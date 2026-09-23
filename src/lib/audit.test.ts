import { describe, expect, it } from "vitest";
import type { SiteAeo } from "./aeo";
import { buildAudit, fixState, groupIssues, type AuditIssue } from "./audit";
import type { PageRow } from "./reports";
import type { VisualCheck } from "./visual-core";

const AT = "2026-09-23T13:00:00Z";
const check = (key: VisualCheck["key"], points: number, max: number): VisualCheck => ({ key, label: key, points, max, detail: `${key} detail` });

type Crawl = NonNullable<PageRow["crawl"]>;
const page = (path: string, impressions: number, crawl: Partial<Crawl> | null = {}): PageRow => ({
  pageKey: `site.com${path}`,
  url: `https://site.com${path}`,
  clicks: 0,
  impressions,
  ctr: null,
  position: null,
  topQueries: [],
  crawl: crawl && {
    title: `Title for ${path}`,
    metaDescription: `Description for ${path}`,
    h1: ["Heading"],
    wordCount: 800,
    internalLinkCount: 10,
    schemaTypes: ["LocalBusiness"],
    inSitemap: true,
    statusCode: 200,
    error: null,
    crawledAt: AT,
    visual: {
      score: 100,
      checks: [check("mobile", 20, 20), check("contrast", 20, 20)],
      capture: { networkIdle: true, status: 200, failedRequests: 0 },
      error: null,
      capturedAt: AT,
      hasScreenshot: true,
    },
    answers: { score: 95, check: null },
    ...crawl,
  },
});

const types = (issues: AuditIssue[]) => issues.map((i) => `${i.pageKey || "site"}:${i.type}`).sort();
const noSite = { aeo: null, crawledAt: AT };

describe("buildAudit", () => {
  it("finds nothing on a clean page", () => {
    expect(buildAudit([page("/", 10)], noSite)).toEqual([]);
  });

  it("flags on-page problems", () => {
    const rows = [
      page("/long", 5, { title: "x".repeat(61), metaDescription: "m".repeat(156), h1: ["A", "B"], wordCount: 120, schemaTypes: [], inSitemap: false }),
      page("/empty", 3, { title: null, metaDescription: null, h1: [] }),
    ];
    expect(types(buildAudit(rows, noSite))).toEqual([
      "site.com/empty:h1_missing",
      "site.com/empty:meta_missing",
      "site.com/empty:title_missing",
      "site.com/long:h1_multiple",
      "site.com/long:meta_long",
      "site.com/long:no_schema",
      "site.com/long:not_in_sitemap",
      "site.com/long:thin_content",
      "site.com/long:title_long",
    ]);
  });

  it("flags duplicates case-insensitively, among working pages only", () => {
    const rows = [
      page("/a", 1, { title: "Same", metaDescription: "Same meta" }),
      page("/b", 1, { title: "same", metaDescription: "same meta" }),
      page("/gone", 1, { title: "Same", statusCode: 404 }),
    ];
    const issues = buildAudit(rows, noSite);
    expect(types(issues)).toEqual([
      "site.com/a:meta_duplicate",
      "site.com/a:title_duplicate",
      "site.com/b:meta_duplicate",
      "site.com/b:title_duplicate",
      "site.com/gone:page_error",
    ]);
    expect(issues.find((i) => i.type === "page_error")?.detail).toBe("HTTP 404");
  });

  it("skips thin-content, schema and call-to-action checks on legal and contact pages", () => {
    const noCta = {
      score: 90,
      checks: [check("aboveFold", 10, 20)],
      capture: { networkIdle: true, status: 200, failedRequests: 0 },
      error: null,
      capturedAt: AT,
      hasScreenshot: true,
    };
    expect(
      buildAudit(
        [page("/privacy-policy", 0, { wordCount: 90, schemaTypes: [], visual: noCta }), page("/contact", 0, { wordCount: 50, schemaTypes: [] })],
        noSite,
      ),
    ).toEqual([]);
    expect(types(buildAudit([page("/services", 0, { visual: noCta })], noSite))).toEqual(["site.com/services:visual_aboveFold"]);
  });

  it("flags visual checks under 70% of their points, weak answers, and pages only Search Console knows", () => {
    const rows = [
      page("/v", 8, {
        visual: {
          score: 60,
          checks: [check("mobile", 10, 20), check("tapTargets", 11, 15), check("aboveFold", 10, 20)],
          capture: { networkIdle: true, status: 200, failedRequests: 0 },
          error: null,
          capturedAt: AT,
          hasScreenshot: true,
        },
        answers: {
          score: 55,
          check: {
            score: 55,
            questions: 1,
            faqSchema: false,
            items: [{ source: "heading", question: "How much?", answerStart: "It depends.", words: 2, firstSentenceWords: 2, score: 40, issues: ["Opening is only 2 words."] }],
          },
        },
      }),
      page("/old-page", 12, null),
      page("/never-seen", 0, null),
    ];
    const issues = buildAudit(rows, noSite);
    expect(types(issues)).toEqual([
      "site.com/old-page:gsc_not_crawled",
      "site.com/v:answers_weak",
      "site.com/v:visual_aboveFold",
      "site.com/v:visual_mobile",
    ]);
    expect(issues.find((i) => i.type === "answers_weak")?.detail).toBe('Score 55. Weakest: "How much?" (40). Opening is only 2 words.');
  });

  it("adds site-wide AI crawler and llms.txt issues", () => {
    const aeo = {
      robotsStatus: 200,
      checkedAt: AT,
      aiCrawlers: [
        { agent: "GPTBot", status: "blocked", namedGroup: true, blockedPages: ["a", "b"] },
        { agent: "ClaudeBot", status: "partial", namedGroup: true, blockedPages: ["a"] },
        { agent: "PerplexityBot", status: "allowed", namedGroup: false, blockedPages: [] },
      ],
      llmsTxt: { url: "u", statusCode: 404, present: false, title: null, hasSummary: false, sections: 0, links: 0, bytes: 0, fullVersion: false, issues: ["No llms.txt at the site root."] },
    } as SiteAeo;
    const issues = buildAudit([], { aeo, crawledAt: AT });
    expect(issues.map((i) => [i.type, i.pageKey, i.detail])).toEqual([
      ["ai_crawler_blocked", "", "GPTBot (whole site), ClaudeBot (1 pages)"],
      ["llms_txt", "", "No llms.txt at the site root."],
    ]);
  });
});

