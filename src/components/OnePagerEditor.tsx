"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { saveSheet, type ActionState } from "@/app/(app)/actions";
import { FREE_VALUE_ITEMS, OUTREACH, sheetToText, SOLUTION_ITEMS, type OnePagerSheetData } from "@/lib/outreach-sheet";
import { AlertIcon, BulbIcon, GiftIcon, SearchIcon } from "./icons";
import { Monogram } from "./Monogram";

function fit(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

// A text box that grows with its content, so nothing is cut off on screen or in print.
function AutoText({ value, onChange, label, className = "" }: { value: string; onChange: (v: string) => void; label: string; className?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (ref.current) fit(ref.current);
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`block w-full resize-none overflow-hidden rounded-md border-0 border-b border-line-strong bg-white/[0.04] px-3 py-2 text-[13px] leading-snug text-ink focus:bg-white/[0.07] focus:outline-none print:border-line print:py-1.5 print:text-[12px] ${className}`}
    />
  );
}

function Card({ n, title, icon, children, accent }: { n: string; title: string; icon: ReactNode; children: ReactNode; accent?: boolean }) {
  return (
    <section
      className={`break-inside-avoid rounded-xl border p-5 print:p-3.5 ${
        accent ? "border-accent-500 bg-gradient-to-br from-accent-900/70 to-accent-900/20" : "border-line-strong bg-white/[0.03]"
      }`}
    >
      <header className="mb-3.5 flex items-center justify-between print:mb-2.5">
        <h2 className="flex items-baseline gap-3 text-[22px] font-medium tracking-[-0.01em] text-ink print:text-[19px]">
          <span className="text-[11px] tracking-[0.2em] text-accent-300">{n}</span>
          {title}
        </h2>
        <span className="text-accent-300">{icon}</span>
      </header>
      {children}
    </section>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2.5 text-[13px] text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 shrink-0 accent-accent-500" />
      {label}
    </label>
  );
}

const copy = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

