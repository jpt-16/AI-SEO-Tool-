import type { AnswerItem, SiteAeo } from "@/lib/aeo";
import { formatDateTime } from "@/lib/format";
import type { PageRow } from "@/lib/reports";

type Crawl = NonNullable<PageRow["crawl"]>;

function scoreTone(score: number) {
  if (score >= 90) return "border-accent-700 text-accent-300";
  if (score >= 70) return "border-line-strong text-soft";
  return "border-danger-line text-danger";
}

function ScoreChip({ label, score, title }: { label: string; score: number | null; title: string }) {
  return (
    <span
      title={title}
      className={`tag gap-1.5 px-2.5 py-0.5 text-[11.5px] tabular-nums ${score === null ? "border-line text-muted" : scoreTone(score)}`}
    >
      <span className="tracking-[0.12em] uppercase">{label}</span>
      <span className="font-medium">{score ?? "—"}</span>
    </span>
  );
}

export function ScoreChips({ crawl }: { crawl: Crawl }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ScoreChip
        label="Visual"
        score={crawl.visual.score}
        title="Design and usability on a phone screen, from a headless-browser capture (0–100)."
      />
      <ScoreChip
        label="Answers"
        score={crawl.answers.score}
        title="How easily AI answer engines can quote this page: short, self-contained answers near each question (0–100)."
      />
    </div>
  );
}

const SOURCE: Record<AnswerItem["source"], string> = {
  lead: "Opening",
  heading: "Heading",
  details: "FAQ",
  definition: "FAQ",
  inline: "Q&A",
  schema: "Schema only",
};

function captureWarning(c: Crawl["visual"]["capture"]): string | null {
  if (c.status !== null && c.status >= 400) return `The page answered HTTP ${c.status} during capture.`;
  if (c.failedRequests) return `${c.failedRequests} request${c.failedRequests === 1 ? "" : "s"} failed while the page loaded.`;
  if (c.networkIdle === false) return "The page never stopped loading, so it was captured after a 30-second wait.";
  return null;
}

export function PageInsights({ pageKey, crawl }: { pageKey: string; crawl: Crawl }) {
  const { visual, answers } = crawl;
  const items = [...(answers.check?.items ?? [])].sort((a, b) => a.score - b.score);
  if (!visual.capturedAt && !answers.check) return null;
  return (
    <details className="group text-[13px]">
      <summary className="cursor-pointer list-none text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">Visual and answer details ▸</span>
        <span className="hidden group-open:inline">Hide details ▾</span>
      </summary>

      <div className="mt-4 flex flex-col gap-6">
        {visual.capturedAt && (
          <section aria-label="Visual score" className="flex flex-col gap-4 sm:flex-row sm:items-start">
            {visual.hasScreenshot && (
              // eslint-disable-next-line @next/next/no-img-element -- served by our own route, already sized
              <img
                src={`/api/screenshot?page=${encodeURIComponent(pageKey)}&v=${encodeURIComponent(visual.capturedAt)}`}
                alt="First screen of the page on a phone"
                width={390}
                height={844}
                loading="lazy"
                className="h-auto w-36 shrink-0 self-start rounded-md border border-line sm:w-40"
              />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-2.5">
              <p className="text-xs text-muted">
                Phone view, 390×844 · captured {formatDateTime(visual.capturedAt)}
              </p>
              {captureWarning(visual.capture) && (
                <p className="text-xs leading-relaxed text-danger">
                  {captureWarning(visual.capture)} The screenshot and score may show a partly loaded page; crawl again to
                  re-check.
                </p>
              )}
              {visual.error ? (
                <p className="text-danger">Capture failed: {visual.error}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {visual.checks.map((c) => (
                    <li key={c.key} className="flex flex-col gap-0.5">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="font-medium text-ink">{c.label}</span>
                        <span className={`shrink-0 tabular-nums ${c.points < c.max * 0.7 ? "text-danger" : "text-muted"}`}>
                          {c.points}/{c.max}
                        </span>
                      </span>
                      <span className="leading-relaxed text-soft">{c.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {answers.check && (
          <section aria-label="Answer extractability" className="flex flex-col gap-2.5">
            <p className="text-xs text-muted">
              {answers.check.questions
                ? `${answers.check.questions} questions found${answers.check.faqSchema ? " · FAQ schema" : ""} · weakest first`
                : "No question-and-answer sections; only the opening paragraph is scored."}
            </p>
            <ul className="flex flex-col divide-y divide-line">
              {items.map((item) => (
                <li key={`${item.source}:${item.question}`} className="flex flex-col gap-1 py-2.5">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 break-words text-ink">
                      <span className="mr-2 text-[10.5px] tracking-[0.14em] text-muted uppercase">{SOURCE[item.source]}</span>
                      {item.question}
                    </span>
                    <span className={`shrink-0 tabular-nums ${item.score < 70 ? "text-danger" : "text-muted"}`}>{item.score}</span>
                  </span>
                  <span className="leading-relaxed break-words text-soft">{item.answerStart || "(no answer text)"}</span>
                  {item.issues.length > 0 && <span className="text-xs leading-relaxed text-muted">{item.issues.join(" ")}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </details>
  );
}

const CRAWLER_TONE = {
  allowed: "border-line-strong text-soft",
  partial: "border-accent-700 text-accent-300",
  blocked: "border-danger-line text-danger",
};

export function SiteAeoSummary({ aeo }: { aeo: SiteAeo }) {
  const llms = aeo.llmsTxt;
  return (
    <div className="flex flex-col gap-2.5 text-[13px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="mr-1 text-[10.5px] tracking-[0.2em] text-muted uppercase">AI crawlers</span>
        {aeo.aiCrawlers.map((c) => (
          <span
            key={c.agent}
            className={`tag px-2 py-0 text-[11.5px] ${CRAWLER_TONE[c.status]}`}
            title={
              c.status === "allowed"
                ? `${c.agent} can crawl every page${c.namedGroup ? " (named in robots.txt)" : ""}.`
                : `${c.agent} is blocked from ${c.status === "blocked" ? "the whole site" : `${c.blockedPages.length} pages`} by robots.txt.`
            }
          >
            {c.agent} · {c.status === "allowed" ? "allowed" : c.status === "blocked" ? "blocked" : `${c.blockedPages.length} pages blocked`}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="mr-1 text-[10.5px] tracking-[0.2em] text-muted uppercase">llms.txt</span>
        {llms.present ? (
          <span className="text-soft">
            <a href={llms.url} target="_blank" rel="noreferrer">
              Present
            </a>{" "}
            · {llms.links} links · {llms.sections} sections{llms.fullVersion ? " · llms-full.txt too" : ""}
            {llms.issues.length > 0 && <span className="text-danger"> · {llms.issues.join(" ")}</span>}
          </span>
        ) : (
          <span className="text-danger">{llms.issues.join(" ")}</span>
        )}
      </div>
    </div>
  );
}
