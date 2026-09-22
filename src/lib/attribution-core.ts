import { addDays, GSC_TIMEZONE, isoDateInTimeZone, windowEndingOn, type DateWindow } from "./dates";

// Length of the before and after windows. Equal lengths keep the raw numbers comparable.
export const RESULT_DAYS = 14;

export interface StatBlock {
  clicks: number;
  impressions: number;
  // Impression-weighted average; null when there were no impressions.
  position: number | null;
}

export interface QueryStat extends StatBlock {
  query: string;
}

// Output of the blueprint_stats() SQL function.
export interface StatsSnapshot {
  window: DateWindow;
  page: StatBlock;
  cited: StatBlock;
  queries: QueryStat[];
}

export interface Delta {
  before: number | null;
  after: number | null;
  change: number | null;
}

export interface DiffBlock {
  clicks: Delta;
  impressions: Delta;
  position: Delta;
}

export interface ResultDiff {
  cited: DiffBlock;
  page: DiffBlock;
  queries: (DiffBlock & { query: string })[];
}

// The Search Console (Pacific) date a blueprint was marked done. That day is
// split between old and new, so it belongs to neither window.
export function doneDate(doneAt: string | Date): string {
  return isoDateInTimeZone(new Date(doneAt), GSC_TIMEZONE);
}

// The 14 days before the change, as far as synced data reaches.
export function baselineWindow(done: string, latestDataDate: string | null): DateWindow {
  const dayBefore = addDays(done, -1);
  const end = latestDataDate && latestDataDate < dayBefore ? latestDataDate : dayBefore;
  return windowEndingOn(end, RESULT_DAYS);
}

// The first 14 full days after the change.
export function resultWindow(done: string): DateWindow {
  return { startDate: addDays(done, 1), endDate: addDays(done, RESULT_DAYS) };
}

export function resultReady(done: string, latestDataDate: string | null): boolean {
  return latestDataDate !== null && latestDataDate >= resultWindow(done).endDate;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function delta(before: number | null, after: number | null): Delta {
  return { before, after, change: before === null || after === null ? null : round2(after - before) };
}

function diffBlock(before: StatBlock, after: StatBlock): DiffBlock {
  return {
    clicks: delta(before.clicks, after.clicks),
    impressions: delta(before.impressions, after.impressions),
    position: delta(before.position, after.position),
  };
}

const EMPTY: StatBlock = { clicks: 0, impressions: 0, position: null };

export function computeDiff(before: StatsSnapshot, after: StatsSnapshot): ResultDiff {
  const afterByQuery = new Map(after.queries.map((q) => [q.query, q]));
  return {
    cited: diffBlock(before.cited, after.cited),
    page: diffBlock(before.page, after.page),
    queries: before.queries.map((q) => ({ query: q.query, ...diffBlock(q, afterByQuery.get(q.query) ?? EMPTY) })),
  };
}

// The queries a blueprint is measured on: the ones Claude cited, if they're in
// the data it saw, otherwise every query it saw.
export function pickTargetQueries(cited: string[] | null | undefined, seen: string[]): string[] {
  const byLower = new Map(seen.map((q) => [q.toLowerCase(), q]));
  const matched = [...new Set((cited ?? []).map((q) => byLower.get(q.trim().toLowerCase())).filter((q) => q !== undefined))];
  return matched.length ? matched : seen;
}

export interface Sortable {
  done_at: string | null;
  result_diff: ResultDiff | null;
}

// Measured results by biggest click increase on the cited queries (then on the
// whole page); pending ones after, soonest result first.
export function sortResults<T extends Sortable>(items: T[]): T[] {
  const clicks = (d: ResultDiff, k: "cited" | "page") => d[k].clicks.change ?? 0;
  return [...items].sort((a, b) => {
    if (a.result_diff && b.result_diff) {
      return clicks(b.result_diff, "cited") - clicks(a.result_diff, "cited") || clicks(b.result_diff, "page") - clicks(a.result_diff, "page");
    }
    if (a.result_diff) return -1;
    if (b.result_diff) return 1;
    return (a.done_at ?? "").localeCompare(b.done_at ?? "");
  });
}
