import "server-only";
import { buildAudit, fixKey, fixState, type AuditFix, type AuditIssue, type FixState } from "./audit";
import { getLatestCrawl, type CrawlRun } from "./crawl-run";
import { syncWindow } from "./dates";
import { getOverview, getPageReport } from "./reports";
import { db } from "./supabase";

export interface AuditEntry extends AuditIssue {
  state: FixState;
  fixedAt: string | null;
}

export async function getAudit(siteId: string): Promise<{ entries: AuditEntry[]; crawl: CrawlRun | null }> {
  const [overview, crawl, fixes] = await Promise.all([
    getOverview(siteId),
    getLatestCrawl(siteId),
    db().from("audit_fixes").select("page_key, issue, fixed_at, kind").eq("site_id", siteId),
  ]);
  if (fixes.error) throw fixes.error;
  // Without Search Console data the report still lists crawled pages, with 0 impressions.
  const window = overview?.window ?? syncWindow();
  const { rows } = await getPageReport(siteId, { window, search: "", limit: 1000, offset: 0 });
  const issues = buildAudit(rows, { aeo: crawl?.aeo ?? null, crawledAt: crawl?.finished_at ?? crawl?.started_at ?? null });

  const byKey = new Map((fixes.data as AuditFix[]).map((f) => [fixKey(f.page_key, f.issue), f]));
  return {
    crawl,
    entries: issues.map((issue) => {
      const fix = byKey.get(fixKey(issue.pageKey, issue.type));
      return { ...issue, state: fixState(issue, fix), fixedAt: fix?.fixed_at ?? null };
    }),
  };
}
