// Site audit as a Markdown brief to hand to Claude Code (or any developer): open issues
// grouped by page, with what's wrong now and what to change.
import { ISSUE_TYPES, META_MAX, TITLE_MAX, type AuditIssue, type IssueType, type Severity } from "./audit";

// What to change, per issue type. Written as instructions to whoever edits the site.
export const FIX: Record<IssueType, string> = {
  page_error: "Make this URL return 200 with the right content, or 301-redirect it to the page that replaced it and update links to it.",
  ai_crawler_blocked: "Edit robots.txt so these crawlers are allowed (remove their Disallow rules, or add an `Allow: /` group for them).",
  title_missing: `Add a <title> of ${TITLE_MAX} characters or fewer: what the page offers, then the brand name.`,
  visual_mobile: "Fix the layout so nothing is wider than a 390px phone screen (no sideways scrolling), and make sure the page has `<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">`.",
  gsc_not_crawled: "Google still shows this URL but no page links to it. If the page should exist, link to it from the navigation or a related page; if it's gone, 301-redirect it to the closest current page.",
  title_long: `Shorten the <title> to ${TITLE_MAX} characters or fewer. Keep the main search term first and the brand name last.`,
  title_duplicate: "Give this page its own <title> describing what's specific to it, so it doesn't match another page.",
  meta_missing: `Add a meta description of 120–${META_MAX} characters that summarises the page and gives a reason to click.`,
  h1_missing: "Add one H1 near the top that states what the page is about.",
  visual_contrast: "Raise the contrast of the low-contrast text to at least 4.5:1 against its background (3:1 for large text), by darkening the text or changing the background.",
  visual_legibility: "Raise body and label text to at least 12px on phones (16px for body copy is better).",
  visual_tapTargets: "Make small buttons and links at least 24×24px, or add spacing so they're not crowded together.",
  visual_aboveFold: "Check the first screen on a 390×844 phone: the H1 and a main call-to-action (e.g. call, book, quote, shop, contact) should both be visible without scrolling. The check is automatic, so verify first: if a clear call to action is already visible, change nothing and say which one it is.",
  answers_weak: "After each question heading or FAQ item, start with a direct answer of 25 words or fewer that makes sense on its own (don't start with 'It' or 'This'). Keep that first paragraph under 60 words, and put detail after it.",
  meta_long: `Shorten the meta description to ${META_MAX} characters or fewer so it isn't cut off.`,
  meta_duplicate: "Write a meta description specific to this page, so it doesn't match another page.",
  h1_multiple: "Keep one H1 and change the others to H2.",
  thin_content: "Add genuinely useful content (the service, who it's for, the area, common questions) to get past 300 words. Don't pad it.",
  no_schema: "Add JSON-LD structured data suited to the page, e.g. LocalBusiness/Organization on the home page, Service or Product on offer pages, Article on blog posts, FAQPage where there's an FAQ. Use only facts that are on the page.",
  not_in_sitemap: "Add this URL to the sitemap.",
  visual_images: "Fix broken image URLs, and give every meaningful image descriptive alt text (alt=\"\" for decorative ones).",
  visual_failed: "The tool couldn't capture this page; nothing to change in the site for this.",
  llms_txt: "Add /llms.txt: a `# Business name` line, a `> one-paragraph summary`, then `## Sections` listing key pages as Markdown links.",
};

const LABEL: Record<Severity, string> = { high: "HIGH", med: "MEDIUM", low: "LOW" };
const RANK: Record<Severity, number> = { high: 0, med: 1, low: 2 };
const sev = (i: AuditIssue) => ISSUE_TYPES[i.type].severity;

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

const line = (i: AuditIssue) => `- **[${LABEL[sev(i)]}] ${ISSUE_TYPES[i.type].label}.** Now: ${i.detail}\n  Fix: ${FIX[i.type]}`;

export function auditBrief(input: {
  site: { name: string; domain: string };
  issues: AuditIssue[];
  crawledAt: string | null;
  generatedAt: Date;
}): string {
  const { site, crawledAt } = input;
  const issues = input.issues.filter((i) => i.type !== "visual_failed");
  const origin = `https://${site.domain}`;
  const date = (iso: string | Date) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  const count = (s: Severity) => issues.filter((i) => sev(i) === s).length;

  const out: string[] = [
    `# SEO fixes for ${site.name} (${site.domain})`,
    "",
    `From the JT Builds SEO Workbench site audit · crawled ${crawledAt ? date(crawledAt) : "—"} · exported ${date(input.generatedAt)}`,
    `${issues.length} open issue${issues.length === 1 ? "" : "s"}: ${count("high")} high, ${count("med")} medium, ${count("low")} low.`,
    "",
    "## Instructions",
    "",
    `You're working in the codebase for ${origin}. Fix the issues below.`,
    "",
    "- Work page by page. Find each page's source from its URL path.",
    "- Keep each page's meaning, facts and brand name. Don't invent services, prices, locations, reviews or claims.",
    `- Limits: titles ${TITLE_MAX} characters or fewer, meta descriptions ${META_MAX} or fewer, one H1 per page.`,
    "- Higher-severity issues and pages with more search impressions come first.",
    "- If a fix needs information you don't have, skip it and list it at the end as a question.",
    "- Finish with a short summary of what changed on each page. The site gets re-crawled afterwards to confirm.",
    "",
  ];

  if (issues.length === 0) {
    out.push("No open issues. Nothing to change.", "");
    return out.join("\n");
  }

  const siteWide = issues.filter((i) => !i.url).sort((a, b) => RANK[sev(a)] - RANK[sev(b)]);
  if (siteWide.length) out.push("## Whole site", "", ...siteWide.map(line), "");

  const byPage = new Map<string, AuditIssue[]>();
  issues.filter((i) => i.url).forEach((i) => byPage.set(i.url!, [...(byPage.get(i.url!) ?? []), i]));
  const pages = [...byPage.entries()]
    .map(([url, list]) => ({ url, list: list.sort((a, b) => RANK[sev(a)] - RANK[sev(b)]), top: Math.min(...list.map((i) => RANK[sev(i)])), impressions: list[0].impressions }))
    .sort((a, b) => a.top - b.top || b.impressions - a.impressions || a.url.localeCompare(b.url));

  for (const page of pages) {
    out.push(`## ${pathOf(page.url)}`, "", `${page.url} · ${page.impressions} search impressions in the last 90 days`, "", ...page.list.map(line), "");
  }
  return out.join("\n");
}
