"use client";

import { useActionState } from "react";
import { saveProperty } from "@/app/(app)/actions";
import type { GscSiteEntry } from "@/lib/gsc";

function describe(entry: GscSiteEntry) {
  const kind = entry.siteUrl.startsWith("sc-domain:") ? "Domain property" : "URL-prefix property";
  const level = entry.permissionLevel.replace(/^site/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
  return `${kind} · ${level}`;
}

export function PropertyForm({ siteId, properties, selected }: { siteId: string; properties: GscSiteEntry[]; selected: string | null }) {
  const [state, action, pending] = useActionState(saveProperty, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="siteId" value={siteId} />
      <fieldset className="flex flex-col gap-2.5">
        <legend className="eyebrow mb-3">Properties your account can read</legend>
        {properties.map((p) => (
          <label
            key={p.siteUrl}
            className="flex min-h-14 cursor-pointer items-center gap-3.5 rounded-lg border border-line px-4 has-checked:border-accent-500 has-checked:bg-accent-500/6"
          >
            <input type="radio" name="property" value={p.siteUrl} defaultChecked={p.siteUrl === selected} required className="size-[18px] accent-accent-500" />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium break-all">{p.siteUrl}</span>
              <span className="text-xs text-muted">{describe(p)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex items-center justify-end gap-3">
        {state && (
          <span role="status" className={`text-xs ${state.ok ? "text-accent-300" : "text-danger"}`}>
            {state.message}
          </span>
        )}
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "Saving…" : "Save property"}
        </button>
      </div>
    </form>
  );
}
