import { selectSite } from "@/app/(app)/actions";
import type { Site } from "@/lib/sites";
import { ChevronsIcon } from "./icons";
import { Monogram } from "./Monogram";
import { NavLinks } from "./NavLinks";

export function Sidebar({ sites, current, connected }: { sites: Site[]; current: Site | null; connected: boolean }) {
  return (
    <nav aria-label="Main" className="rule-right flex w-64 shrink-0 flex-col gap-9 px-6 py-8">
      <div className="flex flex-col gap-3.5">
        <Monogram height={36} />
        <span className="eyebrow">SEO workbench</span>
      </div>

      {current && (
        <div className="flex flex-col gap-2.5">
          <span className="eyebrow text-muted">Client</span>
          <details className="group relative">
            <summary className="flex min-h-13 cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{current.name}</span>
                <span className="text-xs text-muted">{current.domain}</span>
              </span>
              <ChevronsIcon size={16} className="text-muted" />
            </summary>
            <form action={selectSite} className="panel absolute inset-x-0 top-full z-10 mt-2 flex flex-col p-1.5">
              {sites.map((site) => (
                <button
                  key={site.id}
                  name="siteId"
                  value={site.id}
                  aria-current={site.id === current.id ? "true" : undefined}
                  className="flex min-h-11 cursor-pointer flex-col items-start justify-center rounded-md px-3 py-2 text-left text-sm hover:bg-accent-500/12 aria-[current]:text-accent-300"
                >
                  <span className="font-medium">{site.name}</span>
                  <span className="text-xs text-muted">{site.domain}</span>
                </button>
              ))}
            </form>
          </details>
        </div>
      )}

      <NavLinks />

      <div className="mt-auto flex items-center gap-2.5 text-xs text-muted">
        {connected ? (
          <>
            <span className="size-[7px] rounded-full bg-accent-500 shadow-[0_0_0_4px_rgb(145_132_217/0.16)]" />
            Search Console connected · read-only
          </>
        ) : (
          <>
            <span className="size-[7px] rounded-full bg-danger" />
            Search Console not connected
          </>
        )}
      </div>
    </nav>
  );
}
