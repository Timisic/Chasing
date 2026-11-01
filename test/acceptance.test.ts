import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import chasingExtension from "../src/index.ts";

process.env.CHASING_CONFIG_PATH = join(await mkdtemp(join(tmpdir(), "chasing-test-config-")), "config.json");

type Handler = (event: any, context: any) => any;

class FakePi {
  readonly handlers = new Map<string, Handler[]>();
  readonly tools = new Map<string, any>();
  readonly commands = new Map<string, any>();
  readonly entries: Array<{ customType: string; data: unknown }> = [];
  readonly messages: Array<{ message: any; options: any }> = [];

  on(name: string, handler: Handler): void {
    const handlers = this.handlers.get(name) ?? [];
    handlers.push(handler);
    this.handlers.set(name, handlers);
  }

  registerTool(tool: any): void {
    this.tools.set(tool.name, tool);
  }

  registerCommand(name: string, command: any): void {
    this.commands.set(name, command);
  }

  appendEntry(customType: string, data: unknown): void {
    this.entries.push({ customType, data });
  }

  sendMessage(message: any, options: any): void {
    this.messages.push({ message, options });
  }

  setSessionName(): void {}

  async emit(name: string, event: any, context: any): Promise<any[]> {
    return Promise.all((this.handlers.get(name) ?? []).map((handler) => handler(event, context)));
  }
}

