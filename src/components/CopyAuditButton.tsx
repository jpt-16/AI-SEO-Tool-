"use client";

import { useState } from "react";

// Copies the audit brief so it can be pasted straight into Claude Code.
export function CopyAuditButton() {
  const [state, setState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const copy = async () => {
    setState("copying");
    try {
      const res = await fetch("/api/audit/export?inline=1", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await navigator.clipboard.writeText(await res.text());
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2500);
  };
  const label = { idle: "Copy for Claude Code", copying: "Copying…", copied: "Copied", failed: "Couldn't copy" }[state];
  return (
    <button type="button" onClick={copy} className="btn min-h-10 px-4 text-[11.5px]" disabled={state === "copying"} aria-live="polite">
      {label}
    </button>
  );
}
