"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { Monogram } from "./Monogram";

// Phone/tablet top bar; the menu reuses the sidebar's contents.
export function MobileNav({ clientName, children }: { clientName: string | null; children: ReactNode }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [pathname]);

  // No backdrop-filter on the header: it would become the containing block for the fixed menu panel.
  return (
    <header className="sticky top-0 z-30 flex h-15 items-center justify-between gap-3 bg-bg px-4 rule-bottom sm:px-6 lg:hidden">
      <Link href="/performance" className="flex min-w-0 items-center gap-3 text-ink no-underline">
        <Monogram height={26} id="jt-monogram-mobile" />
        <span className="flex min-w-0 flex-col">
          <span className="text-[10px] font-medium tracking-[0.24em] text-accent-500 uppercase">SEO workbench</span>
          {clientName && <span className="truncate text-[13px] text-soft">{clientName}</span>}
        </span>
      </Link>
      <details ref={menu} className="group">
        <summary
          aria-label="Menu"
          className="btn min-h-11 list-none px-3 [&::-webkit-details-marker]:hidden"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16" className="group-open:hidden" />
            <path d="M4 12h16" className="group-open:hidden" />
            <path d="M4 17h16" className="group-open:hidden" />
            <path d="m6 6 12 12M18 6 6 18" className="hidden group-open:block" />
          </svg>
        </summary>
        <nav
          aria-label="Main"
          className="fixed inset-x-0 top-15 bottom-0 flex flex-col gap-8 overflow-y-auto bg-bg px-4 pt-6 pb-8 sm:px-6"
        >
          {children}
        </nav>
      </details>
    </header>
  );
}
