import { NextResponse, type NextRequest } from "next/server";
import { getAudit } from "@/lib/audit-data";
import { auditBrief } from "@/lib/audit-export";
import { getCurrentSite } from "@/lib/sites";

// GET /api/audit/export          -> the current client's open audit issues as a Markdown download
// GET /api/audit/export?inline=1 -> the same text, for copying to the clipboard
export async function GET(request: NextRequest) {
  const site = await getCurrentSite();
  if (!site) return NextResponse.json({ error: "No client site found." }, { status: 404 });
  const { entries, crawl } = await getAudit(site.id);
  const markdown = auditBrief({
    site,
    issues: entries.filter((e) => e.state !== "fixed"),
    crawledAt: crawl?.finished_at ?? crawl?.started_at ?? null,
    generatedAt: new Date(),
  });
  const headers: Record<string, string> = { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" };
  if (!request.nextUrl.searchParams.get("inline")) {
    const slug = site.domain.replace(/^www\./, "").replace(/[^a-z0-9.-]+/gi, "-");
    headers["Content-Disposition"] = `attachment; filename="seo-fixes-${slug}-${new Date().toISOString().slice(0, 10)}.md"`;
  }
  return new NextResponse(markdown, { headers });
}
