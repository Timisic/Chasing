import { readFileSync } from "node:fs";

import type { ChasingState } from "./domain.ts";

const CONTRACT = readFileSync(new URL("./prompt.md", import.meta.url), "utf8");

export function buildChasingPrompt(basePrompt: string, state: ChasingState): string {
  if (!state.active) return basePrompt;

  const stateSummary = JSON.stringify({
    phase: state.phase,
    recommendedMode: state.recommendedMode,
    mode: state.mode,
    proposedMission: state.proposedMission,
    mission: state.mission,
    materials: state.materials.map(({ path, sha256 }) => ({ path, sha256 })),
    retrievals: state.retrievals.map(({ id, query, tool, sources }) => ({
      id,
      query,
      tool,
      sources: sources.map(({ title, url, kind }) => ({ title, url, kind })),
    })),
    masteryMap: state.masteryMap,
    coverage: state.coverage,
    lastAnsweredStage: state.lastAnsweredStage,
    endSuggested: state.endSuggested,
  });

  return `${basePrompt}\n\n${CONTRACT}\nCurrent state: ${stateSummary}\n`;
}
