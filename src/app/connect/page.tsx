import Link from "next/link";
import { LockIcon } from "@/components/icons";
import { Monogram } from "@/components/Monogram";
import { getConnection } from "@/lib/google";

const STEPS = [
  {
    title: "Sign in with Google",
    body: "Use the account that already has access to the client’s Search Console property.",
  },
  {
    title: "Approve read-only access",
    body: "The tool asks to read Search Console and see your email address. It can’t change anything in Search Console.",
    scope: "webmasters.readonly",
  },
  {
    title: "Pick the property and run the first sync",
    body: "Choose cloverdownsdetailing.com from the properties your account can see.",
  },
];

export default async function ConnectPage({ searchParams }: PageProps<"/connect">) {
  const { error } = await searchParams;
  const connection = await getConnection().catch(() => null);

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      <section className="relative flex flex-col justify-between gap-12 overflow-hidden px-5 py-10 max-lg:rule-bottom sm:px-8 sm:py-12 lg:gap-16 lg:px-19 lg:py-16 lg:rule-right">
        <svg
          aria-hidden="true"
          viewBox="0 0 720 900"
          preserveAspectRatio="xMidYMid slice"
          fill="none"
          stroke="currentColor"
          className="pointer-events-none absolute inset-0 h-full w-full text-accent-500 opacity-16"
        >
          <path d="M-40 760 L720 0" />
          <path d="M-40 840 L720 80" />
          <path d="M-40 920 L720 160" />
          <circle cx="560" cy="640" r="180" />
          <circle cx="560" cy="640" r="260" />
        </svg>
        <div className="relative flex items-center gap-4">
          <Monogram height={46} id="jt-monogram-connect" />
          <span className="text-[13px] font-medium tracking-[0.5em]">BUILDS CO.</span>
        </div>
        <div className="relative flex max-w-[540px] flex-col gap-5.5">
          <span className="eyebrow tracking-[0.3em]">SEO workbench</span>
          <h1 className="text-[clamp(32px,4.2vw,56px)] leading-[1.06] font-medium tracking-[-0.01em] text-pretty">
            Audit every client site from the data Google already has.
          </h1>
          <p className="text-[16.5px] leading-[1.75] text-muted">
            Connect the Google account that manages your clients’ Search Console properties. Queries, pages, clicks,
            impressions, CTR and position are pulled for the last 90 days and stored in your own database.
          </p>
        </div>
        <div className="relative flex flex-col gap-2">
          <span className="eyebrow text-muted">First client</span>
          <span className="text-[15px] font-medium">Clover Downs Detailing — cloverdownsdetailing.com</span>
        </div>
      </section>

      <section className="flex flex-col justify-center gap-8 px-5 py-10 sm:gap-9 sm:px-8 sm:py-12 lg:px-23 lg:py-16">
        <div className="flex flex-col gap-3">
          <span className="eyebrow">Step 1 of 2</span>
          <h2 className="text-[28px] leading-tight font-medium tracking-[-0.01em] sm:text-[34px]">Connect Google Search Console</h2>
        </div>

        {typeof error === "string" && (
          <p role="alert" className="rounded-lg border border-danger-line px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}
        {connection && (
          <p className="rounded-lg border border-accent-700 px-4 py-3 text-sm text-accent-200">
            Already connected{connection.google_email ? ` as ${connection.google_email}` : ""}.{" "}
            <Link href="/performance" className="text-accent-400 underline underline-offset-4">
              Go to search performance
            </Link>
          </p>
        )}

        <ol className="panel flex flex-col overflow-hidden">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-4 border-line px-5 py-5 sm:gap-5 sm:px-6 sm:py-5.5 [&+&]:border-t">
              <span className="w-8 shrink-0 text-[22px] leading-none font-medium text-accent-500">0{i + 1}</span>
              <div className="flex flex-col gap-1.5">
                <span className="font-medium">{step.title}</span>
                <span className="text-sm leading-relaxed text-muted">{step.body}</span>
                {step.scope && (
                  <code className="mt-0.5 self-start rounded border border-line-strong px-2 py-0.5 font-mono text-xs text-soft">
                    {step.scope}
                  </code>
                )}
              </div>
            </li>
          ))}
        </ol>

        <div className="flex flex-col gap-4">
          <a href="/api/auth/google/start" className="btn btn-accent min-h-[54px] text-[12.5px]">
            <LockIcon size={16} />
            {connection ? "Reconnect with Google" : "Continue with Google"}
          </a>
          <span className="text-center text-[13px] leading-relaxed text-muted">
            Your refresh token is encrypted, stays server-side and never reaches the browser. Disconnect any time from
            Connections.
          </span>
        </div>
      </section>
    </div>
  );
}
