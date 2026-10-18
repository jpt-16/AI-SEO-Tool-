// Minimal Gemini API client (generateContent over REST) returning JSON that matches a zod
// schema. No SDK: one endpoint, and the HTTP layer is injectable for tests.
import { z } from "zod";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
// Overloaded / rate-limited responses are usually gone a few seconds later.
const RETRY_STATUSES = new Set([429, 500, 503]);
const RETRY_DELAYS_MS = [1500, 4000];

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "rate" | "blocked" | "truncated" | "format" | "api",
    readonly status?: number,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

export interface GeminiRequest<T> {
  model: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  // How much the model thinks before answering. Thinking tokens bill as output.
  thinkingLevel: ThinkingLevel;
  // Counts thinking and answer together.
  maxOutputTokens: number;
}

export interface GeminiResult<T> {
  parsed: T;
  inputTokens: number;
  // Answer plus thinking tokens: both bill at the output rate.
  outputTokens: number;
}

export interface GeminiSearchRequest {
  model: string;
  system: string;
  prompt: string;
  thinkingLevel: ThinkingLevel;
  maxOutputTokens: number;
}

export interface GeminiSearchResult {
  // The model's findings as plain text, grounded in Google Search results.
  text: string;
  // Pages the answer was grounded on.
  sources: { title: string; url: string }[];
  inputTokens: number;
  outputTokens: number;
}

export interface GeminiClient {
  generateJson<T>(request: GeminiRequest<T>): Promise<GeminiResult<T>>;
  // Answers using live Google Search (grounding). Plain text, since structured output and
  // search grounding don't combine reliably: draft from this with generateJson.
  search(request: GeminiSearchRequest): Promise<GeminiSearchResult>;
}

interface GenerateContentResponse {
  candidates?: {
    finishReason?: string;
    content?: { parts?: { text?: string; thought?: boolean }[] };
    groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] };
  }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  error?: { code?: number; message?: string; status?: string };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Standard JSON Schema, without the dialect marker the API doesn't take.
function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

export function createGeminiClient(apiKey: string, fetchImpl: typeof fetch = fetch, delays: number[] = RETRY_DELAYS_MS): GeminiClient {
  async function post(model: string, body: unknown): Promise<GenerateContentResponse> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let json: GenerateContentResponse = {};
      try {
        json = text ? (JSON.parse(text) as GenerateContentResponse) : {};
      } catch {
        // Non-JSON error page; handled below by status.
      }
      if (res.ok) return json;

      if (RETRY_STATUSES.has(res.status) && attempt < delays.length) {
        await sleep(delays[attempt]);
        continue;
      }
      const message = json.error?.message ?? (text.slice(0, 200) || res.statusText);
      // A bad key comes back as 400 "API key not valid", not 401.
      if (res.status === 401 || res.status === 403 || (res.status === 400 && /api key/i.test(message))) {
        throw new GeminiError(message, "auth", res.status);
      }
      throw new GeminiError(message, res.status === 429 ? "rate" : "api", res.status);
    }
  }

  const tokens = (json: GenerateContentResponse) => {
    const usage = json.usageMetadata ?? {};
    return {
      inputTokens: usage.promptTokenCount ?? 0,
      // Answer plus thinking tokens: both bill at the output rate.
      outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
    };
  };

  return {
    async search(request: GeminiSearchRequest): Promise<GeminiSearchResult> {
      const json = await post(request.model, {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: "user", parts: [{ text: request.prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { maxOutputTokens: request.maxOutputTokens, thinkingConfig: { thinkingLevel: request.thinkingLevel } },
      });
      if (json.promptFeedback?.blockReason) {
        throw new GeminiError(`Gemini blocked this search (${json.promptFeedback.blockReason}).`, "blocked");
      }
      const candidate = json.candidates?.[0];
      if (candidate?.finishReason === "MAX_TOKENS") throw new GeminiError("Gemini's answer was cut off (max tokens).", "truncated");
      const text = (candidate?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim();
      if (!text) throw new GeminiError(`Gemini returned no answer (${candidate?.finishReason ?? "no candidates"}).`, "blocked");

      const seen = new Set<string>();
      const sources = (candidate?.groundingMetadata?.groundingChunks ?? []).flatMap((c) => {
        const url = c.web?.uri;
        if (!url || seen.has(url)) return [];
        seen.add(url);
        return [{ title: c.web?.title ?? url, url }];
      });
      return { text, sources, ...tokens(json) };
    },

    async generateJson<T>(request: GeminiRequest<T>): Promise<GeminiResult<T>> {
      const json = await post(request.model, {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: "user", parts: [{ text: request.prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: jsonSchema(request.schema),
          maxOutputTokens: request.maxOutputTokens,
          thinkingConfig: { thinkingLevel: request.thinkingLevel },
        },
      });

      if (json.promptFeedback?.blockReason) {
        throw new GeminiError(`Gemini blocked this page (${json.promptFeedback.blockReason}).`, "blocked");
      }
      const candidate = json.candidates?.[0];
      if (candidate?.finishReason === "MAX_TOKENS") throw new GeminiError("Gemini's answer was cut off (max tokens).", "truncated");
      if (!candidate || (candidate.finishReason && candidate.finishReason !== "STOP")) {
        throw new GeminiError(`Gemini stopped without an answer (${candidate?.finishReason ?? "no candidates"}).`, "blocked");
      }

      const answer = (candidate.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
      let data: unknown;
      try {
        data = JSON.parse(answer);
      } catch {
        throw new GeminiError("Gemini's answer wasn't valid JSON.", "format");
      }
      const parsed = request.schema.safeParse(data);
      if (!parsed.success) throw new GeminiError("Gemini's answer didn't match the blueprint format.", "format");

      return { parsed: parsed.data, ...tokens(json) };
    },
  };
}

export function geminiFromEnv(): GeminiClient {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY isn't set.");
  return createGeminiClient(key);
}

export function describeAiError(err: unknown): string {
  if (err instanceof GeminiError) {
    if (err.kind === "auth") return "The Gemini API key was rejected. Check GEMINI_API_KEY in Vercel.";
    if (err.kind === "rate") return "Gemini rate limit hit. Try again in a minute.";
    if (err.kind === "api") return `Gemini API error${err.status ? ` ${err.status}` : ""}: ${err.message}`;
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
