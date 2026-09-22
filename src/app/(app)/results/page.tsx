import Link from "next/link";
import { redirect } from "next/navigation";
import { pathOf } from "@/components/ReportTables";
import {
  doneDate,
  RESULT_DAYS,
  resultWindow,
  type Delta,
  type QueryStat,
  type StatBlock,
  type StatsSnapshot,
} from "@/lib/attribution-core";
import { targetQueriesOf } from "@/lib/attribution";
import { listResults, type Blueprint } from "@/lib/blueprints";
import { addDays, type DateWindow } from "@/lib/dates";
import { formatDate, formatDateTime, formatInt } from "@/lib/format";
import { getConnection } from "@/lib/google";
import { getCurrentSite } from "@/lib/sites";

const DASH = "—";
const signed = (n: number, digits: number) => {
  const text = Math.abs(n).toFixed(digits);
  return n > 0 ? `+${text}` : n < 0 ? `−${text}` : digits ? (0).toFixed(digits) : "0";
};
const count = (n: number | null | undefined) => (n === null || n === undefined ? DASH : formatInt(n));
const pos = (n: number | null | undefined) => (n === null || n === undefined ? DASH : n.toFixed(1));
const range = (w: DateWindow) => `${formatDate(w.startDate)} – ${formatDate(w.endDate)}`;

type Metric = "clicks" | "impressions" | "position";
const METRICS: { key: Metric; label: string }[] = [
  { key: "clicks", label: "Clicks" },
  { key: "impressions", label: "Impressions" },
  { key: "position", label: "Avg position" },
];

function cell(metric: Metric, value: number | null | undefined) {
  return metric === "position" ? pos(value) : count(value);
}

function change(metric: Metric, d: Delta | undefined) {
  if (!d || d.change === null) return DASH;
  return signed(d.change, metric === "position" ? 1 : 0);
}

