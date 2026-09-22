import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto";
import { toCsv } from "./csv";
import { addDays, priorWindow, syncWindow, windowEndingOn } from "./dates";
import { GSC_ROW_LIMIT, querySearchAnalytics, type GscApiRow, type GscRequester } from "./gsc";
import { percentChange, summarize } from "./metrics";

describe("dates", () => {
  it("adds days across month and leap-year boundaries", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
  });

  it("builds an inclusive 90-day window ending two days ago in Pacific time", () => {
    // 06:00 UTC on Sep 22 is still Sep 21 in Los Angeles.
    const window = syncWindow(new Date("2026-09-22T06:00:00Z"));
    expect(window).toEqual({ startDate: "2026-06-22", endDate: "2026-09-19" });
  });

  it("puts the prior window directly before the current one", () => {
    const current = windowEndingOn("2026-09-19");
    expect(priorWindow(current)).toEqual({ startDate: "2026-03-24", endDate: "2026-06-21" });
  });
});

describe("crypto", () => {
  const key = randomBytes(32).toString("base64");

  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptSecret("1//refresh-token", key);
    const b = encryptSecret("1//refresh-token", key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe("1//refresh-token");
  });

  it("rejects tampered ciphertext and wrong keys", () => {
    const payload = encryptSecret("secret", key);
    const [iv, tag, data] = payload.split(".");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 1;
    expect(() => decryptSecret([iv, tag, flipped.toString("base64")].join("."), key)).toThrow();
    expect(() => decryptSecret(payload, randomBytes(32).toString("base64"))).toThrow();
  });

  it("requires a 32-byte key", () => {
    expect(() => encryptSecret("x", randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });
});

describe("querySearchAnalytics", () => {
  const row = (i: number): GscApiRow => ({ keys: [String(i)], clicks: 1, impressions: 2, ctr: 0.5, position: 3 });

  it("pages with startRow until a short page comes back", async () => {
    const pages = [Array.from({ length: GSC_ROW_LIMIT }, (_, i) => row(i)), [row(GSC_ROW_LIMIT)]];
    const request = vi.fn(async () => ({ data: { rows: pages.shift() } }));
    const rows = await querySearchAnalytics(request as unknown as GscRequester, "sc-domain:example.com", {
      startDate: "2026-06-22",
      endDate: "2026-09-19",
      dimensions: ["date", "query", "page"],
    });
    expect(rows).toHaveLength(GSC_ROW_LIMIT + 1);
    expect(request).toHaveBeenCalledTimes(2);
    const calls = request.mock.calls as unknown as Array<[{ url: string; data: { startRow: number; type: string } }]>;
    expect(calls[0][0].url).toBe(
      "https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query",
    );
    expect(calls[0][0].data).toMatchObject({ startRow: 0, rowLimit: GSC_ROW_LIMIT, type: "web" });
    expect(calls[1][0].data.startRow).toBe(GSC_ROW_LIMIT);
  });

  it("treats a response with no rows as empty", async () => {
    const request = vi.fn(async () => ({ data: {} }));
    const rows = await querySearchAnalytics(request as unknown as GscRequester, "https://example.com/", {
      startDate: "2026-06-22",
      endDate: "2026-09-19",
      dimensions: ["date"],
    });
    expect(rows).toEqual([]);
  });
});

describe("metrics", () => {
  it("weights position by impressions and derives CTR from totals", () => {
    const totals = summarize([
      { clicks: 10, impressions: 100, position: 2 },
      { clicks: 0, impressions: 300, position: 10 },
    ]);
    expect(totals).toEqual({ clicks: 10, impressions: 400, ctr: 0.025, position: 8 });
    expect(summarize([])).toBeNull();
  });

  it("returns null change when there is no prior value", () => {
    expect(percentChange(12, 10)).toBeCloseTo(0.2);
    expect(percentChange(5, 0)).toBeNull();
  });
});

describe("toCsv", () => {
  it("quotes separators and defuses spreadsheet formulas", () => {
    const csv = toCsv(["query", "clicks"], [["detailing, mobile", 3], ['say "hi"', 1], ["=HYPERLINK(1)", 0], [null, 2]]);
    expect(csv).toBe(
      'query,clicks\r\n"detailing, mobile",3\r\n"say ""hi""",1\r\n\'=HYPERLINK(1),0\r\n,2\r\n',
    );
  });
});
