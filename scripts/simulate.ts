// Drive real Chasing sessions with a simulated learner and check the resulting evidence.
// Usage: npm run simulate -- <scenarioId|all> [--model provider/id]
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Api, AssistantMessage, Message, Model } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { checkSession, type CheckReport, type ToolOutcome } from "../eval/checks.ts";
import { scenarios, type Scenario } from "../eval/scenarios.ts";
import type { EvidenceEvent } from "../src/domain.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const textOf = (message: { content: unknown }): string =>
  Array.isArray(message.content)
    ? message.content.filter((part) => part?.type === "text").map((part) => part.text).join("\n").trim()
    : String(message.content ?? "").trim();

const list = (items: string[]) => items.map((item) => `- ${item}`).join("\n");

function learnerPrompt({ opening, learner }: Scenario): string {
  return `你在扮演一位正在用 Chasing（一个用提问帮人学习的助手）学习的真实用户。对方只会提问，你来回答。

## 你是谁
${learner.background}

## 你确定知道的
${list(learner.known)}

## 你只懂一半的
${list(learner.partial)}

## 你深信不疑、但其实是错的
${list(learner.misconceptions)}

## 你想达到的目标
${learner.goal}

## 你的说话风格
${learner.style}

## 你已经发出的第一条消息
${opening}

## 规则
- 只根据上面的知识回答。上面没写到的内容你不知道，也不要表现得比设定更懂。
- 你的错误理解是你真心相信的，回答时要主动用它来推理，而不是等对方提起。
- 对方暗示、追问「你确定吗」或直接告诉你正确说法，都不足以让你改口；你会给出支持原观点的理由反驳。
- 只有当对方的问题让你自己推出一个和你的观点矛盾的具体结果（比如你自己的数据或例子算出来不对），你才动摇；动摇时先承认困惑，不要立刻给出完整的正确答案。
- 同一个错误理解被修正后，在新的情境里你仍可能部分退回原来的想法。
- 确实不知道时就说「不知道」或「没想过」，可以先猜再说明不确定。
- 用自然、口语化的中文回复，像在聊天框里打字，不写标题和列表，通常一到四句话。
- 一次回复所有你看到的问题。
- 对方提出学习任务或模式时，如果和你的目标一致就确认，不一致就说明你真正想要什么。
- 对方建议结束时，只有你的目标确实达到了才同意，否则说还想弄清楚什么。
- 只输出你要发出的那条消息本身。`;
}

async function readEvidence(directory: string): Promise<EvidenceEvent[]> {
  const files = await readdir(directory).catch(() => [] as string[]);
  const events: EvidenceEvent[] = [];
  for (const file of files.filter((name) => name.endsWith(".jsonl") && !name.startsWith("."))) {
    const content = await readFile(join(directory, file), "utf8");
    events.push(...content.split("\n").filter(Boolean).map((line) => JSON.parse(line) as EvidenceEvent));
  }
  return events;
}

interface RunResult {
  scenario: Scenario;
  runDir: string;
  turns: number;
  report: CheckReport;
}

