import Link from "next/link";
import { redirect } from "next/navigation";
import { AnalyzeForm } from "@/components/AnalyzeForm";
import { pathOf } from "@/components/ReportTables";
import {
  countBlueprints,
  DEFAULT_MIN_IMPRESSIONS,
  getLatestBlueprintRun,
  listBlueprints,
  type Blueprint,
  type BlueprintRun,
  type BlueprintStatus,
} from "@/lib/blueprints";
import { formatDateTime, formatInt, formatPct } from "@/lib/format";
import { getConnection } from "@/lib/google";
import { getCurrentSite } from "@/lib/sites";
import { setBlueprintStatus } from "../actions";

// Each page is a model call; give a 10-page run room to finish.
export const maxDuration = 300;

const TABS: { status: BlueprintStatus; label: string }[] = [
  { status: "open", label: "Open" },
  { status: "done", label: "Done" },
  { status: "skipped", label: "Skipped" },
];

const PRIORITY = {
  high: { label: "High priority", className: "border-accent-500 bg-accent-500/15 text-accent-200" },
  med: { label: "Medium priority", className: "border-accent-700 text-accent-300" },
  low: { label: "Low priority", className: "border-line-strong text-muted" },
};

function StatusButton({ id, status, label, accent }: { id: number; status: BlueprintStatus; label: string; accent?: boolean }) {
  return (
    <form action={setBlueprintStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" className={`btn min-h-11 w-full sm:w-auto ${accent ? "btn-accent" : ""}`}>
        {label}
      </button>
    </form>
  );
}

function Change({ label, current, proposed, max }: { label: string; current: string | null; proposed: string | null; max: number }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10.5px] tracking-[0.2em] text-muted uppercase">{label}</span>
      {proposed === null ? (
        <p className="text-sm text-muted">Keep the current one: {current ?? "(missing)"}</p>
      ) : (
        <div className="flex flex-col gap-1.5 text-sm leading-relaxed">
          <p className="break-words text-muted">
            <span className="mr-2 text-[10.5px] tracking-[0.16em] uppercase">Now</span>
            <span className="line-through decoration-line-strong">{current ?? "(missing)"}</span>
          </p>
          <p className="break-words text-ink">
            <span className="mr-2 text-[10.5px] tracking-[0.16em] text-accent-400 uppercase">New</span>
            {proposed}{" "}
            <span className={`text-xs tabular-nums whitespace-nowrap ${proposed.length > max ? "text-danger" : "text-muted"}`}>
              · {proposed.length}/{max}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

function BlueprintCard({ blueprint: b }: { blueprint: Blueprint }) {
  const priority = PRIORITY[b.priority];
  const snap = b.page_snapshot;
  return (
    <article className="panel flex flex-col gap-5 p-5 sm:p-7">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={`tag px-2.5 py-0.5 text-[11px] tracking-[0.14em] uppercase ${priority.className}`}>
          {priority.label}
        </span>
        <a href={b.url} target="_blank" rel="noreferrer" className="font-medium break-all text-ink no-underline hover:text-accent-400">
          {pathOf(b.url)}
        </a>
        <span className="text-xs text-muted sm:ml-auto">
          {b.status === "open" ? `Found ${formatDateTime(b.created_at)}` : `Marked ${b.status} ${formatDateTime(b.status_changed_at ?? b.created_at)}`}
        </span>
      </header>

      <div className="flex flex-col gap-2.5">
        <h2 className="text-lg leading-snug font-medium sm:text-xl">{b.finding}</h2>
        <p className="text-[15px] leading-relaxed text-soft">{b.reasoning}</p>
      </div>

      <div className="grid grid-cols-1 gap-5 border-t border-line pt-5 xl:grid-cols-2">
        <Change label="Title tag" current={snap.title} proposed={b.proposed_title} max={60} />
        <Change label="Meta description" current={snap.metaDescription} proposed={b.proposed_meta} max={155} />
      </div>

      <details className="group border-t border-line pt-4 text-[13px]">
        <summary className="cursor-pointer list-none text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">Show the data Claude saw ▸</span>
          <span className="hidden group-open:inline">Hide the data ▾</span>
        </summary>
        <div className="mt-3 flex flex-col gap-2 text-soft">
          <p>
            {formatInt(snap.impressions)} impressions · {formatInt(snap.clicks)} clicks · {snap.window.startDate} to{" "}
            {snap.window.endDate}
          </p>
          <ul className="flex flex-col gap-1">
            {snap.topQueries.map((q) => (
              <li key={q.query} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 break-words">{q.query}</span>
                <span className="shrink-0 text-xs text-muted tabular-nums">
                  {q.impressions} impr · {formatPct(q.ctr)} · pos {q.position.toFixed(1)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">Model: {b.model}</p>
        </div>
      </details>

      <div className="flex flex-col gap-2.5 sm:flex-row">
        {b.status === "open" ? (
          <>
            <StatusButton id={b.id} status="done" label="Mark done" accent />
            <StatusButton id={b.id} status="skipped" label="Skip" />
          </>
        ) : (
          <StatusButton id={b.id} status="open" label="Reopen" />
        )}
      </div>
    </article>
  );
}

function LastRun({ run }: { run: BlueprintRun | null }) {
  if (!run) return <p className="text-[13px] text-muted">No analysis has run yet.</p>;
  if (run.status === "running") return <p className="text-[13px] text-muted">Analysis started {formatDateTime(run.started_at)}…</p>;
  if (run.status === "failed") {
    return (
      <p className="text-[13px] text-danger">
        Last analysis failed {formatDateTime(run.started_at)}: {run.error}
      </p>
    );
  }
  return (
    <p className="text-[13px] text-muted">
      Last analysis {formatDateTime(run.finished_at ?? run.started_at)} · {run.pages_analyzed ?? 0} pages over{" "}
      {run.min_impressions} impressions · {run.blueprints_created ?? 0} new blueprints
    </p>
  );
}

export default async function BlueprintsPage({ searchParams }: PageProps<"/blueprints">) {
  const params = await searchParams;
  const status: BlueprintStatus = params.status === "done" || params.status === "skipped" ? params.status : "open";

  const [connection, site] = await Promise.all([getConnection(), getCurrentSite()]);
  if (!connection) redirect("/connect");
  if (!site) return <p className="text-muted">No client sites yet.</p>;

  const [blueprints, counts, lastRun] = await Promise.all([
    listBlueprints(site.id, status),
    countBlueprints(site.id),
    getLatestBlueprintRun(site.id),
  ]);

  return (
    <>
      <header className="flex flex-col gap-3.5">
        <span className="eyebrow">AI review · Claude</span>
        <h1 className="text-[32px] leading-[1.06] font-medium tracking-[-0.01em] sm:text-[44px]">Blueprints</h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted">
          For each page people are finding, Claude compares its title and meta description with the searches it shows up
          for and proposes the single change most likely to win clicks. Pages with nothing worth changing get no
          blueprint.
        </p>
      </header>

      <section aria-label="Run analysis" className="panel flex flex-col gap-4 p-5 sm:p-7">
        <AnalyzeForm siteId={site.id} defaultMinImpressions={DEFAULT_MIN_IMPRESSIONS} />
        <LastRun run={lastRun} />
      </section>

      <nav aria-label="Blueprint status" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.status}
            href={t.status === "open" ? "/blueprints" : `/blueprints?status=${t.status}`}
            aria-current={t.status === status ? "page" : undefined}
            className={`btn min-h-10 px-4 ${t.status === status ? "btn-accent" : "border-line text-muted"}`}
          >
            {t.label} · {counts[t.status]}
          </Link>
        ))}
      </nav>

      {blueprints.length ? (
        <div className="flex flex-col gap-5">
          {blueprints.map((b) => (
            <BlueprintCard key={b.id} blueprint={b} />
          ))}
        </div>
      ) : (
        <p className="panel p-5 text-sm leading-relaxed text-muted sm:p-7">
          {status === "open"
            ? "No open blueprints. Run an analysis above, or lower the minimum impressions if no pages qualify yet."
            : `No ${status} blueprints yet.`}
        </p>
      )}
    </>
  );
}
