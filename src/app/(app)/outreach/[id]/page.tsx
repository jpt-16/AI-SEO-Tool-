import Link from "next/link";
import { notFound } from "next/navigation";
import { OnePagerEditor } from "@/components/OnePagerEditor";
import { ResearchAgainForm } from "@/components/OutreachForm";
import { formatDateTime } from "@/lib/format";
import { getProspect, PROSPECT_STATUSES, STATUS_LABEL, type Prospect } from "@/lib/outreach";
import { formatToday } from "@/lib/outreach-sheet";
import { deleteProspect, setProspectStatus } from "../../actions";

// "Research and redraft" runs here too.
export const maxDuration = 300;

const yesNo = (v: boolean | null | undefined) => (v === null || v === undefined ? "unknown" : v ? "yes" : "no");

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[170px_1fr] sm:gap-4">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-[13.5px] break-words text-soft">{children}</dd>
    </div>
  );
}

function Research({ prospect }: { prospect: Prospect }) {
  const r = prospect.research;
  if (!r) return null;
  const f = r.facts;
  const c = r.capture;
  return (
    <section aria-label="What the research found" className="panel flex flex-col gap-5 p-5 sm:p-7">
      <h2 className="text-lg font-medium">What the research found</h2>

      <div className="flex flex-col gap-3">
        <h3 className="text-[10.5px] tracking-[0.2em] text-muted uppercase">Their website</h3>
        {f ? (
          <dl className="flex flex-col gap-2.5">
            <Fact label="Pages read">{f.pagesRead.length}</Fact>
            <Fact label="Title">{f.title ?? "none"}</Fact>
            <Fact label="Phone on the site">{f.phones.join(", ") || "none found"}{f.phones.length ? ` · tap-to-call link: ${yesNo(f.hasTelLink)}` : ""}</Fact>
            <Fact label="Email">{f.emails.join(", ") || "none found"}</Fact>
            <Fact label="Quote / booking form">{f.hasForm ? (f.formMentionsQuote ? "yes" : "a general form only") : "none found"}</Fact>
            <Fact label="Links to Google Maps">{f.googleBusinessLinks.length ? f.googleBusinessLinks.join(", ") : "none"}</Fact>
            <Fact label="Social / directories">{f.socials.length ? f.socials.join(", ") : "none linked"}</Fact>
            <Fact label="Built with">{f.platform ?? "unknown"}</Fact>
            <Fact label="Footer year">{f.copyrightYear ?? "none"}</Fact>
          </dl>
        ) : (
          <p className="text-sm text-danger">Couldn&apos;t read the site: {r.factsError}</p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-[10.5px] tracking-[0.2em] text-muted uppercase">On a phone screen</h3>
        {!c ? (
          <p className="text-sm text-muted">Not checked.</p>
        ) : c.failed ? (
          <p className="text-sm text-muted">Couldn&apos;t check: {c.failed}</p>
        ) : (
          <dl className="flex flex-col gap-2.5">
            <Fact label="Score">{c.score}/100</Fact>
            <Fact label="Fits the screen">{yesNo(c.fitsPhone)}</Fact>
            <Fact label="Call to action">{c.callToAction ? `"${c.callToAction}"` : "none found (automatic check)"}</Fact>
            {c.problems.length > 0 && (
              <Fact label="Weak spots">
                <ul className="flex flex-col gap-1">
                  {c.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </Fact>
            )}
          </dl>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-[10.5px] tracking-[0.2em] text-muted uppercase">Google search</h3>
        {r.search ? (
          <>
            <p className="text-[13.5px] leading-relaxed break-words whitespace-pre-wrap text-soft">{r.search.text}</p>
            {r.search.sources.length > 0 && (
              <ul className="flex flex-col gap-1 text-xs">
                {r.search.sources.map((s) => (
                  <li key={s.url} className="break-all">
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">{r.searchError ? `Search failed: ${r.searchError}` : "Not searched."}</p>
        )}
      </div>
    </section>
  );
}

export default async function ProspectPage({ params }: PageProps<"/outreach/[id]">) {
  const { id } = await params;
  const prospect = await getProspect(id);
  if (!prospect) notFound();

  return (
    <>
      <header className="flex flex-col gap-3.5">
        <Link href="/outreach" className="text-[13px] text-muted no-underline hover:text-ink">
          ← All prospects
        </Link>
        <h1 className="text-[28px] leading-[1.08] font-medium tracking-[-0.01em] break-words sm:text-[40px]">{prospect.business_name}</h1>
        <p className="text-[13px] break-all text-muted">
          <a href={prospect.website} target="_blank" rel="noreferrer">
            {prospect.website.replace(/^https?:\/\//, "")}
          </a>
          {prospect.city ? ` · ${prospect.city}` : ""}
          {prospect.researched_at ? ` · drafted ${formatDateTime(prospect.researched_at)}` : ""}
          {prospect.cost_usd !== null ? ` · cost $${Number(prospect.cost_usd).toFixed(3)}, plus any Google Search fee` : ""}
        </p>
        <div className="flex flex-wrap items-center gap-2" aria-label="Status">
          {PROSPECT_STATUSES.map((s) => (
            <form key={s} action={setProspectStatus}>
              <input type="hidden" name="id" value={prospect.id} />
              <input type="hidden" name="status" value={s} />
              <button
                type="submit"
                aria-pressed={s === prospect.status}
                className={`btn min-h-10 px-4 text-[11.5px] ${s === prospect.status ? "btn-accent" : "border-line text-muted"}`}
              >
                {STATUS_LABEL[s]}
              </button>
            </form>
          ))}
        </div>
      </header>

      {prospect.research_error && (
        <p role="alert" className="panel border-danger-line p-5 text-sm leading-relaxed text-danger sm:p-6">
          The draft failed: {prospect.research_error}
        </p>
      )}

      {prospect.unverified && prospect.unverified.length > 0 && (
        <section aria-label="Check before sending" className="panel flex flex-col gap-2.5 p-5 sm:p-6">
          <h2 className="text-lg font-medium">Check before sending</h2>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[13.5px] leading-relaxed text-soft">
            {prospect.unverified.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </section>
      )}

      {prospect.one_pager && prospect.message !== null && (
        <OnePagerEditor
          // A redraft replaces the content, so remount the editor with the new text.
          key={prospect.researched_at ?? prospect.id}
          prospectId={prospect.id}
          businessName={prospect.business_name}
          dateText={formatToday()}
          initialSheet={prospect.one_pager}
          initialMessage={prospect.message}
        />
      )}

      <Research prospect={prospect} />

      <section aria-label="Redo the research" className="panel flex flex-col gap-3 p-5 sm:p-7">
        <h2 className="text-lg font-medium">{prospect.one_pager ? "Research again" : "Try again"}</h2>
        <ResearchAgainForm id={prospect.id} />
      </section>

      <form action={deleteProspect}>
        <input type="hidden" name="id" value={prospect.id} />
        <button type="submit" className="btn btn-danger min-h-10 px-4 text-[11.5px]">
          Delete this prospect
        </button>
      </form>
    </>
  );
}
