import "server-only";
import { BLUEPRINT_MODEL, addUsage, usageCost, type Usage } from "./blueprint-prompt";
import { checkGmailLogin, createGmailDraft, gmailStatus } from "./gmail";
import { describeAiError, geminiFromEnv, type GeminiClient } from "./gemini";
import {
  buildDiscoverySearchPrompt,
  DISCOVERY_EXTRACT_SYSTEM_PROMPT,
  DISCOVERY_SEARCH_SYSTEM_PROMPT,
  DiscoveryOutput,
  pickEmail,
  siteMatchesBusiness,
  toCandidates,
} from "./outreach-auto-core";
import { hostKey } from "./crawl";
import { composeEmail } from "./outreach-sheet";
import { getProspect, readSite, researchProspect, type DraftState } from "./outreach";
import { db } from "./supabase";

// How many businesses one run handles. Each gets its own function call (a minute or two each).
export const PER_RUN = Math.min(12, Math.max(1, Number(process.env.OUTREACH_PER_RUN) || 6));
const SEARCHES_PER_RUN = 3;
const MAX_ATTEMPTS = 2;
// The run itself stops at 300s; leave it a margin to record the result.
const RUN_DEADLINE_MS = 285_000;
const PROSPECT_TIMEOUT_MS = 250_000;

export interface OutreachSearch {
  id: string;
  created_at: string;
  trade: string;
  town: string;
  enabled: boolean;
  last_run_at: string | null;
}

export interface OutreachRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  trigger: "cron" | "manual";
  found: number;
  drafted: number;
  no_email: number;
  skipped: number;
  failed: number;
  cost_usd: number | null;
  error: string | null;
}

export async function listSearches(): Promise<OutreachSearch[]> {
  const { data, error } = await db().from("outreach_searches").select("*").order("created_at");
  if (error) throw error;
  return data as OutreachSearch[];
}

