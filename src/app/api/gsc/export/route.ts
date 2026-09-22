import { NextResponse, type NextRequest } from "next/server";
import { toCsv } from "@/lib/csv";
import { getOverview, getPageReport, getQueryReport } from "@/lib/reports";
import { getCurrentSite } from "@/lib/sites";

// Supabase's API returns at most 1,000 rows per request by default.
const CHUNK = 1000;

async function all<T>(fetchChunk: (offset: number) => Promise<{ rows: T[] }>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += CHUNK) {
    const chunk = await fetchChunk(offset);
    rows.push(...chunk.rows);
    if (chunk.rows.length < CHUNK) return rows;
  }
}

const num = (n: number | null, digits: number) => (n === null ? null : n.toFixed(digits));

export async function GET(request: NextRequest) {
  const tab = request.nextUrl.searchParams.get("tab") === "pages" ? "pages" : "queries";
  const search = request.nextUrl.searchParams.get("q") ?? "";
  const site = await getCurrentSite();
  if (!site) return NextResponse.json({ error: "No client site found." }, { status: 404 });
  const overview = await getOverview(site.id);
  if (!overview) return NextResponse.json({ error: "Nothing synced yet." }, { status: 404 });
  const paging = (offset: number) => ({ window: overview.window, search, limit: CHUNK, offset });

  let csv: string;
  if (tab === "queries") {
    const rows = await all((offset) => getQueryReport(site.id, paging(offset)));
    csv = toCsv(
      ["query", "top_page", "clicks", "impressions", "ctr", "position"],
      rows.map((r) => [r.query, r.topPage, r.clicks, r.impressions, r.ctr.toFixed(4), r.position.toFixed(2)]),
    );
  } else {
    const rows = await all((offset) => getPageReport(site.id, paging(offset)));
    csv = toCsv(
      [
        "page", "clicks", "impressions", "ctr", "position", "top_queries", "title", "meta_description",
        "h1", "word_count", "internal_links", "schema_types", "in_sitemap", "status_code", "crawl_error",
      ],
      rows.map((r) => [
        r.url,
        r.clicks,
        r.impressions,
        num(r.ctr, 4),
        num(r.position, 2),
        r.topQueries.map((q) => q.query).join(" | "),
        r.crawl?.title ?? null,
        r.crawl?.metaDescription ?? null,
        r.crawl?.h1.join(" | ") ?? null,
        r.crawl?.wordCount ?? null,
        r.crawl?.internalLinkCount ?? null,
        r.crawl?.schemaTypes.join(" | ") ?? null,
        r.crawl ? String(r.crawl.inSitemap) : null,
        r.crawl?.statusCode ?? null,
        r.crawl?.error ?? null,
      ]),
    );
  }

  const filename = `${site.domain}-${tab}-${overview.window.startDate}-to-${overview.window.endDate}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
