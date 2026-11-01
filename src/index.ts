import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";

import { Type } from "@earendil-works/pi-ai";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { isToolCallEventType, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

import { CONFIG_VERSION, loadConfig, type ChasingConfig } from "./config.ts";
import {
  createInitialState,
  type ChasingMode,
  type ChasingState,
  type CoverageItem,
  type Intervention,
  type MasteryArea,
  type PreparedDiagnosticRound,
  type PreparedQuestion,
  type RetrievalTrace,
  type SourceReference,
} from "./domain.ts";
import { EvidenceRecorder } from "./evidence.ts";
import { DisabledSynchronizer, LangfuseSynchronizer } from "./langfuse.ts";
import { buildChasingPrompt } from "./prompt.ts";
import { fetchRetrievedSources, type HostResolver } from "./retrieval.ts";

const STATE_ENTRY = "chasing:state";
const MATERIAL_ACCESS_BLOCK_REASON =
  "Chasing does not inspect the current workspace. Only explicitly supplied Markdown material may be read.";

function textResult(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text }], details };
}

function restoreState(ctx: ExtensionContext): ChasingState | undefined {
  const branch = ctx.sessionManager.getBranch();
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type === "custom" && entry.customType === STATE_ENTRY && entry.data) {
      return structuredClone(entry.data as ChasingState);
    }
  }
  return undefined;
}

function questionCount(text: string): number {
  return (text.match(/[?？]/g) ?? []).length;
}

function validateQuestion(question: string): string {
  const normalized = question.trim();
  if (!normalized) throw new Error("Question cannot be empty");
  if (questionCount(normalized) !== 1) {
    throw new Error("Ask exactly one focused question; put background, terms, and examples in their dedicated fields");
  }
  return normalized;
}

function formatQuestion(question: PreparedQuestion): string {
  const parts: string[] = [];
  if (question.interventionText) parts.push(question.interventionText.trim());
  if (question.context) parts.push(question.context.trim());
  if (question.terms?.length) {
    parts.push(`术语：${question.terms.map(({ term, definition }) => `${term}：${definition}`).join("；")}`);
  }
  if (question.example) parts.push(`例子：${question.example.trim()}`);
  parts.push(question.question);
  if (question.answerGuide) parts.push(`回答时可以参考：${question.answerGuide.trim()}`);
  if (question.sources.length > 0) {
    parts.push(`依据：${question.sources.map((source) => `[${source.title}](${source.url})`).join(" · ")}`);
  }
  return parts.join("\n\n");
}

function formatDiagnosticRound(round: PreparedDiagnosticRound): string {
  const parts = round.questions.map(
    ({ title, question }, index) => `❓ **Q${index + 1}** - **${title}**: ${question}`,
  );
  return [round.introduction?.trim(), ...parts].filter(Boolean).join("\n\n");
}

function replaceAssistantText(message: AgentMessage, text: string): AgentMessage {
  if (message.role !== "assistant") return message;
  const nonText = message.content.filter((part) => part.type !== "text");
  return { ...message, content: [...nonText, { type: "text", text }] };
}

function snapshotModel(ctx: ExtensionContext): ChasingState["model"] {
  if (!ctx.model) return undefined;
  return {
    provider: ctx.model.provider,
    id: ctx.model.id,
    ...(ctx.thinkingLevel ? { thinkingLevel: ctx.thinkingLevel } : {}),
  };
}

function phaseStatus(phase: ChasingState["phase"]): string | undefined {
  const labels: Partial<Record<ChasingState["phase"], string>> = {
    onboarding: "目标澄清",
    diagnosis: "掌握度探测",
    "mission-review": "任务确认",
    mapping: "全景构建",
    deepening: "盲区深挖",
    verification: "理解验收",
    ending: "结束确认",
  };
  const label = labels[phase];
  return label ? `Chasing · ${label}` : undefined;
}

interface ChasingDependencies {
  request?: typeof fetch;
  resolveHost?: HostResolver;
}