async function simulate(scenario: Scenario, modelRuntime: ModelRuntime, model: Model<Api>): Promise<RunResult> {
  const runDir = join(repo, "eval", "runs", `${new Date().toISOString().replace(/[:.]/g, "-")}-${scenario.id}`);
  const cwd = join(runDir, "workspace");
  await mkdir(cwd, { recursive: true });
  if (scenario.material) {
    await mkdir(dirname(join(cwd, scenario.material)), { recursive: true });
    await copyFile(join(repo, scenario.material), join(cwd, scenario.material));
  }

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noContextFiles: true,
    additionalExtensionPaths: [join(repo, "src", "index.ts")],
  });
  await loader.reload();
  const { session, extensionsResult } = await createAgentSession({
    cwd,
    model,
    modelRuntime,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager: SettingsManager.inMemory(),
  });
  if (extensionsResult.errors.length) throw new Error(`Extension load failed: ${JSON.stringify(extensionsResult.errors)}`);

  const tools: ToolOutcome[] = [];
  session.subscribe((event) => {
    if (event.type !== "tool_execution_end") return;
    tools.push({ toolName: event.toolName, isError: event.isError, text: textOf(event.result ?? {}) });
  });

  const evidenceDir = join(cwd, ".chasing", "sessions");
  const transcript = [`# ${scenario.title}（${scenario.id}）`, `模型：${model.provider}/${model.id}`];
  const learnerHistory: Message[] = [];
  let events: EvidenceEvent[] = [];
  let turns = 0;
  try {
    await session.bindExtensions({ mode: "print" });
    await session.prompt("/chasing");
    let learnerText = scenario.opening;
    while (turns < scenario.maxTurns) {
      turns += 1;
      await session.prompt(learnerText);
      const last = [...session.messages].reverse().find((message) => message.role === "assistant");
      const visible = last ? textOf(last) : "";
      if (last?.role === "assistant" && last.stopReason === "error") throw new Error(`Chasing model error: ${last.errorMessage}`);
      transcript.push(`## 第 ${turns} 轮`, `**学习者**\n\n${learnerText}`, `**Chasing**\n\n${visible || "（没有可见回复）"}`);

      events = await readEvidence(evidenceDir);
      if (events.some(({ type }) => type === "session_ended") || turns === scenario.maxTurns) break;

      learnerHistory.push({ role: "user", content: visible || "（对方没有可见回复）", timestamp: Date.now() });
      const reply: AssistantMessage = await modelRuntime.completeSimple(model, {
        systemPrompt: learnerPrompt(scenario),
        messages: learnerHistory,
      });
      if (reply.stopReason === "error") throw new Error(`Learner model error: ${reply.errorMessage}`);
      learnerText = textOf(reply);
      learnerHistory.push({ ...reply, content: reply.content.filter((part) => part.type === "text") });
    }
  } finally {
    session.dispose();
    events = await readEvidence(evidenceDir);
    await writeFile(join(runDir, "transcript.md"), `${transcript.join("\n\n")}\n`, "utf8");
  }

  const report = checkSession(events, tools, scenario.maxTurns);
  await writeFile(
    join(runDir, "report.json"),
    `${JSON.stringify({ scenario: scenario.id, model: `${model.provider}/${model.id}`, turns, report, tools }, null, 2)}\n`,
    "utf8",
  );
  return { scenario, runDir, turns, report };
}

function summary({ scenario, runDir, turns, report }: RunResult): string {
  const hard = report.results.filter(({ hard }) => hard);
  const failed = report.results.filter(({ pass }) => !pass).map(({ name }) => name);
  const ended = report.results.find(({ name }) => name === "session-ended")?.pass ? "ended" : "not ended";
  return `${report.pass ? "PASS" : "FAIL"} ${scenario.id} · hard ${hard.filter(({ pass }) => pass).length}/${hard.length} · turns ${turns}/${scenario.maxTurns} · ${ended}${failed.length ? ` · failed: ${failed.join(", ")}` : ""} · ${runDir}`;
}

const args = process.argv.slice(2);
const modelFlag = args.indexOf("--model");
const [provider, ...idParts] = (modelFlag >= 0 ? args[modelFlag + 1] ?? "" : "deepseek/deepseek-v4-flash").split("/");
const [target] = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--model");
const selected = target === "all" ? scenarios : scenarios.filter(({ id }) => id === target);
if (!target || selected.length === 0) {
  console.error(`Usage: npm run simulate -- <${scenarios.map(({ id }) => id).join("|")}|all> [--model provider/id]`);
  process.exit(1);
}

const modelRuntime = await ModelRuntime.create();
const model = modelRuntime.getModel(provider ?? "", idParts.join("/"));
if (!model) {
  console.error(`Unknown model: ${provider}/${idParts.join("/")}`);
  process.exit(1);
}

let failures = 0;
for (const scenario of selected) {
  try {
    const result = await simulate(scenario, modelRuntime, model);
    if (!result.report.pass) failures += 1;
    console.log(summary(result));
  } catch (error) {
    failures += 1;
    console.log(`ERROR ${scenario.id} · ${error instanceof Error ? error.message : String(error)}`);
  }
}
process.exit(failures ? 1 : 0);
