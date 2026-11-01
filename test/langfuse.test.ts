import assert from "node:assert/strict";
import test from "node:test";

import type { EvidenceEvent } from "../src/domain.ts";
import { LangfuseSynchronizer } from "../src/langfuse.ts";

test("Langfuse export is replay-safe and exposes product-analysis attributes", async () => {
  const payloads: any[] = [];
  const request = (async (_input: string | URL | Request, init?: RequestInit) => {
    payloads.push(JSON.parse(String(init?.body)));
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  const synchronizer = new LangfuseSynchronizer(
    { enabled: true, baseUrl: "http://localhost:3000", publicKey: "pk", secretKey: "sk" },
    request,
  );
  const event: EvidenceEvent = {
    schemaVersion: 2,
    sessionId: "analysis-session",
    sequence: 7,
    timestamp: "2026-08-17T01:02:03.000Z",
    type: "question_prepared",
    phase: "deepening",
    evaluationEligible: true,
    mode: "learn",
    mission: "Map eval techniques.",
    model: { provider: "deepseek", id: "deepseek-v4-flash", thinkingLevel: "high" },
    versions: { extension: "0.2.0", prompt: "chasing-v2.0", evidence: 2, config: "chasing-config-v1" },
    data: {
      questionId: "question-1",
      stage: "deepening",
      intervention: "clarify",
      context: "Minimum sufficient background.",
      question: "Which boundary matters most?",
      sources: [{ title: "Primary", url: "https://example.org/paper", kind: "primary", retrievalId: "r1" }],
      output: "Minimum sufficient background. Which boundary matters most?",
      usage: { input: 100, output: 20, totalTokens: 120 },
    },
  };

  await synchronizer.sync(event);
  await synchronizer.sync(event);

  const firstSpan = payloads[0].resourceSpans[0].scopeSpans[0].spans[0];
  const replayedSpan = payloads[1].resourceSpans[0].scopeSpans[0].spans[0];
  assert.equal(firstSpan.spanId, replayedSpan.spanId);
  const attributes = Object.fromEntries(firstSpan.attributes.map(({ key, value }: any) => [key, Object.values(value)[0]]));
  assert.equal(attributes["chasing.phase"], "deepening");
  assert.equal(attributes["chasing.stage"], "deepening");
  assert.equal(attributes["chasing.intervention"], "clarify");
  assert.equal(attributes["chasing.sources_count"], 1);
  assert.equal(attributes["chasing.question_chars"], 28);
  assert.equal(attributes["chasing.visible_output_chars"], 59);
  assert.equal(attributes["gen_ai.usage.input_tokens"], 100);
  assert.equal(attributes["gen_ai.usage.output_tokens"], 20);
  assert.equal(attributes["gen_ai.request.model"], "deepseek-v4-flash");
  assert.equal(attributes["chasing.evaluation_eligible"], true);
});

test("Langfuse export aborts a hung endpoint within its configured timeout", async () => {
  const request = ((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")), { once: true });
  })) as typeof fetch;
  const synchronizer = new LangfuseSynchronizer(
    { enabled: true, baseUrl: "http://localhost:3000", publicKey: "pk", secretKey: "sk" },
    request,
    20,
  );
  const event = {
    schemaVersion: 2,
    sessionId: "timeout-session",
    sequence: 1,
    timestamp: "2026-08-17T01:02:03.000Z",
    type: "session_started",
    phase: "onboarding",
    evaluationEligible: false,
    versions: { extension: "0.2.0", prompt: "chasing-v2.0", evidence: 2, config: "chasing-config-v1" },
    data: {},
  } as const;

  await assert.rejects(synchronizer.sync(event), /timeout|abort/i);
});
