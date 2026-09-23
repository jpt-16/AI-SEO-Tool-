import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionButton } from "@/components/ActionButton";
import { CopyAuditButton } from "@/components/CopyAuditButton";
import { pathOf } from "@/components/ReportTables";
import { groupIssues, ISSUE_TYPES, type Severity } from "@/lib/audit";
import { getAudit, type AuditEntry } from "@/lib/audit-data";
import { formatDateTime, formatInt } from "@/lib/format";
import { getConnection } from "@/lib/google";
import { getCurrentSite } from "@/lib/sites";
import { setAuditIssue } from "../actions";

// "Crawl again" runs here too, and a crawl captures every page.
export const maxDuration = 300;

const SEVERITY: Record<Severity, { label: string; className: string }> = {
  high: { label: "High", className: "border-danger-line text-danger" },
  med: { label: "Medium", className: "border-accent-700 text-accent-300" },
  low: { label: "Low", className: "border-line-strong text-muted" },
};

function FixButton({ siteId, entry, fixed }: { siteId: string; entry: AuditEntry; fixed: boolean }) {
  return (
    <form action={setAuditIssue} className="shrink-0">
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="pageKey" value={entry.pageKey} />
      <input type="hidden" name="issue" value={entry.type} />
      <input type="hidden" name="fixed" value={String(fixed)} />
      <button type="submit" className="btn min-h-10 w-full px-3.5 text-[11.5px] sm:w-auto">
        {fixed ? "Mark fixed" : "Reopen"}
      </button>
    </form>
  );
}

function IssueRow({ siteId, entry, view }: { siteId: string; entry: AuditEntry; view: "open" | "fixed" }) {
  return (
    <li className="flex flex-col gap-2.5 border-t border-line py-3.5 first:border-t-0 sm:flex-row sm:items-start sm:gap-5">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {entry.url ? (
            <a href={entry.url} target="_blank" rel="noreferrer" className="font-medium break-all text-ink no-underline hover:text-accent-400">
              {pathOf(entry.url)}
            </a>
          ) : (
            <span className="font-medium text-ink">Whole site</span>
          )}
          {entry.url && <span className="text-xs text-muted tabular-nums">{formatInt(entry.impressions)} impr.</span>}
        </div>
        <p className="text-[13px] leading-relaxed break-words text-soft">{entry.detail}</p>
        {entry.state === "returned" && entry.fixedAt && (
          <p className="text-xs text-danger">Marked fixed {formatDateTime(entry.fixedAt)}, but the latest crawl still finds it.</p>
        )}
        {view === "fixed" && entry.fixedAt && (
          <p className="text-xs text-muted">Marked fixed {formatDateTime(entry.fixedAt)}. It comes back if the next crawl still finds it.</p>
        )}
      </div>
      <FixButton siteId={siteId} entry={entry} fixed={view === "open"} />
    </li>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="flex flex-col gap-1.5 bg-surface px-4 py-4 sm:px-6 sm:py-5">
      <span className={`text-[28px] leading-none font-medium tabular-nums sm:text-[34px] ${tone ?? "text-ink"}`}>{value}</span>
      <span className="text-[10.5px] tracking-[0.2em] text-muted uppercase">{label}</span>
    </div>
  );
}

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const params = await searchParams;
  const view = params.view === "fixed" ? "fixed" : "open";

  const [connection, site] = await Promise.all([getConnection(), getCurrentSite()]);
  if (!connection) redirect("/connect");
  if (!site) return <p className="text-muted">No client sites yet.</p>;

  const { entries, crawl } = await getAudit(site.id);
  const open = entries.filter((e) => e.state !== "fixed");
  const fixed = entries.filter((e) => e.state === "fixed");
  const shown = view === "open" ? open : fixed;
  const groups = groupIssues(shown);
  const count = (s: Severity) => open.filter((e) => ISSUE_TYPES[e.type].severity === s).length;

  return (
    <>
      <header className="flex flex-col gap-3.5">
        <span className="eyebrow">From the latest crawl</span>
        <h1 className="text-[32px] leading-[1.06] font-medium tracking-[-0.01em] sm:text-[44px]">Site audit</h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted">
          Every problem the crawl found: on-page SEO, the phone-screen visual checks, how quotable answers are, and AI
          crawler access. Most serious first, then by how much search traffic each page gets.
        </p>
      </header>

      <section aria-label="Crawl" className="panel flex flex-wrap items-center justify-between gap-3 p-4 sm:px-6">
        <span className="text-[13px] text-muted">
          {crawl
            ? `Last crawl ${formatDateTime(crawl.finished_at ?? crawl.started_at)} · ${crawl.pages_crawled ?? 0} pages · re-crawls every Monday`
            : "Not crawled yet."}
        </span>
        <ActionButton kind="crawl" siteId={site.id} label={crawl ? "Crawl again" : "Crawl site"} accent={!crawl} />
      </section>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
        <Tile label="High" value={count("high")} tone={count("high") ? "text-danger" : undefined} />
        <Tile label="Medium" value={count("med")} />
        <Tile label="Low" value={count("low")} />
        <Tile label="Marked fixed" value={fixed.length} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Audit view" className="flex flex-wrap gap-2">
          {(["open", "fixed"] as const).map((v) => (
            <Link
              key={v}
              href={v === "open" ? "/audit" : "/audit?view=fixed"}
              aria-current={v === view ? "page" : undefined}
              className={`btn min-h-10 px-4 ${v === view ? "btn-accent" : "border-line text-muted"}`}
            >
              {v === "open" ? `To fix · ${open.length}` : `Marked fixed · ${fixed.length}`}
            </Link>
          ))}
        </nav>
        {crawl && open.length > 0 && (
          <div className="flex flex-wrap gap-2" aria-label="Export">
            <a href="/api/audit/export" className="btn min-h-10 px-4 text-[11.5px]" download>
              Download for Claude Code
            </a>
            <CopyAuditButton />
          </div>
        )}
      </div>

      {!crawl ? (
        <p className="panel p-5 text-sm text-muted sm:p-7">Crawl the site to run the audit.</p>
      ) : groups.length === 0 ? (
        <p className="panel p-5 text-sm leading-relaxed text-muted sm:p-7">
          {view === "open" ? "Nothing to fix. The latest crawl found no problems." : "Nothing marked fixed."}
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((group) => {
            const type = ISSUE_TYPES[group.type];
            const severity = SEVERITY[type.severity];
            return (
              <section key={group.type} aria-labelledby={`issue-${group.type}`} className="panel flex flex-col gap-3 p-5 sm:p-7">
                <header className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className={`tag px-2.5 py-0.5 text-[11px] tracking-[0.14em] uppercase ${severity.className}`}>{severity.label}</span>
                    <h2 id={`issue-${group.type}`} className="text-lg leading-snug font-medium">
                      {type.label}
                    </h2>
                    <span className="text-[13px] text-muted">
                      {group.issues[0].url ? `${group.issues.length} page${group.issues.length === 1 ? "" : "s"}` : "Site-wide"}
                    </span>
                  </div>
                  <p className="text-[13px] leading-relaxed text-muted">{type.why}</p>
                </header>
                <ul className="flex flex-col">
                  {group.issues.map((entry) => (
                    <IssueRow key={`${entry.pageKey}:${entry.type}`} siteId={site.id} entry={entry} view={view} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
