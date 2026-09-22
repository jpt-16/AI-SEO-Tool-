import "server-only";
import { crawlSite, type CrawlOptions } from "./crawl";
import { db } from "./supabase";

const UPSERT_BATCH = 200;

export type CrawlTrigger = "manual" | "cron" | "api" | "script";

export interface CrawlResult {
  siteId: string;
  ok: boolean;
  pagesCrawled: number;
  pagesFailed: number;
  error?: string;
}

export async function runSiteCrawl(siteId: string, trigger: CrawlTrigger, options?: CrawlOptions): Promise<CrawlResult> {
  const result: CrawlResult = { siteId, ok: false, pagesCrawled: 0, pagesFailed: 0 };

  const { data: site, error: siteError } = await db().from("sites").select("id, domain").eq("id", siteId).maybeSingle();
  if (siteError) throw siteError;
  if (!site) return { ...result, error: "Site not found." };

  const { data: run, error: runError } = await db()
    .from("crawl_runs")
    .insert({ site_id: siteId, trigger })
    .select("id")
    .single();
  if (runError) throw runError;

  try {
    const pages = await crawlSite(`https://${site.domain}`, options);
    if (pages.length === 0) throw new Error(`Couldn't load any pages from https://${site.domain}.`);

    const crawledAt = new Date().toISOString();
    const rows = pages.map((p) => ({
      site_id: siteId,
      url: p.url,
      status_code: p.statusCode,
      title: p.title ?? null,
      meta_description: p.metaDescription ?? null,
      h1: p.h1 ?? [],
      h2: p.h2 ?? [],
      word_count: p.wordCount ?? null,
      internal_link_count: p.internalLinkCount ?? null,
      json_ld: p.jsonLd ?? [],
      schema_types: p.schemaTypes ?? [],
      in_sitemap: p.inSitemap,
      error: p.error,
      crawl_run_id: run.id,
      crawled_at: crawledAt,
    }));
    for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
      const { error } = await db()
        .from("crawl_pages")
        .upsert(rows.slice(i, i + UPSERT_BATCH), { onConflict: "site_id,page_key" });
      if (error) throw new Error(`Saving crawl_pages failed: ${error.message}`);
    }

    result.ok = true;
    result.pagesFailed = pages.filter((p) => p.error).length;
    result.pagesCrawled = pages.length - result.pagesFailed;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err);
  }

  await db()
    .from("crawl_runs")
    .update({
      status: result.ok ? "succeeded" : "failed",
      pages_crawled: result.ok ? result.pagesCrawled : null,
      pages_failed: result.ok ? result.pagesFailed : null,
      error: result.error ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", run.id);

  return result;
}

export interface CrawlRun {
  status: "running" | "succeeded" | "failed";
  pages_crawled: number | null;
  pages_failed: number | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export async function getLatestCrawl(siteId: string): Promise<CrawlRun | null> {
  const { data, error } = await db()
    .from("crawl_runs")
    .select("status, pages_crawled, pages_failed, error, started_at, finished_at")
    .eq("site_id", siteId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}
