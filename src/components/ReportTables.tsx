import { formatInt, formatPct, formatPosition } from "@/lib/format";
import { missingQueryWords } from "@/lib/match";
import type { PageRow, QueryRow } from "@/lib/reports";

export function pathOf(url: string) {
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

function Position({ value }: { value: number }) {
  return (
    <span
      className={`inline-block min-w-11 rounded border px-2 py-0.5 text-center text-[12.5px] font-medium tabular-nums ${positionTone(value)}`}
    >
      {formatPosition(value)}
    </span>
  );
}

export function QueryTable({ rows }: { rows: QueryRow[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="text-left text-[10.5px] tracking-[0.2em] text-muted uppercase">
          <th scope="col" className="px-6 py-3.5 font-medium">Query</th>
          <th scope="col" className="px-6 py-3.5 font-medium">Top landing page</th>
          <th scope="col" className="px-6 py-3.5 text-right font-medium">Clicks</th>
          <th scope="col" className="px-6 py-3.5 text-right font-medium">Impressions</th>
          <th scope="col" className="px-6 py-3.5 text-right font-medium">CTR</th>
          <th scope="col" className="px-6 py-3.5 text-right font-medium">Position</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.query} className="border-t border-line">
            <td className="px-6 py-3.5 font-medium break-all">{row.query}</td>
            <td className="px-6 py-3.5 text-[13px] break-all text-muted" title={row.topPage ?? undefined}>
              {row.topPage && pathOf(row.topPage)}
            </td>
            <td className="px-6 py-3.5 text-right font-medium tabular-nums">{formatInt(row.clicks)}</td>
            <td className="px-6 py-3.5 text-right text-soft tabular-nums">{formatInt(row.impressions)}</td>
            <td className="px-6 py-3.5 text-right text-soft tabular-nums">{formatPct(row.ctr)}</td>
            <td className="px-6 py-3.5 text-right">
              <Position value={row.position} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Common rule-of-thumb limits before Google truncates in results.
const TITLE_MAX = 60;
const META_MAX = 160;

function Flag({ children, tone = "warn" }: { children: React.ReactNode; tone?: "warn" | "info" }) {
  return (
    <span
      className={`tag px-2 py-0 text-[11px] ${tone === "warn" ? "border-danger-line text-danger" : "border-line-strong text-muted"}`}
    >
      {children}
    </span>
  );
}

function OnPageText({ text, max, missing }: { text: string | null; max?: number; missing: string }) {
  if (!text) return <Flag>{missing}</Flag>;
  return (
    <span>
      {text}{" "}
      {max && (
        <span className={`text-xs tabular-nums whitespace-nowrap ${text.length > max ? "text-danger" : "text-muted"}`}>
          · {text.length}/{max}
        </span>
      )}
    </span>
  );
}

function QueryWords({ query, title }: { query: string; title: string | null }) {
  const missing = new Set(missingQueryWords(query, title));
  const words = query.split(/(\s+)/);
  return (
    <span>
      {words.map((w, i) =>
        missing.has(w.toLowerCase()) ? (
          <span key={i} className="text-accent-300 underline decoration-accent-500 decoration-dotted underline-offset-4">
            {w}
          </span>
        ) : (
          <span key={i}>{w}</span>
        ),
      )}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] tracking-[0.2em] text-muted uppercase">{label}</span>
      <span className="text-[15px] font-medium tabular-nums">{value}</span>
    </div>
  );
}

function PageItem({ row }: { row: PageRow }) {
  const c = row.crawl;
  const failed = c && (c.error || (c.statusCode !== null && c.statusCode >= 400));
  return (
    <li className="grid grid-cols-1 gap-6 border-t border-line px-6 py-5.5 xl:grid-cols-[minmax(0,1fr)_380px] xl:gap-10">
      <div className="flex min-w-0 flex-col gap-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <a href={row.url} target="_blank" rel="noreferrer" className="font-medium break-all text-ink no-underline hover:text-accent-400" title={row.url}>
            {pathOf(row.url)}
          </a>
          {!c && <Flag tone="info">Not crawled</Flag>}
          {failed && <Flag>{c.error ?? `HTTP ${c.statusCode}`}</Flag>}
          {c && !failed && !c.inSitemap && <Flag tone="info">Not in sitemap</Flag>}
          {c && c.h1.length > 1 && <Flag>{c.h1.length} H1s</Flag>}
        </div>

        {c && !failed && (
          <>
            <dl className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm leading-relaxed">
              <dt className="pt-0.5 text-[10.5px] tracking-[0.2em] text-muted uppercase">Title</dt>
              <dd>
                <OnPageText text={c.title} max={TITLE_MAX} missing="No title tag" />
              </dd>
              <dt className="pt-0.5 text-[10.5px] tracking-[0.2em] text-muted uppercase">Meta</dt>
              <dd className="text-soft">
                <OnPageText text={c.metaDescription} max={META_MAX} missing="No meta description" />
              </dd>
              <dt className="pt-0.5 text-[10.5px] tracking-[0.2em] text-muted uppercase">H1</dt>
              <dd className="text-soft">
                <OnPageText text={c.h1.join(" · ") || null} missing="No H1" />
              </dd>
            </dl>
            <p className="text-xs text-muted">
              {formatInt(c.wordCount ?? 0)} words · {formatInt(c.internalLinkCount ?? 0)} internal links · Schema:{" "}
              {c.schemaTypes.length ? c.schemaTypes.join(", ") : "none"}
            </p>
          </>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-4 gap-3">
          <Stat label="Clicks" value={formatInt(row.clicks)} />
          <Stat label="Impr." value={formatInt(row.impressions)} />
          <Stat label="CTR" value={row.ctr === null ? "—" : formatPct(row.ctr)} />
          <Stat label="Pos." value={row.position === null ? "—" : formatPosition(row.position)} />
        </div>
        {row.topQueries.length > 0 ? (
          <ul className="flex flex-col gap-1.5 text-[13px]">
            {row.topQueries.map((q) => (
              <li key={q.query} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 break-words">
                  <QueryWords query={q.query} title={c?.title ?? null} />
                </span>
                <span className="shrink-0 text-xs text-muted tabular-nums">
                  {formatInt(q.impressions)} impr · {formatPosition(q.position)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">No Search Console impressions in this window.</p>
        )}
      </div>
    </li>
  );
}

export function PageList({ rows }: { rows: PageRow[] }) {
  return (
    <>
      <p className="px-6 pt-3.5 pb-3 text-xs text-muted">
        Top queries per page. <span className="text-accent-300 underline decoration-dotted underline-offset-4">Underlined words</span>{" "}
        don’t appear in that page’s title tag.
      </p>
      <ul>
        {rows.map((row) => (
          <PageItem key={row.pageKey} row={row} />
        ))}
      </ul>
    </>
  );
}
