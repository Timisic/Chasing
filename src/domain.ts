export const EXTENSION_VERSION = "0.2.0";
export const PROMPT_VERSION = "chasing-v2.0";
export const EVIDENCE_VERSION = 2;

export type ChasingMode = "learn" | "clarify-decide";
export type ChasingPhase =
  | "onboarding"
  | "diagnosis"
  | "mission-review"
  | "mapping"
  | "deepening"
  | "verification"
  | "ending"
  | "ended"
  | "inactive";
export type QuestionStage = Extract<ChasingPhase, "mapping" | "deepening" | "verification" | "ending">;
export type Intervention = "none" | "clarify" | "narrow" | "hint" | "explain";

export interface SourceReference {
  title: string;
  url: string;
  kind: "official" | "primary";
  retrievalId: string;
}

export interface RetrievedSource {
  title: string;
  url: string;
  kind: "official" | "primary";
  excerpt?: string;
}

export interface RetrievalTrace {
  id: string;
  query: string;
  tool: string;
  sources: RetrievedSource[];
  retrievedAt: string;
}

export interface MaterialSnapshot {
  path: string;
  sha256: string;
  content: string;
  capturedAt: string;
}

export interface PreparedQuestion {
  id: string;
  stage: QuestionStage;
  rationale: string;
  context?: string;
  terms?: Array<{ term: string; definition: string }>;
  example?: string;
  question: string;
  answerGuide?: string;
  intervention: Intervention;
  interventionText?: string;
  sources: SourceReference[];
  preparedAt: string;
  answered: boolean;
}

export interface DiagnosticQuestion {
  title: string;
  question: string;
}

export interface PreparedDiagnosticRound {
  id: string;
  rationale: string;
  introduction?: string;
  questions: DiagnosticQuestion[];
  preparedAt: string;
  answered: boolean;
}

export type MasteryStatus = "known" | "partial" | "unknown" | "misconception";

export interface MasteryArea {
  topic: string;
  status: MasteryStatus;
  evidence: string;
}

export type CoverageStatus = "pending" | "covered" | "verified";

export interface CoverageItem {
  topic: string;
  status: CoverageStatus;
  evidence?: string;
}

export interface ChasingState {
  sessionId: string;
  active: boolean;
  phase: ChasingPhase;
  sequence: number;
  startedAt: string;
  recommendedMode?: ChasingMode;
  mode?: ChasingMode;
  proposedMission?: string;
  mission?: string;
  materials: MaterialSnapshot[];
  retrievals: RetrievalTrace[];
  masteryMap: MasteryArea[];
  coverage: CoverageItem[];
  lastAnsweredStage?: QuestionStage;
  evaluationEligible: boolean;
  pendingQuestion?: PreparedQuestion;
  pendingDiagnosticRound?: PreparedDiagnosticRound;
  endSuggested: boolean;
  endedAt?: string;
  model?: { provider: string; id: string; thinkingLevel?: string };
  versions: {
    extension: string;
    prompt: string;
    evidence: number;
    config: string;
  };
}

export interface EvidenceEvent {
  schemaVersion: number;
  sessionId: string;
  sequence: number;
  timestamp: string;
  type: string;
  phase: ChasingPhase;
  evaluationEligible: boolean;
  mode?: ChasingMode;
  mission?: string;
  model?: ChasingState["model"];
  versions: ChasingState["versions"];
  data: Record<string, unknown>;
}

export function createInitialState(sessionId: string, now = new Date()): ChasingState {
  return {
    sessionId,
    active: true,
    phase: "onboarding",
    sequence: 0,
    startedAt: now.toISOString(),
    materials: [],
    retrievals: [],
    masteryMap: [],
    coverage: [],
    evaluationEligible: false,
    endSuggested: false,
    versions: {
      extension: EXTENSION_VERSION,
      prompt: PROMPT_VERSION,
      evidence: EVIDENCE_VERSION,
      config: "chasing-config-v1",
    },
  };
}