async function harness() {
  const cwd = await mkdtemp(join(tmpdir(), "chasing-"));
  const pi = new FakePi();
  const notifications: string[] = [];
  const statuses: Array<string | undefined> = [];
  const context = {
    cwd,
    mode: "tui",
    hasUI: true,
    model: { provider: "deepseek", id: "deepseek-chat" },
    thinkingLevel: "medium",
    ui: {
      notify: (message: string) => notifications.push(message),
      setStatus: (_name: string, value?: string) => statuses.push(value),
      setWidget() {},
      setHiddenThinkingLabel() {},
    },
    sessionManager: {
      getSessionId: () => "pi-session-1",
      getSessionFile: () => join(cwd, "pi-session.jsonl"),
      getBranch: () => [],
    },
  };

  const request = ((input: string | URL | Request, init?: RequestInit) => globalThis.fetch(input, init)) as typeof fetch;
  chasingExtension(pi as any, {
    request,
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  return { cwd, pi, context, notifications, statuses };
}

async function startedHarness() {
  const result = await harness();
  await result.pi.emit("session_start", { type: "session_start", reason: "startup" }, result.context);
  return result;
}

async function runTool(pi: FakePi, name: string, params: Record<string, unknown>) {
  const tool = pi.tools.get(name);
  assert.ok(tool, `tool ${name} should be registered`);
  return tool.execute(`call-${name}`, params, new AbortController().signal, () => {}, {});
}

function latestState(pi: FakePi): any {
  return [...pi.entries].reverse().find((entry) => entry.customType === "chasing:state")?.data;
}

async function establishLearnMission(pi: FakePi, context: any, mission: string) {
  await runTool(pi, "chasing_prepare_diagnostic_round", {
    rationale: "A minimal diagnostic establishes the evidence required for this acceptance scenario.",
    questions: [
      { title: "Existing model", question: "What do you already believe about this topic?" },
      { title: "Uncertainty", question: "Which part is least clear to you?" },
    ],
  });
  await pi.emit(
    "before_agent_start",
    { type: "before_agent_start", prompt: "I know the basics but the mechanism is unclear.", systemPrompt: "BASE", systemPromptOptions: {} },
    context,
  );
  await runTool(pi, "chasing_record_mastery_map", {
    areas: [
      { topic: "basic vocabulary", status: "known", evidence: "The user reports knowing the basics." },
      { topic: "mechanism", status: "unknown", evidence: "The user says the mechanism is unclear." },
    ],
  });
  await runTool(pi, "chasing_confirm_mode", { mode: "learn" });
  await runTool(pi, "chasing_confirm_mission", { mission });
  await runTool(pi, "chasing_define_coverage", {
    items: [
      { topic: "core vocabulary" },
      { topic: "underlying mechanism" },
      { topic: "independent verification" },
    ],
  });
}

test("Pi startup activates Chasing silently and waits for user input", async () => {
  const { pi, context } = await harness();

  await pi.emit("session_start", { type: "session_start", reason: "startup" }, context);

  assert.equal(pi.messages.length, 0);
  assert.ok(pi.commands.has("chasing-leave"));
  assert.ok(pi.commands.has("chasing-sync"));
  assert.ok(pi.tools.has("chasing_prepare_question"));
  assert.equal(pi.entries[0]?.customType, "chasing:event");
});

test("Chasing blocks implicit workspace enumeration before the user supplies material", async () => {
  const { pi, context } = await startedHarness();

  for (const event of [
    { type: "tool_call", toolCallId: "ls-1", toolName: "ls", input: { path: context.cwd } },
    { type: "tool_call", toolCallId: "find-1", toolName: "find", input: { pattern: "**/*", path: context.cwd } },
    { type: "tool_call", toolCallId: "grep-1", toolName: "grep", input: { pattern: "TODO", path: context.cwd } },
    { type: "tool_call", toolCallId: "read-1", toolName: "read", input: { path: join(context.cwd, "random.md") } },
    { type: "tool_call", toolCallId: "bash-1", toolName: "bash", input: { command: "find . -type f" } },
  ]) {
    const results = await pi.emit("tool_call", event, context);
    assert.equal(results[0]?.block, true, `${event.toolName} should be blocked`);
    assert.match(results[0]?.reason, /explicitly supplied Markdown material/i);
  }

  const [networkRetrievalGuard] = await pi.emit(
    "tool_call",
    {
      type: "tool_call",
      toolCallId: "curl-1",
      toolName: "bash",
      input: { command: "curl -fsSL --max-time=10 https://example.com/reference" },
    },
    context,
  );
  assert.equal(networkRetrievalGuard?.block, true);
});

test("print mode waits for the initial user prompt instead of starting a competing turn", async () => {
  const { pi, context } = await harness();
  context.mode = "print";
  context.hasUI = false;

  await pi.emit("session_start", { type: "session_start", reason: "startup" }, context);

  assert.equal(pi.messages.length, 0);
  const [result] = await pi.emit(
    "before_agent_start",
    { type: "before_agent_start", prompt: "Teach me event loops", systemPrompt: "BASE", systemPromptOptions: {} },
    context,
  );
  assert.match(result.systemPrompt, /Chasing extension/);
  const latestEvent: any = [...pi.entries].reverse().find((entry) => entry.customType === "chasing:event");
  assert.equal(latestEvent.data.type, "user_input");
  assert.equal(latestEvent.data.data.prompt, "Teach me event loops");
});

test("Learn onboarding can batch the current diagnostic frontier and persist a mastery map", async () => {
  const { pi, context, statuses } = await startedHarness();

  await runTool(pi, "chasing_confirm_mode", { mode: "learn" });
  await assert.rejects(
    runTool(pi, "chasing_confirm_mission", { mission: "Map the Eval lifecycle." }),
    /mastery map/i,
  );

  await runTool(pi, "chasing_prepare_diagnostic_round", {
    rationale: "The initial description exposes several independent calibration questions.",
    introduction: "先用一轮快速探测定位你的起点；不知道也可以直接写不知道。",
    questions: [
      { title: "生命周期", question: "你会把 benchmark 放在模型生命周期的哪个位置？" },
      { title: "训练侧", question: "Reward model 属于预训练还是后训练？" },
      { title: "产品侧", question: "线上 bad case 如何进入下一轮评测？" },
    ],
  });
  assert.equal(latestState(pi).phase, "diagnosis");
  assert.equal(statuses.at(-1), "Chasing · 掌握度探测");

  const assistant = {
    role: "assistant",
    content: [{ type: "text", text: "extra" }],
    stopReason: "stop",
    timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
  const [replacement] = await pi.emit("message_end", { type: "message_end", message: assistant }, context);
  const visible = replacement.message.content.find((part: any) => part.type === "text").text;
  assert.match(visible, /❓ \*\*Q1\*\* - \*\*生命周期\*\*/);
  assert.match(visible, /❓ \*\*Q3\*\* - \*\*产品侧\*\*/);
  assert.doesNotMatch(visible, /推荐答案|➡️/);

  await pi.emit(
    "before_agent_start",
    { type: "before_agent_start", prompt: "1. 发布前；2. 不确定；3. 回流成回归集。", systemPrompt: "BASE", systemPromptOptions: {} },
    context,
  );
  await runTool(pi, "chasing_record_mastery_map", {
    areas: [
      { topic: "benchmark placement", status: "known", evidence: "Correctly placed before release." },
      { topic: "reward model lifecycle", status: "unknown", evidence: "Explicitly uncertain." },
      { topic: "online feedback loop", status: "partial", evidence: "Named regression data but not rubric updates." },
    ],
  });
  assert.equal(latestState(pi).masteryMap.length, 3);
  assert.equal(latestState(pi).masteryMap[1].status, "unknown");
  await runTool(pi, "chasing_confirm_mission", { mission: "Map the Eval lifecycle." });
  assert.equal(latestState(pi).phase, "mapping");
  await assert.rejects(
    runTool(pi, "chasing_prepare_question", {
      stage: "mapping",
      rationale: "The map cannot begin until the mission checklist exists.",
      question: "Where should the map begin?",
      intervention: "none",
      sources: [],
    }),
    /coverage/i,
  );
  await runTool(pi, "chasing_define_coverage", {
    items: [
      { topic: "training-time eval" },
      { topic: "deployment eval" },
      { topic: "agent eval" },
    ],
  });

  const [prompt] = await pi.emit(
    "before_agent_start",
    { type: "before_agent_start", prompt: "继续", systemPrompt: "BASE", systemPromptOptions: {} },
    context,
  );
  assert.match(prompt.systemPrompt, /reward model lifecycle/);
  assert.match(prompt.systemPrompt, /unknown/);
});

test("the user can override the recommended mode and must confirm the mission", async () => {
  const { pi, context, statuses } = await startedHarness();

  await runTool(pi, "chasing_recommend_mode", { mode: "learn", reason: "The user wants external knowledge." });
  await runTool(pi, "chasing_confirm_mode", { mode: "clarify-decide" });
  await runTool(pi, "chasing_propose_mission", { mission: "Decide whether to narrow the product scope." });

  assert.equal(latestState(pi).phase, "mission-review");
  assert.equal(statuses.at(-1), "Chasing · 任务确认");
  assert.equal(latestState(pi).mission, undefined);

  await runTool(pi, "chasing_confirm_mission", { mission: "Decide whether to narrow the product scope." });
  assert.equal(latestState(pi).mode, "clarify-decide");
  assert.equal(latestState(pi).evaluationEligible, false);
  assert.equal(latestState(pi).phase, "mapping");
  assert.equal(statuses.at(-1), "Chasing · 全景构建");

  const [result] = await pi.emit(
    "before_agent_start",
    { type: "before_agent_start", prompt: "继续", systemPrompt: "BASE", systemPromptOptions: {} },
    context,
  );
  assert.match(result.systemPrompt, /Current state/);
  assert.match(result.systemPrompt, /Decide whether to narrow/);
});

test("Learn mode captures Markdown content, allows only that file, and rejects unsupported material", async () => {
  const { cwd, pi, context } = await startedHarness();
  const markdownPath = join(cwd, "guide.md");
  const textPath = join(cwd, "guide.txt");
  await writeFile(markdownPath, "# Primary material\n", "utf8");
  await writeFile(textPath, "not supported\n", "utf8");

  await runTool(pi, "chasing_confirm_mode", { mode: "learn" });
  await runTool(pi, "chasing_add_material", { paths: [markdownPath] });

  const material = latestState(pi).materials[0];
  assert.equal(material.path, await realpath(markdownPath));
  assert.equal(material.content, "# Primary material\n");
  assert.match(material.sha256, /^[a-f0-9]{64}$/);
  assert.equal(latestState(pi).evaluationEligible, true);

  const [readGuard] = await pi.emit(
    "tool_call",
    { type: "tool_call", toolCallId: "read-material", toolName: "read", input: { path: await realpath(markdownPath) } },
    context,
  );
  assert.equal(readGuard, undefined);

  await assert.rejects(
    runTool(pi, "chasing_add_material", { paths: [textPath] }),
    /accepts only Markdown/,
  );
});

test("a private rationale is persisted before its answer and never rendered", async () => {
  const { cwd, pi, context } = await startedHarness();
  await establishLearnMission(pi, context, "Explain event loop ordering in my own words.");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("Event loop phases", { status: 200, headers: { "content-type": "text/plain" } })) as typeof fetch;
  try {
    await runTool(pi, "chasing_fetch_sources", {
      query: "Node.js event loop official documentation",
      sources: [{ title: "Node.js event loop", url: "https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick", kind: "official" }],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  await runTool(pi, "chasing_prepare_question", {
    stage: "deepening",
    rationale: "The user named the queues but has not explained ordering.",
    question: "Which queue runs first after the current call stack is empty?",
    intervention: "none",
    sources: [{ title: "Node.js event loop", url: "https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick", kind: "official" }],
  });
  await runTool(pi, "chasing_prepare_question", {
    stage: "deepening",
    rationale: "The user named the queues but has not explained ordering.",
    question: "Which queue runs first after the current call stack is empty?",
    intervention: "none",
    sources: [{ title: "Node.js event loop", url: "https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick", kind: "official" }],
  });

  const assistant = {
    role: "assistant",
    content: [{ type: "text", text: "LEAKED RATIONALE and extra prose" }],
    stopReason: "stop",
    timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
  const [replacement] = await pi.emit("message_end", { type: "message_end", message: assistant }, context);
  const visible = replacement.message.content.find((part: any) => part.type === "text").text;
  assert.doesNotMatch(visible, /rationale|queues but/i);
  assert.match(visible, /Which queue runs first/);
  assert.match(visible, /nodejs\.org/);
  assert.equal((visible.match(/[?？]/g) ?? []).length, 1);

  await pi.emit(
    "before_agent_start",
    { type: "before_agent_start", prompt: "I think microtasks run first.", systemPrompt: "BASE", systemPromptOptions: {} },
    context,
  );
  const evidencePath = join(cwd, ".chasing", "sessions", "pi-session-1.jsonl");
  const events = (await readFile(evidencePath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  const prepared = events.find((event) => event.type === "question_prepared");
  assert.equal(events.filter((event) => event.type === "question_prepared").length, 1);
  const completed = events.find((event) => event.type === "assistant_turn_completed");
  assert.match(completed.data.output, /Which queue runs first/);
  assert.doesNotMatch(completed.data.output, /queues but/i);
  assert.equal(completed.data.usage.totalTokens, 0);
  const answer = events.find((event) => event.type === "user_answer");
  assert.ok(prepared.sequence < answer.sequence);
  assert.equal(answer.data.questionId, prepared.data.questionId);
});

test("a no-material Learn session retains full retrieval trace but displays at most three links", async () => {
  const { cwd, pi, context } = await startedHarness();
  await establishLearnMission(pi, context, "Understand a fact that requires current official sources.");
  assert.equal(latestState(pi).materials.length, 0);

  const sources = [1, 2, 3, 4].map((number) => ({
    title: `Official source ${number}`,
    url: `https://example.org/official-${number}`,
    kind: "official",
    excerpt: `Primary evidence ${number}`,
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => new Response(`Primary evidence for ${String(input)}`, {
    status: 200,
    headers: { "content-type": "text/plain" },
  })) as typeof fetch;
  try {
    await runTool(pi, "chasing_fetch_sources", {
      query: "current official fact",
      sources: sources.map(({ title, url, kind }) => ({ title, url, kind })),
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  await runTool(pi, "chasing_prepare_question", {
    stage: "deepening",
    rationale: "The next question depends on the retrieved official fact.",
    question: "How does this official definition change your earlier explanation?",
    intervention: "none",
    sources: sources.slice(0, 3).map(({ title, url, kind }) => ({ title, url, kind })),
  });

  const assistant = {
    role: "assistant",
    content: [{ type: "text", text: "extra" }],
    stopReason: "stop",
    timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
  const [replacement] = await pi.emit("message_end", { type: "message_end", message: assistant }, context);
  const visible = replacement.message.content.find((part: any) => part.type === "text").text;
  assert.equal((visible.match(/https:\/\/example\.org/g) ?? []).length, 3);

  const events = (await readFile(join(cwd, ".chasing", "sessions", "pi-session-1.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line));
  const sourceEvent = events.find((event) => event.type === "sources_retrieved");
  assert.equal(sourceEvent.data.sources.length, 4);
  assert.equal(sourceEvent.data.tool, "chasing_fetch_sources");
});

test("Learn retrieval fetches primary sources before recording and auto-links cited URLs", async () => {
  const { pi, context } = await startedHarness();
  await establishLearnMission(pi, context, "Understand the event loop from primary sources.");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    assert.equal(String(input), "https://example.org/");
    return new Response("<html><body><h1>Primary paper</h1><p>The event loop advances through phases.</p></body></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }) as typeof fetch;
  try {
    const retrieval = await runTool(pi, "chasing_fetch_sources", {
      query: "event loop phases",
      sources: [{ title: "Primary paper", url: "https://example.org", kind: "primary" }],
    });
    assert.match(retrieval.content[0].text, /retrievalId: [a-f0-9-]+/i);
    assert.match(latestState(pi).retrievals[0].sources[0].excerpt, /advances through phases/);
  } finally {
    globalThis.fetch = originalFetch;
  }

  await runTool(pi, "chasing_prepare_question", {
    stage: "mapping",
    rationale: "The primary source establishes the phase model needed by the next question.",
    context: "The source describes an event loop as a sequence of phases.",
    question: "Which phase transition matters for your example？",
    intervention: "none",
    sources: [{ title: "Primary paper", url: "https://example.org", kind: "primary" }],
  });
  const assistant = {
    role: "assistant",
    content: [{ type: "text", text: "extra" }],
    stopReason: "stop",
    timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
  const [replacement] = await pi.emit("message_end", { type: "message_end", message: assistant }, context);
  const visible = replacement.message.content.find((part: any) => part.type === "text").text;
  assert.match(visible, /\[Primary paper\]\(https:\/\/example\.org\/\)/);
});

test("a focused question preserves its background, terms, example, and answer guide", async () => {
  const { pi, context } = await startedHarness();
  await establishLearnMission(pi, context, "Understand promises.");

  await runTool(pi, "chasing_prepare_question", {
    stage: "mapping",
    rationale: "The user needs a coordinate system before reasoning about checkpoint selection.",
    context: "训练会周期性保存 checkpoint；开发集用于反复选择，最终测试集保持隔离。",
    terms: [{ term: "checkpoint", definition: "训练过程中保存的一份模型状态" }],
    example: "例如比较第 10k 与第 20k step 的任务表现。",
    question: "你会用什么证据决定保留哪一个 checkpoint？",
    answerGuide: "可以从训练信号、开发集表现和最终测试隔离三个角度回答。",
    intervention: "none",
    sources: [],
  });
  const assistant = {
    role: "assistant",
    content: [{ type: "text", text: "extra" }],
    stopReason: "stop",
    timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
  const [replacement] = await pi.emit("message_end", { type: "message_end", message: assistant }, context);
  const visible = replacement.message.content.find((part: any) => part.type === "text").text;
  assert.match(visible, /训练会周期性保存 checkpoint/);
  assert.match(visible, /checkpoint：训练过程中保存的一份模型状态/);
  assert.match(visible, /例如比较第 10k/);
  assert.match(visible, /你会用什么证据决定/);
  assert.match(visible, /训练信号、开发集表现/);
  assert.equal((visible.match(/[?？]/g) ?? []).length, 1);
});

test("question and intervention guards reject batch questions and long teaching", async () => {
  const { pi, context } = await startedHarness();
  await establishLearnMission(pi, context, "Understand promises.");

  await assert.rejects(
    runTool(pi, "chasing_prepare_question", {
      stage: "mapping",
      rationale: "Two concepts remain unclear.",
      question: "What is a promise? Why use one?",
      intervention: "none",
      sources: [],
    }),
    /exactly one focused question/i,
  );
  const diagnosticPi = (await startedHarness()).pi;
  await assert.rejects(
    runTool(diagnosticPi, "chasing_prepare_diagnostic_round", {
      rationale: "One generated item is incomplete.",
      questions: [
        { title: "Complete", question: "What is a promise?" },
        { title: "Incomplete", question: "Why does this rule" },
      ],
    }),
    /exactly one focused question/i,
  );

  await assert.rejects(
    runTool(pi, "chasing_prepare_question", {
      stage: "deepening",
      rationale: "The user asked for help.",
      question: "What changes with this hint?",
      intervention: "explain",
      interventionText: "x".repeat(401),
      sources: [],
    }),
    /extremely short/,
  );
});

test("ending is only a suggestion until the user explicitly confirms, with no summary", async () => {
  const { pi, context, statuses } = await startedHarness();
  await runTool(pi, "chasing_confirm_mode", { mode: "clarify-decide" });
  await runTool(pi, "chasing_confirm_mission", { mission: "Choose a launch scope." });

  await assert.rejects(
    runTool(pi, "chasing_suggest_end", { reason: "Trade-offs are explicit." }),
    /coverage|verification/i,
  );
  await assert.rejects(
    runTool(pi, "chasing_define_coverage", {
      items: [
        { topic: "Target user and problem" },
        { topic: "Launch trade-offs" },
      ],
    }),
    /3-8/,
  );
  await runTool(pi, "chasing_define_coverage", {
    items: [
      { topic: "Target user and problem" },
      { topic: "Launch trade-offs" },
      { topic: "Success evidence" },
    ],
  });
  await runTool(pi, "chasing_prepare_question", {
    stage: "verification",
    rationale: "The user should restate the decision and its main trade-off before ending.",
    context: "Use the two agreed coverage items as the checklist.",
    question: "What launch scope do you choose, and which trade-off makes it preferable？",
    intervention: "none",
    sources: [],
  });
  await pi.emit(
    "before_agent_start",
    { type: "before_agent_start", prompt: "Launch narrowly for one user segment because support cost is the binding trade-off.", systemPrompt: "BASE", systemPromptOptions: {} },
    context,
  );
  await runTool(pi, "chasing_update_coverage", {
    updates: [
      { topic: "Target user and problem", status: "verified", evidence: "Named one user segment and its problem." },
      { topic: "Launch trade-offs", status: "verified", evidence: "Identified support cost as binding." },
      { topic: "Success evidence", status: "verified", evidence: "Named what would prove the launch worked." },
    ],
  });
  await runTool(pi, "chasing_suggest_end", { reason: "Trade-offs are explicit." });
  assert.equal(latestState(pi).active, true);
  assert.equal(latestState(pi).phase, "ending");
  assert.equal(statuses.at(-1), "Chasing · 结束确认");

  const declined = await runTool(pi, "chasing_confirm_end", { confirmed: false });
  assert.match(declined.content[0].text, /Continue questioning/);
  assert.equal(latestState(pi).active, true);
  assert.equal(statuses.at(-1), "Chasing · 盲区深挖");

  await runTool(pi, "chasing_suggest_end", { reason: "The user reconfirmed the choice." });
  const ended = await runTool(pi, "chasing_confirm_end", { confirmed: true });
  assert.equal(latestState(pi).active, false);
  assert.equal(latestState(pi).phase, "ended");
  assert.match(ended.content[0].text, /Do not summarize/);
  const endEvent: any = [...pi.entries].reverse().find((entry: any) => entry.customType === "chasing:event");
  assert.equal(endEvent.data.data.summaryGenerated, false);
});

test("diagnostic mastery cannot be rewritten after mission confirmation", async () => {
  const { pi, context } = await startedHarness();

  await runTool(pi, "chasing_prepare_diagnostic_round", {
    rationale: "The user has independent starting-point unknowns.",
    questions: [
      { title: "Goal", question: "What outcome would make this session successful?" },
      { title: "Knowledge", question: "Which part of the topic already feels clear?" },
    ],
  });
  await pi.emit(
    "before_agent_start",
    { type: "before_agent_start", prompt: "I want a decision, and the terminology is unclear.", systemPrompt: "BASE", systemPromptOptions: {} },
    context,
  );
  await runTool(pi, "chasing_record_mastery_map", {
    areas: [
      { topic: "decision frame", status: "partial", evidence: "User named a desired decision." },
      { topic: "terminology", status: "unknown", evidence: "User said terminology is unclear." },
    ],
  });
  await runTool(pi, "chasing_confirm_mode", { mode: "learn" });
  await runTool(pi, "chasing_confirm_mission", { mission: "Clarify the topic enough to make a decision." });

  await assert.rejects(
    runTool(pi, "chasing_record_mastery_map", {
      areas: [
        { topic: "rewritten after mission", status: "known", evidence: "This should not be accepted." },
        { topic: "another rewrite", status: "known", evidence: "This should not be accepted." },
      ],
    }),
    /before mission confirmation/i,
  );
  assert.equal(latestState(pi).masteryMap[0].topic, "decision frame");
});

test("Langfuse misconfiguration never blocks canonical local evidence", async () => {
  const { cwd, pi, context } = await harness();
  await mkdir(join(cwd, ".chasing"), { recursive: true });
  await writeFile(
    join(cwd, ".chasing", "config.json"),
    JSON.stringify({ langfuse: { enabled: true, publicKey: "", secretKey: "" } }),
    "utf8",
  );

  await pi.emit("session_start", { type: "session_start", reason: "startup" }, context);
  await runTool(pi, "chasing_confirm_mode", { mode: "learn" });

  const evidence = await readFile(join(cwd, ".chasing", "sessions", "pi-session-1.jsonl"), "utf8");
  assert.match(evidence, /session_started/);
  assert.match(evidence, /mode_confirmed/);
  assert.match(evidence, /chasing-config-v1/);
});
