"use client";

import { useActionState } from "react";
import { runCrawl, runSync, type ActionState } from "@/app/(app)/actions";
import { RefreshIcon, SearchIcon } from "./icons";

const ACTIONS = {
  sync: { run: runSync, Icon: RefreshIcon, pending: "Syncing…" },
  crawl: { run: runCrawl, Icon: SearchIcon, pending: "Crawling…" },
} satisfies Record<string, { run: (prev: ActionState | null, data: FormData) => Promise<ActionState>; Icon: unknown; pending: string }>;

export function ActionButton({
  kind,
  siteId,
  label,
  disabled,
  accent = true,
}: {
  kind: keyof typeof ACTIONS;
  siteId: string;
  label: string;
  disabled?: boolean;
  accent?: boolean;
}) {
  const { run, Icon, pending: pendingLabel } = ACTIONS[kind];
  const [state, action, pending] = useActionState(run, null);
  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="siteId" value={siteId} />
      {state && (
        <span role="status" className={`text-xs ${state.ok ? "text-accent-300" : "text-danger"}`}>
          {state.message}
        </span>
      )}
      <button type="submit" className={`btn ${accent ? "btn-accent" : ""}`} disabled={pending || disabled}>
        <Icon size={14} className={pending && kind === "sync" ? "animate-spin" : pending ? "animate-pulse" : undefined} />
        {pending ? pendingLabel : label}
      </button>
    </form>
  );
}
