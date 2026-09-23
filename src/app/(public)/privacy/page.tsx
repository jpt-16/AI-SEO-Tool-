import type { Metadata } from "next";
import { LEGAL_UPDATED, OPERATOR } from "@/lib/legal";

export const metadata: Metadata = {
  title: `Privacy Policy · ${OPERATOR.appName}`,
  description: `How ${OPERATOR.appName} collects, uses, stores and deletes data, including Google Search Console data.`,
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[19px] font-medium text-ink">{title}</h2>
      <div className="flex flex-col gap-3 text-[15px] leading-relaxed text-soft [&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPolicy() {
  const mail = <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>;
  return (
    <article className="flex flex-col gap-9">
      <header className="flex flex-col gap-3">
        <span className="eyebrow">Last updated {LEGAL_UPDATED}</span>
        <h1 className="text-[32px] leading-[1.08] font-medium tracking-[-0.01em] sm:text-[42px]">Privacy Policy</h1>
        <p className="text-[15px] leading-relaxed text-soft">
          {OPERATOR.name} (&quot;we&quot;, &quot;us&quot;), based in {OPERATOR.location}, operates the {OPERATOR.appName} (&quot;the
          tool&quot;). It&apos;s the internal tool we use to measure and improve the websites of the businesses we work with,
          and our own. This policy explains what the tool collects, how it&apos;s used, who processes it and how to have it
          deleted. Our website&apos;s own privacy policy is at{" "}
          <a href={`${OPERATOR.website}/privacy-policy`}>{OPERATOR.website.replace("https://", "")}/privacy-policy</a>.
        </p>
      </header>

      <Section title="Who uses the tool">
        <p>
          Only {OPERATOR.name} signs in to the tool. It isn&apos;t offered to the public, and clients don&apos;t need an account.
          A site is added only when its owner has asked us to work on it and has given our Google account access to its
          Google Search Console property.
        </p>
      </Section>

      <Section title="Information we collect">
        <p>
          <strong className="font-medium text-ink">From Google, with permission.</strong> When a Google account is connected,
          the tool asks Google for read-only access (the <code>webmasters.readonly</code> scope) plus the account&apos;s email
          address (<code>openid</code> and <code>email</code>). With that, it reads, for the Search Console properties the
          account can already see:
        </p>
        <ul>
          <li>
            Search performance: the searches a site appeared for, the pages shown, and the clicks, impressions, click-through
            rate and average position for each, by day, for roughly the last 90 days (daily totals for the last 180).
          </li>
          <li>The list of Search Console properties the account can access, so we can pick the right one for each client.</li>
          <li>The connected account&apos;s email address, shown in the tool so we know which account is connected.</li>
        </ul>
        <p>
          The tool can&apos;t change anything in Search Console, and it doesn&apos;t read Gmail, Drive or any other Google data.
        </p>
        <p>
          <strong className="font-medium text-ink">From public websites.</strong> The tool crawls the public pages of the
          sites we work on, the same way a search engine does: page titles, descriptions, headings, text length, links,
          structured data, <code>robots.txt</code> and <code>llms.txt</code>. It also takes a screenshot of the first screen
          of each page as it looks on a phone, and measures things like text size and contrast.
        </p>
        <p>
          <strong className="font-medium text-ink">From our own use.</strong> Notes on which recommendations we&apos;ve acted
          on and when, and the tool&apos;s run history (when data was synced or pages crawled, and any errors).
        </p>
        <p>
          The tool doesn&apos;t collect information about the people who visit our clients&apos; websites. Search Console reports
          search activity in aggregate and doesn&apos;t identify searchers.
        </p>
      </Section>

      <Section title="How we use it">
        <ul>
          <li>To report on how each site performs in Google Search, for us and for that site&apos;s owner.</li>
          <li>To find problems on a site&apos;s pages and recommend specific improvements.</li>
          <li>To measure whether a change made to a site improved its search performance.</li>
        </ul>
        <p>
          We don&apos;t sell this information, use it for advertising, or share it with anyone except the processors listed
          below and the owner of the site it describes. We don&apos;t use it to train AI models. Our staff look at a site&apos;s
          data only to do the work above, or when needed for security or to comply with the law.
        </p>
      </Section>

      <Section title="Google API Services User Data Policy">
        <p>
          {OPERATOR.appName}&apos;s use and transfer to any other app of information received from Google APIs will adhere to
          the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>,
          including the Limited Use requirements.
        </p>
      </Section>

      <Section title="Service providers that process the data">
        <ul>
          <li>
            <strong className="font-medium text-ink">Supabase</strong> stores the tool&apos;s database (United States).
          </li>
          <li>
            <strong className="font-medium text-ink">Vercel</strong> hosts and runs the tool (United States).
          </li>
          <li>
            <strong className="font-medium text-ink">Anthropic</strong> provides the AI model (Claude) behind recommendations.
            For each page we ask it to review, it receives the page&apos;s address, title, description, headings, word count
            and structured-data types, plus that page&apos;s top five Search Console searches with their clicks, impressions,
            click-through rate and position. Anthropic processes this to return the recommendation and, under its commercial
            terms, doesn&apos;t use it to train its models.
          </li>
          <li>
            <strong className="font-medium text-ink">Google</strong> is the source of the Search Console data and handles
            sign-in to the connected Google account.
          </li>
        </ul>
      </Section>

      <Section title="Cookies">
        <p>
          The tool sets two functional cookies and no others: one remembers which client site is selected in the dashboard,
          and one lasts ten minutes while connecting a Google account, to protect that step from forgery. There are no
          analytics, advertising or tracking cookies.
        </p>
      </Section>

      <Section title="Storage, security and retention">
        <p>
          All traffic is encrypted in transit. Google access tokens are encrypted (AES-256-GCM) before they&apos;re stored and
          are never sent to a browser. The database is closed to public access, and only the tool&apos;s server can read it.
          The tool itself is behind a sign-in.
        </p>
        <p>
          We keep a site&apos;s data while we&apos;re working on that site. When a Google account is disconnected in the tool,
          its access is revoked with Google and the stored token is deleted immediately. When we stop working on a site, or
          when its owner asks, we delete that site&apos;s data within 30 days.
        </p>
      </Section>

      <Section title="Your choices">
        <ul>
          <li>
            You can remove the tool&apos;s access to your Google account at any time at{" "}
            <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>, or remove our account
            from your Search Console property under Settings → Users and permissions.
          </li>
          <li>You can ask what data we hold about your site, or ask us to correct or delete it, by emailing {mail}.</li>
        </ul>
      </Section>

      <Section title="Children">
        <p>The tool is for businesses and isn&apos;t directed at children under 13. We don&apos;t knowingly collect their information.</p>
      </Section>

      <Section title="Changes">
        <p>
          If we change this policy, we&apos;ll update the date at the top. Material changes to how Google data is used will be
          communicated to the owners of the sites involved before they take effect.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          {OPERATOR.name}, {OPERATOR.location} · {mail}
        </p>
      </Section>
    </article>
  );
}
