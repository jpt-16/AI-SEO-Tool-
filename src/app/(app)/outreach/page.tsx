import Link from "next/link";
import { AddSearchForm, RedraftAllButton, RunNowButton } from "@/components/OutreachAuto";
import { OutreachForm } from "@/components/OutreachForm";
import { formatDateTime } from "@/lib/format";
import { gmailStatus } from "@/lib/gmail";
import { listProspects, STATUS_LABEL, type Prospect } from "@/lib/outreach";
import { listRuns, listSearches, PER_RUN } from "@/lib/outreach-auto";
import { deleteSearch, setSearchEnabled } from "../actions";

// Researching a prospect reads their site, searches Google and drafts the sheet.
export const maxDuration = 300;

function draftBadge(p: Prospect): { label: string; tone: string } | null {
  if (p.draft_state === "created") return { label: "In Gmail", tone: "text-accent-300" };
  if (p.draft_state === "no_email") return { label: "No email found", tone: "text-muted" };
  if (p.draft_state === "failed") return { label: "Draft failed", tone: "text-danger" };
  if (p.draft_state === "skipped") return { label: "Skipped", tone: "text-muted" };
  return null;
}

export default async function OutreachPage() {
  const [prospects, searches, runs] = await Promise.all([listProspects(), listSearches(), listRuns()]);
  const gmail = gmailStatus();
  return (
    <>
      <header className="flex flex-col gap-3.5">
        <span className="eyebrow">Cold outreach · Gemini · Gmail</span>
        <h1 className="text-[32px] leading-[1.06] font-medium tracking-[-0.01em] sm:text-[44px]">Outreach</h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted">
          For each business the tool reads their site, checks it on a phone, searches Google for their listing and reviews,
          then writes a personal email that follows your one-pager&apos;s four parts: what it found, what that may mean for their
          customers, how you can help, and what&apos;s free. Set it up once
          below and the drafts show up in your Gmail on their own. Nothing is ever sent for you.
        </p>
      </header>

      <section aria-label="Automatic outreach" className="panel flex flex-col gap-5 p-5 sm:p-7">
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Automatic outreach</h2>
          <p className="max-w-2xl text-[13.5px] leading-relaxed text-muted">
            Every day at about 10am Eastern the tool finds up to {PER_RUN} new businesses from your saved searches, researches
            each one and puts a draft email in your Gmail. It never sends anything: you
            open Gmail, read the drafts and send the ones you like.
          </p>
        </div>

        <p role="status" className={`text-[13px] leading-relaxed ${gmail.configured ? "text-accent-300" : "text-danger"}`}>
          {gmail.configured ? (
            <>
              Drafts go to {gmail.address}&apos;s Gmail{gmail.from !== gmail.address ? `, from ${gmail.from}` : ""}.{" "}
              <a href="https://mail.google.com/mail/#drafts" target="_blank" rel="noreferrer">Open Gmail drafts</a>
            </>
          ) : (
            <>
              Gmail isn&apos;t set up, so nothing runs. In Vercel, add <code>GMAIL_ADDRESS</code> (your Gmail address) and{" "}
              <code>GMAIL_APP_PASSWORD</code> (create one at myaccount.google.com/apppasswords, which needs 2-Step Verification
              on), then redeploy.
            </>
          )}
        </p>

        <div className="flex flex-col gap-3">
          <h3 className="text-[10.5px] tracking-[0.2em] text-muted uppercase">Saved searches · {searches.length}</h3>
          {searches.length === 0 ? (
            <p className="text-sm text-muted">None yet. Add one, like &quot;plumbers&quot; in &quot;Foxboro, MA&quot;, and the daily run starts using it.</p>
          ) : (
            <ul className="flex flex-col">
              {searches.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-2.5 first:border-t-0">
                  <span className={`text-[14px] ${s.enabled ? "text-ink" : "text-muted line-through"}`}>
                    {s.trade} in {s.town}
                    <span className="ml-3 text-xs text-muted no-underline">{s.last_run_at ? `last used ${formatDateTime(s.last_run_at)}` : "not used yet"}</span>
                  </span>
                  <span className="flex gap-2">
                    <form action={setSearchEnabled}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="enabled" value={String(!s.enabled)} />
                      <button type="submit" className="btn min-h-10 px-3.5 text-[11.5px]">{s.enabled ? "Pause" : "Resume"}</button>
                    </form>
                    <form action={deleteSearch}>
                      <input type="hidden" name="id" value={s.id} />
                      <button type="submit" className="btn btn-danger min-h-10 px-3.5 text-[11.5px]">Remove</button>
                    </form>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <AddSearchForm />
        </div>

        <RunNowButton />
        {prospects.some((p) => p.draft_state === "created") && <RedraftAllButton count={prospects.filter((p) => p.draft_state === "created").length} />}

        {runs.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-[10.5px] tracking-[0.2em] text-muted uppercase">Recent runs</h3>
            <ul className="flex flex-col text-[13px]">
              {runs.map((r) => (
                <li key={r.id} className="flex flex-col gap-0.5 border-t border-line py-2 first:border-t-0 sm:flex-row sm:justify-between sm:gap-4">
                  <span className="text-soft">
                    {formatDateTime(r.started_at)} · {r.trigger === "cron" ? "daily" : "by hand"}
                  </span>
                  <span className={r.error ? "text-danger" : "text-muted"}>
                    {!r.finished_at ? "Didn't finish" : `${r.found} found · ${r.drafted} drafted · ${r.no_email} no email · ${r.skipped} skipped · ${r.failed} failed · $${Number(r.cost_usd ?? 0).toFixed(2)}`}
                    {r.error ? ` · ${r.error}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section aria-label="New prospect" className="panel flex flex-col gap-4 p-5 sm:p-7">
        <h2 className="text-lg font-medium">Add one by hand</h2>
        <OutreachForm />
      </section>

      <section aria-label="Prospects" className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Prospects · {prospects.length}</h2>
        {prospects.length === 0 ? (
          <p className="panel p-5 text-sm leading-relaxed text-muted sm:p-7">No one yet. Add a business above.</p>
        ) : (
          <ul className="panel flex flex-col px-5 sm:px-7">
            {prospects.map((p) => (
              <li key={p.id} className="flex flex-col gap-1 border-t border-line py-3.5 first:border-t-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-5">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Link href={`/outreach/${p.id}`} className="font-medium break-words text-ink no-underline hover:text-accent-400">
                    {p.business_name}
                  </Link>
                  <span className="text-xs break-all text-muted">{p.website.replace(/^https?:\/\//, "")}</span>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs text-muted">
                  {draftBadge(p) && <span className={draftBadge(p)!.tone}>{draftBadge(p)!.label}</span>}
                  {p.research_error && <span className="text-danger">Research failed</span>}
                  {!p.one_pager && !p.research_error && p.status !== "queued" && p.draft_state === "none" && <span>No sheet</span>}
                  <span className="tag px-2.5 py-0.5 text-[11px] tracking-[0.14em] uppercase">{STATUS_LABEL[p.status]}</span>
                  <span>{formatDateTime(p.created_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
