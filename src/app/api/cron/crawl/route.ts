import { NextResponse, type NextRequest } from "next/server";
import { runSiteCrawl } from "@/lib/crawl-run";
import { listSites } from "@/lib/sites";

// A crawl includes headless-browser capture of every page.
export const maxDuration = 300;

// Weekly Vercel Cron (see vercel.json), with `Authorization: Bearer $CRON_SECRET`.
//   GET /api/cron/crawl             -> crawls every site, each in its own function call
//   GET /api/cron/crawl?siteId=...  -> crawls one site
// One call per site gives each site the full time limit instead of sharing one.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const siteId = request.nextUrl.searchParams.get("siteId");
  if (siteId) {
    const result = await runSiteCrawl(siteId, "cron");
    return NextResponse.json({ results: [result] }, { status: result.ok ? 200 : 502 });
  }

  const sites = await listSites();
  const results = await Promise.all(
    sites.map(async (site) => {
      const url = new URL(request.nextUrl.pathname, request.nextUrl.origin);
      url.searchParams.set("siteId", site.id);
      try {
        const res = await fetch(url, { headers: { authorization: auth }, cache: "no-store" });
        const body = (await res.json()) as { results?: unknown[]; error?: string };
        return body.results?.[0] ?? { siteId: site.id, ok: false, error: body.error ?? `HTTP ${res.status}` };
      } catch (err) {
        return { siteId: site.id, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
  const ok = results.every((r) => (r as { ok?: boolean }).ok);
  return NextResponse.json({ results }, { status: ok ? 200 : 502 });
}
