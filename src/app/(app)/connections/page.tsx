import { CheckIcon } from "@/components/icons";
import { PropertyForm } from "@/components/PropertyForm";
import { ActionButton } from "@/components/ActionButton";
import { formatDate, formatDateTime, formatInt } from "@/lib/format";
import { describeGoogleError, getConnection, GSC_SCOPE, gscRequester } from "@/lib/google";
import { listSites as listGscProperties, type GscSiteEntry } from "@/lib/gsc";
import { getRecentRuns, type SyncRun } from "@/lib/reports";
import { getCurrentSite } from "@/lib/sites";
import { disconnectGoogle, setSyncEnabled } from "../actions";

export const maxDuration = 60;

const PULLED = [
  ["Window", "Last 90 days"],
  ["Dimensions", "date, query, page"],
  ["Metrics", "clicks, impressions, CTR, position"],
  ["Search type", "Web"],
  ["Paging", "25,000 rows per request"],
  ["Stored in", "Supabase · gsc_search_analytics"],
];

function RunStatus({ run }: { run: SyncRun }) {
  const tone =
    run.status === "succeeded"
      ? "text-accent-300 border-accent-700"
      : run.status === "failed"
        ? "text-danger border-danger-line"
        : "text-soft border-line-strong";
  const label = run.status === "succeeded" ? "Succeeded" : run.status === "failed" ? run.error ?? "Failed" : "Running";
  return (
    <span className={`tag ${tone}`}>
      <span className="size-1.5 shrink-0 rounded-full bg-current" />
      {label}
    </span>
  );
}

function duration(run: SyncRun) {
  if (!run.finished_at) return "—";
  return `${((Date.parse(run.finished_at) - Date.parse(run.started_at)) / 1000).toFixed(1)} s`;
}

