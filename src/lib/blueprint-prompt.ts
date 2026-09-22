import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { PageRow } from "./reports";

export const BLUEPRINT_MODEL = "claude-sonnet-4-6";

export const BlueprintOutput = z.object({
  blueprint: z
    .object({
      finding: z.string().describe("One sentence naming the problem."),
      reasoning: z.string().describe("2-4 sentences citing the specific queries and numbers behind the finding."),
      proposed_title: z.string().nullable().describe("Full replacement title tag, or null to keep the current one."),
      proposed_meta: z.string().nullable().describe("Full replacement meta description, or null to keep the current one."),
      priority: z.enum(["high", "med", "low"]),
    })
    .nullable()
    .describe("The single highest-leverage change, or null when there is no real mismatch."),
});

export type BlueprintResult = NonNullable<z.infer<typeof BlueprintOutput>["blueprint"]>;

export interface SnapshotQuery {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

// Everything Claude sees about a page; stored with the blueprint as page_snapshot.
export interface PageSnapshot {
  url: string;
  window: { startDate: string; endDate: string };
  title: string | null;
  metaDescription: string | null;
  h1: string[];
  h2: string[];
  wordCount: number | null;
  schemaTypes: string[];
  clicks: number;
  impressions: number;
  position: number | null;
  topQueries: SnapshotQuery[];
}

export const SYSTEM_PROMPT = `You are a senior local-SEO strategist reviewing one page of a small service business's website for the agency that manages it.

You get the page's current title tag, meta description, headings and word count, plus the Google Search Console queries the page appeared for over the last 90 days (clicks, impressions, CTR, average position).

Find the single highest-leverage change to this page's title tag and/or meta description, if one exists. Typical problems worth fixing:
- Searchers find the page for terms the title and meta don't mention, or mention only weakly (a mismatch between demand and what the snippet promises).
- The term people actually search is buried at the end of the title or missing from it.
- A title or meta description is too long and gets truncated (over roughly 60 and 155 characters), or is missing.
- The snippet is unlikely to earn the click at the position the page already holds.

How to judge the evidence:
- Weigh queries by impressions and position. A query seen once at position 80 is weak evidence; tens of impressions on page 1-2 is strong.
- Queries clearly unrelated to this business (for example a same-named town in another country) are noise, unless that irrelevant traffic is itself the problem worth naming.
- Search Console data for a small site is thin. Don't over-read one or two impressions.

Rules for the recommendation:
- Base every claim on the data provided. Don't invent services, locations, prices, reviews or facts; the headings show what the page actually covers.
- Proposed titles stay under 60 characters and meta descriptions under 155. Write for people, so the result earns the click, and keep the brand name if the current title has it.
- Set proposed_title or proposed_meta to null when that element should stay as it is.
- priority: high = a clear mismatch on queries with real impressions at page 1-2 positions, likely to gain clicks soon; med = a clear improvement with modest volume; low = minor polish.
- If the title and meta already fit the demand, or the data is too thin to justify a change, return {"blueprint": null}. An empty result is a good outcome; never manufacture a recommendation to have something to say.`;

const fmtLen = (text: string | null) => (text ? `${text} (${text.length} chars)` : "(missing)");

export function buildUserPrompt(business: { name: string; domain: string }, page: PageSnapshot): string {
  const queries = page.topQueries.length
    ? page.topQueries
        .map(
          (q, i) =>
            `${i + 1}. "${q.query}": ${q.impressions} impressions, ${q.clicks} clicks, CTR ${(q.ctr * 100).toFixed(1)}%, avg position ${q.position.toFixed(1)}`,
        )
        .join("\n")
    : "(no queries)";
  return `Business: ${business.name} (${business.domain})
Page: ${page.url}
Search Console window: ${page.window.startDate} to ${page.window.endDate}
Page totals: ${page.impressions} impressions, ${page.clicks} clicks, avg position ${page.position?.toFixed(1) ?? "n/a"}

Title tag: ${fmtLen(page.title)}
Meta description: ${fmtLen(page.metaDescription)}
H1: ${page.h1.join(" | ") || "(missing)"}
H2s: ${page.h2.join(" | ") || "(none)"}
Word count: ${page.wordCount ?? "unknown"}
Schema types: ${page.schemaTypes.join(", ") || "none"}

Top queries by impressions:
${queries}`;
}

// Pages worth a model call: enough impressions and a successful crawl to compare against.
export function selectPages(rows: PageRow[], minImpressions: number): PageRow[] {
  return rows
    .filter((r) => r.impressions > minImpressions && r.crawl && !r.crawl.error)
    .sort((a, b) => b.impressions - a.impressions);
}

export function describeAnthropicError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in Vercel.";
  if (err instanceof Anthropic.RateLimitError) return "Anthropic rate limit hit. Try again in a minute.";
  if (err instanceof Anthropic.APIError) {
    // The API's own message is already plain English (e.g. "Your credit balance is too low…").
    const apiMessage = (err.error as { error?: { message?: string } } | undefined)?.error?.message;
    return `Anthropic API error${err.status ? ` ${err.status}` : ""}: ${apiMessage ?? err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

// Why no page qualified, in terms the dashboard can act on.
export function noPagesReason(rows: PageRow[], minImpressions: number): string {
  const busy = rows.filter((r) => r.impressions > minImpressions);
  if (busy.length === 0) return `No pages have more than ${minImpressions} impressions in the last 90 days.`;
  const crawled = busy.filter((r) => r.crawl);
  if (crawled.length === 0) {
    return `${busy.length} pages have more than ${minImpressions} impressions, but none have been crawled yet. Crawl the site first.`;
  }
  return `${busy.length} pages have more than ${minImpressions} impressions, but their last crawl failed. Crawl the site again.`;
}
