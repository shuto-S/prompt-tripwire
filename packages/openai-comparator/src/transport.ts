import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import { ComparisonCandidateContentSchema } from "@prompt-tripwire/domain";

import type {
  ComparatorTransport,
  ComparatorTransportRequest,
  ComparatorTransportResult,
  ComparatorUsage,
} from "./types.js";

const SYSTEM_INSTRUCTIONS = [
  "Compare independent engineering plans for material implementation differences.",
  "Return consensus, materially different alternatives, and unresolved unknowns only.",
  "Suppress naming, prose ordering, and equivalent implementation details.",
  "Use only repository evidence IDs already present in the supplied plans.",
  "Use only supplied probe IDs in supportedByProbeIds.",
  "Do not claim that deterministic safety triggers are approved or safe.",
  "Do not expose chain-of-thought. Provide concise structured conclusions only.",
].join("\n");

function usageOf(
  value:
    | {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
        output_tokens_details?: { reasoning_tokens?: number };
      }
    | null
    | undefined,
): ComparatorUsage {
  return {
    inputTokens: value?.input_tokens ?? null,
    outputTokens: value?.output_tokens ?? null,
    totalTokens: value?.total_tokens ?? null,
    reasoningTokens: value?.output_tokens_details?.reasoning_tokens ?? null,
  };
}

function refused(output: readonly unknown[]): boolean {
  for (const item of output) {
    if (item === null || typeof item !== "object" || !("content" in item)) continue;
    const rawContent = (item as { content?: unknown }).content;
    if (!Array.isArray(rawContent)) continue;
    const content: readonly unknown[] = rawContent;
    if (
      content.some(
        (part) =>
          part !== null &&
          typeof part === "object" &&
          "type" in part &&
          (part as { type?: unknown }).type === "refusal",
      )
    ) {
      return true;
    }
  }
  return false;
}

export interface OpenAiResponsesTransportOptions {
  readonly apiKey?: string;
  readonly client?: OpenAI;
}

export class OpenAiResponsesTransport implements ComparatorTransport {
  private readonly client: OpenAI;

  constructor(options: OpenAiResponsesTransportOptions = {}) {
    this.client =
      options.client ??
      new OpenAI({
        maxRetries: 0,
        ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
      });
  }

  async compare(
    request: ComparatorTransportRequest,
    options: { readonly signal: AbortSignal },
  ): Promise<ComparatorTransportResult> {
    const response = await this.client.responses.parse(
      {
        model: request.model,
        reasoning: { effort: request.reasoningEffort as "low" | "medium" | "high" },
        instructions: SYSTEM_INSTRUCTIONS,
        input: [
          {
            role: "user",
            content: JSON.stringify({ task: request.task, plans: request.plans }),
          },
        ],
        text: {
          format: zodTextFormat(ComparisonCandidateContentSchema, "prompt_tripwire_comparison"),
        },
        store: false,
        max_output_tokens: 5_000,
      },
      { signal: options.signal },
    );
    return {
      responseId: response.id,
      model: response.model,
      output: response.output_parsed,
      refused: refused(response.output),
      usage: usageOf(response.usage),
    };
  }
}
