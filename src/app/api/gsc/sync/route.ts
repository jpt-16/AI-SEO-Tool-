import { NextResponse, type NextRequest } from "next/server";
import { syncAllEnabledSites, syncSite } from "@/lib/sync";

export const maxDuration = 60;

// POST /api/gsc/sync            -> every client with sync enabled
// POST /api/gsc/sync?siteId=... -> one client
export async function POST(request: NextRequest) {
  const siteId = request.nextUrl.searchParams.get("siteId");
  const results = siteId ? [await syncSite(siteId, "api")] : await syncAllEnabledSites("api");
  return NextResponse.json({ results }, { status: results.every((r) => r.ok) ? 200 : 502 });
}
