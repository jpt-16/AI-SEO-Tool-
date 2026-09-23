import "server-only";
import { checkSiteAeo, type SiteAeo } from "./aeo";
import { crawlSite, CRAWLER_USER_AGENT, type CrawlOptions } from "./crawl";
import { db } from "./supabase";
import { captureSite } from "./visual";

const UPSERT_BATCH = 200;

export type CrawlTrigger = "manual" | "cron" | "api" | "script";

export interface CrawlResult {
  siteId: string;
  ok: boolean;
  pagesCrawled: number;
  pagesFailed: number;
  visualPages?: number;
  visualFailed?: number;
  // Visual capture failing (e.g. no browser) doesn't fail the crawl.
  visualError?: string;
  error?: string;
}

export interface RunCrawlOptions extends CrawlOptions {
  // Headless-browser capture and scoring; on unless false or VISUAL_CAPTURE=off.
  visual?: boolean;
  // Stop starting visual captures this long after the crawl starts. Defaults to
  // VISUAL_BUDGET_MS on serverless (functions stop at 300s), unlimited elsewhere.
  visualBudgetMs?: number;
}

const VISUAL_BUDGET_MS = 240_000;

const errorText = (err: unknown) =>
  err instanceof Error ? err.message.split("\n")[0] : String((err as { message?: string })?.message ?? err);

// Captures every page that loaded and stores its score, checks and screenshot.
async function captureVisuals(siteId: string, urls: string[], result: CrawlResult, deadline: number) {
  const capturedAt = new Date().toISOString();
  let captures;
  try {
    captures = await captureSite(urls, undefined, undefined, deadline);
  } catch (err) {
    result.visualError = `Visual capture couldn't start: ${errorText(err)}`;
    return;
  }
  const rows = captures.map((c) =>
    "error" in c
      ? { site_id: siteId, url: c.url, visual_score: null, visual_checks: null, visual_metrics: null, screenshot_jpeg: null, screenshot_sha256: null, visual_error: c.error, visual_captured_at: capturedAt }
      : {
          site_id: siteId,
          url: c.url,
          visual_score: c.score.score,
          visual_checks: c.score.checks,
          visual_metrics: { ...c.metrics, networkIdle: c.networkIdle, status: c.status, failedRequests: c.failedRequests, ms: c.ms },
          screenshot_jpeg: c.screenshot,
          screenshot_sha256: c.screenshotSha256,
          visual_error: null,
          visual_captured_at: capturedAt,
        },
  );
  // Screenshots make rows large, so save a few at a time.
  for (let i = 0; i < rows.length; i += 10) {
    const { error } = await db().from("crawl_pages").upsert(rows.slice(i, i + 10), { onConflict: "site_id,page_key" });
    if (error) throw new Error(`Saving visual scores failed: ${error.message}`);
  }
  result.visualFailed = captures.filter((c) => "error" in c).length;
  result.visualPages = captures.length - result.visualFailed;
  const skipped = urls.length - captures.length;
  if (skipped > 0) {
    result.visualError = `Stopped at the time limit after ${captures.length} of ${urls.length} pages; the other ${skipped} keep their previous visual scores.`;
  }
}

export async function runSiteCrawl(siteId: string, trigger: CrawlTrigger, options: RunCrawlOptions = {}): Promise<CrawlResult> {
  const result: CrawlResult = { siteId, ok: false, pagesCrawled: 0, pagesFailed: 0 };
  const started = Date.now();
  const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  const visualBudget = options.visualBudgetMs ?? (serverless ? VISUAL_BUDGET_MS : Number.POSITIVE_INFINITY);
  let aeo: SiteAeo | null = null;

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
      answer_score: p.answers?.score ?? null,
      answer_check: p.answers ?? null,
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

    const loaded = pages.filter((p) => !p.error && p.title !== undefined).map((p) => p.url);
    aeo = await checkSiteAeo(`https://${site.domain}`, loaded, { userAgent: CRAWLER_USER_AGENT, fetchImpl: options.fetchImpl });
    if (options.visual !== false && process.env.VISUAL_CAPTURE !== "off" && loaded.length) {
      await captureVisuals(siteId, loaded, result, started + visualBudget);
    }
  } catch (err) {
    result.error = errorText(err);
  }

  await db()
    .from("crawl_runs")
    .update({
      status: result.ok ? "succeeded" : "failed",
      pages_crawled: result.ok ? result.pagesCrawled : null,
      pages_failed: result.ok ? result.pagesFailed : null,
      aeo,
      visual_pages: result.visualPages ?? null,
      visual_failed: result.visualFailed ?? null,
      visual_error: result.visualError ?? null,
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
  aeo: SiteAeo | null;
  visual_pages: number | null;
  visual_failed: number | null;
  visual_error: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export async function getLatestCrawl(siteId: string): Promise<CrawlRun | null> {
  const { data, error } = await db()
    .from("crawl_runs")
    .select("status, pages_crawled, pages_failed, aeo, visual_pages, visual_failed, visual_error, error, started_at, finished_at")
    .eq("site_id", siteId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}
