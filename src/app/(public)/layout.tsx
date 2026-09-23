import Link from "next/link";
import { Monogram } from "@/components/Monogram";
import { LEGAL_UPDATED, OPERATOR } from "@/lib/legal";

// Public pages (no login): the homepage, privacy policy and terms. Google's OAuth
// verification needs all three reachable without signing in.
export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line py-5">
        <Link href="/" className="flex items-center gap-3 text-ink no-underline">
          <Monogram height={30} id="jt-monogram-public" />
          <span className="text-[11px] font-medium tracking-[0.24em] text-accent-500 uppercase">SEO Workbench</span>
        </Link>
        <Link href="/performance" className="btn min-h-10 px-4 text-[11.5px]">
          Sign in
        </Link>
      </header>
      <main className="flex flex-1 flex-col gap-8 py-10 sm:py-14">{children}</main>
      <footer className="flex flex-col gap-2 border-t border-line py-6 text-[13px] text-muted sm:flex-row sm:items-center sm:justify-between">
        <span>
          © 2026 {OPERATOR.name} · {OPERATOR.location}
        </span>
        <nav aria-label="Legal" className="flex gap-5">
          <Link href="/privacy">Privacy policy</Link>
          <Link href="/terms">Terms</Link>
          <a href={`mailto:${OPERATOR.email}`}>Contact</a>
        </nav>
        <span className="sr-only">Last updated {LEGAL_UPDATED}</span>
      </footer>
    </div>
  );
}
