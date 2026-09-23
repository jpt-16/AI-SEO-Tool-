import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import {
  BlueprintOutput,
  buildUserPrompt,
  describeAnthropicError,
  noPagesReason,
  selectPages,
  SYSTEM_PROMPT,
  type PageSnapshot,
} from "./blueprint-prompt";
import type { PageRow } from "./reports";

const snapshot: PageSnapshot = {
  url: "https://cloverdownsdetailing.com/mobile-detailing/hamilton",
  window: { startDate: "2026-06-23", endDate: "2026-09-20" },
  title: "Mobile Detailing in Hamilton, MA — Clover Downs Detailing",
  metaDescription: null,
  h1: ["Mobile detailing in Hamilton."],
  h2: ["What we do", "Service area"],
  wordCount: 951,
  schemaTypes: ["AutoDetailing", "FAQPage"],
  clicks: 1,
  impressions: 42,
  position: 18.25,
  topQueries: [{ query: "detailing hamilton", clicks: 1, impressions: 20, ctr: 0.05, position: 9.5 }],
};

describe("buildUserPrompt", () => {
  const prompt = buildUserPrompt({ name: "Clover Downs Detailing", domain: "cloverdownsdetailing.com" }, snapshot);

  it("includes the page data with lengths, missing fields and query stats", () => {
    expect(prompt).toContain("Title tag: Mobile Detailing in Hamilton, MA — Clover Downs Detailing (57 chars)");
    expect(prompt).toContain("Meta description: (missing)");
    expect(prompt).toContain("H2s: What we do | Service area");
    expect(prompt).toContain('1. "detailing hamilton": 20 impressions, 1 clicks, CTR 5.0%, avg position 9.5');
    expect(prompt).toContain("Page totals: 42 impressions, 1 clicks, avg position 18.3");
  });

  it("tells the model an empty result is acceptable", () => {
    expect(SYSTEM_PROMPT).toMatch(/set blueprint to null/);
    expect(SYSTEM_PROMPT).toMatch(/never manufacture a recommendation/);
    expect(SYSTEM_PROMPT).toMatch(/no_change_reason/);
    // Double quotes inside the JSON text fields cut Claude's sentences short.
    expect(SYSTEM_PROMPT).toMatch(/single quotes/);
  });
});

describe("BlueprintOutput", () => {
  it("accepts an empty result and a full blueprint", () => {
    const empty = { blueprint: null, no_change_reason: "Only 3 impressions, all at position 70+." };
    expect(BlueprintOutput.parse(empty)).toEqual(empty);
    const full = {
      blueprint: {
        finding: "Title misses the term people search.",
        reasoning: "20 impressions for 'detailing hamilton' at 9.5.",
        proposed_title: "Car Detailing in Hamilton, MA | Clover Downs",
        proposed_meta: null,
        priority: "high",
        target_queries: ["detailing hamilton"],
      },
      no_change_reason: null,
    };
    expect(BlueprintOutput.parse(full)).toEqual(full);
  });

  it("rejects priorities outside high/med/low", () => {
    expect(() =>
      BlueprintOutput.parse({
        blueprint: { finding: "x", reasoning: "y", proposed_title: null, proposed_meta: null, priority: "urgent", target_queries: [] },
        no_change_reason: null,
      }),
    ).toThrow();
  });
});

describe("selectPages", () => {
  const row = (url: string, impressions: number, crawl: Partial<NonNullable<PageRow["crawl"]>> | null): PageRow => ({
    pageKey: url,
    url,
    clicks: 0,
    impressions,
    ctr: 0,
    position: 10,
    topQueries: [],
    crawl: crawl && {
      title: "t",
      metaDescription: "m",
      h1: [],
      wordCount: 100,
      internalLinkCount: 1,
      schemaTypes: [],
      inSitemap: true,
      statusCode: 200,
      error: null,
      crawledAt: "2026-09-22T00:00:00Z",
      visual: {
        score: null,
        checks: [],
        capture: { networkIdle: null, status: null, failedRequests: null },
        error: null,
        capturedAt: null,
        hasScreenshot: false,
      },
      answers: { score: null, check: null },
      ...crawl,
    },
  });

  it("explains why nothing qualified", () => {
    expect(noPagesReason([row("a", 3, {})], 5)).toBe("No pages have more than 5 impressions in the last 90 days.");
    expect(noPagesReason([row("a", 19, null), row("b", 6, null)], 0)).toBe(
      "2 pages have more than 0 impressions, but none have been crawled yet. Crawl the site first.",
    );
    expect(noPagesReason([row("a", 19, { error: "HTTP 500" })], 0)).toMatch(/last crawl failed/);
  });

  it("keeps crawled pages above the threshold, busiest first", () => {
    const picked = selectPages(
      [
        row("a", 25, {}),
        row("b", 20, {}), // not more than 20
        row("c", 90, {}),
        row("d", 50, null), // never crawled
        row("e", 60, { error: "HTTP 404" }),
      ],
      20,
    );
    expect(picked.map((p) => p.url)).toEqual(["c", "a"]);
  });
});

describe("describeAnthropicError", () => {
  it("surfaces the API's own message, e.g. an empty credit balance", () => {
    const err = Anthropic.APIError.generate(
      400,
      {
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
        },
      },
      undefined,
      new Headers(),
    );
    expect(describeAnthropicError(err)).toBe(
      "Anthropic API error 400: Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
    );
  });

  it("names a rejected key", () => {
    const err = Anthropic.APIError.generate(
      401,
      { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
      undefined,
      new Headers(),
    );
    expect(describeAnthropicError(err)).toMatch(/API key was rejected/);
  });
});
