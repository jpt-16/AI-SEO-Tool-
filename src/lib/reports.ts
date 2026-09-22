import "server-only";
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

export interface ReportRow {
  key: string;
  secondary: string | null;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export async function getReport(
  siteId: string,
  tab: ReportTab,
  window: DateWindow,
  search: string,
  limit: number,
  offset: number,
): Promise<{ rows: ReportRow[]; total: number }> {
  const { data, error } = await db().rpc(tab === "queries" ? "gsc_query_report" : "gsc_page_report", {
    p_site_id: siteId,
    p_start: window.startDate,
    p_end: window.endDate,
    p_search: search || null,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  const raw = (data ?? []) as Array<Record<string, string | number | null>>;
  return {
    total: Number(raw[0]?.total_count ?? 0),
    rows: raw.map((r) => ({
      key: String(tab === "queries" ? r.query : r.page),
      secondary: (tab === "queries" ? r.top_page : r.top_query) as string | null,
      clicks: Number(r.clicks),
      impressions: Number(r.impressions),
      ctr: Number(r.ctr ?? 0),
      position: Number(r.position ?? 0),
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
