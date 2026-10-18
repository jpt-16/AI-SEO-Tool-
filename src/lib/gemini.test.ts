import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BlueprintOutput } from "./blueprint-prompt";
import { createGeminiClient, describeAiError, GeminiError } from "./gemini";

const Schema = z.object({ answer: z.string().nullable() });
const request = { model: "gemini-3.8-flash", system: "sys", prompt: "hi", schema: Schema, thinkingLevel: "low" as const, maxOutputTokens: 1000 };

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const answer = (text: string, usage = { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 300 }, finishReason = "STOP") =>
  reply({ candidates: [{ finishReason, content: { parts: [{ text }] } }], usageMetadata: usage });

function stub(...responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return responses.shift() ?? reply({}, 500);
  }) as unknown as typeof fetch;
  return { calls, client: createGeminiClient("test-key", fetchImpl, [0, 0]) };
}

describe("createGeminiClient", () => {
  it("sends the key as a header, asks for schema-constrained JSON and bills thinking as output", async () => {
    const { calls, client } = stub(answer('{"answer":"ok"}'));
    const result = await client.generateJson(request);
    expect(result).toEqual({ parsed: { answer: "ok" }, inputTokens: 100, outputTokens: 320 });

    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    expect(calls[0].url).not.toContain("test-key");
    expect((calls[0].init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.systemInstruction.parts[0].text).toBe("sys");
    expect(body.generationConfig).toMatchObject({ responseMimeType: "application/json", maxOutputTokens: 1000, thinkingConfig: { thinkingLevel: "low" } });
    expect(body.generationConfig.responseJsonSchema.$schema).toBeUndefined();
    expect(body.generationConfig.responseJsonSchema.properties.answer).toBeDefined();
  });

  it("ignores thought parts when reading the answer", async () => {
    const { client } = stub(reply({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "pondering", thought: true }, { text: '{"answer":null}' }] } }] }));
    expect((await client.generateJson(request)).parsed).toEqual({ answer: null });
  });

  it("turns the blueprint schema into plain JSON Schema", async () => {
    const { calls, client } = stub(answer('{"blueprint":null,"no_change_reason":"fine"}'));
    await client.generateJson({ ...request, schema: BlueprintOutput });
    const schema = JSON.parse(calls[0].init.body as string).generationConfig.responseJsonSchema;
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties)).toEqual(["blueprint", "no_change_reason"]);
  });

  it("retries an overloaded model, then gives up with the API's message", async () => {
    const overloaded = () => reply({ error: { code: 503, message: "The model is overloaded." } }, 503);
    const ok = stub(overloaded(), answer('{"answer":"ok"}'));
    expect((await ok.client.generateJson(request)).parsed).toEqual({ answer: "ok" });
    expect(ok.calls).toHaveLength(2);

    const bad = stub(overloaded(), overloaded(), overloaded());
    await expect(bad.client.generateJson(request)).rejects.toMatchObject({ kind: "api", status: 503, message: "The model is overloaded." });
    expect(bad.calls).toHaveLength(3);
  });

  it("classifies a rejected key (a 400 for Gemini) and a rate limit", async () => {
    const key = stub(reply({ error: { code: 400, message: "API key not valid. Please pass a valid API key." } }, 400));
    await expect(key.client.generateJson(request)).rejects.toMatchObject({ kind: "auth" });
    expect(key.calls).toHaveLength(1);

    const rate = stub(...[1, 2, 3].map(() => reply({ error: { message: "quota" } }, 429)));
    await expect(rate.client.generateJson(request)).rejects.toMatchObject({ kind: "rate" });
  });

  it("rejects truncated, blocked, non-JSON and off-schema answers", async () => {
    await expect(stub(answer('{"answer":"x', undefined, "MAX_TOKENS")).client.generateJson(request)).rejects.toMatchObject({ kind: "truncated" });
    await expect(stub(reply({ promptFeedback: { blockReason: "SAFETY" } })).client.generateJson(request)).rejects.toMatchObject({ kind: "blocked" });
    await expect(stub(answer("not json")).client.generateJson(request)).rejects.toMatchObject({ kind: "format" });
    await expect(stub(answer('{"answer":5}')).client.generateJson(request)).rejects.toMatchObject({ kind: "format" });
  });
});

describe("describeAiError", () => {
  it("gives plain-English messages", () => {
    expect(describeAiError(new GeminiError("x", "auth", 400))).toMatch(/GEMINI_API_KEY/);
    expect(describeAiError(new GeminiError("Quota exceeded", "api", 403))).toBe("Gemini API error 403: Quota exceeded");
    expect(describeAiError(new Error("boom"))).toBe("boom");
  });
});

describe("search", () => {
  const searchRequest = { model: "gemini-3.8-flash", system: "sys", prompt: "find it", thinkingLevel: "low" as const, maxOutputTokens: 1000 };

  it("turns on Google Search grounding and returns the text with its sources", async () => {
    const { calls, client } = stub(
      reply({
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: "Listing found. " }, { text: "4.8 stars." }] },
            groundingMetadata: {
              groundingChunks: [
                { web: { uri: "https://maps.example/a", title: "Maps" } },
                { web: { uri: "https://maps.example/a", title: "Maps again" } },
                { web: { uri: "https://yelp.example/b" } },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10, thoughtsTokenCount: 5 },
      }),
    );
    const result = await client.search(searchRequest);
    expect(result).toEqual({
      text: "Listing found. 4.8 stars.",
      sources: [
        { title: "Maps", url: "https://maps.example/a" },
        { title: "https://yelp.example/b", url: "https://yelp.example/b" },
      ],
      inputTokens: 50,
      outputTokens: 15,
    });
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.tools).toEqual([{ google_search: {} }]);
    expect(body.generationConfig.responseMimeType).toBeUndefined();
  });

  it("fails clearly when nothing comes back", async () => {
    await expect(stub(reply({ candidates: [{ finishReason: "STOP", content: { parts: [] } }] })).client.search(searchRequest)).rejects.toMatchObject({ kind: "blocked" });
    await expect(stub(reply({ promptFeedback: { blockReason: "SAFETY" } })).client.search(searchRequest)).rejects.toMatchObject({ kind: "blocked" });
  });
});
