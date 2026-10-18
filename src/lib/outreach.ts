import "server-only";
import { CRAWLER_USER_AGENT } from "./crawl";
import { BLUEPRINT_MODEL, addUsage, usageCost, type Usage } from "./blueprint-prompt";
import { describeAiError, geminiFromEnv, type GeminiClient } from "./gemini";
import {
  buildDraftPrompt,
  buildSearchPrompt,
  DRAFT_SYSTEM_PROMPT,
  extractFacts,
  isPublicHostname,
  mergeFacts,
  SEARCH_SYSTEM_PROMPT,
  usefulLinks,
  type CaptureSummary,
  type PageFacts,
  type ProspectInput,
  type ResearchBundle,
} from "./outreach-core";
import { formatToday, OnePagerOutput, sheetFromDraft, type OnePagerSheetData } from "./outreach-sheet";
import { db } from "./supabase";
import { captureSite, type VisualCapture } from "./visual";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_CHARS = 2_000_000;
const CAPTURE_BUDGET_MS = 90_000;

export type ProspectStatus = "queued" | "draft" | "sent" | "replied" | "passed";
export const PROSPECT_STATUSES: ProspectStatus[] = ["draft", "sent", "replied", "passed"];
export const STATUS_LABEL: Record<ProspectStatus, string> = { queued: "Queued", draft: "Draft", sent: "Sent", replied: "Replied", passed: "Passed" };
export type DraftState = "none" | "created" | "no_email" | "failed" | "skipped";

export interface Prospect {
  id: string;
  created_at: string;
  business_name: string;
  website: string;
  owner_name: string | null;
  city: string | null;
  notes: string | null;
  status: ProspectStatus;
  research: ResearchBundle | null;
  one_pager: OnePagerSheetData | null;
  message: string | null;
  subject: string | null;
  unverified: string[] | null;
  email: string | null;
  source: "manual" | "auto";
  search_id: string | null;
  attempts: number;
  draft_state: DraftState;
  gmail_draft_id: string | null;
  drafted_at: string | null;
  draft_error: string | null;
  skip_reason: string | null;
  model: string | null;
  cost_usd: number | null;
  researched_at: string | null;
  research_error: string | null;
}

const COLUMNS =
  "id, created_at, business_name, website, owner_name, city, notes, status, research, one_pager, message, subject, unverified, email, source, search_id, attempts, draft_state, gmail_draft_id, drafted_at, draft_error, skip_reason, model, cost_usd, researched_at, research_error";

export async function listProspects(): Promise<Prospect[]> {
  const { data, error } = await db().from("outreach_prospects").select(COLUMNS).order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  return data as Prospect[];
}

export async function getProspect(id: string): Promise<Prospect | null> {
  const { data, error } = await db().from("outreach_prospects").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as Prospect | null) ?? null;
}

