import { describe, expect, it } from "vitest";
import {
  baselineWindow,
  computeDiff,
  doneDate,
  pickTargetQueries,
  resultReady,
  resultWindow,
  sortResults,
  type ResultDiff,
  type StatsSnapshot,
} from "./attribution-core";

const snap = (cited: [number, number, number | null], page: [number, number, number | null], queries: StatsSnapshot["queries"]): StatsSnapshot => ({
  window: { startDate: "2026-09-01", endDate: "2026-09-14" },
  cited: { clicks: cited[0], impressions: cited[1], position: cited[2] },
  page: { clicks: page[0], impressions: page[1], position: page[2] },
  queries,
});

describe("windows", () => {
  it("uses the Search Console (Pacific) date for done", () => {
    // 03:00 UTC on Sep 23 is still Sep 22 in California.
    expect(doneDate("2026-09-23T03:00:00Z")).toBe("2026-09-22");
  });

  it("baseline is the 14 days before done, capped at the last synced day", () => {
    expect(baselineWindow("2026-09-22", "2026-09-19")).toEqual({ startDate: "2026-09-06", endDate: "2026-09-19" });
    expect(baselineWindow("2026-09-22", "2026-10-30")).toEqual({ startDate: "2026-09-08", endDate: "2026-09-21" });
    expect(baselineWindow("2026-09-22", null)).toEqual({ startDate: "2026-09-08", endDate: "2026-09-21" });
  });

  it("result is the 14 full days after done, ready once they've all synced", () => {
    expect(resultWindow("2026-09-22")).toEqual({ startDate: "2026-09-23", endDate: "2026-10-06" });
    expect(resultReady("2026-09-22", "2026-10-05")).toBe(false);
    expect(resultReady("2026-09-22", "2026-10-06")).toBe(true);
    expect(resultReady("2026-09-22", null)).toBe(false);
  });
});

describe("computeDiff", () => {
  it("diffs clicks, impressions and position, per query too", () => {
    const before = snap([1, 20, 12.5], [2, 40, 20], [
      { query: "detailing hamilton", clicks: 1, impressions: 15, position: 11 },
      { query: "mobile detailing hamilton", clicks: 0, impressions: 5, position: null },
    ]);
    const after = snap([4, 30, 8.25], [5, 50, 15], [{ query: "detailing hamilton", clicks: 4, impressions: 30, position: 8.25 }]);
    const diff = computeDiff(before, after);
    expect(diff.cited).toEqual({
      clicks: { before: 1, after: 4, change: 3 },
      impressions: { before: 20, after: 30, change: 10 },
      position: { before: 12.5, after: 8.25, change: -4.25 },
    });
    expect(diff.page.clicks.change).toBe(3);
    // A query missing afterwards counts as zero, with no position to compare.
    expect(diff.queries[1]).toEqual({
      query: "mobile detailing hamilton",
      clicks: { before: 0, after: 0, change: 0 },
      impressions: { before: 5, after: 0, change: -5 },
      position: { before: null, after: null, change: null },
    });
  });
});

describe("pickTargetQueries", () => {
  const seen = ["detailing hamilton", "clover detailing"];
  it("keeps cited queries that Claude actually saw, in their original spelling", () => {
    expect(pickTargetQueries([" Detailing Hamilton", "invented query"], seen)).toEqual(["detailing hamilton"]);
  });
  it("falls back to every query seen", () => {
    expect(pickTargetQueries([], seen)).toEqual(seen);
    expect(pickTargetQueries(null, seen)).toEqual(seen);
    expect(pickTargetQueries(["nope"], seen)).toEqual(seen);
  });
});

describe("sortResults", () => {
  const diff = (cited: number, page: number) =>
    ({ cited: { clicks: { change: cited } }, page: { clicks: { change: page } } }) as unknown as ResultDiff;
  it("puts measured results first by click gain, then pending by done date", () => {
    const items = [
      { id: "pending-late", done_at: "2026-09-20T00:00:00Z", result_diff: null },
      { id: "down", done_at: "2026-08-01T00:00:00Z", result_diff: diff(-2, 0) },
      { id: "up-page", done_at: "2026-08-01T00:00:00Z", result_diff: diff(3, 9) },
      { id: "pending-early", done_at: "2026-09-10T00:00:00Z", result_diff: null },
      { id: "up", done_at: "2026-08-01T00:00:00Z", result_diff: diff(3, 1) },
    ];
    expect(sortResults(items).map((i) => i.id)).toEqual(["up-page", "up", "down", "pending-early", "pending-late"]);
  });
});
