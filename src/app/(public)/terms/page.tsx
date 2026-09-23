import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_UPDATED, OPERATOR } from "@/lib/legal";

export const metadata: Metadata = {
  title: `Terms of Service · ${OPERATOR.appName}`,
  description: `Terms for ${OPERATOR.appName}, the SEO tool ${OPERATOR.name} uses for its clients' websites.`,
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[19px] font-medium text-ink">{title}</h2>
      <div className="flex flex-col gap-3 text-[15px] leading-relaxed text-soft">{children}</div>
    </section>
  );
}

export default function Terms() {
  return (
    <article className="flex flex-col gap-9">
      <header className="flex flex-col gap-3">
        <span className="eyebrow">Last updated {LEGAL_UPDATED}</span>
        <h1 className="text-[32px] leading-[1.08] font-medium tracking-[-0.01em] sm:text-[42px]">Terms of Service</h1>
        <p className="text-[15px] leading-relaxed text-soft">
          These terms cover {OPERATOR.appName} (&quot;the tool&quot;), operated by {OPERATOR.name} (&quot;we&quot;, &quot;us&quot;).
          They apply alongside the terms of any engagement you have with us, which are at{" "}
          <a href={`${OPERATOR.website}/terms`}>{OPERATOR.website.replace("https://", "")}/terms</a>. Where the two differ,
          your engagement terms win.
        </p>
      </header>

      <Section title="What the tool is">
        <p>
          The tool is used by {OPERATOR.name} to audit and improve the websites of the businesses we work with. It reads
          search performance data from Google Search Console with the site owner&apos;s permission, checks the site&apos;s
          public pages, and suggests changes. Access is limited to {OPERATOR.name}.
        </p>
      </Section>

      <Section title="Your permission">
        <p>
          By giving our Google account access to your Search Console property, you confirm you&apos;re entitled to do so and
          allow the tool to read that property&apos;s data as described in the <Link href="/privacy">privacy policy</Link>. You
          can withdraw access at any time; the tool then stops receiving new data for your site.
        </p>
      </Section>

      <Section title="Recommendations and data">
        <p>
          Reports and recommendations come from Google&apos;s data, automated checks and an AI model. Google&apos;s data can
          be delayed, sampled or revised, and AI recommendations can be wrong, so we review them before acting on your site.
          We don&apos;t guarantee any ranking, traffic or result.
        </p>
      </Section>

      <Section title="Availability">
        <p>
          We aim to keep the tool running but don&apos;t promise it will always be available or error-free. It depends on
          services we don&apos;t control, including Google, Anthropic, Supabase and Vercel.
        </p>
      </Section>

      <Section title="Liability">
        <p>
          To the extent the law allows, the tool is provided &quot;as is&quot;, and we&apos;re not liable for indirect or
          consequential losses arising from its use. Nothing here limits liability that can&apos;t be limited by law.
        </p>
      </Section>

      <Section title="Governing law and changes">
        <p>
          These terms are governed by the laws of the Commonwealth of Massachusetts. If we change them, we&apos;ll update the
          date at the top.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>
        </p>
      </Section>
    </article>
  );
}
