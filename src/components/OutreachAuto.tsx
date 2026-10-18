"use client";

import { useActionState, useTransition, useState } from "react";
import { addSearch, createDraftFor, redraftAll, runOutreachNow, type ActionState } from "@/app/(app)/actions";
import { MailIcon, RefreshIcon } from "./icons";

const fieldClass =
  "min-h-11 w-full rounded-lg border border-line-strong bg-transparent px-3 text-[15px] text-ink placeholder:text-muted focus:border-accent-500 focus:outline-none";
const labelClass = "text-[10.5px] tracking-[0.2em] text-muted uppercase";

function Status({ state, pending }: { state: ActionState | null; pending: boolean }) {
  if (!state || pending) return null;
  return (
    <span role="status" className={`text-[13px] ${state.ok ? "text-accent-300" : "text-danger"}`}>
      {state.message}
    </span>
  );
}

export function AddSearchForm() {
  const [state, action, pending] = useActionState<ActionState | null, FormData>(addSearch, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Trade</span>
          <input name="trade" required className={fieldClass} placeholder="plumbers" disabled={pending} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Town</span>
          <input name="town" required className={fieldClass} placeholder="Foxboro, MA" disabled={pending} />
        </label>
        <button type="submit" className="btn min-h-11" disabled={pending}>
          {pending ? "Saving…" : "Add search"}
        </button>
      </div>
      <Status state={state} pending={pending} />
    </form>
  );
}

// Runs the daily job now. It takes a few minutes: it finds businesses, then researches each one.
export function RunNowButton() {
  const [state, setState] = useState<ActionState | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-accent min-h-11"
          disabled={pending}
          onClick={() => {
            setState(null);
            start(async () => setState(await runOutreachNow()));
          }}
        >
          <RefreshIcon size={15} className={pending ? "animate-spin" : undefined} />
          {pending ? "Running…" : "Run now"}
        </button>
        {pending && <span className="text-xs text-muted">Finding businesses and drafting emails. This takes a few minutes; keep this page open.</span>}
      </div>
      <Status state={state} pending={pending} />
    </div>
  );
}

// For after switching the Gmail account: saves the drafts already made to the new account too.
export function RedraftAllButton({ count }: { count: number }) {
  const [state, setState] = useState<ActionState | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn min-h-11"
          disabled={pending}
          onClick={() => {
            setState(null);
            start(async () => setState(await redraftAll()));
          }}
        >
          <MailIcon size={15} className={pending ? "animate-pulse" : undefined} />
          {pending ? "Saving…" : `Save the ${count} existing draft${count === 1 ? "" : "s"} to Gmail again`}
        </button>
        <span className="text-xs text-muted">Use after changing the Gmail account. The drafts in the old account stay there; delete them yourself.</span>
      </div>
      <Status state={state} pending={pending} />
    </div>
  );
}

export function DraftToGmailForm({ id, defaultTo, created }: { id: string; defaultTo: string; created: boolean }) {
  const [state, action, pending] = useActionState<ActionState | null, FormData>(createDraftFor, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <label className="flex flex-col gap-1.5 sm:max-w-md">
        <span className={labelClass}>Send to</span>
        <input name="to" type="email" defaultValue={defaultTo} placeholder="owner@theirbusiness.com" className={fieldClass} disabled={pending} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn min-h-11" disabled={pending}>
          <MailIcon size={15} className={pending ? "animate-pulse" : undefined} />
          {pending ? "Creating…" : created ? "Create another Gmail draft" : "Create Gmail draft"}
        </button>
        <span className="text-xs text-muted">Saved as a draft in Gmail. Nothing is sent.</span>
        <Status state={state} pending={pending} />
      </div>
    </form>
  );
}
