import "server-only";
import { collectBlueprintResults } from "./attribution";
import { priorWindow, syncWindow } from "./dates";
import { describeGoogleError, gscRequester } from "./google";
import { querySearchAnalytics, type GscApiRow } from "./gsc";
import { db } from "./supabase";

const UPSERT_BATCH = 1000;

export type SyncTrigger = "manual" | "cron" | "api";

export interface SyncResult {
  siteId: string;
  ok: boolean;
  rowsFetched: number;
  startDate: string;
  endDate: string;
  // Done blueprints whose after-numbers this sync completed.
  blueprintResults?: number;
  error?: string;
}

async function upsertInBatches(table: string, rows: object[], onConflict: string) {
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const { error } = await db().from(table).upsert(rows.slice(i, i + UPSERT_BATCH), { onConflict });
    if (error) throw new Error(`Saving ${table} failed: ${error.message}`);
  }
}

function metrics(row: GscApiRow) {
  return { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position };
}

export async function syncSite(siteId: string, trigger: SyncTrigger, now = new Date()): Promise<SyncResult> {
  const window = syncWindow(now);
  const result: SyncResult = { siteId, ok: false, rowsFetched: 0, ...window };

  const { data: site, error: siteError } = await db()
    .from("sites")
    .select("id, gsc_property")
    .eq("id", siteId)
    .maybeSingle();
  if (siteError) throw siteError;
  if (!site) return { ...result, error: "Site not found." };

  const { data: run, error: runError } = await db()
    .from("gsc_sync_runs")
    .insert({ site_id: siteId, trigger, start_date: window.startDate, end_date: window.endDate })
    .select("id")
    .single();
  if (runError) throw runError;

  try {
    if (!site.gsc_property) throw new Error("Pick a Search Console property for this client first.");
    const request = await gscRequester();
    if (!request) throw new Error("Google Search Console isn't connected.");

    const syncedAt = new Date().toISOString();
    const rows = await querySearchAnalytics(request, site.gsc_property, {
      ...window,
      dimensions: ["date", "query", "page"],
    });
    // Totals cover the prior window too, for the "vs prior 90 days" comparison.
    const totals = await querySearchAnalytics(request, site.gsc_property, {
      startDate: priorWindow(window).startDate,
      endDate: window.endDate,
      dimensions: ["date"],
    });

    await upsertInBatches(
      "gsc_search_analytics",
      rows.map((row) => {
        const [date, query, page] = row.keys ?? [];
        return { site_id: siteId, date, query, page, ...metrics(row), synced_at: syncedAt };
      }),
      "site_id,date,query,page",
    );
    await upsertInBatches(
      "gsc_daily_totals",
      totals.map((row) => ({ site_id: siteId, date: row.keys?.[0], ...metrics(row), synced_at: syncedAt })),
      "site_id,date",
    );

    result.ok = true;
    result.rowsFetched = rows.length;
  } catch (err) {
    result.error = describeGoogleError(err);
  }

  if (result.ok) {
    try {
      result.blueprintResults = await collectBlueprintResults(siteId);
    } catch (err) {
      // The sync itself worked; results are picked up again on the next one.
      console.error("Recording blueprint results failed", err);
    }
  }

  await db()
    .from("gsc_sync_runs")
    .update({
      status: result.ok ? "succeeded" : "failed",
      rows_fetched: result.ok ? result.rowsFetched : null,
      error: result.error ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", run.id);

  return result;
}

export async function syncAllEnabledSites(trigger: SyncTrigger): Promise<SyncResult[]> {
  const { data: sites, error } = await db()
    .from("sites")
    .select("id")
    .eq("sync_enabled", true)
    .not("gsc_property", "is", null);
  if (error) throw error;
  const results: SyncResult[] = [];
  for (const site of sites) results.push(await syncSite(site.id, trigger));
  return results;
}