async function getHtml(fetchImpl: typeof fetch, url: string): Promise<{ html: string; url: string }> {
  if (!isPublicHostname(new URL(url).hostname)) throw new Error("That address isn't a public website.");
  const res = await fetchImpl(url, {
    redirect: "follow",
    headers: { "User-Agent": CRAWLER_USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const finalUrl = res.url || url;
  if (!isPublicHostname(new URL(finalUrl).hostname)) throw new Error("That address redirects somewhere that isn't a public website.");
  if (!res.ok) throw new Error(`The site returned HTTP ${res.status}.`);
  const type = res.headers.get("content-type") ?? "";
  if (type && !/html|xml/i.test(type)) throw new Error(`The address isn't a web page (${type.split(";")[0]}).`);
  return { html: (await res.text()).slice(0, MAX_HTML_CHARS), url: finalUrl };
}

// The homepage plus its contact / about / services pages.
export async function readSite(website: string, fetchImpl: typeof fetch = fetch) {
  const home = await getHtml(fetchImpl, website);
  const pages: PageFacts[] = [extractFacts(home.html, home.url)];
  const others = await Promise.all(
    usefulLinks(home.html, home.url).map(async (link) => {
      try {
        const page = await getHtml(fetchImpl, link);
        return extractFacts(page.html, page.url);
      } catch {
        return null; // A broken secondary page doesn't spoil the homepage facts.
      }
    }),
  );
  pages.push(...others.filter((p): p is PageFacts => p !== null));
  return mergeFacts(pages);
}

function summarizeCapture(c: VisualCapture): CaptureSummary {
  const problems = c.score.checks
    .filter((check) => check.points < check.max * 0.7)
    .map((check) => `${check.label}: ${check.detail}`);
  const mobile = c.score.checks.find((check) => check.key === "mobile");
  return {
    score: c.score.score,
    failed: null,
    problems,
    fitsPhone: mobile ? mobile.points >= mobile.max : null,
    callToAction: c.metrics.aboveFold.cta ? c.metrics.aboveFold.ctaText : null,
  };
}

async function capture(url: string): Promise<CaptureSummary> {
  const [result] = await captureSite([url], 1, undefined, Date.now() + CAPTURE_BUDGET_MS);
  if (!result) return { score: null, failed: "ran out of time", problems: [], fitsPhone: null, callToAction: null };
  if ("error" in result) return { score: null, failed: result.error, problems: [], fitsPhone: null, callToAction: null };
  return summarizeCapture(result);
}

export interface ResearchOptions {
  // Ask Google Search about their listing and reviews.
  search?: boolean;
  // Check the homepage on a phone-sized screen (launches headless Chromium).
  capture?: boolean;
  client?: GeminiClient;
  fetchImpl?: typeof fetch;
}

export interface ResearchResult {
  ok: boolean;
  error?: string;
  usage: Usage;
}

// Reads the prospect's site, checks Google, drafts the sheet and saves everything. Reading,
// capturing and searching are best-effort and recorded as notes when they fail; only the
// final draft is required.
export async function researchProspect(id: string, options: ResearchOptions = {}): Promise<ResearchResult> {
  const result: ResearchResult = { ok: false, usage: usageCost(0, 0) };
  const prospect = await getProspect(id);
  if (!prospect) return { ...result, error: "That prospect no longer exists." };

  const input: ProspectInput = {
    businessName: prospect.business_name,
    website: prospect.website,
    ownerName: prospect.owner_name,
    city: prospect.city,
    notes: prospect.notes,
  };
  const research: ResearchBundle = { facts: null, factsError: null, capture: null, search: null, searchError: null };

  try {
    const client = options.client ?? geminiFromEnv();

    const [facts, shot, search] = await Promise.allSettled([
      readSite(prospect.website, options.fetchImpl),
      options.capture === false ? Promise.resolve(null) : capture(prospect.website),
      options.search === false
        ? Promise.resolve(null)
        : client.search({
            model: BLUEPRINT_MODEL,
            system: SEARCH_SYSTEM_PROMPT,
            prompt: buildSearchPrompt(input),
            thinkingLevel: "low",
            maxOutputTokens: 8000,
          }),
    ]);

    if (facts.status === "fulfilled") research.facts = facts.value;
    else research.factsError = describeAiError(facts.reason);
    if (shot.status === "fulfilled") research.capture = shot.value;
    else research.capture = { score: null, failed: describeAiError(shot.reason), problems: [], fitsPhone: null, callToAction: null };
    if (search.status === "fulfilled" && search.value) {
      research.search = { text: search.value.text, sources: search.value.sources };
      result.usage = addUsage(result.usage, usageCost(search.value.inputTokens, search.value.outputTokens));
    } else if (search.status === "rejected") {
      research.searchError = describeAiError(search.reason);
    }

    const draft = await client.generateJson({
      model: BLUEPRINT_MODEL,
      system: DRAFT_SYSTEM_PROMPT,
      prompt: buildDraftPrompt(input, research, formatToday()),
      schema: OnePagerOutput,
      thinkingLevel: "medium",
      maxOutputTokens: 16000,
    });
    result.usage = addUsage(result.usage, usageCost(draft.inputTokens, draft.outputTokens));

    // The notes say who the owner is; the model only fills the gap.
    const sheet = sheetFromDraft(draft.parsed);
    const { error } = await db()
      .from("outreach_prospects")
      .update({
        owner_name: prospect.owner_name ?? draft.parsed.owner_name,
        research,
        one_pager: sheet,
        message: draft.parsed.message,
        subject: draft.parsed.subject,
        unverified: draft.parsed.unverified,
        model: BLUEPRINT_MODEL,
        cost_usd: result.usage.costUsd,
        researched_at: new Date().toISOString(),
        research_error: null,
        // A redraft starts the email over: the old Gmail draft stays in Gmail.
        status: prospect.status === "queued" ? "draft" : prospect.status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw new Error(`Saving the draft failed: ${error.message}`);
    result.ok = true;
  } catch (err) {
    result.error = describeAiError(err);
    await db()
      .from("outreach_prospects")
      .update({ research, research_error: result.error, updated_at: new Date().toISOString() })
      .eq("id", id);
  }
  return result;
}