export default async function ConnectionsPage({ searchParams }: PageProps<"/connections">) {
  const { connected } = await searchParams;
  const [connection, site] = await Promise.all([getConnection(), getCurrentSite()]);

  if (!connection) {
    return (
      <>
        <header className="flex flex-col gap-3.5">
          <span className="eyebrow">Connections</span>
          <h1 className="text-[44px] leading-[1.06] font-medium tracking-[-0.01em]">Google Search Console</h1>
        </header>
        <section className="panel flex flex-col items-start gap-4 p-8">
          <h2 className="text-lg font-medium">Not connected</h2>
          <p className="max-w-xl text-sm leading-relaxed text-muted">
            Connect the Google account that has access to your clients’ Search Console properties.
          </p>
          <a href="/api/auth/google/start" className="btn btn-accent">
            Continue with Google
          </a>
        </section>
      </>
    );
  }

  let properties: GscSiteEntry[] = [];
  let propertiesError: string | null = null;
  try {
    const request = await gscRequester();
    if (request) properties = await listGscProperties(request);
  } catch (err) {
    propertiesError = describeGoogleError(err);
  }
  const runs = site ? await getRecentRuns(site.id, 10) : [];

  return (
    <>
      <header className="flex flex-col gap-3.5">
        <span className="eyebrow">Connections</span>
        <h1 className="text-[44px] leading-[1.06] font-medium tracking-[-0.01em]">Google Search Console</h1>
      </header>

      {connected === "1" && (
        <p role="status" className="rounded-lg border border-accent-700 px-4 py-3 text-sm text-accent-200">
          Google connected. Pick the property for {site?.name ?? "this client"} below, then run the first sync.
        </p>
      )}

      <section aria-label="Account" className="panel flex flex-wrap items-center justify-between gap-6 px-7 py-6">
        <div className="flex items-center gap-4.5">
          <div className="flex size-[46px] items-center justify-center rounded-lg border border-accent-500 text-accent-500 shadow-[0_0_18px_rgb(145_132_217/0.3)]">
            <CheckIcon size={20} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-base font-medium">
              Connected as {connection.google_email ?? "your Google account"}
            </span>
            <div className="flex flex-wrap items-center gap-2.5 text-[13px] text-muted">
              <span>Scope</span>
              <code className="rounded border border-line-strong px-2 py-0.5 font-mono text-xs text-soft">{GSC_SCOPE}</code>
              <span>· since {formatDateTime(connection.connected_at)}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2.5">
          <a href="/api/auth/google/start" className="btn">
            Reconnect
          </a>
          <form action={disconnectGoogle}>
            <button type="submit" className="btn btn-danger">
              Disconnect
            </button>
          </form>
        </div>
      </section>

      {site && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <section aria-labelledby="prop-h" className="panel flex flex-col gap-4.5 px-7 py-6.5">
            <h2 id="prop-h" className="text-lg font-medium">
              Property for {site.name}
            </h2>
            {propertiesError ? (
              <p role="alert" className="text-sm text-danger">
                {propertiesError}
              </p>
            ) : properties.length ? (
              <PropertyForm siteId={site.id} properties={properties} selected={site.gsc_property} />
            ) : (
              <p className="text-sm text-muted">
                This Google account can’t see any Search Console properties. Add it as a user on the property in Search
                Console, then reload.
              </p>
            )}
          </section>

          <section aria-labelledby="sync-h" className="panel flex flex-col gap-4.5 px-7 py-6.5">
            <h2 id="sync-h" className="text-lg font-medium">
              What gets pulled
            </h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4.5 text-sm">
              {PULLED.map(([term, value]) => (
                <div key={term} className="flex flex-col gap-1.5">
                  <dt className="text-[10.5px] tracking-[0.2em] text-muted uppercase">{term}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4.5">
              <form action={setSyncEnabled} className="flex items-center gap-3 text-sm">
                <input type="hidden" name="siteId" value={site.id} />
                <input type="hidden" name="enabled" value={String(!site.sync_enabled)} />
                <span>
                  Daily sync is <strong className="font-medium">{site.sync_enabled ? "on" : "off"}</strong>
                  <span className="text-muted"> · 11:00 UTC</span>
                </span>
                <button type="submit" className="btn min-h-10 px-4 text-[11.5px]">
                  {site.sync_enabled ? "Turn off" : "Turn on"}
                </button>
              </form>
              <ActionButton kind="sync" siteId={site.id} label="Run sync now" disabled={!site.gsc_property} />
            </div>
          </section>
        </div>
      )}

      {site && (
        <section aria-labelledby="hist-h" className="panel overflow-hidden">
          <div className="rule-bottom flex items-center justify-between px-7 py-5">
            <h2 id="hist-h" className="text-lg font-medium">
              Sync history
            </h2>
          </div>
          {runs.length ? (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-[10.5px] tracking-[0.2em] text-muted uppercase">
                  <th scope="col" className="px-7 py-3.5 font-medium">Started</th>
                  <th scope="col" className="px-7 py-3.5 font-medium">Date range</th>
                  <th scope="col" className="px-7 py-3.5 font-medium">Trigger</th>
                  <th scope="col" className="px-7 py-3.5 text-right font-medium">Rows</th>
                  <th scope="col" className="px-7 py-3.5 text-right font-medium">Duration</th>
                  <th scope="col" className="px-7 py-3.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-t border-line">
                    <td className="px-7 py-3.5">{formatDateTime(run.started_at)}</td>
                    <td className="px-7 py-3.5 text-muted">
                      {run.start_date && run.end_date
                        ? `${formatDate(run.start_date)} – ${formatDate(run.end_date)}`
                        : "—"}
                    </td>
                    <td className="px-7 py-3.5 text-muted capitalize">{run.trigger}</td>
                    <td className="px-7 py-3.5 text-right tabular-nums">
                      {run.rows_fetched === null ? "—" : formatInt(run.rows_fetched)}
                    </td>
                    <td className="px-7 py-3.5 text-right text-soft tabular-nums">{duration(run)}</td>
                    <td className="px-7 py-3.5">
                      <RunStatus run={run} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-7 py-8 text-sm text-muted">No syncs yet.</p>
          )}
        </section>
      )}
    </>
  );
}
