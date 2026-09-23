"use client";

import { useActionState } from "react";
import { generateBlueprints } from "@/app/(app)/actions";
import { DEFAULT_EFFORT, EFFORT_LABELS, EFFORTS } from "@/lib/effort";
import { ClipboardIcon } from "./icons";

const EFFORT_HINTS = { low: "cheapest", medium: "recommended", high: "most reasoning, costs most" } as const;
const fieldClass =
  "min-h-11 rounded-lg border border-line-strong bg-transparent px-3 text-[15px] text-ink focus:border-accent-500 focus:outline-none";

export function AnalyzeForm({ siteId, defaultMinImpressions }: { siteId: string; defaultMinImpressions: number }) {
  const [state, action, pending] = useActionState(generateBlueprints, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="siteId" value={siteId} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[10.5px] tracking-[0.2em] text-muted uppercase">Min. impressions (90 days)</span>
          <input
            type="number"
            name="minImpressions"
            min={0}
            defaultValue={defaultMinImpressions}
            className={`${fieldClass} w-32 tabular-nums`}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[10.5px] tracking-[0.2em] text-muted uppercase">Depth</span>
          <select name="effort" defaultValue={DEFAULT_EFFORT} className={`${fieldClass} w-60 bg-surface`}>
            {EFFORTS.map((e) => (
              <option key={e} value={e}>
                {EFFORT_LABELS[e]} ({EFFORT_HINTS[e]})
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-accent" disabled={pending}>
          <ClipboardIcon size={15} className={pending ? "animate-pulse" : undefined} />
          {pending ? "Analyzing…" : "Analyze pages"}
        </button>
      </div>
      <label className="flex items-center gap-2.5 text-[13px] text-soft">
        <input type="checkbox" name="recheck" value="1" className="size-4 accent-accent-500" />
        Re-check pages Claude already cleared, even if nothing on them changed
      </label>
      {pending && <span className="text-xs text-muted">Claude is reviewing each page. This can take a minute.</span>}
      {state && !pending && (
        <span role="status" className={`text-[13px] ${state.ok ? "text-accent-300" : "text-danger"}`}>
          {state.message}
        </span>
      )}
    </form>
  );
}
