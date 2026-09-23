import "server-only";
import type { AnswerCheck } from "./aeo";
import type { VisualCheck } from "./visual-core";
import { priorWindow, windowEndingOn, type DateWindow } from "./dates";
import { summarize, type Totals } from "./metrics";
import { db } from "./supabase";

export interface Overview {
  window: DateWindow;
  current: Totals | null;
  prior: Totals | null;
}

// Anchored on the newest synced day, so the window matches what's stored.
export async function getOverview(siteId: string): Promise<Overview | null> {
  const { data: latest, error } = await db()
    .from("gsc_daily_totals")
    .select("date")
    .eq("site_id", siteId)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!latest) return null;

  const window = windowEndingOn(latest.date);
  const prior = priorWindow(window);
  const { data: rows, error: rowsError } = await db()
    .from("gsc_daily_totals")
    .select("date, clicks, impressions, position")
    .eq("site_id", siteId)
    .gte("date", prior.startDate)
    .lte("date", window.endDate);
  if (rowsError) throw rowsError;

  return {
    window,
    current: summarize(rows.filter((r) => r.date >= window.startDate)),
    prior: summarize(rows.filter((r) => r.date <= prior.endDate)),
  };
}

export type ReportTab = "queries" | "pages";

interface Paging {
  window: DateWindow;
  search: string;
  limit: number;
  offset: number;
}

async function callReport(fn: string, siteId: string, { window, search, limit, offset }: Paging) {
  const { data, error } = await db().rpc(fn, {
    p_site_id: siteId,
    p_start: window.startDate,
    p_end: window.endDate,
    p_search: search || null,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  const raw = (data ?? []) as Array<Record<string, unknown>>;
  return { raw, total: Number(raw[0]?.total_count ?? 0) };
}

export interface QueryRow {
  query: string;
  topPage: string | null;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export async function getQueryReport(siteId: string, paging: Paging): Promise<{ rows: QueryRow[]; total: number }> {
  const { raw, total } = await callReport("gsc_query_report", siteId, paging);
  return {
    total,
    rows: raw.map((r) => ({
      query: String(r.query),
      topPage: (r.top_page as string | null) ?? null,
      clicks: Number(r.clicks),
      impressions: Number(r.impressions),
      ctr: Number(r.ctr ?? 0),
      position: Number(r.position ?? 0),
    })),
  };
}

export interface PageQuery {
  query: string;
  clicks: number;
  impressions: number;
  position: number;
}

export interface PageRow {
  pageKey: string;
  url: string;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
  topQueries: PageQuery[];
  // Null when the crawler hasn't seen this page (e.g. only Search Console knows it).
  crawl: {
    title: string | null;
    metaDescription: string | null;
    h1: string[];
    wordCount: number | null;
    internalLinkCount: number | null;
    schemaTypes: string[];
    inSitemap: boolean;
    statusCode: number | null;
    error: string | null;
    crawledAt: string;
    visual: {
      score: number | null;
      checks: VisualCheck[];
      // How the capture went: a bad status, failed requests or no network idle can mean
      // the screenshot shows a half-loaded page.
      capture: { networkIdle: boolean | null; status: number | null; failedRequests: number | null };
      error: string | null;
      capturedAt: string | null;
      hasScreenshot: boolean;
    };
    answers: { score: number | null; check: AnswerCheck | null };
  } | null;
}

export async function getPageReport(siteId: string, paging: Paging): Promise<{ rows: PageRow[]; total: number }> {
  const { raw, total } = await callReport("gsc_page_seo_report", siteId, paging);
  return {
    total,
    rows: raw.map((r) => ({
      pageKey: String(r.page_key),
      url: String(r.url),
      clicks: Number(r.clicks),
      impressions: Number(r.impressions),
      ctr: r.ctr === null ? null : Number(r.ctr),
      position: r.position === null ? null : Number(r.position),
      topQueries: ((r.top_queries as PageQuery[] | null) ?? []).map((q) => ({
        query: q.query,
        clicks: Number(q.clicks),
        impressions: Number(q.impressions),
        position: Number(q.position),
      })),
      crawl: r.crawled_at
        ? {
            title: (r.title as string | null) ?? null,
            metaDescription: (r.meta_description as string | null) ?? null,
            h1: (r.h1 as string[] | null) ?? [],
            wordCount: (r.word_count as number | null) ?? null,
            internalLinkCount: (r.internal_link_count as number | null) ?? null,
            schemaTypes: (r.schema_types as string[] | null) ?? [],
            inSitemap: Boolean(r.in_sitemap),
            statusCode: (r.status_code as number | null) ?? null,
            error: (r.crawl_error as string | null) ?? null,
            crawledAt: String(r.crawled_at),
            visual: {
              score: (r.visual_score as number | null) ?? null,
              checks: (r.visual_checks as VisualCheck[] | null) ?? [],
              capture: {
                networkIdle: (r.visual_capture as { networkIdle?: boolean } | null)?.networkIdle ?? null,
                status: (r.visual_capture as { status?: number } | null)?.status ?? null,
                failedRequests: (r.visual_capture as { failedRequests?: number } | null)?.failedRequests ?? null,
              },
              error: (r.visual_error as string | null) ?? null,
              capturedAt: (r.visual_captured_at as string | null) ?? null,
              hasScreenshot: Boolean(r.has_screenshot),
            },
            answers: {
              score: (r.answer_score as number | null) ?? null,
              check: (r.answer_check as AnswerCheck | null) ?? null,
            },
          }
        : null,
    })),
  };
}

export interface SyncRun {
  id: number;
  trigger: string;
  status: "running" | "succeeded" | "failed";
  start_date: string | null;
  end_date: string | null;
  rows_fetched: number | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export async function getRecentRuns(siteId: string, limit = 10): Promise<SyncRun[]> {
  const { data, error } = await db()
    .from("gsc_sync_runs")
    .select("*")
    .eq("site_id", siteId)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}
