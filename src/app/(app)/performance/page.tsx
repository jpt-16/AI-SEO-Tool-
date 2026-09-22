import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionButton } from "@/components/ActionButton";
import { PageList, QueryTable } from "@/components/ReportTables";
import { getLatestCrawl, type CrawlRun } from "@/lib/crawl-run";
import { formatCompact, formatDate, formatDateTime, formatInt, formatPct, formatPosition } from "@/lib/format";
import { getConnection } from "@/lib/google";
import { percentChange, type Totals } from "@/lib/metrics";
import { getOverview, getPageReport, getQueryReport, getRecentRuns, type ReportTab } from "@/lib/reports";
import { getCurrentSite } from "@/lib/sites";

export const maxDuration = 60;

const PAGE_SIZE = 25;

function CrawlBar({ siteId, crawl }: { siteId: string; crawl: CrawlRun | null }) {
  let status: string;
  if (!crawl) status = "Not crawled yet. Crawl the site to pull each page’s title, meta description and headings.";
  else if (crawl.status === "running") status = `Crawl started ${formatDateTime(crawl.started_at)}…`;
  else if (crawl.status === "failed") status = `Last crawl failed ${formatDateTime(crawl.started_at)}: ${crawl.error}`;
  else {
    const failed = crawl.pages_failed ? ` · ${crawl.pages_failed} failed` : "";
    status = `Last crawled ${formatDateTime(crawl.finished_at ?? crawl.started_at)} · ${crawl.pages_crawled} pages${failed}`;
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-6">
      <span className={`text-[13px] ${crawl?.status === "failed" ? "text-danger" : "text-muted"}`}>{status}</span>
      <ActionButton kind="crawl" siteId={siteId} label={crawl ? "Crawl again" : "Crawl site"} accent={!crawl} />
    </div>
  );
}

function Delta({ text, good }: { text: string; good: boolean }) {
  return <span className={`text-[12.5px] ${good ? "text-soft" : "text-danger"}`}>{text}</span>;
}

function Kpi({ label, value, delta }: { label: string; value: string; delta: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 bg-surface px-5 py-5 sm:gap-2.5 sm:px-8 sm:py-7.5">
      <span className="text-[32px] leading-none font-medium tracking-[-0.01em] text-accent-500 tabular-nums sm:text-[44px]">
        {value}
      </span>
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
    <section aria-label="Totals" className="panel grid grid-cols-2 gap-px overflow-hidden bg-line xl:grid-cols-4">
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

  const [overview, runs, crawl] = await Promise.all([
    getOverview(site.id),
    getRecentRuns(site.id, 10),
    getLatestCrawl(site.id),
  ]);
  const paging = overview && { window: overview.window, search, limit: PAGE_SIZE, offset: (pageNumber - 1) * PAGE_SIZE };
  const report = !paging
    ? null
    : tab === "queries"
      ? { tab, ...(await getQueryReport(site.id, paging)) }
      : { tab, ...(await getPageReport(site.id, paging)) };
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
      <header className="flex flex-wrap items-end justify-between gap-4 sm:gap-6">
        <div className="flex min-w-0 flex-col gap-3.5">
          <span className="eyebrow">Google Search Console</span>
          <h1 className="text-[32px] leading-[1.06] font-medium tracking-[-0.01em] sm:text-[44px]">Search performance</h1>
          <div className="flex flex-wrap items-center gap-3">
            {site.gsc_property ? (
              <span className="tag break-all text-soft">{site.gsc_property}</span>
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
            <span className="w-full text-xs text-muted sm:w-auto">Last synced {formatDateTime(lastSuccess.finished_at)}</span>
          )}
          {overview && (
            <a href={exportHref} className="btn">
              Export CSV
            </a>
          )}
          <ActionButton kind="sync" siteId={site.id} label="Sync now" disabled={!site.gsc_property} />
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
        <section className="panel flex flex-col items-start gap-4 p-5 sm:p-8">
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
            <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 rule-bottom sm:px-6 sm:py-4.5">
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
              <form className="flex w-full items-end gap-3.5 sm:w-auto" action="/performance">
                {tab !== "queries" && <input type="hidden" name="tab" value={tab} />}
                <label htmlFor="filter" className="eyebrow pb-3">
                  Filter
                </label>
                <input
                  id="filter"
                  name="q"
                  type="search"
                  defaultValue={search}
                  placeholder={tab === "queries" ? "Query contains…" : "URL or title contains…"}
                  className="min-h-10 w-full min-w-0 flex-1 border-0 border-b sm:w-64 sm:flex-none border-line-strong bg-transparent px-0.5 py-2 text-[15px] text-ink placeholder:text-muted/70 focus:border-accent-500 focus:outline-none"
                />
              </form>
            </div>

            {report.tab === "pages" && <CrawlBar siteId={site.id} crawl={crawl} />}

            {report.rows.length === 0 ? (
              <p className="px-4 py-10 text-sm text-muted sm:px-6">No {tab} match “{search}”.</p>
            ) : report.tab === "queries" ? (
              <QueryTable rows={report.rows} />
            ) : (
              <PageList rows={report.rows} />
            )}

            <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-4 text-[13px] text-muted sm:px-6">
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