export function OnePagerEditor({
  prospectId,
  businessName,
  dateText,
  initialSheet,
  initialMessage,
}: {
  prospectId: string;
  businessName: string;
  dateText: string;
  initialSheet: OnePagerSheetData;
  initialMessage: string;
}) {
  const [sheet, setSheet] = useState(initialSheet);
  const [message, setMessage] = useState(initialMessage);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<ActionState | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Textarea heights depend on the width, which changes for print.
  useEffect(() => {
    const refit = () => document.querySelectorAll<HTMLTextAreaElement>(".print-sheet textarea").forEach(fit);
    window.addEventListener("beforeprint", refit);
    return () => window.removeEventListener("beforeprint", refit);
  }, []);

  const edit = (next: Partial<OnePagerSheetData>) => {
    setSheet((s) => ({ ...s, ...next }));
    setDirty(true);
    setStatus(null);
  };

  const save = async () => {
    setSaving(true);
    setStatus(await saveSheet(prospectId, sheet, message));
    setSaving(false);
    setDirty(false);
  };

  const flash = async (key: string, text: string) => {
    setCopied((await copy(text)) ? key : "failed");
    setTimeout(() => setCopied(null), 2200);
  };

  const row = (label: string, key: "google_listing" | "website_and_phone" | "reviews_and_local_search") => (
    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[150px_1fr] sm:items-start sm:gap-3 print:grid-cols-[150px_1fr]">
      <span className="pt-2 text-xs text-muted">{label}</span>
      <AutoText label={label} value={sheet[key]} onChange={(v) => edit({ [key]: v })} />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2" aria-label="Sheet actions">
        <button type="button" className="btn btn-accent min-h-10 px-4 text-[11.5px]" onClick={() => window.print()}>
          Print / save as PDF
        </button>
        <button type="button" className="btn min-h-10 px-4 text-[11.5px]" onClick={() => flash("sheet", sheetToText(sheet, businessName))}>
          {copied === "sheet" ? "Copied" : "Copy as text"}
        </button>
        <button type="button" className="btn min-h-10 px-4 text-[11.5px]" onClick={save} disabled={saving || !dirty}>
          {saving ? "Saving…" : dirty ? "Save edits" : "Saved"}
        </button>
        {status && (
          <span role="status" className={`text-[13px] ${status.ok ? "text-accent-300" : "text-danger"}`}>
            {status.message}
          </span>
        )}
        {copied === "failed" && <span className="text-[13px] text-danger">Couldn&apos;t copy</span>}
      </div>

      <article
        aria-label={`One-pager for ${businessName}`}
        className="print-sheet mx-auto flex w-full max-w-[820px] flex-col gap-4 rounded-2xl border border-line bg-bg px-5 py-6 sm:px-9 sm:py-8 print:min-h-[11in] print:w-[8.5in] print:max-w-none print:gap-2.5 print:rounded-none print:border-0 print:px-[0.6in] print:pt-[0.4in] print:pb-[0.3in]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-line pb-4 print:pb-3">
          <span className="flex items-center gap-3 text-ink">
            <Monogram height={22} id="sheet-monogram" />
            <span className="text-[17px] tracking-[-0.01em]">Builds Co.</span>
          </span>
          <span className="text-right text-[10px] tracking-[0.22em] text-muted uppercase">A quick look, made for you</span>
        </header>

        <div className="flex flex-col gap-2.5">
          <span className="text-[11px] tracking-[0.2em] text-accent-300 uppercase">Prepared for</span>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_170px_150px] print:grid-cols-[1fr_170px_150px]">
            <div className="flex flex-col gap-1.5">
              <span className="border-b border-line-strong bg-white/[0.04] px-3 py-2 text-[15px] text-ink">{businessName}</span>
              <span className="text-[9.5px] tracking-[0.2em] text-muted uppercase">Business name</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <input
                aria-label="Owner"
                value={sheet.owner_name ?? ""}
                onChange={(e) => edit({ owner_name: e.target.value || null })}
                className="border-0 border-b border-line-strong bg-white/[0.04] px-3 py-2 text-[15px] text-ink focus:bg-white/[0.07] focus:outline-none print:border-line print:py-1.5"
              />
              <span className="text-[9.5px] tracking-[0.2em] text-muted uppercase">Owner</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="border-b border-line-strong bg-white/[0.04] px-3 py-2 text-[15px] text-ink">{dateText}</span>
              <span className="text-[9.5px] tracking-[0.2em] text-muted uppercase">Date</span>
            </div>
          </div>
        </div>

        <Card n="01" title="Show Your Research" icon={<SearchIcon size={26} />}>
          <div className="flex flex-col gap-2.5 print:gap-1.5">
            {row("Google listing", "google_listing")}
            {row("Website & phone", "website_and_phone")}
            {row("Reviews & local search", "reviews_and_local_search")}
          </div>
        </Card>

        <Card n="02" title="Their Problem" icon={<AlertIcon size={26} />}>
          <p className="mb-2 text-xs text-muted">What this may mean for your customers</p>
          <AutoText label="What this may mean for your customers" value={sheet.problem} onChange={(v) => edit({ problem: v })} className="min-h-[5.5rem] rounded-lg border border-line-strong print:min-h-[3.25rem]" />
        </Card>

        <Card n="03" title="Your Solution" icon={<BulbIcon size={26} />}>
          <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3 print:mb-2 print:grid-cols-3 print:gap-y-1.5">
            {SOLUTION_ITEMS.map((item) => (
              <Check key={item.key} label={item.label} checked={sheet.solution[item.key]} onChange={(v) => edit({ solution: { ...sheet.solution, [item.key]: v } })} />
            ))}
          </div>
          <AutoText label="How this fits the business" value={sheet.solution_note} onChange={(v) => edit({ solution_note: v })} className="rounded-lg border border-line-strong" />
          <p className="mt-2.5 text-xs text-muted">{OUTREACH.price}</p>
        </Card>

        <Card n="04" title="Free Value" icon={<GiftIcon size={28} />} accent>
          <div className="mb-3 grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2 print:mb-2 print:grid-cols-2 print:gap-y-1.5">
            {FREE_VALUE_ITEMS.map((item) => (
              <Check key={item.key} label={item.label} checked={sheet.free_value[item.key]} onChange={(v) => edit({ free_value: { ...sheet.free_value, [item.key]: v } })} />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[150px_1fr] sm:items-start sm:gap-3 print:grid-cols-[150px_1fr]">
            <span className="pt-2 text-xs text-muted">Or something else</span>
            <AutoText label="Or something else" value={sheet.free_value_other ?? ""} onChange={(v) => edit({ free_value_other: v || null })} />
          </div>
          <div className="mt-3.5 border-t border-line-strong pt-3 text-[12.5px] print:mt-2.5 print:pt-2 leading-relaxed text-soft">
            <strong className="font-semibold text-ink">No strings.</strong> Reply to this message or call{" "}
            <strong className="font-semibold text-ink">{OUTREACH.phone}</strong>, or visit{" "}
            <strong className="font-semibold text-ink">{OUTREACH.contactUrl}</strong>. I reply personally within one business day.
            <span className="mt-1.5 block text-[10px] tracking-[0.18em] text-muted uppercase">
              {OUTREACH.sender} · {OUTREACH.role}
            </span>
          </div>
        </Card>

        <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-[10px] tracking-[0.16em] text-muted uppercase">
          <span>JT Builds Co. · {OUTREACH.location}</span>
          <span>{OUTREACH.site}</span>
          <span>{OUTREACH.handle}</span>
        </footer>
      </article>

      <section aria-label="Message to send with the sheet" className="panel flex flex-col gap-3 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-medium">Message to send with it</h2>
          <button type="button" className="btn min-h-10 px-4 text-[11.5px]" onClick={() => flash("message", message)}>
            {copied === "message" ? "Copied" : "Copy message"}
          </button>
        </div>
        <AutoText
          label="Message"
          value={message}
          onChange={(v) => {
            setMessage(v);
            setDirty(true);
            setStatus(null);
          }}
          className="min-h-28 rounded-lg border border-line-strong text-[14px]"
        />
        <p className="text-xs text-muted">Edit anything above or here, then Save. Check the list under &quot;Check before sending&quot; first.</p>
      </section>
    </div>
  );
}
