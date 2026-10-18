"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { saveSheet, type ActionState } from "@/app/(app)/actions";
import { composeEmail, FREE_VALUE_ITEMS, OUTREACH, SOLUTION_ITEMS, type OnePagerSheetData } from "@/lib/outreach-sheet";

const inputClass =
  "block w-full resize-none overflow-hidden rounded-lg border border-line-strong bg-transparent px-3 py-2 text-[14px] leading-snug text-ink focus:border-accent-500 focus:outline-none";

// A text box that grows with its content, so nothing is cut off.
function AutoText({ value, onChange, label, className = "" }: { value: string; onChange: (v: string) => void; label: string; className?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} rows={1} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} ${className}`} />;
}

function Part({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-5 first:border-t-0 first:pt-0">
      <h3 className="flex items-baseline gap-3 text-[17px] font-medium text-ink">
        <span className="text-[11px] tracking-[0.2em] text-accent-300">{n}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2.5 text-[13.5px] text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 shrink-0 accent-accent-500" />
      {label}
    </label>
  );
}

// The email, as the four parts of the one-pager: edit any part and the preview updates.
export function EmailEditor({
  prospectId,
  businessName,
  initialSheet,
  initialOpener,
  initialSubject,
  postalAddress,
}: {
  prospectId: string;
  businessName: string;
  initialSheet: OnePagerSheetData;
  initialOpener: string;
  initialSubject: string;
  postalAddress: string | null;
}) {
  const [sheet, setSheet] = useState(initialSheet);
  const [opener, setOpener] = useState(initialOpener);
  const [subject, setSubject] = useState(initialSubject);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<ActionState | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);

  const touch = () => {
    setDirty(true);
    setStatus(null);
  };
  const edit = (next: Partial<OnePagerSheetData>) => {
    setSheet((s) => ({ ...s, ...next }));
    touch();
  };

  const email = composeEmail({ business: businessName, subject, opener, sheet, postalAddress });

  const save = async () => {
    setSaving(true);
    setStatus(await saveSheet(prospectId, sheet, opener, subject));
    setSaving(false);
    setDirty(false);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${email.subject}\n\n${email.text}`);
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied(null), 2200);
  };

  const row = (label: string, key: "google_listing" | "website_and_phone" | "reviews_and_local_search") => (
    <Field label={label}>
      <AutoText label={label} value={sheet[key]} onChange={(v) => edit({ [key]: v })} />
    </Field>
  );

  return (
    <section aria-label="The email" className="panel flex flex-col gap-6 p-5 sm:p-7">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-medium">The email</h2>
          <p className="text-[13px] text-muted">Written in the four parts of your one-pager. Edit anything, then Save. Changes apply to the next Gmail draft you create.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn min-h-10 px-4 text-[11.5px]" onClick={copy}>
            {copied === "ok" ? "Copied" : copied === "failed" ? "Couldn't copy" : "Copy email"}
          </button>
          <button type="button" className="btn btn-accent min-h-10 px-4 text-[11.5px]" onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving…" : dirty ? "Save edits" : "Saved"}
          </button>
        </div>
      </header>
      {status && (
        <p role="status" className={`-mt-3 text-[13px] ${status.ok ? "text-accent-300" : "text-danger"}`}>
          {status.message}
        </p>
      )}

      <Field label="Subject">
        <input
          aria-label="Subject"
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
            touch();
          }}
          className={inputClass}
        />
      </Field>
      <Field label={`Opening (greeting "Hi ${sheet.owner_name?.trim().split(/\s+/)[0] ?? "there"}," is added before it)`}>
        <AutoText
          label="Opening"
          value={opener}
          onChange={(v) => {
            setOpener(v);
            touch();
          }}
        />
      </Field>
      <Field label="Owner's name">
        <input aria-label="Owner" value={sheet.owner_name ?? ""} onChange={(e) => edit({ owner_name: e.target.value || null })} className={`${inputClass} sm:max-w-xs`} />
      </Field>

      <Part n="01" title="Show your research">
        {row("Google listing", "google_listing")}
        {row("Website & phone", "website_and_phone")}
        {row("Reviews & local search", "reviews_and_local_search")}
      </Part>

      <Part n="02" title="Their problem">
        <AutoText label="What this may mean for your customers" value={sheet.problem} onChange={(v) => edit({ problem: v })} className="min-h-20" />
      </Part>

      <Part n="03" title="Your solution">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {SOLUTION_ITEMS.map((item) => (
            <Check key={item.key} label={item.label} checked={sheet.solution[item.key]} onChange={(v) => edit({ solution: { ...sheet.solution, [item.key]: v } })} />
          ))}
        </div>
        <AutoText label="How this fits the business" value={sheet.solution_note} onChange={(v) => edit({ solution_note: v })} />
        <p className="text-xs text-muted">{OUTREACH.price} (added automatically)</p>
      </Part>

      <Part n="04" title="Free value">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {FREE_VALUE_ITEMS.map((item) => (
            <Check key={item.key} label={item.label} checked={sheet.free_value[item.key]} onChange={(v) => edit({ free_value: { ...sheet.free_value, [item.key]: v } })} />
          ))}
        </div>
        <Field label="Or something else">
          <AutoText label="Or something else" value={sheet.free_value_other ?? ""} onChange={(v) => edit({ free_value_other: v || null })} />
        </Field>
      </Part>

      <section aria-label="Preview" className="flex flex-col gap-2 border-t border-line pt-5">
        <h3 className="text-[10.5px] tracking-[0.2em] text-muted uppercase">What goes into Gmail</h3>
        <p className="text-[13px] text-muted">
          Subject: <span className="text-ink">{email.subject}</span>
        </p>
        <pre className="rounded-lg border border-line bg-white/[0.03] p-4 font-sans text-[13.5px] leading-relaxed break-words whitespace-pre-wrap text-soft">{email.text}</pre>
      </section>
    </section>
  );
}
