import assert from "node:assert/strict";
import test from "node:test";

import { checkSession, type ToolOutcome } from "../eval/checks.ts";
import type { ChasingPhase, EvidenceEvent } from "../src/domain.ts";
import { MATERIAL_ACCESS_BLOCK_REASON } from "../src/index.ts";

type Step = [type: string, phase: ChasingPhase, data?: Record<string, unknown>];

function session(steps: Step[]): EvidenceEvent[] {
  return steps.map(([type, phase, data = {}], index) => ({
    schemaVersion: 2,
    sessionId: "s",
    sequence: index + 1,
    timestamp: "2026-11-01T00:00:00.000Z",
    type,
    phase,
    evaluationEligible: true,
    versions: { extension: "0.2.0", prompt: "chasing-v2.0", evidence: 2, config: "chasing-config-v1" },
    data,
  }));
}

const verified = { items: [{ topic: "a", status: "verified" }, { topic: "b", status: "verified" }, { topic: "c", status: "verified" }] };

const completeSession: Step[] = [
  ["session_started", "onboarding"],
  ["user_input", "onboarding"],
  ["diagnostic_round_prepared", "diagnosis"],
  ["assistant_turn_completed", "diagnosis"],
  ["diagnostic_answer", "diagnosis"],
  ["mastery_map_recorded", "diagnosis"],
  ["mode_recommended", "diagnosis"],
  ["mission_proposed", "mission-review"],
  ["user_input", "mission-review"],
  ["mode_confirmed", "mission-review"],
  ["mission_confirmed", "mapping"],
  ["coverage_defined", "mapping", { items: [{ topic: "a", status: "pending" }, { topic: "b", status: "pending" }, { topic: "c", status: "pending" }] }],
  ["question_prepared", "mapping"],
  ["assistant_turn_completed", "mapping"],
  ["user_answer", "mapping"],
  ["question_prepared", "verification"],
  ["assistant_turn_completed", "verification"],
  ["user_answer", "verification"],
  ["coverage_updated", "verification", verified],
  ["end_suggested", "ending"],
  ["user_input", "ending"],
  ["session_ended", "ended"],
];

const result = (report: ReturnType<typeof checkSession>, name: string) => {
  const found = report.results.find((check) => check.name === name);
  assert.ok(found, `check ${name} exists`);
  return found;
};

test("a complete, well-formed session passes every check", () => {
  const report = checkSession(session(completeSession), [], 18);
  assert.equal(report.pass, true);
  assert.deepEqual(report.results.filter(({ pass }) => !pass), []);
  assert.equal(
    result(report, "phases-in-order").detail,
    "onboarding → diagnosis → mission-review → mapping → verification → ending → ended",
  );
  assert.equal(result(report, "turn-budget").detail, "6/18 learner turns");
});

test("a prose turn without a prepared question fails hard and names the turn", () => {
  const steps: Step[] = [...completeSession.slice(0, 15), ["user_answer", "mapping"], ...completeSession.slice(15)];
  const report = checkSession(session(steps), [], 18);
  assert.equal(report.pass, false);
  assert.deepEqual(result(report, "no-freeform-turns").sequences, [15]);
});

test("ordering violations are reported with their sequence numbers", () => {
  const report = checkSession(session([
    ["session_started", "onboarding"],
    ["user_input", "onboarding"],
    ["question_prepared", "deepening"],
    ["assistant_turn_completed", "deepening"],
    ["user_answer", "deepening"],
    ["mission_confirmed", "mapping"],
    ["coverage_defined", "mapping", { items: [{ topic: "a", status: "covered" }] }],
    ["end_suggested", "ending"],
    ["session_ended", "ended"],
    ["end_declined", "deepening"],
    ["session_ended", "ended"],
  ]), [], 18);
  assert.equal(report.pass, false);
  assert.equal(result(report, "phases-in-order").pass, false);
  assert.deepEqual(result(report, "mission-before-questions").sequences, [3]);
  assert.deepEqual(result(report, "end-suggested-after-verified").sequences, [8]);
  assert.deepEqual(result(report, "ended-after-suggestion").sequences, [11]);
});

test("tool errors, blocked workspace access, and turn exhaustion are reported without failing the session", () => {
  const tools: ToolOutcome[] = [
    { toolName: "chasing_prepare_question", isError: true, text: "Ask exactly one focused question" },
    { toolName: "chasing_prepare_question", isError: true, text: "Ask exactly one focused question" },
    { toolName: "bash", isError: true, text: MATERIAL_ACCESS_BLOCK_REASON },
    { toolName: "chasing_confirm_mode", isError: false, text: "Mode confirmed: learn" },
  ];
  const unfinished = completeSession.slice(0, 17);
  const report = checkSession(session(unfinished), tools, 4);
  assert.equal(report.pass, true);
  assert.equal(result(report, "tool-errors").detail, "2× chasing_prepare_question: Ask exactly one focused question");
  assert.equal(result(report, "blocked-workspace-tools").detail, "1× bash");
  assert.equal(result(report, "turn-budget").pass, false);
  assert.equal(result(report, "session-ended").pass, false);
});
