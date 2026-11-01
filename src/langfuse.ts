import { createHash } from "node:crypto";

import type { ChasingConfig } from "./config.ts";
import type { EvidenceEvent } from "./domain.ts";

export interface EvidenceSynchronizer {
  readonly enabled: boolean;
  sync(event: EvidenceEvent): Promise<void>;
}

function otelAttribute(key: string, value: string | number | boolean) {
  const field = typeof value === "string" ? "stringValue" : typeof value === "boolean" ? "boolValue" : "intValue";
  return { key, value: { [field]: value } };
}

function eventAttributes(event: EvidenceEvent) {
  const phase = event.phase ?? "legacy";
  const evaluationEligible = event.evaluationEligible ?? event.mode === "learn";
  const attributes = [
    otelAttribute("session.id", event.sessionId),
    otelAttribute("chasing.sequence", event.sequence),
    otelAttribute("chasing.phase", phase),
    otelAttribute("chasing.evaluation_eligible", evaluationEligible),
    otelAttribute("chasing.event", JSON.stringify(event)),
    ...(event.mode ? [otelAttribute("chasing.mode", event.mode)] : []),
    ...(event.mission ? [otelAttribute("chasing.mission", event.mission)] : []),
    ...(event.model ? [
      otelAttribute("gen_ai.system", event.model.provider),
      otelAttribute("gen_ai.request.model", event.model.id),
      ...(event.model.thinkingLevel ? [otelAttribute("chasing.thinking_level", event.model.thinkingLevel)] : []),
    ] : []),
  ];
  const { data } = event;
  if (typeof data.stage === "string") attributes.push(otelAttribute("chasing.stage", data.stage));
  if (typeof data.intervention === "string") attributes.push(otelAttribute("chasing.intervention", data.intervention));
  if (typeof data.questionId === "string") attributes.push(otelAttribute("chasing.question_id", data.questionId));
  if (typeof data.question === "string") attributes.push(otelAttribute("chasing.question_chars", data.question.length));
  if (typeof data.context === "string") attributes.push(otelAttribute("chasing.context_chars", data.context.length));
  if (typeof data.answer === "string") attributes.push(otelAttribute("chasing.answer_chars", data.answer.length));
  if (typeof data.prompt === "string") attributes.push(otelAttribute("chasing.user_input_chars", data.prompt.length));
  if (typeof data.output === "string") attributes.push(otelAttribute("chasing.visible_output_chars", data.output.length));
  if (Array.isArray(data.sources)) attributes.push(otelAttribute("chasing.sources_count", data.sources.length));
  if (data.usage && typeof data.usage === "object") {
    const usage = data.usage as Record<string, unknown>;
    if (typeof usage.input === "number") attributes.push(otelAttribute("gen_ai.usage.input_tokens", usage.input));
    if (typeof usage.output === "number") attributes.push(otelAttribute("gen_ai.usage.output_tokens", usage.output));
    if (typeof usage.totalTokens === "number") attributes.push(otelAttribute("chasing.total_tokens", usage.totalTokens));
  }
  return attributes;
}

export class LangfuseSynchronizer implements EvidenceSynchronizer {
  readonly enabled = true;
  private readonly config: ChasingConfig["langfuse"];
  private readonly request: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    config: ChasingConfig["langfuse"],
    request: typeof fetch = fetch,
    timeoutMs = 3_000,
  ) {
    this.config = config;
    this.request = request;
    this.timeoutMs = timeoutMs;
  }

  async sync(event: EvidenceEvent): Promise<void> {
    if (!this.config.enabled) return;
    if (!this.config.publicKey || !this.config.secretKey) {
      throw new Error("Langfuse sync is enabled, but publicKey/secretKey are missing");
    }

    const traceId = createHash("sha256").update(event.sessionId).digest("hex").slice(0, 32);
    const spanId = createHash("sha256").update(`${event.sessionId}:${event.sequence}`).digest("hex").slice(0, 16);
    const nanos = String(BigInt(Date.parse(event.timestamp)) * 1_000_000n);
    const payload = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              otelAttribute("service.name", "chasing-pi-extension"),
              otelAttribute("service.version", event.versions.extension),
            ],
          },
          scopeSpans: [
            {
              scope: { name: "chasing", version: event.versions.extension },
              spans: [
                {
                  traceId,
                  spanId,
                  name: `chasing.${event.type}`,
                  kind: 1,
                  startTimeUnixNano: nanos,
                  endTimeUnixNano: nanos,
                  attributes: eventAttributes(event),
                  status: { code: 1 },
                },
              ],
            },
          ],
        },
      ],
    };

    const endpoint = `${this.config.baseUrl.replace(/\/$/, "")}/api/public/otel/v1/traces`;
    const authorization = Buffer.from(`${this.config.publicKey}:${this.config.secretKey}`).toString("base64");
    const response = await this.request(endpoint, {
      method: "POST",
      headers: {
        authorization: `Basic ${authorization}`,
        "content-type": "application/json",
        "x-langfuse-ingestion-version": "4",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Langfuse OTLP export failed (${response.status})`);
  }
}

export class DisabledSynchronizer implements EvidenceSynchronizer {
  readonly enabled = false;
  async sync(): Promise<void> {}
}
