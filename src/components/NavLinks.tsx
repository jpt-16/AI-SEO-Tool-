"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartIcon, LinkIcon, SearchIcon } from "./icons";

const LINKS = [
  { href: "/performance", label: "Search performance", Icon: ChartIcon },
  { href: "/connections", label: "Connections", Icon: LinkIcon },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <div className="flex flex-col gap-0.5">
      {LINKS.map(({ href, label, Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm no-underline transition-colors ${
              active ? "bg-accent-500/12 font-medium text-ink" : "text-subtle hover:text-ink"
            }`}
          >
            <Icon className={active ? "text-accent-500" : undefined} />
            {label}
          </Link>
        );
      })}
      <span className="flex min-h-11 items-center gap-3 px-3 text-sm text-muted" aria-disabled="true">
        <SearchIcon />
        Site audit
        <span className="ml-auto text-[10.5px] tracking-[0.16em]">SOON</span>
      </span>
    </div>
  );
}
