import type { ChasingPhase, CoverageItem, EvidenceEvent } from "../src/domain.ts";
import { MATERIAL_ACCESS_BLOCK_REASON } from "../src/index.ts";

export interface ToolOutcome {
  toolName: string;
  isError: boolean;
  text: string;
}

export interface CheckResult {
  name: string;
  hard: boolean;
  pass: boolean;
  detail: string;
  sequences: number[];
}

export interface CheckReport {
  pass: boolean;
  results: CheckResult[];
}

interface SessionEvidence {
  events: EvidenceEvent[];
  tools: ToolOutcome[];
  maxTurns: number;
}

type Outcome = Omit<CheckResult, "name" | "hard">;

const PHASE_ORDER: ChasingPhase[] = [
  "onboarding",
  "diagnosis",
  "mission-review",
  "mapping",
  "deepening",
  "verification",
  "ending",
  "ended",
];
const USER_TURN_EVENTS = new Set(["user_input", "user_answer", "diagnostic_answer"]);
// These steps ask the user to confirm something, which the contract has the model do in plain prose.
const PROSE_TURN_EVENTS = new Set(["mode_recommended", "mission_proposed", "end_suggested", "session_ended"]);

function turns(events: EvidenceEvent[]): EvidenceEvent[][] {
  const result: EvidenceEvent[][] = [];
  for (const event of events) {
    if (USER_TURN_EVENTS.has(event.type)) result.push([event]);
    else result.at(-1)?.push(event);
  }
  return result;
}

function countBy(items: string[]): string {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts].map(([item, count]) => `${count}× ${item}`).join("; ");
}

const isBlocked = (tool: ToolOutcome) => tool.isError && tool.text.includes(MATERIAL_ACCESS_BLOCK_REASON);
const ended = (events: EvidenceEvent[]) => events.some(({ type }) => type === "session_ended");

const CHECKS: Array<{ name: string; hard: boolean; run(session: SessionEvidence): Outcome }> = [
  {
    name: "phases-in-order",
    hard: true,
    run({ events }) {
      const firsts = new Map<ChasingPhase, number>();
      for (const { phase, sequence } of events) if (!firsts.has(phase) && phase !== "inactive") firsts.set(phase, sequence);
      const reached = [...firsts.keys()];
      const ranks = reached.map((phase) => PHASE_ORDER.indexOf(phase));
      return {
        pass: ranks.every((rank, index) => index === 0 || rank > ranks[index - 1]!),
        detail: reached.join(" → "),
        sequences: [...firsts.values()],
      };
    },
  },
  {
    name: "mission-before-questions",
    hard: true,
    run({ events }) {
      const confirmed = events.find(({ type }) => type === "mission_confirmed")?.sequence ?? Infinity;
      const early = events.filter(({ type, sequence }) => type === "question_prepared" && sequence < confirmed);
      return {
        pass: early.length === 0,
        detail: early.length ? `${early.length} question(s) prepared before mission confirmation` : "ok",
        sequences: early.map(({ sequence }) => sequence),
      };
    },
  },
  {
    name: "no-freeform-turns",
    hard: true,
    run({ events }) {
      const freeform = turns(events).filter(
        (turn) => !turn.some(({ type }) => type === "assistant_turn_completed" || PROSE_TURN_EVENTS.has(type)),
      );
      return {
        pass: freeform.length === 0,
        detail: freeform.length ? `${freeform.length} turn(s) answered without a prepared question or round` : "ok",
        sequences: freeform.map(([start]) => start!.sequence),
      };
    },
  },
  {
    name: "end-suggested-after-verified",
    hard: true,
    run({ events }) {
      let coverage: CoverageItem[] = [];
      const premature: number[] = [];
      for (const event of events) {
        if (event.type === "coverage_defined" || event.type === "coverage_updated") {
          coverage = event.data.items as CoverageItem[];
        }
        if (event.type === "end_suggested" && (coverage.length === 0 || coverage.some(({ status }) => status !== "verified"))) {
          premature.push(event.sequence);
        }
      }
      return { pass: premature.length === 0, detail: premature.length ? "end suggested with unverified coverage" : "ok", sequences: premature };
    },
  },
  {
    name: "ended-after-suggestion",
    hard: true,
    run({ events }) {
      let suggested = false;
      const unsuggested: number[] = [];
      for (const { type, sequence } of events) {
        if (type === "end_suggested") suggested = true;
        if (type === "end_declined") suggested = false;
        if (type === "session_ended" && !suggested) unsuggested.push(sequence);
      }
      return { pass: unsuggested.length === 0, detail: unsuggested.length ? "ended without a pending suggestion" : "ok", sequences: unsuggested };
    },
  },
  {
    name: "tool-errors",
    hard: false,
    run({ tools }) {
      const errors = tools.filter((tool) => tool.isError && !isBlocked(tool));
      return {
        pass: errors.length === 0,
        detail: errors.length ? countBy(errors.map(({ toolName, text }) => `${toolName}: ${text}`)) : "none",
        sequences: [],
      };
    },
  },
  {
    name: "blocked-workspace-tools",
    hard: false,
    run({ tools }) {
      const blocked = tools.filter(isBlocked);
      return { pass: blocked.length === 0, detail: blocked.length ? countBy(blocked.map(({ toolName }) => toolName)) : "none", sequences: [] };
    },
  },
  {
    name: "turn-budget",
    hard: false,
    run({ events, maxTurns }) {
      const used = turns(events).length;
      return { pass: ended(events) || used < maxTurns, detail: `${used}/${maxTurns} learner turns`, sequences: [] };
    },
  },
  {
    name: "session-ended",
    hard: false,
    run({ events }) {
      const end = events.find(({ type }) => type === "session_ended");
      return { pass: Boolean(end), detail: end ? "ended by user confirmation" : "not ended", sequences: end ? [end.sequence] : [] };
    },
  },
];

export function checkSession(events: EvidenceEvent[], tools: ToolOutcome[], maxTurns: number): CheckReport {
  const results = CHECKS.map(({ name, hard, run }) => ({ name, hard, ...run({ events, tools, maxTurns }) }));
  return { pass: results.every(({ hard, pass }) => !hard || pass), results };
}
