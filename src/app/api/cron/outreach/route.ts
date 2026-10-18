import { NextResponse, type NextRequest } from "next/server";
import { processProspect, remoteRunner, runOutreachLoop } from "@/lib/outreach-auto";

// Each business takes a minute or two (site, phone check, Google search, drafting, PDF).
export const maxDuration = 300;

// Daily Vercel Cron (see vercel.json), with `Authorization: Bearer $CRON_SECRET`.
//   GET /api/cron/outreach                    -> one run: find businesses, then handle the queue
//   GET /api/cron/outreach?prospectId=<uuid>  -> one business, start to finish (the run calls this)
// One call per business gives each the full time limit instead of sharing one.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const prospectId = request.nextUrl.searchParams.get("prospectId");
  if (prospectId) {
    const outcome = await processProspect(prospectId);
    return NextResponse.json({ outcome });
  }

  const result = await runOutreachLoop({ trigger: "cron", runOne: remoteRunner(request.nextUrl.origin, auth) });
  return NextResponse.json({ result }, { status: result.ok ? 200 : 502 });
}
