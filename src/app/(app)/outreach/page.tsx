import Link from "next/link";
import { OutreachForm } from "@/components/OutreachForm";
import { formatDateTime } from "@/lib/format";
import { listProspects, STATUS_LABEL } from "@/lib/outreach";

// Researching a prospect reads their site, searches Google and drafts the sheet.
export const maxDuration = 300;

export default async function OutreachPage() {
  const prospects = await listProspects();
  return (
    <>
      <header className="flex flex-col gap-3.5">
        <span className="eyebrow">Cold outreach · Gemini</span>
        <h1 className="text-[32px] leading-[1.06] font-medium tracking-[-0.01em] sm:text-[44px]">Outreach</h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted">
          Enter a business and its website. The tool reads their site, checks it on a phone, searches Google for their
          listing and reviews, then fills in your &quot;A quick look, made for you&quot; one-pager and a short message to send
          with it. Nothing is sent for you. Read it over, fix anything, then print it as a PDF.
        </p>
      </header>

      <section aria-label="New prospect" className="panel p-5 sm:p-7">
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
                  {p.research_error && <span className="text-danger">Draft failed</span>}
                  {!p.one_pager && !p.research_error && <span>No draft</span>}
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
