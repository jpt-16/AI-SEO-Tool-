import { NextResponse, type NextRequest } from "next/server";
import { requireEnv } from "@/lib/env";
import { listSites } from "@/lib/sites";

export const maxDuration = 300;

// POST /api/crawl            -> every site
// POST /api/crawl?siteId=... -> one site
// The crawl itself (with its headless-browser captures) runs in /api/cron/crawl, the one function
// that carries Chromium; this route only forwards to it.
export async function POST(request: NextRequest) {
  const siteId = request.nextUrl.searchParams.get("siteId");
  const ids = siteId ? [siteId] : (await listSites()).map((s) => s.id);
  const results: unknown[] = [];
  for (const id of ids) {
    const url = new URL("/api/cron/crawl", request.nextUrl.origin);
    url.searchParams.set("siteId", id);
    url.searchParams.set("trigger", "api");
    try {
      const res = await fetch(url, { headers: { authorization: `Bearer ${requireEnv("CRON_SECRET")}` }, cache: "no-store" });
      const body = (await res.json()) as { results?: unknown[]; error?: string };
      results.push(body.results?.[0] ?? { siteId: id, ok: false, error: body.error ?? `HTTP ${res.status}` });
    } catch (err) {
      results.push({ siteId: id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return NextResponse.json({ results }, { status: results.every((r) => (r as { ok?: boolean }).ok) ? 200 : 502 });
}
