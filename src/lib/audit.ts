// Site audit: every problem the crawl, visual capture and AEO checks found, as one list.
// Pure, so it's testable; audit-fixes decide which ones are hidden as "marked fixed".
import type { SiteAeo } from "./aeo";
import type { PageRow } from "./reports";

export type Severity = "high" | "med" | "low";

export const ISSUE_TYPES = {
  page_error: { label: "Page returns an error", severity: "high", why: "Visitors and search engines get an error instead of the page." },
  ai_crawler_blocked: {
    label: "AI crawlers blocked",
    severity: "high",
    why: "robots.txt stops these AI crawlers, so their answer engines can't read or cite the site.",
  },
  title_missing: { label: "No title tag", severity: "high", why: "Google has to invent the headline it shows in results." },
  visual_mobile: { label: "Doesn't fit a phone screen", severity: "high", why: "Most local searches are on phones; sideways scrolling drives people off." },
  gsc_not_crawled: {
    label: "In Search Console but not found by the crawler",
    severity: "med",
    why: "Google shows this URL, but no crawled page links to it. It may be removed, redirected or orphaned.",
  },
  title_long: { label: "Title over 60 characters", severity: "med", why: "Google cuts long titles off in results." },
  title_duplicate: { label: "Same title as another page", severity: "med", why: "Google can't tell the pages apart and may show the wrong one." },
  meta_missing: { label: "No meta description", severity: "med", why: "Google picks its own snippet, often a poor one." },
  h1_missing: { label: "No H1 heading", severity: "med", why: "The page has no main heading telling readers and search engines what it's about." },
  visual_contrast: { label: "Low text contrast", severity: "med", why: "Hard-to-read text loses visitors and fails accessibility standards." },
  visual_legibility: { label: "Small text", severity: "med", why: "Text under 12px is hard to read on a phone." },
  visual_tapTargets: { label: "Crowded tap targets", severity: "med", why: "Small buttons and links close together are easy to mis-tap." },
  visual_aboveFold: {
    label: "First screen missing a headline or call to action",
    severity: "med",
    why: "Visitors should see what the page offers and how to act without scrolling.",
  },
  answers_weak: {
    label: "Answers hard for AI to quote",
    severity: "med",
    why: "Answer engines quote short, self-contained answers placed right after the question.",
  },
  meta_long: { label: "Meta description over 155 characters", severity: "low", why: "Google cuts long descriptions off mid-sentence." },
  meta_duplicate: { label: "Same meta description as another page", severity: "low", why: "Duplicate snippets make pages look interchangeable in results." },
  h1_multiple: { label: "More than one H1", severity: "low", why: "One main heading per page keeps the topic clear." },
  thin_content: { label: "Under 300 words", severity: "low", why: "Short pages have little for search engines to rank or AI to quote." },
  no_schema: { label: "No structured data (schema)", severity: "low", why: "Schema helps search engines and AI understand the business and page." },
  not_in_sitemap: { label: "Not in the sitemap", severity: "low", why: "The sitemap is how search engines find every page; this one is missing from it." },
  visual_images: { label: "Image problems", severity: "low", why: "Broken images look neglected; missing alt text hurts accessibility and image search." },
  visual_failed: { label: "Visual capture failed", severity: "low", why: "This page couldn't be scored; crawl again to retry." },
  llms_txt: { label: "llms.txt missing or incomplete", severity: "low", why: "llms.txt gives AI tools a plain summary of the business and its key pages." },
} as const satisfies Record<string, { label: string; severity: Severity; why: string }>;

export type IssueType = keyof typeof ISSUE_TYPES;

export interface AuditIssue {
  type: IssueType;
  // "" for site-wide issues.
  pageKey: string;
  url: string | null;
  detail: string;
  impressions: number;
  // When the data behind the issue was collected; a "fixed" mark older than this is stale.
  detectedAt: string | null;
}

export const TITLE_MAX = 60;
export const META_MAX = 155;
const THIN_WORDS = 300;
const ANSWER_MIN = 70;
// Legal and contact pages are short and schema-free by nature.
const UTILITY_PAGE = /\/(privacy|privacy-policy|terms|terms-of-service|accessibility|cookies?|legal|contact)\/?$/i;

const VISUAL_TYPES: Record<string, IssueType> = {
  mobile: "visual_mobile",
  legibility: "visual_legibility",
  contrast: "visual_contrast",
  tapTargets: "visual_tapTargets",
  aboveFold: "visual_aboveFold",
  images: "visual_images",
};

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