export default function chasingExtension(pi: ExtensionAPI, dependencies: ChasingDependencies = {}): void {
  let state: ChasingState | undefined;
  let config: ChasingConfig | undefined;
  let recorder: EvidenceRecorder | undefined;
  let context: ExtensionContext | undefined;
  let preparedForRender: PreparedQuestion | PreparedDiagnosticRound | undefined;

  const requireRuntime = () => {
    if (!state || !recorder || !config || !context) throw new Error("Chasing session has not started");
    return { state, recorder, config, context };
  };

  const record = async (type: string, data: Record<string, unknown>) => {
    const runtime = requireRuntime();
    return runtime.recorder.record(runtime.state, type, data);
  };

  const setPhase = (phase: ChasingState["phase"]) => {
    const runtime = requireRuntime();
    runtime.state.phase = phase;
    runtime.context.ui.setStatus("chasing", phaseStatus(phase));
  };

  pi.on("session_start", async (event, ctx) => {
    context = ctx;
    config = await loadConfig(ctx.cwd);
    state = restoreState(ctx) ?? createInitialState(ctx.sessionManager.getSessionId() || randomUUID());
    if ((state.phase as string) === "questioning") state.phase = "deepening";
    state.versions.config = CONFIG_VERSION;
    state.retrievals ??= [];
    state.masteryMap ??= [];
    state.coverage ??= [];
    state.verificationCompleted ??= false;
    const model = snapshotModel(ctx);
    if (model) {
      state.model = model;
    } else {
      delete state.model;
    }
    recorder = new EvidenceRecorder(
      ctx.cwd,
      config,
      pi,
      config.langfuse.enabled ? new LangfuseSynchronizer(config.langfuse) : new DisabledSynchronizer(),
    );

    ctx.ui.setStatus("chasing", state.active ? phaseStatus(state.phase) : undefined);
    ctx.ui.setHiddenThinkingLabel("Chasing 正在选择下一问…");
    if (event.reason === "startup" && state.active && state.sequence === 0) {
      await record("session_started", { piSessionFile: ctx.sessionManager.getSessionFile() });
      pi.setSessionName("Chasing");
    }
  });

  pi.on("before_agent_start", async (event) => {
    if (!state?.active || !recorder) return;
    if (state.pendingDiagnosticRound && !state.pendingDiagnosticRound.answered) {
      state.pendingDiagnosticRound.answered = true;
      await record("diagnostic_answer", {
        roundId: state.pendingDiagnosticRound.id,
        answer: event.prompt,
      });
    } else if (state.pendingQuestion && !state.pendingQuestion.answered) {
      state.pendingQuestion.answered = true;
      if (state.pendingQuestion.stage === "verification") state.verificationCompleted = true;
      await record("user_answer", {
        questionId: state.pendingQuestion.id,
        answer: event.prompt,
      });
    } else {
      await record("user_input", { prompt: event.prompt });
    }
    return { systemPrompt: buildChasingPrompt(event.systemPrompt, state) };
  });

  pi.on("message_end", async (event) => {
    if (!state?.active || !preparedForRender || event.message.role !== "assistant") return;
    if (event.message.stopReason !== "stop") return;
    const prepared = preparedForRender;
    const rendered = "questions" in prepared ? formatDiagnosticRound(prepared) : formatQuestion(prepared);
    await record("assistant_turn_completed", {
      preparedId: prepared.id,
      kind: "questions" in prepared ? "diagnostic-round" : "question",
      output: rendered,
      stopReason: event.message.stopReason,
      usage: event.message.usage,
    });
    preparedForRender = undefined;
    return { message: replaceAssistantText(event.message, rendered) };
  });

  pi.on("model_select", async (event) => {
    if (!state?.active) return;
    state.model = {
      provider: event.model.provider,
      id: event.model.id,
      ...(context?.thinkingLevel ? { thinkingLevel: context.thinkingLevel } : {}),
    };
    await record("model_selected", state.model);
  });

  pi.on("tool_call", (event, ctx) => {
    if (!state?.active) return;

    if (
      isToolCallEventType("ls", event)
      || isToolCallEventType("find", event)
    ) {
      return { block: true, reason: MATERIAL_ACCESS_BLOCK_REASON };
    }

    if (isToolCallEventType("bash", event)) {
      return { block: true, reason: MATERIAL_ACCESS_BLOCK_REASON };
    }

    if (isToolCallEventType("read", event) || isToolCallEventType("grep", event)) {
      const requestedPath = resolve(ctx.cwd, event.input.path ?? ".");
      const isExplicitMaterial = state.materials.some((material) => material.path === requestedPath);
      if (!isExplicitMaterial) return { block: true, reason: MATERIAL_ACCESS_BLOCK_REASON };
    }
  });

  pi.registerTool({
    name: "chasing_prepare_diagnostic_round",
    label: "Prepare Chasing diagnostic round",
    description: "Prepare one batch of currently independent onboarding questions to map the learner's starting point.",
    parameters: Type.Object({
      rationale: Type.String({ description: "Private reason this frontier is the right diagnostic batch" }),
      introduction: Type.Optional(Type.String({ description: "Short, reassuring visible introduction" })),
      questions: Type.Array(
        Type.Object({
          title: Type.String(),
          question: Type.String({ description: "One independent diagnostic question; do not reveal the answer" }),
        }),
        { minItems: 2, maxItems: 8 },
      ),
    }),
    async execute(_id, params) {
      const runtime = requireRuntime();
      if (runtime.state.mission) throw new Error("Diagnostic rounds belong before mission confirmation");
      if (runtime.state.pendingQuestion && !runtime.state.pendingQuestion.answered) {
        throw new Error("A Chasing question is already awaiting the user's answer");
      }
      if (runtime.state.pendingDiagnosticRound && !runtime.state.pendingDiagnosticRound.answered) {
        throw new Error("A diagnostic round is already awaiting the user's answer");
      }
      const rationale = params.rationale.trim();
      if (!rationale) throw new Error("A brief private rationale is required");
      const round: PreparedDiagnosticRound = {
        id: randomUUID(),
        rationale,
        ...(params.introduction?.trim() ? { introduction: params.introduction.trim() } : {}),
        questions: params.questions.map(({ title, question }) => ({
          title: title.trim(),
          question: validateQuestion(question),
        })),
        preparedAt: new Date().toISOString(),
        answered: false,
      };
      runtime.state.pendingDiagnosticRound = round;
      preparedForRender = round;
      setPhase("diagnosis");
      await record("diagnostic_round_prepared", {
        roundId: round.id,
        rationale: round.rationale,
        ...(round.introduction ? { introduction: round.introduction } : {}),
        questions: round.questions,
      });
      return textResult("Diagnostic round prepared. Emit no additional prose.", { roundId: round.id });
    },
  });

  pi.registerTool({
    name: "chasing_record_mastery_map",
    label: "Record Chasing mastery map",
    description: "Persist the evidence-backed starting map derived from diagnostic answers.",
    parameters: Type.Object({
      areas: Type.Array(
        Type.Object({
          topic: Type.String(),
          status: Type.Union([
            Type.Literal("known"),
            Type.Literal("partial"),
            Type.Literal("unknown"),
            Type.Literal("misconception"),
          ]),
          evidence: Type.String(),
        }),
        { minItems: 2, maxItems: 12 },
      ),
    }),
    async execute(_id, params) {
      const runtime = requireRuntime();
      if (runtime.state.mission) {
        throw new Error("Record the diagnostic mastery map before mission confirmation");
      }
      if (!runtime.state.pendingDiagnosticRound?.answered) {
        throw new Error("Record a mastery map only after the user answers a diagnostic round");
      }
      runtime.state.masteryMap = params.areas.map(({ topic, status, evidence }) => ({
        topic: topic.trim(),
        status,
        evidence: evidence.trim(),
      })) as MasteryArea[];
      await record("mastery_map_recorded", { areas: runtime.state.masteryMap });
      return textResult(
        `Mastery map recorded:\n${runtime.state.masteryMap.map(({ topic, status }) => `- ${topic}: ${status}`).join("\n")}`,
      );
    },
  });

  pi.registerTool({
    name: "chasing_fetch_sources",
    label: "Fetch Chasing sources",
    description: "Actually fetch official or primary HTTPS sources, persist their excerpts, and return a retrieval id.",
    parameters: Type.Object({
      query: Type.String(),
      sources: Type.Array(
        Type.Object({
          title: Type.String(),
          url: Type.String(),
          kind: Type.Union([Type.Literal("official"), Type.Literal("primary")]),
        }),
        { minItems: 1, maxItems: 5 },
      ),
    }),
    async execute(_id, params, signal) {
      const runtime = requireRuntime();
      const query = params.query.trim();
      if (!query) throw new Error("Retrieval query is required");
      const sources = await fetchRetrievedSources(
        params.sources,
        dependencies.request ?? fetch,
        dependencies.resolveHost,
        signal,
      );
      const trace: RetrievalTrace = {
        id: randomUUID(),
        query,
        tool: "chasing_fetch_sources",
        sources,
        retrievedAt: new Date().toISOString(),
      };
      runtime.state.retrievals.push(trace);
      await record("sources_retrieved", {
        retrievalId: trace.id,
        query: trace.query,
        tool: trace.tool,
        sources: trace.sources,
      });
      const sourceText = trace.sources
        .map(({ title, url, excerpt }, index) => `SOURCE ${index + 1}: ${title}\nURL: ${url}\nEXCERPT: ${excerpt}`)
        .join("\n\n");
      return textResult(`Retrieved ${trace.sources.length} source(s). retrievalId: ${trace.id}\n\n${sourceText}`, {
        retrievalId: trace.id,
      });
    },
  });

  pi.registerTool({
    name: "chasing_prepare_question",
    label: "Prepare Chasing question",
    description: "Privately record the rationale and prepare the single user-visible Chasing question.",
    promptSnippet: "Privately record one Chasing question before displaying it",
    parameters: Type.Object({
      stage: Type.Union([
        Type.Literal("onboarding"),
        Type.Literal("mapping"),
        Type.Literal("deepening"),
        Type.Literal("verification"),
        Type.Literal("ending"),
        Type.Literal("core"),
      ]),
      rationale: Type.String({ description: "Private, brief: latest observation and why this question is most valuable" }),
      context: Type.Optional(Type.String({ description: "Visible minimum background required to understand the question" })),
      terms: Type.Optional(Type.Array(Type.Object({ term: Type.String(), definition: Type.String() }), { maxItems: 4 })),
      example: Type.Optional(Type.String({ description: "One concise example when the question would otherwise be abstract" })),
      question: Type.String({ description: "Exactly one focused question" }),
      answerGuide: Type.Optional(Type.String({ description: "A short coordinate system for answering, without revealing the answer" })),
      intervention: Type.Union([
        Type.Literal("none"),
        Type.Literal("clarify"),
        Type.Literal("narrow"),
        Type.Literal("hint"),
        Type.Literal("explain"),
      ]),
      interventionText: Type.Optional(Type.String({ description: "Visible minimal hint/explanation before the question" })),
      sources: Type.Array(
        Type.Object({
          title: Type.String(),
          url: Type.String(),
          kind: Type.Union([Type.Literal("official"), Type.Literal("primary")]),
        }),
        { maxItems: 3 },
      ),
    }),
    async execute(_toolCallId, params) {
      const runtime = requireRuntime();
      if (!runtime.state.active) throw new Error("Chasing is inactive");
      if (params.stage !== "onboarding" && !runtime.state.mission) throw new Error("Confirm the mission before core questioning");
      if (params.stage !== "onboarding" && runtime.state.coverage.length === 0) {
        throw new Error("Define mission coverage before core questioning");
      }
      if (params.sources.length > 3) throw new Error("At most three compact sources are allowed");
      const linkedSources = params.sources.map((source) => {
        const normalizedUrl = new URL(source.url).toString();
        const retrieval = [...runtime.state.retrievals]
          .reverse()
          .find((trace) => trace.sources.some((candidate) => new URL(candidate.url).toString() === normalizedUrl));
        if (!retrieval) throw new Error(`Question source is not present in retrieval trace: ${source.url}`);
        const retrievedSource = retrieval.sources.find((candidate) => new URL(candidate.url).toString() === normalizedUrl);
        if (!retrievedSource) throw new Error(`Question source is not present in retrieval trace: ${source.url}`);
        return {
          title: source.title,
          url: retrievedSource.url,
          kind: retrievedSource.kind,
          retrievalId: retrieval.id,
        } as SourceReference;
      });
      const rationale = params.rationale.trim();
      if (!rationale) throw new Error("A brief private rationale is required");
      const normalizedQuestion = validateQuestion(params.question);
      const existing = runtime.state.pendingQuestion;
      if (existing && !existing.answered) {
        if (existing.question === normalizedQuestion) {
          preparedForRender = existing;
          return textResult("This Chasing question is already prepared. Emit no additional prose.", {
            questionId: existing.id,
          });
        }
        throw new Error("A Chasing question is already awaiting the user's answer");
      }
      const interventionText = params.interventionText?.trim();
      if (params.intervention === "none" && interventionText) {
        throw new Error("interventionText requires a non-none intervention");
      }
      if (interventionText && interventionText.length > 400) {
        throw new Error("Interventions must remain extremely short");
      }
      if (params.context && params.context.length > 800) throw new Error("Question context must stay under 800 characters");
      if (params.example && params.example.length > 400) throw new Error("Question examples must stay under 400 characters");
      if (params.answerGuide && params.answerGuide.length > 240) throw new Error("Answer guides must stay under 240 characters");
      if (params.terms?.some(({ term, definition }) => term.length > 80 || definition.length > 160)) {
        throw new Error("Question terms and definitions must remain concise");
      }
      const question: PreparedQuestion = {
        id: randomUUID(),
        stage: params.stage,
        rationale,
        ...(params.context?.trim() ? { context: params.context.trim() } : {}),
        ...(params.terms?.length
          ? { terms: params.terms.map(({ term, definition }) => ({ term: term.trim(), definition: definition.trim() })) }
          : {}),
        ...(params.example?.trim() ? { example: params.example.trim() } : {}),
        question: normalizedQuestion,
        ...(params.answerGuide?.trim() ? { answerGuide: params.answerGuide.trim() } : {}),
        intervention: params.intervention as Intervention,
        ...(interventionText ? { interventionText } : {}),
        sources: linkedSources,
        preparedAt: new Date().toISOString(),
        answered: false,
      };
      runtime.state.pendingQuestion = question;
      preparedForRender = question;
      if (question.stage === "mapping") setPhase("mapping");
      if (question.stage === "deepening" || question.stage === "core") setPhase("deepening");
      if (question.stage === "verification") setPhase("verification");
      if (question.stage === "ending") setPhase("ending");
      await record("question_prepared", {
        questionId: question.id,
        stage: question.stage,
        rationale: question.rationale,
        ...(question.context ? { context: question.context } : {}),
        ...(question.terms ? { terms: question.terms } : {}),
        ...(question.example ? { example: question.example } : {}),
        question: question.question,
        ...(question.answerGuide ? { answerGuide: question.answerGuide } : {}),
        intervention: question.intervention,
        ...(question.interventionText ? { interventionText: question.interventionText } : {}),
        sources: question.sources,
      });
      return textResult("Chasing question prepared. Emit no additional prose.", { questionId: question.id });
    },
    renderCall(_args, theme) {
      return new Text(theme.fg("muted", "Chasing 正在选择下一问…"), 0, 0);
    },
    renderResult(_result, _options, theme) {
      return new Text(theme.fg("muted", "问题已准备"), 0, 0);
    },
  });

  pi.registerTool({
    name: "chasing_recommend_mode",
    label: "Recommend Chasing mode",
    description: "Record a mode recommendation after learning enough about the user's intent.",
    parameters: Type.Object({
      mode: Type.Union([Type.Literal("learn"), Type.Literal("clarify-decide")]),
      reason: Type.String(),
    }),
    async execute(_id, params) {
      const runtime = requireRuntime();
      runtime.state.recommendedMode = params.mode as ChasingMode;
      await record("mode_recommended", { mode: params.mode, reason: params.reason });
      return textResult(`Recommend ${params.mode}; the user must confirm or override it.`);
    },
  });

  pi.registerTool({
    name: "chasing_confirm_mode",
    label: "Confirm Chasing mode",
    description: "Persist the user's confirmed mode choice or override.",
    parameters: Type.Object({
      mode: Type.Union([Type.Literal("learn"), Type.Literal("clarify-decide")]),
    }),
    async execute(_id, params) {
      const runtime = requireRuntime();
      runtime.state.mode = params.mode as ChasingMode;
      runtime.state.evaluationEligible = params.mode === "learn";
      await record("mode_confirmed", { mode: params.mode, overrodeRecommendation: params.mode !== runtime.state.recommendedMode });
      return textResult(`Mode confirmed: ${params.mode}`);
    },
  });

  pi.registerTool({
    name: "chasing_propose_mission",
    label: "Propose Chasing mission",
    description: "Record a concise mission proposal for user review.",
    parameters: Type.Object({ mission: Type.String() }),
    async execute(_id, params) {
      const runtime = requireRuntime();
      runtime.state.proposedMission = params.mission.trim();
      setPhase("mission-review");
      await record("mission_proposed", { mission: runtime.state.proposedMission });
      return textResult(`Mission proposal ready for user confirmation: ${runtime.state.proposedMission}`);
    },
  });

  pi.registerTool({
    name: "chasing_confirm_mission",
    label: "Confirm Chasing mission",
    description: "Persist the user's explicitly confirmed or corrected mission.",
    parameters: Type.Object({ mission: Type.String() }),
    async execute(_id, params) {
      const runtime = requireRuntime();
      if (!runtime.state.mode) throw new Error("Confirm a mode before the mission");
      if (runtime.state.mode === "learn" && runtime.state.masteryMap.length === 0) {
        throw new Error("Record an evidence-backed mastery map before confirming a Learn mission");
      }
      runtime.state.mission = params.mission.trim();
      setPhase("mapping");
      await record("mission_confirmed", { mission: runtime.state.mission });
      return textResult("Mission confirmed. Continue with one adaptive question.");
    },
  });

  pi.registerTool({
    name: "chasing_add_material",
    label: "Add Chasing Markdown material",
    description: "Capture one or more local Markdown files as canonical session evidence.",
    parameters: Type.Object({ paths: Type.Array(Type.String(), { minItems: 1 }) }),
    async execute(_id, params) {
      const runtime = requireRuntime();
      const captured = [];
      for (const inputPath of params.paths) {
        const absolutePath = await realpath(resolve(runtime.context.cwd, inputPath));
        if (![".md", ".markdown"].includes(extname(absolutePath).toLowerCase())) {
          throw new Error(`Unsupported material format: ${inputPath}. Chasing V1 accepts only Markdown.`);
        }
        const info = await stat(absolutePath);
        if (info.size > runtime.config.maxMaterialBytes) {
          throw new Error(`Material exceeds ${runtime.config.maxMaterialBytes} bytes: ${inputPath}`);
        }
        const content = await readFile(absolutePath, "utf8");
        const material = {
          path: absolutePath,
          sha256: createHash("sha256").update(content).digest("hex"),
          content,
          capturedAt: new Date().toISOString(),
        };
        runtime.state.materials.push(material);
        captured.push({ path: material.path, sha256: material.sha256, content: material.content });
      }
      await record("materials_captured", { materials: captured });
      return textResult(`Captured ${captured.length} Markdown material(s).`);
    },
  });

  pi.registerTool({
    name: "chasing_define_coverage",
    label: "Define Chasing mission coverage",
    description: "Turn the confirmed mission into a small visible checklist that must be verified before ending.",
    parameters: Type.Object({
      items: Type.Array(Type.Object({ topic: Type.String() }), { minItems: 3, maxItems: 8 }),
    }),
    async execute(_id, params) {
      const runtime = requireRuntime();
      if (!runtime.state.mission) throw new Error("Confirm the mission before defining coverage");
      const topics = params.items.map(({ topic }) => topic.trim()).filter(Boolean);
      if (topics.length < 3 || topics.length > 8) throw new Error("Mission coverage must contain 3-8 items");
      if (new Set(topics).size !== topics.length) throw new Error("Coverage topics must be unique");
      runtime.state.coverage = topics.map((topic) => ({ topic, status: "pending" })) as CoverageItem[];
      runtime.state.verificationCompleted = false;
      await record("coverage_defined", { items: runtime.state.coverage });
      return textResult(`Coverage defined:\n${topics.map((topic) => `- [ ] ${topic}`).join("\n")}`);
    },
  });

  pi.registerTool({
    name: "chasing_update_coverage",
    label: "Update Chasing mission coverage",
    description: "Record evidence that a mission topic was covered or verified in the user's own words.",
    parameters: Type.Object({
      updates: Type.Array(
        Type.Object({
          topic: Type.String(),
          status: Type.Union([Type.Literal("covered"), Type.Literal("verified")]),
          evidence: Type.String(),
        }),
        { minItems: 1, maxItems: 8 },
      ),
    }),
    async execute(_id, params) {
      const runtime = requireRuntime();
      for (const update of params.updates) {
        const item = runtime.state.coverage.find(({ topic }) => topic === update.topic);
        if (!item) throw new Error(`Unknown coverage topic: ${update.topic}`);
        item.status = update.status;
        item.evidence = update.evidence.trim();
      }
      await record("coverage_updated", { updates: params.updates, items: runtime.state.coverage });
      return textResult(
        `Coverage updated:\n${runtime.state.coverage.map(({ topic, status }) => `- [${status === "verified" ? "x" : " "}] ${topic}: ${status}`).join("\n")}`,
      );
    },
  });

  pi.registerTool({
    name: "chasing_suggest_end",
    label: "Suggest ending Chasing",
    description: "Record a lightweight end suggestion. This never ends the session by itself.",
    parameters: Type.Object({ reason: Type.String() }),
    async execute(_id, params) {
      const runtime = requireRuntime();
      if (runtime.state.coverage.length === 0) throw new Error("Define mission coverage before suggesting the end");
      if (!runtime.state.verificationCompleted) throw new Error("Complete a verification question before suggesting the end");
      if (runtime.state.coverage.some(({ status }) => status !== "verified")) {
        throw new Error("Every mission coverage item must be verified before suggesting the end");
      }
      runtime.state.endSuggested = true;
      setPhase("ending");
      await record("end_suggested", { reason: params.reason });
      return textResult("Ask the user whether to end; do not end without confirmation.");
    },
  });

  pi.registerTool({
    name: "chasing_confirm_end",
    label: "End Chasing session",
    description: "End only after the user explicitly confirms. Never generate a summary.",
    parameters: Type.Object({ confirmed: Type.Boolean() }),
    async execute(_id, params) {
      const runtime = requireRuntime();
      if (!params.confirmed) {
        setPhase("deepening");
        runtime.state.endSuggested = false;
        await record("end_declined", {});
        return textResult("Continue questioning; the user declined ending.");
      }
      setPhase("ended");
      runtime.state.active = false;
      runtime.state.endedAt = new Date().toISOString();
      await record("session_ended", { summaryGenerated: false });
      runtime.context.ui.setStatus("chasing", undefined);
      return textResult("Chasing ended. Offer only: start a new Chasing topic or return to ordinary Pi. Do not summarize.");
    },
  });

  pi.registerCommand("chasing-leave", {
    description: "Leave Chasing and return to ordinary Pi",
    handler: async (_args, ctx) => {
      const runtime = requireRuntime();
      runtime.state.active = false;
      setPhase("inactive");
      await record("chasing_left", {});
      ctx.ui.setStatus("chasing", undefined);
      ctx.ui.setWidget("chasing", undefined);
      ctx.ui.setHiddenThinkingLabel();
      ctx.ui.notify("已离开 Chasing，Pi 已恢复普通模式。", "info");
    },
  });

  pi.registerCommand("chasing-sync", {
    description: "Replay the current Chasing evidence into configured Langfuse",
    handler: async (_args, ctx) => {
      const runtime = requireRuntime();
      if (!runtime.config.langfuse.enabled) {
        ctx.ui.notify("Langfuse 同步未启用；本地证据未受影响。", "warning");
        return;
      }
      const result = await runtime.recorder.replaySession(runtime.state.sessionId);
      ctx.ui.notify(`Langfuse 补传完成：${result.synced} 条成功，${result.queued} 条进入重试队列。`, result.queued ? "warning" : "info");
    },
  });

  pi.registerCommand("chasing", {
    description: "Start a new Chasing topic in the current Pi session",
    handler: async (_args, ctx) => {
      const previousSessionId = state?.sessionId;
      state = createInitialState(randomUUID());
      const model = snapshotModel(ctx);
      if (model) state.model = model;
      ctx.ui.setStatus("chasing", phaseStatus(state.phase));
      await record("session_started", { previousSessionId, piSessionFile: ctx.sessionManager.getSessionFile() });
      ctx.ui.notify("新的 Chasing 主题已就绪，请发送主题、问题或 Markdown 材料。", "info");
    },
  });
}
