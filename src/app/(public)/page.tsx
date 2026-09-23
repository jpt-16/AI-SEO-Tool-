import type { Metadata } from "next";
import Link from "next/link";
import { OPERATOR } from "@/lib/legal";

export const metadata: Metadata = {
  title: `${OPERATOR.appName} · ${OPERATOR.name}`,
  description: "The SEO tool JT Builds Co. uses to measure and improve its clients' websites in Google Search.",
};

const FEATURES = [
  {
    title: "Search performance",
    body: "Reads Google Search Console (read-only) for the sites we manage: which searches show each page, how often, where it ranks and how many people click.",
  },
  {
    title: "Page checks",
    body: "Crawls each site's public pages to check titles, descriptions, headings, structured data, how the page looks and works on a phone, and whether AI answer engines can read and quote it.",
  },
  {
    title: "Recommendations and results",
    body: "Suggests specific title and description changes where search data shows a mismatch, then compares the numbers before and after each change is made.",
  },
];

export default function Home() {
  return (
    <>
      <section className="flex flex-col gap-4">
        <span className="eyebrow">{OPERATOR.name}</span>
        <h1 className="text-[34px] leading-[1.06] font-medium tracking-[-0.01em] sm:text-[48px]">{OPERATOR.appName}</h1>
        <p className="max-w-2xl text-[16px] leading-relaxed text-soft">
          The internal tool {OPERATOR.name} uses to audit and improve the websites of the small businesses it works with,
          including its own. It isn&apos;t open to the public: only {OPERATOR.name} signs in, and it connects to Google Search
          Console only for sites whose owners have given us access.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link href="/performance" className="btn btn-accent">
            Open the dashboard
          </Link>
          <a href={OPERATOR.website} className="btn">
            About {OPERATOR.name}
          </a>
        </div>
      </section>

      <section aria-label="What it does" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="panel flex flex-col gap-2 p-5">
            <h2 className="text-[15px] font-medium">{f.title}</h2>
            <p className="text-[14px] leading-relaxed text-muted">{f.body}</p>
          </div>
        ))}
      </section>

      <section className="panel flex flex-col gap-2 p-5 text-[14px] leading-relaxed text-soft sm:p-6">
        <h2 className="text-[15px] font-medium text-ink">Your Google data</h2>
        <p>
          With your permission, the tool reads Search Console data for your site through Google&apos;s read-only access. We use
          it only to report on and improve your site, never sell it or use it for advertising, and you can disconnect at any
          time. The <Link href="/privacy">privacy policy</Link> explains exactly what we collect, where it goes and how to have
          it deleted.
        </p>
      </section>
    </>
  );
}
