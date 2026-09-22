import { NextResponse, type NextRequest } from "next/server";
import { toCsv } from "@/lib/csv";
import { getOverview, getReport } from "@/lib/reports";
import { getCurrentSite } from "@/lib/sites";

// Supabase's API returns at most 1,000 rows per request by default.
const CHUNK = 1000;

export async function GET(request: NextRequest) {
  const tab = request.nextUrl.searchParams.get("tab") === "pages" ? "pages" : "queries";
  const search = request.nextUrl.searchParams.get("q") ?? "";
  const site = await getCurrentSite();
  if (!site) return NextResponse.json({ error: "No client site found." }, { status: 404 });
  const overview = await getOverview(site.id);
  if (!overview) return NextResponse.json({ error: "Nothing synced yet." }, { status: 404 });

  const rows = [];
  for (let offset = 0; ; offset += CHUNK) {
    const chunk = await getReport(site.id, tab, overview.window, search, CHUNK, offset);
    rows.push(...chunk.rows);
    if (chunk.rows.length < CHUNK) break;
  }
  const header =
    tab === "queries"
      ? ["query", "top_page", "clicks", "impressions", "ctr", "position"]
      : ["page", "top_query", "clicks", "impressions", "ctr", "position"];
  const csv = toCsv(
    header,
    rows.map((r) => [r.key, r.secondary, r.clicks, r.impressions, r.ctr.toFixed(4), r.position.toFixed(2)]),
  );
  const filename = `${site.domain}-${tab}-${overview.window.startDate}-to-${overview.window.endDate}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