export function buildAudit(rows: PageRow[], site: { aeo: SiteAeo | null; crawledAt: string | null }): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const add = (type: IssueType, row: PageRow | null, detail: string, detectedAt: string | null) =>
    issues.push({ type, pageKey: row?.pageKey ?? "", url: row?.url ?? null, detail, impressions: row?.impressions ?? 0, detectedAt });

  const live = rows.filter((r) => r.crawl && !r.crawl.error && !(r.crawl.statusCode !== null && r.crawl.statusCode >= 400));
  const countBy = (value: (r: PageRow) => string | null) => {
    const counts = new Map<string, number>();
    live.forEach((r) => {
      const v = value(r);
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    });
    return counts;
  };
  const titles = countBy((r) => r.crawl!.title?.trim().toLowerCase() || null);
  const metas = countBy((r) => r.crawl!.metaDescription?.trim().toLowerCase() || null);

  for (const row of rows) {
    const c = row.crawl;
    if (!c) {
      if (row.impressions > 0) add("gsc_not_crawled", row, `${row.impressions} impressions in the last 90 days.`, site.crawledAt);
      continue;
    }
    const at = c.crawledAt;
    if (c.error || (c.statusCode !== null && c.statusCode >= 400)) {
      add("page_error", row, c.error ?? `HTTP ${c.statusCode}`, at);
      continue;
    }
    const utility = UTILITY_PAGE.test(pathOf(row.url));

    if (!c.title) add("title_missing", row, "No <title> tag.", at);
    else {
      if (c.title.length > TITLE_MAX) add("title_long", row, `${c.title.length} characters: ${c.title}`, at);
      const n = titles.get(c.title.trim().toLowerCase()) ?? 0;
      if (n > 1) add("title_duplicate", row, `Shared with ${n - 1} other page${n > 2 ? "s" : ""}: ${c.title}`, at);
    }
    if (!c.metaDescription) add("meta_missing", row, "No meta description.", at);
    else {
      if (c.metaDescription.length > META_MAX) add("meta_long", row, `${c.metaDescription.length} characters.`, at);
      const n = metas.get(c.metaDescription.trim().toLowerCase()) ?? 0;
      if (n > 1) add("meta_duplicate", row, `Shared with ${n - 1} other page${n > 2 ? "s" : ""}.`, at);
    }
    if (c.h1.length === 0) add("h1_missing", row, "No H1 on the page.", at);
    else if (c.h1.length > 1) add("h1_multiple", row, `${c.h1.length} H1s: ${c.h1.join(" · ")}`, at);
    if (!utility && c.wordCount !== null && c.wordCount < THIN_WORDS) add("thin_content", row, `${c.wordCount} words.`, at);
    if (!utility && c.schemaTypes.length === 0) add("no_schema", row, "No JSON-LD structured data.", at);
    if (!c.inSitemap) add("not_in_sitemap", row, "Found by following links only.", at);

    const v = c.visual;
    if (v.error) add("visual_failed", row, v.error, v.capturedAt);
    for (const check of v.checks) {
      // Legal and contact pages don't need a sales call to action on the first screen.
      if (utility && check.key === "aboveFold") continue;
      if (check.points < check.max * 0.7) add(VISUAL_TYPES[check.key], row, `${check.points}/${check.max}. ${check.detail}`, v.capturedAt);
    }

    const a = c.answers;
    if (a.score !== null && a.score < ANSWER_MIN && a.check) {
      const weakest = [...a.check.items].sort((x, y) => x.score - y.score)[0];
      const why = weakest ? ` Weakest: "${weakest.question}" (${weakest.score}). ${weakest.issues[0] ?? ""}` : "";
      add("answers_weak", row, `Score ${a.score}.${why}`.trim(), at);
    }
  }

  if (site.aeo) {
    const blocked = site.aeo.aiCrawlers.filter((c) => c.status !== "allowed");
    if (blocked.length) {
      const list = blocked.map((c) => (c.status === "blocked" ? `${c.agent} (whole site)` : `${c.agent} (${c.blockedPages.length} pages)`));
      add("ai_crawler_blocked", null, list.join(", "), site.crawledAt);
    }
    if (site.aeo.llmsTxt.issues.length) add("llms_txt", null, site.aeo.llmsTxt.issues.join(" "), site.crawledAt);
  }
  return issues;
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, med: 1, low: 2 };

export interface AuditGroup<T extends AuditIssue = AuditIssue> {
  type: IssueType;
  issues: T[];
}

// Groups by issue type: most severe first, then by how much search traffic the affected
// pages get. Within a group, the busiest page first.
export function groupIssues<T extends AuditIssue>(issues: T[]): AuditGroup<T>[] {
  const byType = new Map<IssueType, T[]>();
  issues.forEach((i) => byType.set(i.type, [...(byType.get(i.type) ?? []), i]));
  const traffic = (list: AuditIssue[]) => list.reduce((sum, i) => sum + i.impressions, 0);
  return [...byType.entries()]
    .map(([type, list]) => ({
      type,
      issues: [...list].sort((a, b) => b.impressions - a.impressions || (a.url ?? "").localeCompare(b.url ?? "")),
    }))
    .sort(
      (a, b) =>
        SEVERITY_RANK[ISSUE_TYPES[a.type].severity] - SEVERITY_RANK[ISSUE_TYPES[b.type].severity] ||
        traffic(b.issues) - traffic(a.issues) ||
        b.issues.length - a.issues.length,
    );
}

export interface AuditFix {
  page_key: string;
  issue: string;
  fixed_at: string;
}

export type FixState = "open" | "fixed" | "returned";

// A mark counts until newer data still shows the issue; then it's "returned" (shown as open).
export function fixState(issue: AuditIssue, fix: AuditFix | undefined): FixState {
  if (!fix) return "open";
  if (issue.detectedAt && new Date(issue.detectedAt) > new Date(fix.fixed_at)) return "returned";
  return "fixed";
}

export const fixKey = (pageKey: string, type: string) => `${pageKey}\u0000${type}`;