export async function listRuns(limit = 8): Promise<OutreachRun[]> {
  const { data, error } = await db().from("outreach_runs").select("*").order("started_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data as OutreachRun[];
}

// ---- Finding businesses ----

export async function discoverForSearch(
  search: OutreachSearch,
  count: number,
  client: GeminiClient = geminiFromEnv(),
): Promise<{ ids: string[]; usage: Usage; rejected: number }> {
  const { data: existing, error } = await db().from("outreach_prospects").select("business_name, website");
  if (error) throw error;
  const known = new Set((existing ?? []).map((p) => hostKey(p.website as string)));
  const names = (existing ?? []).map((p) => p.business_name as string);

  // Ask for a few extra: some won't have a usable website or will already be known.
  const found = await client.search({
    model: BLUEPRINT_MODEL,
    system: DISCOVERY_SEARCH_SYSTEM_PROMPT,
    prompt: buildDiscoverySearchPrompt(search.trade, search.town, count + 4, names),
    thinkingLevel: "low",
    maxOutputTokens: 8000,
  });
  let usage = usageCost(found.inputTokens, found.outputTokens);

  const extracted = await client.generateJson({
    model: BLUEPRINT_MODEL,
    system: DISCOVERY_EXTRACT_SYSTEM_PROMPT,
    prompt: found.text,
    schema: DiscoveryOutput,
    thinkingLevel: "low",
    maxOutputTokens: 8000,
  });
  usage = addUsage(usage, usageCost(extracted.inputTokens, extracted.outputTokens));

  const { accepted, rejected } = toCandidates(extracted.parsed.businesses, known);
  const chosen = accepted.slice(0, count);
  let ids: string[] = [];
  if (chosen.length) {
    const { data, error: insertError } = await db()
      .from("outreach_prospects")
      .insert(
        chosen.map((c) => ({ business_name: c.name, website: c.website, city: c.town ?? search.town, status: "queued", source: "auto", search_id: search.id })),
      )
      .select("id");
    if (insertError) throw new Error(`Saving prospects failed: ${insertError.message}`);
    ids = (data ?? []).map((r) => r.id as string);
  }
  await db().from("outreach_searches").update({ last_run_at: new Date().toISOString() }).eq("id", search.id);
  return { ids, usage, rejected: rejected.length + (accepted.length - chosen.length) };
}

// ---- One business ----

export interface Deps {
  readSite: typeof readSite;
  research: typeof researchProspect;
  createDraft: typeof createGmailDraft;
}
const defaultDeps: Deps = { readSite, research: researchProspect, createDraft: createGmailDraft };

export interface ProcessOutcome {
  state: "created" | "no_email" | "skipped" | "failed" | "retry";
  costUsd: number;
  reason?: string;
}

async function drop(id: string, state: DraftState, reason: string, costUsd = 0): Promise<ProcessOutcome> {
  await db()
    .from("outreach_prospects")
    .update({ status: "passed", draft_state: state, skip_reason: reason, updated_at: new Date().toISOString() })
    .eq("id", id);
  return { state: state === "none" ? "skipped" : (state as ProcessOutcome["state"]), costUsd, reason };
}

// Puts the prospect's email into Gmail as a draft: a short personal opening, then the one-pager's
// four sections written out as text. Never sends. `to` overrides the address found on their site.
export async function draftProspect(id: string, options: { to?: string; deps?: Pick<Deps, "createDraft"> } = {}): Promise<ProcessOutcome> {
  const deps = options.deps ?? defaultDeps;
  const prospect = await getProspect(id);
  if (!prospect) return { state: "failed", costUsd: 0, reason: "That prospect no longer exists." };
  if (!prospect.one_pager || prospect.message === null) return { state: "failed", costUsd: 0, reason: "There's no sheet to send yet." };

  const to = options.to?.trim() || prospect.email || pickEmail(prospect.research?.facts?.emails ?? [], prospect.website);
  if (!to) {
    await db().from("outreach_prospects").update({ draft_state: "no_email", draft_error: null, updated_at: new Date().toISOString() }).eq("id", id);
    return { state: "no_email", costUsd: 0, reason: "No email address found." };
  }

  try {
    const email = composeEmail({
      business: prospect.business_name,
      subject: prospect.subject,
      opener: prospect.message,
      sheet: prospect.one_pager,
      postalAddress: process.env.OUTREACH_POSTAL_ADDRESS,
    });
    const draft = await deps.createDraft({ to, subject: email.subject, text: email.text });
    await db()
      .from("outreach_prospects")
      .update({
        email: to,
        subject: email.subject,
        draft_state: "created",
        gmail_draft_id: draft.id,
        drafted_at: new Date().toISOString(),
        draft_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    return { state: "created", costUsd: 0 };
  } catch (err) {
    const reason = describeAiError(err);
    await db().from("outreach_prospects").update({ email: to, draft_state: "failed", draft_error: reason, updated_at: new Date().toISOString() }).eq("id", id);
    return { state: "failed", costUsd: 0, reason };
  }
}

// A queued business, start to finish: check the site is theirs and has an email address (cheap,
// before spending on the AI), research and draft the email, then create the Gmail draft.
export async function processProspect(id: string, deps: Deps = defaultDeps): Promise<ProcessOutcome> {
  const prospect = await getProspect(id);
  if (!prospect || prospect.status !== "queued") return { state: "skipped", costUsd: 0, reason: "Not queued." };
  const attempts = prospect.attempts + 1;
  await db().from("outreach_prospects").update({ attempts }).eq("id", id);

  let facts;
  try {
    facts = await deps.readSite(prospect.website);
  } catch (err) {
    return drop(id, "skipped", `Couldn't read their website: ${describeAiError(err)}`);
  }
  if (!siteMatchesBusiness(prospect.business_name, facts)) return drop(id, "skipped", "The website doesn't look like this business.");
  const email = pickEmail(facts.emails, prospect.website);
  if (!email) return drop(id, "no_email", "No email address on their website.");
  await db().from("outreach_prospects").update({ email }).eq("id", id);

  const research = await deps.research(id, { search: true, capture: true });
  if (!research.ok) {
    if (attempts >= MAX_ATTEMPTS) return drop(id, "failed", `Research failed: ${research.error}`, research.usage.costUsd);
    return { state: "retry", costUsd: research.usage.costUsd, reason: research.error };
  }
  const drafted = await draftProspect(id, { to: email, deps });
  return { ...drafted, costUsd: research.usage.costUsd };
}

// Saves every existing draft to Gmail again, for after the Gmail account was changed. The old
// drafts stay where they were: the tool never deletes mail.
export async function redraftExisting(deps: Pick<Deps, "createDraft"> = defaultDeps): Promise<{ created: number; failed: number; error?: string }> {
  const { data, error } = await db().from("outreach_prospects").select("id").eq("draft_state", "created").order("created_at");
  if (error) throw error;
  const result: { created: number; failed: number; error?: string } = { created: 0, failed: 0 };
  for (const { id } of (data ?? []) as { id: string }[]) {
    const outcome = await draftProspect(id, { deps });
    if (outcome.state === "created") result.created++;
    else {
      result.failed++;
      result.error = result.error ?? outcome.reason;
    }
  }
  return result;
}

// ---- The loop ----

export interface LoopOptions {
  trigger: "cron" | "manual";
  // Processes one queued prospect, in its own function call so each gets the full time limit.
  runOne: (id: string) => Promise<ProcessOutcome>;
  client?: GeminiClient;
}

export interface LoopResult {
  ok: boolean;
  error?: string;
  found: number;
  drafted: number;
  noEmail: number;
  skipped: number;
  failed: number;
  costUsd: number;
}

// One run: needs Gmail set up; tops the queue up from the saved searches; processes the
// queue. Safe to call repeatedly: finished businesses are never done twice.
export async function runOutreachLoop(options: LoopOptions): Promise<LoopResult> {
  const result: LoopResult = { ok: false, found: 0, drafted: 0, noEmail: 0, skipped: 0, failed: 0, costUsd: 0 };
  const { data: run, error: runError } = await db().from("outreach_runs").insert({ trigger: options.trigger }).select("id").single();
  if (runError) throw runError;

  let usage = usageCost(0, 0);
  try {
    // Before spending anything: is Gmail set up, and does the app password work?
    if (!gmailStatus().configured) throw new Error("Gmail isn't set up yet: add GMAIL_ADDRESS and GMAIL_APP_PASSWORD in Vercel.");
    await checkGmailLogin();

    const { data: queued, error } = await db()
      .from("outreach_prospects")
      .select("id")
      .eq("status", "queued")
      .order("created_at")
      .limit(PER_RUN);
    if (error) throw error;
    const ids = (queued ?? []).map((r) => r.id as string);

    if (ids.length < PER_RUN) {
      const { data: searches, error: searchError } = await db()
        .from("outreach_searches")
        .select("*")
        .eq("enabled", true)
        .order("last_run_at", { ascending: true, nullsFirst: true })
        .limit(SEARCHES_PER_RUN);
      if (searchError) throw searchError;
      const client = options.client ?? geminiFromEnv();
      const list = (searches ?? []) as OutreachSearch[];
      // Share the open places between the searches, so one trade doesn't take them all.
      const share = Math.ceil((PER_RUN - ids.length) / Math.max(1, list.length));
      for (const search of list) {
        const need = Math.min(share, PER_RUN - ids.length);
        if (need <= 0) break;
        try {
          const found = await discoverForSearch(search, need, client);
          ids.push(...found.ids);
          result.found += found.ids.length;
          usage = addUsage(usage, found.usage);
        } catch (err) {
          // One bad search shouldn't stop the others or the queue.
          result.error = `Finding ${search.trade} in ${search.town} failed: ${describeAiError(err)}`;
        }
      }
    }

    const outcomes = await Promise.allSettled(ids.map((id) => options.runOne(id)));
    for (const o of outcomes) {
      if (o.status === "rejected") {
        result.failed++;
        result.error = result.error ?? describeAiError(o.reason);
        continue;
      }
      result.costUsd += o.value.costUsd;
      if (o.value.state === "created") result.drafted++;
      else if (o.value.state === "no_email") result.noEmail++;
      else if (o.value.state === "skipped") result.skipped++;
      else if (o.value.state === "failed") result.failed++;
      // "retry" stays queued for the next run.
    }
    result.costUsd += usage.costUsd;
    result.ok = true;
  } catch (err) {
    result.error = describeAiError(err);
  }

  await db()
    .from("outreach_runs")
    .update({
      finished_at: new Date().toISOString(),
      found: result.found,
      drafted: result.drafted,
      no_email: result.noEmail,
      skipped: result.skipped,
      failed: result.failed,
      cost_usd: result.costUsd,
      error: result.error ?? null,
    })
    .eq("id", run.id);
  return result;
}

// Calls the per-prospect endpoint of this same deployment (see api/cron/outreach).
export function remoteRunner(origin: string, authorization: string): LoopOptions["runOne"] {
  const deadline = Date.now() + RUN_DEADLINE_MS;
  return async (id) => {
    const url = new URL("/api/cron/outreach", origin);
    url.searchParams.set("prospectId", id);
    const res = await fetch(url, { headers: { authorization }, cache: "no-store", signal: AbortSignal.timeout(Math.max(1_000, Math.min(PROSPECT_TIMEOUT_MS, deadline - Date.now()))) });
    const body = (await res.json().catch(() => ({}))) as { outcome?: ProcessOutcome; error?: string };
    if (!body.outcome) throw new Error(body.error ?? `HTTP ${res.status}`);
    return body.outcome;
  };
}
