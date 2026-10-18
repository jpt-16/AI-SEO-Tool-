"use client";

import { useActionState } from "react";
import { createProspect, researchAgain, type ActionState } from "@/app/(app)/actions";
import { MailIcon, RefreshIcon } from "./icons";

const fieldClass =
  "min-h-11 w-full rounded-lg border border-line-strong bg-transparent px-3 text-[15px] text-ink placeholder:text-muted focus:border-accent-500 focus:outline-none";
const labelClass = "text-[10.5px] tracking-[0.2em] text-muted uppercase";

function Options() {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-start gap-2.5 text-[13px] text-soft">
        <input type="checkbox" name="search" value="1" defaultChecked className="mt-0.5 size-4 accent-accent-500" />
        <span>
          Search Google for their listing and reviews
          <span className="block text-xs text-muted">Uses Gemini&apos;s web search, which Google may bill per search on top of the draft.</span>
        </span>
      </label>
      <label className="flex items-start gap-2.5 text-[13px] text-soft">
        <input type="checkbox" name="capture" value="1" defaultChecked className="mt-0.5 size-4 accent-accent-500" />
        <span>
          Check their homepage on a phone screen
          <span className="block text-xs text-muted">Takes about 20 seconds. Finds sideways scrolling, tiny text and a missing call button.</span>
        </span>
      </label>
    </div>
  );
}

export function OutreachForm() {
  const [state, action, pending] = useActionState<ActionState | null, FormData>(createProspect, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Business name</span>
          <input name="businessName" required className={fieldClass} placeholder="Smith & Sons Plumbing" disabled={pending} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Website</span>
          <input name="website" required inputMode="url" className={fieldClass} placeholder="smithandsonsplumbing.com" disabled={pending} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Town (helps find the right listing)</span>
          <input name="city" className={fieldClass} placeholder="Foxboro, MA" disabled={pending} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Owner, if you know</span>
          <input name="ownerName" className={fieldClass} placeholder="Optional" disabled={pending} />
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>What you already know</span>
        <textarea
          name="notes"
          rows={3}
          disabled={pending}
          className={`${fieldClass} py-2.5 leading-relaxed`}
          placeholder="Anything you've seen yourself: no Google listing, 3.9 stars from 12 reviews, phone number only in an image, how you heard of them…"
        />
        <span className="text-xs text-muted">Treated as true, and used over anything the research finds.</span>
      </label>
      <Options />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-accent" disabled={pending}>
          <MailIcon size={15} className={pending ? "animate-pulse" : undefined} />
          {pending ? "Researching…" : "Research and draft"}
        </button>
        {pending && <span className="text-xs text-muted">Reading their site, searching Google and writing the draft. This takes a minute or two.</span>}
        {state && !pending && (
          <span role="status" className={`text-[13px] ${state.ok ? "text-accent-300" : "text-danger"}`}>
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}

export function ResearchAgainForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionState | null, FormData>(researchAgain, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <Options />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn min-h-11" disabled={pending}>
          <RefreshIcon size={15} className={pending ? "animate-spin" : undefined} />
          {pending ? "Researching…" : "Research and redraft"}
        </button>
        <span className="text-xs text-muted">Replaces the sheet and message below, including your edits.</span>
        {state && !pending && (
          <span role="status" className={`text-[13px] ${state.ok ? "text-accent-300" : "text-danger"}`}>
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
