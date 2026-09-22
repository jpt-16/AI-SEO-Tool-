import Link from "next/link";
import { redirect } from "next/navigation";
import { SyncButton } from "@/components/SyncButton";
import { formatCompact, formatDate, formatDateTime, formatInt, formatPct, formatPosition } from "@/lib/format";
import { getConnection } from "@/lib/google";
import { percentChange, type Totals } from "@/lib/metrics";
import { getOverview, getRecentRuns, getReport, type ReportRow, type ReportTab } from "@/lib/reports";
import { getCurrentSite } from "@/lib/sites";

export const maxDuration = 60;

const PAGE_SIZE = 25;

function pathOf(url: string) {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

function positionTone(position: number) {
  if (position <= 3) return "bg-accent-900 text-accent-200 border-accent-800";
  if (position <= 10) return "text-accent-300 border-accent-700";
  return "text-muted border-line";
}

function Delta({ text, good }: { text: string; good: boolean }) {
  return <span className={`text-[12.5px] ${good ? "text-soft" : "text-danger"}`}>{text}</span>;
}

function Kpi({ label, value, delta }: { label: string; value: string; delta: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 border-line px-8 py-7.5 [&+&]:border-l">
      <span className="text-[44px] leading-none font-medium tracking-[-0.01em] text-accent-500 tabular-nums">{value}</span>
      <span className="text-[11px] tracking-[0.24em] text-muted uppercase">{label}</span>
      {delta}
    </div>
  );
}

function pctDelta(current: number, prior: number) {
  const change = percentChange(current, prior);
  if (change === null) return null;
  const sign = change >= 0 ? "+" : "−";
  return <Delta good={change >= 0} text={`${sign}${Math.abs(change * 100).toFixed(0)}% vs prior 90 days`} />;
}

function KpiRow({ current, prior }: { current: Totals; prior: Totals | null }) {
  const ctrPts = prior ? (current.ctr - prior.ctr) * 100 : null;
  const places = prior ? prior.position - current.position : null;
  return (
    <section aria-label="Totals" className="panel grid grid-cols-2 overflow-hidden xl:grid-cols-4">
      <Kpi label="Clicks" value={formatCompact(current.clicks)} delta={prior && pctDelta(current.clicks, prior.clicks)} />
      <Kpi
        label="Impressions"
        value={formatCompact(current.impressions)}
        delta={prior && pctDelta(current.impressions, prior.impressions)}
      />
      <Kpi
        label="Average CTR"
        value={formatPct(current.ctr)}
        delta={
          ctrPts !== null && (
            <Delta good={ctrPts >= 0} text={`${ctrPts >= 0 ? "+" : "−"}${Math.abs(ctrPts).toFixed(1)} pts vs prior 90 days`} />
          )
        }
      />
      <Kpi
        label="Average position"
        value={formatPosition(current.position)}
        delta={
          places !== null &&
          (Math.abs(places) < 0.05 ? (
            <Delta good text="No change vs prior 90 days" />
          ) : (
            <Delta good={places > 0} text={`${places > 0 ? "Up" : "Down"} ${Math.abs(places).toFixed(1)} places`} />
          ))
        }
      />
    </section>
  );
}

function ReportTable({ tab, rows }: { tab: ReportTab; rows: ReportRow[] }) {
  const headings = tab === "queries" ? ["Query", "Top landing page"] : ["Page URL", "Top query"];
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="text-left text-[10.5px] tracking-[0.2em] text-muted uppercase">
          <th scope="col" className="px-6 py-3.5 font-medium">{headings[0]}</th>
          <th scope="col" className="px-6 py-3.5 font-medium">{headings[1]}</th>
          <th scope="col" className="px-6 py-3.5 text-right font-medium">Clicks</th>
          <th scope="col" className="px-6 py-3.5 text-right font-medium">Impressions</th>
          <th scope="col" className="px-6 py-3.5 text-right font-medium">CTR</th>
          <th scope="col" className="px-6 py-3.5 text-right font-medium">Position</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const primary = tab === "queries" ? row.key : pathOf(row.key);
          const secondary = row.secondary && (tab === "queries" ? pathOf(row.secondary) : row.secondary);
          return (
            <tr key={row.key} className="border-t border-line">
              <td className="px-6 py-3.5 font-medium break-all" title={row.key}>{primary}</td>
              <td className="px-6 py-3.5 text-[13px] break-all text-muted" title={row.secondary ?? undefined}>
                {secondary}
              </td>
              <td className="px-6 py-3.5 text-right font-medium tabular-nums">{formatInt(row.clicks)}</td>
              <td className="px-6 py-3.5 text-right text-soft tabular-nums">{formatInt(row.impressions)}</td>
              <td className="px-6 py-3.5 text-right text-soft tabular-nums">{formatPct(row.ctr)}</td>
              <td className="px-6 py-3.5 text-right">
                <span
                  className={`inline-block min-w-11 rounded border px-2 py-0.5 text-center text-[12.5px] font-medium tabular-nums ${positionTone(row.position)}`}
                >
                  {formatPosition(row.position)}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default async function PerformancePage({ searchParams }: PageProps<"/performance">) {
  const params = await searchParams;
  const tab: ReportTab = params.tab === "pages" ? "pages" : "queries";
  const search = typeof params.q === "string" ? params.q.trim() : "";
  const pageNumber = Math.max(1, Number(params.p) || 1);

  const [connection, site] = await Promise.all([getConnection(), getCurrentSite()]);
  if (!connection) redirect("/connect");
  if (!site) {
    return <p className="text-muted">No client sites yet. Add one to the <code>sites</code> table in Supabase.</p>;
  }

  const [overview, runs] = await Promise.all([getOverview(site.id), getRecentRuns(site.id, 10)]);
  const report = overview
    ? await getReport(site.id, tab, overview.window, search, PAGE_SIZE, (pageNumber - 1) * PAGE_SIZE)
    : null;
  const lastSuccess = runs.find((r) => r.status === "succeeded");
  const latest = runs[0];

  const href = (next: { tab?: ReportTab; q?: string; p?: number }) => {
    const qs = new URLSearchParams();
    const t = next.tab ?? tab;
    const q = next.q ?? search;
    if (t !== "queries") qs.set("tab", t);
    if (q) qs.set("q", q);
    if (next.p && next.p > 1) qs.set("p", String(next.p));
    const s = qs.toString();
    return s ? `/performance?${s}` : "/performance";
  };
  const exportHref = `/api/gsc/export?${new URLSearchParams({ tab, ...(search ? { q: search } : {}) })}`;
  const total = report?.total ?? 0;
  const firstRow = total ? (pageNumber - 1) * PAGE_SIZE + 1 : 0;
  const lastRow = Math.min(pageNumber * PAGE_SIZE, total);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-3.5">
          <span className="eyebrow">Google Search Console</span>
          <h1 className="text-[44px] leading-[1.06] font-medium tracking-[-0.01em]">Search performance</h1>
          <div className="flex flex-wrap items-center gap-3">
            {site.gsc_property ? (
              <span className="tag text-soft">{site.gsc_property}</span>
            ) : (
              <Link href="/connections" className="tag border-accent-500 text-accent-500 no-underline">
                Pick a Search Console property
              </Link>
            )}
            {overview && (
              <span className="text-[13px] text-muted">
                Last 90 days · {formatDate(overview.window.startDate)} – {formatDate(overview.window.endDate)} · Search
                Console lags about 2 days
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {lastSuccess?.finished_at && (
            <span className="text-xs text-muted">Last synced {formatDateTime(lastSuccess.finished_at)}</span>
          )}
          {overview && (
            <a href={exportHref} className="btn">
              Export CSV
            </a>
          )}
          <SyncButton siteId={site.id} disabled={!site.gsc_property} />
        </div>
      </header>

      {latest?.status === "failed" && (
        <p role="alert" className="rounded-lg border border-danger-line px-4 py-3 text-sm text-danger">
          The last sync failed: {latest.error}{" "}
          <Link href="/connections" className="text-danger underline underline-offset-4">
            Open Connections
          </Link>
        </p>
      )}

      {!overview || !report ? (
        <section className="panel flex flex-col items-start gap-4 p-8">
          <h2 className="text-lg font-medium">No Search Console data yet</h2>
          <p className="max-w-xl text-sm leading-relaxed text-muted">
            {site.gsc_property
              ? `Run the first sync to pull the last 90 days of queries and pages for ${site.domain}.`
              : `Choose which Search Console property belongs to ${site.name}, then run the first sync.`}
          </p>
          {!site.gsc_property && (
            <Link href="/connections" className="btn btn-accent">
              Choose property
            </Link>
          )}
        </section>
      ) : (
        <>
          {overview.current && <KpiRow current={overview.current} prior={overview.prior} />}

          <section aria-label="Breakdown" className="panel flex flex-1 flex-col overflow-hidden">
            <div className="rule-bottom flex flex-wrap items-center justify-between gap-4 px-6 py-4.5">
              <div className="flex gap-2" aria-label="Group by">
                {(["queries", "pages"] as const).map((t) => (
                  <Link
                    key={t}
                    href={href({ tab: t, q: "", p: 1 })}
                    aria-current={t === tab ? "page" : undefined}
                    className={`btn min-h-10 px-4.5 ${t === tab ? "btn-accent" : "border-line text-muted"}`}
                  >
                    {t}
                  </Link>
                ))}
              </div>
              <form className="flex items-end gap-3.5" action="/performance">
                {tab !== "queries" && <input type="hidden" name="tab" value={tab} />}
                <label htmlFor="filter" className="eyebrow pb-3">
                  Filter
                </label>
                <input
                  id="filter"
                  name="q"
                  type="search"
                  defaultValue={search}
                  placeholder={tab === "queries" ? "Query contains…" : "URL contains…"}
                  className="min-h-10 w-64 border-0 border-b border-line-strong bg-transparent px-0.5 py-2 text-[15px] text-ink placeholder:text-muted/70 focus:border-accent-500 focus:outline-none"
                />
              </form>
            </div>

            {report.rows.length ? (
              <ReportTable tab={tab} rows={report.rows} />
            ) : (
              <p className="px-6 py-10 text-sm text-muted">No {tab} match “{search}”.</p>
            )}

            <div className="mt-auto flex items-center justify-between border-t border-line px-6 py-4 text-[13px] text-muted">
              <span>
                {total ? `Showing ${formatInt(firstRow)}–${formatInt(lastRow)} of ${formatInt(total)} ${tab}` : " "}
              </span>
              <div className="flex gap-2">
                {pageNumber > 1 ? (
                  <Link href={href({ p: pageNumber - 1 })} className="btn min-h-10 px-4 text-[11.5px]">
                    Previous
                  </Link>
                ) : (
                  <span className="btn min-h-10 cursor-default px-4 text-[11.5px] opacity-40">Previous</span>
                )}
                {lastRow < total ? (
                  <Link href={href({ p: pageNumber + 1 })} className="btn min-h-10 px-4 text-[11.5px]">
                    Next
                  </Link>
                ) : (
                  <span className="btn min-h-10 cursor-default px-4 text-[11.5px] opacity-40">Next</span>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}
