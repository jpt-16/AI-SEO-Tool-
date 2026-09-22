"use client";

import { useActionState } from "react";
import { runSync } from "@/app/(app)/actions";
import { RefreshIcon } from "./icons";

export function SyncButton({ siteId, label = "Sync now", disabled }: { siteId: string; label?: string; disabled?: boolean }) {
  const [state, action, pending] = useActionState(runSync, null);
  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="siteId" value={siteId} />
      {state && (
        <span role="status" className={`text-xs ${state.ok ? "text-accent-300" : "text-danger"}`}>
          {state.message}
        </span>
      )}
      <button type="submit" className="btn btn-accent" disabled={pending || disabled}>
        <RefreshIcon size={14} className={pending ? "animate-spin" : undefined} />
        {pending ? "Syncing…" : label}
      </button>
    </form>
  );
}
