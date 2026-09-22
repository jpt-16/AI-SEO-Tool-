"use client";

import { useActionState } from "react";
import { generateBlueprints } from "@/app/(app)/actions";
import { ClipboardIcon } from "./icons";

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
            className="min-h-11 w-32 rounded-lg border border-line-strong bg-transparent px-3 text-[15px] text-ink tabular-nums focus:border-accent-500 focus:outline-none"
          />
        </label>
        <button type="submit" className="btn btn-accent" disabled={pending}>
          <ClipboardIcon size={15} className={pending ? "animate-pulse" : undefined} />
          {pending ? "Analyzing…" : "Analyze pages"}
        </button>
      </div>
      {pending && <span className="text-xs text-muted">Claude is reviewing each page. This can take a minute.</span>}
      {state && !pending && (
        <span role="status" className={`text-[13px] ${state.ok ? "text-accent-300" : "text-danger"}`}>
          {state.message}
        </span>
      )}
    </form>
  );
}
