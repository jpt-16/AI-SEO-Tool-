import { NextResponse, type NextRequest } from "next/server";
import { runSiteCrawl } from "@/lib/crawl-run";
import { listSites } from "@/lib/sites";

// A crawl includes headless-browser capture of every page.
export const maxDuration = 300;

// POST /api/crawl            -> every site
// POST /api/crawl?siteId=... -> one site
export async function POST(request: NextRequest) {
  const siteId = request.nextUrl.searchParams.get("siteId");
  const ids = siteId ? [siteId] : (await listSites()).map((s) => s.id);
  const results = [];
  for (const id of ids) results.push(await runSiteCrawl(id, "api"));
  return NextResponse.json({ results }, { status: results.every((r) => r.ok) ? 200 : 502 });
}
