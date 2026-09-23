import { NextResponse, type NextRequest } from "next/server";
import { getCurrentSite } from "@/lib/sites";
import { db } from "@/lib/supabase";

// GET /api/screenshot?page=<page_key> -> the current client's first-screen capture of that page.
export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("page");
  const site = await getCurrentSite();
  if (!key || !site) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const { data, error } = await db()
    .from("crawl_pages")
    .select("screenshot_jpeg, screenshot_sha256")
    .eq("site_id", site.id)
    .eq("page_key", key)
    .maybeSingle();
  if (error) throw error;
  if (!data?.screenshot_jpeg) return NextResponse.json({ error: "No screenshot." }, { status: 404 });
  return new NextResponse(Buffer.from(data.screenshot_jpeg, "base64"), {
    headers: {
      "Content-Type": "image/jpeg",
      // The hash is in the URL the dashboard uses, so a new capture gets a new URL.
      "Cache-Control": "private, max-age=86400",
      ETag: `"${data.screenshot_sha256}"`,
    },
  });
}