function NumbersTable({
  caption,
  before,
  after,
  diff,
}: {
  caption: string;
  before: StatBlock | undefined;
  after: StatBlock | undefined;
  diff: Record<Metric, Delta> | undefined;
}) {
  return (
    <table className="w-full text-sm tabular-nums">
      <caption className="pb-2 text-left text-[10.5px] tracking-[0.2em] text-muted uppercase">{caption}</caption>
      <thead>
        <tr className="border-b border-line text-left text-xs text-muted">
          <th scope="col" className="py-2 pr-2 font-normal">
            <span className="sr-only">Metric</span>
          </th>
          <th scope="col" className="px-2 py-2 text-right font-normal">
            Before
          </th>
          <th scope="col" className="px-2 py-2 text-right font-normal">
            After
          </th>
          <th scope="col" className="py-2 pl-2 text-right font-normal">
            Change
          </th>
        </tr>
      </thead>
      <tbody>
        {METRICS.map(({ key, label }) => (
          <tr key={key} className="border-b border-line last:border-0">
            <th scope="row" className="py-2.5 pr-2 text-left font-normal text-soft">
              {label}
            </th>
            <td className="px-2 py-2.5 text-right text-ink">{cell(key, before?.[key])}</td>
            <td className="px-2 py-2.5 text-right text-ink">{after ? cell(key, after[key]) : "Pending"}</td>
            <td className="py-2.5 pl-2 text-right text-ink">{change(key, diff?.[key])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function QueryRows({ before, after }: { before: QueryStat[]; after: QueryStat[] | undefined }) {
  const afterByQuery = new Map(after?.map((q) => [q.query, q]));
  return (
    <ul className="flex flex-col divide-y divide-line">
      {before.map((b) => {
        const a = afterByQuery.get(b.query);
        const pair = (metric: Metric) => `${cell(metric, b[metric])} → ${after ? cell(metric, a?.[metric] ?? (metric === "position" ? null : 0)) : "pending"}`;
        return (
          <li key={b.query} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
            <span className="min-w-0 break-words text-soft">{b.query}</span>
            <span className="shrink-0 text-xs text-muted tabular-nums">
              Clicks {pair("clicks")} · Impr {pair("impressions")} · Pos {pair("position")}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ResultCard({ blueprint: b }: { blueprint: Blueprint }) {
  const before = b.baseline_snapshot;
  const after = b.result_snapshot ?? undefined;
  const diff = b.result_diff ?? undefined;
  const done = b.done_at ? doneDate(b.done_at) : null;
  const afterWindow: DateWindow | null = after?.window ?? (done ? resultWindow(done) : null);
  const queries = before?.queries ?? targetQueriesOf(b).map((query) => ({ query, clicks: 0, impressions: 0, position: null }));

  return (
    <article className="panel flex flex-col gap-5 p-5 sm:p-7">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={`tag px-2.5 py-0.5 text-[11px] tracking-[0.14em] uppercase ${after ? "border-accent-700 text-accent-300" : "border-line-strong text-muted"}`}>
          {after ? "Measured" : "Pending"}
        </span>
        <a href={b.url} target="_blank" rel="noreferrer" className="font-medium break-all text-ink no-underline hover:text-accent-400">
          {pathOf(b.url)}
        </a>
        <span className="text-xs text-muted sm:ml-auto">Marked done {b.done_at ? formatDateTime(b.done_at) : DASH}</span>
      </header>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg leading-snug font-medium">{b.finding}</h2>
        <dl className="flex flex-col gap-1 text-[13px] leading-relaxed text-soft">
          {b.proposed_title !== null && (
            <div className="break-words">
              <dt className="mr-2 inline text-[10.5px] tracking-[0.16em] text-muted uppercase">Title</dt>
              <dd className="inline">{b.proposed_title}</dd>
            </div>
          )}
          {b.proposed_meta !== null && (
            <div className="break-words">
              <dt className="mr-2 inline text-[10.5px] tracking-[0.16em] text-muted uppercase">Meta</dt>
              <dd className="inline">{b.proposed_meta}</dd>
            </div>
          )}
        </dl>
      </div>

      <p className="text-xs leading-relaxed text-muted">
        Before: {before ? range(before.window) : DASH}
        <br />
        After: {afterWindow ? range(afterWindow) : DASH}
        {!after && afterWindow && (
          <> · pending until Search Console has data through {formatDate(afterWindow.endDate)}, usually around {formatDate(addDays(afterWindow.endDate, 3))}</>
        )}
      </p>

      <div className="grid grid-cols-1 gap-6 border-t border-line pt-5 lg:grid-cols-2">
        <NumbersTable caption={`Targeted queries (${queries.length})`} before={before?.cited} after={after?.cited} diff={diff?.cited} />
        <NumbersTable caption="Whole page" before={before?.page} after={after?.page} diff={diff?.page} />
      </div>

      <details className="group border-t border-line pt-4 text-[13px]">
        <summary className="cursor-pointer list-none text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">Each targeted query ▸</span>
          <span className="hidden group-open:inline">Hide queries ▾</span>
        </summary>
        <div className="mt-2">
          <QueryRows before={queries} after={after?.queries} />
        </div>
      </details>
    </article>
  );
}

function isMeasured(b: Blueprint): b is Blueprint & { result_snapshot: StatsSnapshot } {
  return b.result_snapshot !== null;
}

export default async function ResultsPage() {
  const [connection, site] = await Promise.all([getConnection(), getCurrentSite()]);
  if (!connection) redirect("/connect");
  if (!site) return <p className="text-muted">No client sites yet.</p>;

  const results = await listResults(site.id);
  const measured = results.filter(isMeasured).length;

  return (
    <>
      <header className="flex flex-col gap-3.5">
        <span className="eyebrow">Attribution</span>
        <h1 className="text-[32px] leading-[1.06] font-medium tracking-[-0.01em] sm:text-[44px]">Results</h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted">
          Search Console numbers for each completed blueprint: the {RESULT_DAYS} days before it was marked done and the
          first {RESULT_DAYS} full days after. Sorted by the change in clicks on the targeted queries. Position 1 is the
          top of the results.
        </p>
        {results.length > 0 && (
          <p className="text-[13px] text-muted">
            {measured} measured · {results.length - measured} pending
          </p>
        )}
      </header>

      {results.length ? (
        <div className="flex flex-col gap-5">
          {results.map((b) => (
            <ResultCard key={b.id} blueprint={b} />
          ))}
        </div>
      ) : (
        <p className="panel p-5 text-sm leading-relaxed text-muted sm:p-7">
          No completed blueprints yet. After you make a change on the site, mark its blueprint done on{" "}
          <Link href="/blueprints">Blueprints</Link> and it shows up here.
        </p>
      )}
    </>
  );
}
