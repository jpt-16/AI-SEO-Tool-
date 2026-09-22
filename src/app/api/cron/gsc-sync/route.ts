import { NextResponse, type NextRequest } from "next/server";
import { syncAllEnabledSites } from "@/lib/sync";

export const maxDuration = 60;

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const results = await syncAllEnabledSites("cron");
  return NextResponse.json({ results }, { status: results.every((r) => r.ok) ? 200 : 502 });
}
