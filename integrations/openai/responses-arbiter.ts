import { validateArbiterDecision, type ArbiterDecision } from "../../brains/arbiter/index.ts";
import type { BrainOpinion } from "../../core/contracts/brain.ts";
import type { Conflict } from "../../core/contracts/conflict.ts";

export type OpenAIArbiterConfig = Readonly<{ apiKey: string; model: string; endpoint?: string; timeoutMs?: number }>;
export type OpenAIUsage = Readonly<{ inputTokens: number; outputTokens: number; latencyMs: number; model: string }>;

export class ResponsesArbiterClient {
  lastUsage: OpenAIUsage | null = null;
  private readonly config: OpenAIArbiterConfig;
  private readonly transport: typeof fetch;
  constructor(config: OpenAIArbiterConfig, transport: typeof fetch = fetch) { this.config = config; this.transport = transport; }

  async decide(input: { opinions: readonly BrainOpinion[]; conflicts: readonly Conflict[] }): Promise<ArbiterDecision> {
    if (!this.config.apiKey || !this.config.model) throw new Error("OPENAI_NOT_CONFIGURED");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 15_000);
    const started = Date.now();
    try {
      const response = await this.transport(this.config.endpoint ?? "https://api.openai.com/v1/responses", {
        method: "POST", signal: controller.signal,
        headers: { authorization: `Bearer ${this.config.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: this.config.model,
          input: [{ role: "system", content: "Act as a trading hypothesis arbiter. Never execute orders. Return only the requested schema." }, { role: "user", content: JSON.stringify(input) }],
          text: { format: { type: "json_schema", name: "arbiter_decision", strict: true, schema: { type: "object", additionalProperties: false, required: ["decision","winningBrain","winningMechanism","rejectedHypotheses","confidence","evidence","invalidationThesis","preferredExitMode","whatWouldChangeMind"], properties: { decision: { enum: ["TRADE","WATCH","NO_TRADE"] }, winningBrain: { type: ["string","null"] }, winningMechanism: { type: ["string","null"] }, rejectedHypotheses: { type: "array", items: { type: "string" } }, confidence: { type: "number", minimum: 0, maximum: 100 }, evidence: { type: "array", items: { type: "string" } }, invalidationThesis: { type: "string" }, preferredExitMode: { type: "string" }, whatWouldChangeMind: { type: "array", items: { type: "string" } } } } } },
        }),
      });
      if (!response.ok) throw new Error(`OPENAI_HTTP_${response.status}`);
      const payload = await response.json() as Record<string, unknown>;
      const text = typeof payload.output_text === "string" ? payload.output_text : extractOutputText(payload.output);
      const value: unknown = JSON.parse(text);
      if (!validateArbiterDecision(value)) throw new Error("OPENAI_SCHEMA_INVALID");
      const usage = (payload.usage ?? {}) as Record<string, number>;
      this.lastUsage = Object.freeze({ inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0, latencyMs: Date.now() - started, model: this.config.model });
      return Object.freeze(value);
    } finally { clearTimeout(timeout); }
  }
}

function extractOutputText(output: unknown): string {
  if (!Array.isArray(output)) throw new Error("OPENAI_OUTPUT_MISSING");
  for (const item of output) for (const part of Array.isArray(item?.content) ? item.content : []) if (typeof part?.text === "string") return part.text;
  throw new Error("OPENAI_OUTPUT_MISSING");
}