describe("groupIssues", () => {
  it("orders by severity, then traffic; busiest page first within a group", () => {
    const issue = (type: AuditIssue["type"], pageKey: string, impressions: number): AuditIssue => ({ type, pageKey, url: `https://${pageKey}`, detail: "", impressions, detectedAt: AT });
    const groups = groupIssues([
      issue("meta_long", "a", 500),
      issue("title_long", "b", 1),
      issue("title_long", "c", 40),
      issue("h1_missing", "d", 90),
      issue("page_error", "e", 0),
    ]);
    expect(groups.map((g) => g.type)).toEqual(["page_error", "h1_missing", "title_long", "meta_long"]);
    expect(groups[2].issues.map((i) => i.pageKey)).toEqual(["c", "b"]);
  });
});

describe("fixState", () => {
  const issue: AuditIssue = { type: "meta_long", pageKey: "p", url: null, detail: "", impressions: 0, detectedAt: "2026-09-23T13:00:00Z" };
  it("stays fixed until a newer crawl still finds the issue", () => {
    expect(fixState(issue, undefined)).toBe("open");
    expect(fixState(issue, { page_key: "p", issue: "meta_long", fixed_at: "2026-09-23T14:00:00Z", kind: "fixed" })).toBe("fixed");
    expect(fixState({ ...issue, detectedAt: "2026-09-30T10:00:00Z" }, { page_key: "p", issue: "meta_long", fixed_at: "2026-09-23T14:00:00Z", kind: "fixed" })).toBe("returned");
  });

  it("keeps 'not an issue' hidden whatever later crawls find", () => {
    expect(fixState({ ...issue, detectedAt: "2026-09-30T10:00:00Z" }, { page_key: "p", issue: "meta_long", fixed_at: "2026-09-23T14:00:00Z", kind: "ignored" })).toBe("ignored");
  });
});
