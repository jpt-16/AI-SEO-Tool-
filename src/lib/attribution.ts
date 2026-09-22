import "server-only";
import {
  baselineWindow,
  computeDiff,
  doneDate,
  resultReady,
  resultWindow,
  type StatsSnapshot,
} from "./attribution-core";
import type { PageSnapshot } from "./blueprint-prompt";
import type { DateWindow } from "./dates";
import { db } from "./supabase";

interface MeasuredBlueprint {
  id: number;
  site_id: string;
  page_key: string;
  target_queries: string[] | null;
  page_snapshot: PageSnapshot;
  done_at: string | null;
  baseline_snapshot: StatsSnapshot | null;
}

const MEASURED_COLUMNS = "id, site_id, page_key, target_queries, page_snapshot, done_at, baseline_snapshot";

export function targetQueriesOf(b: Pick<MeasuredBlueprint, "target_queries" | "page_snapshot">): string[] {
  return b.target_queries?.length ? b.target_queries : b.page_snapshot.topQueries.map((q) => q.query);
}

// Last day of Search Console data synced for the site.
export async function latestDataDate(siteId: string): Promise<string | null> {
  const { data, error } = await db()
    .from("gsc_daily_totals")
    .select("date")
    .eq("site_id", siteId)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.date ?? null;
}

async function blueprintStats(b: MeasuredBlueprint, window: DateWindow): Promise<StatsSnapshot> {
  const { data, error } = await db().rpc("blueprint_stats", {
    p_site_id: b.site_id,
    p_page_key: b.page_key,
    p_queries: targetQueriesOf(b),
    p_start: window.startDate,
    p_end: window.endDate,
  });
  if (error) throw error;
  return data as StatsSnapshot;
}

// Marks a blueprint done and records its "before" numbers.
export async function markBlueprintDone(id: number, now = new Date()): Promise<void> {
  const { data, error } = await db().from("blueprints").select(MEASURED_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Blueprint not found.");
  const b = data as MeasuredBlueprint;
  const baseline = await blueprintStats(b, baselineWindow(doneDate(now), await latestDataDate(b.site_id)));
  const doneAt = now.toISOString();
  const { error: updateError } = await db()
    .from("blueprints")
    .update({
      status: "done",
      status_changed_at: doneAt,
      done_at: doneAt,
      baseline_snapshot: baseline,
      result_snapshot: null,
      result_diff: null,
      result_at: null,
    })
    .eq("id", id);
  if (updateError) throw updateError;
}

// Records the "after" numbers for done blueprints whose 14 post-change days
// have all synced. Runs after every Search Console sync.
export async function collectBlueprintResults(siteId: string, now = new Date()): Promise<number> {
  const latest = await latestDataDate(siteId);
  const { data, error } = await db()
    .from("blueprints")
    .select(MEASURED_COLUMNS)
    .eq("site_id", siteId)
    .eq("status", "done")
    .is("result_snapshot", null)
    .not("done_at", "is", null);
  if (error) throw error;

  let recorded = 0;
  for (const b of data as MeasuredBlueprint[]) {
    const done = doneDate(b.done_at!);
    if (!resultReady(done, latest)) continue;
    // Marked done before baselines existed: the data before the change is still there.
    const baseline = b.baseline_snapshot ?? (await blueprintStats(b, baselineWindow(done, latest)));
    const result = await blueprintStats(b, resultWindow(done));
    const { error: updateError } = await db()
      .from("blueprints")
      .update({
        baseline_snapshot: baseline,
        result_snapshot: result,
        result_diff: computeDiff(baseline, result),
        result_at: now.toISOString(),
      })
      .eq("id", b.id)
      .eq("status", "done");
    if (updateError) throw updateError;
    recorded++;
  }
  return recorded;
}
