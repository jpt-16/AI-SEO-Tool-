import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  BLUEPRINT_MODEL,
  BlueprintOutput,
  buildUserPrompt,
  selectPages,
  SYSTEM_PROMPT,
  type BlueprintResult,
  type PageSnapshot,
} from "./blueprint-prompt";
import { getOverview, getPageReport } from "./reports";
import { db } from "./supabase";

export const DEFAULT_MIN_IMPRESSIONS = 20;
const CONCURRENCY = 3;

export type BlueprintTrigger = "manual" | "cron" | "api" | "script";

export interface BlueprintRunOptions {
  minImpressions?: number;
  maxPages?: number;
  dryRun?: boolean;
  // Injected in tests; defaults to a client reading ANTHROPIC_API_KEY.
  client?: Pick<Anthropic, "messages">;
}

export interface PageOutcome {
  page_key: string;
  url: string;
  outcome: "blueprint" | "none" | "error" | "skipped";
  error?: string;
}

export interface BlueprintRunResult {
  ok: boolean;
  pagesConsidered: number;
  pagesAnalyzed: number;
  blueprintsCreated: number;
  outcomes: PageOutcome[];
  error?: string;
}

export async function analyzePage(
  client: Pick<Anthropic, "messages">,
  business: { name: string; domain: string },
  snapshot: PageSnapshot,
): Promise<BlueprintResult | null> {
  const response = await client.messages.parse({
    model: BLUEPRINT_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(business, snapshot) }],
    output_config: { format: zodOutputFormat(BlueprintOutput) },
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined to analyze this page.");
  if (response.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off (max_tokens).");
  if (!response.parsed_output) throw new Error("Claude's answer didn't match the blueprint format.");
  return response.parsed_output.blueprint;
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.";
  if (err instanceof Anthropic.RateLimitError) return "Anthropic rate limit hit. Try again in a minute.";
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status ?? ""}: ${err.message}`.trim();
  return err instanceof Error ? err.message : String(err);
}

async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function runBlueprints(
  siteId: string,
  trigger: BlueprintTrigger,
  options: BlueprintRunOptions = {},
): Promise<BlueprintRunResult> {
  const minImpressions = options.minImpressions ?? DEFAULT_MIN_IMPRESSIONS;
  const result: BlueprintRunResult = { ok: false, pagesConsidered: 0, pagesAnalyzed: 0, blueprintsCreated: 0, outcomes: [] };

  const { data: site, error: siteError } = await db().from("sites").select("id, name, domain").eq("id", siteId).maybeSingle();
  if (siteError) throw siteError;
  if (!site) return { ...result, error: "Site not found." };

  const overview = await getOverview(siteId);
  if (!overview) return { ...result, error: "No Search Console data yet. Run a sync first." };

  const { rows } = await getPageReport(siteId, { window: overview.window, search: "", limit: 1000, offset: 0 });
  let pages = selectPages(rows, minImpressions);
  result.pagesConsidered = pages.length;

  const { data: open, error: openError } = await db()
    .from("blueprints")
    .select("page_key")
    .eq("site_id", siteId)
    .eq("status", "open");
  if (openError) throw openError;
  const hasOpen = new Set(open.map((b) => b.page_key));
  for (const p of pages.filter((p) => hasOpen.has(p.pageKey))) {
    result.outcomes.push({ page_key: p.pageKey, url: p.url, outcome: "skipped", error: "Already has an open blueprint." });
  }
  pages = pages.filter((p) => !hasOpen.has(p.pageKey));
  if (options.maxPages !== undefined) pages = pages.slice(0, options.maxPages);

  if (options.dryRun) {
    result.ok = true;
    result.outcomes.push(...pages.map((p) => ({ page_key: p.pageKey, url: p.url, outcome: "none" as const })));
    return result;
  }

  const { data: run, error: runError } = await db()
    .from("blueprint_runs")
    .insert({ site_id: siteId, trigger, model: BLUEPRINT_MODEL, min_impressions: minImpressions, pages_considered: result.pagesConsidered })
    .select("id")
    .single();
  if (runError) throw runError;

  try {
    if (pages.length && !options.client && !process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY isn't set.");
    }
    const client = options.client ?? new Anthropic();

    const { data: crawlRows, error: crawlError } = await db()
      .from("crawl_pages")
      .select("page_key, h2")
      .eq("site_id", siteId)
      .in("page_key", pages.map((p) => p.pageKey));
    if (crawlError) throw crawlError;
    const h2ByKey = new Map(crawlRows.map((r) => [r.page_key as string, (r.h2 as string[]) ?? []]));

    const outcomes = await mapConcurrent(pages, CONCURRENCY, async (page): Promise<PageOutcome> => {
      const c = page.crawl!;
      const snapshot: PageSnapshot = {
        url: page.url,
        window: overview.window,
        title: c.title,
        metaDescription: c.metaDescription,
        h1: c.h1,
        h2: h2ByKey.get(page.pageKey) ?? [],
        wordCount: c.wordCount,
        schemaTypes: c.schemaTypes,
        clicks: page.clicks,
        impressions: page.impressions,
        position: page.position,
        topQueries: page.topQueries.map((q) => ({ ...q, ctr: q.impressions ? q.clicks / q.impressions : 0 })),
      };
      const base = { page_key: page.pageKey, url: page.url };
      try {
        const blueprint = await analyzePage(client, site, snapshot);
        if (!blueprint) return { ...base, outcome: "none" };
        const { error } = await db().from("blueprints").insert({
          site_id: siteId,
          page_key: page.pageKey,
          url: page.url,
          ...blueprint,
          page_snapshot: snapshot,
          model: BLUEPRINT_MODEL,
          run_id: run.id,
        });
        // 23505: another run opened a blueprint for this page meanwhile.
        if (error?.code === "23505") return { ...base, outcome: "skipped", error: "Already has an open blueprint." };
        if (error) throw new Error(`Saving blueprint failed: ${error.message}`);
        return { ...base, outcome: "blueprint" };
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError) throw err;
        return { ...base, outcome: "error", error: describeError(err) };
      }
    });

    result.outcomes.push(...outcomes);
    result.pagesAnalyzed = outcomes.filter((o) => o.outcome === "blueprint" || o.outcome === "none").length;
    result.blueprintsCreated = outcomes.filter((o) => o.outcome === "blueprint").length;
    const failed = outcomes.filter((o) => o.outcome === "error");
    result.ok = failed.length < outcomes.length || outcomes.length === 0;
    if (!result.ok) result.error = failed[0]?.error;
  } catch (err) {
    result.error = describeError(err);
  }

  await db()
    .from("blueprint_runs")
    .update({
      status: result.ok ? "succeeded" : "failed",
      pages_analyzed: result.pagesAnalyzed,
      blueprints_created: result.blueprintsCreated,
      results: result.outcomes,
      error: result.error ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", run.id);

  return result;
}

export type BlueprintStatus = "open" | "done" | "skipped";

export interface Blueprint {
  id: number;
  page_key: string;
  url: string;
  finding: string;
  reasoning: string;
  proposed_title: string | null;
  proposed_meta: string | null;
  priority: "high" | "med" | "low";
  status: BlueprintStatus;
  page_snapshot: PageSnapshot;
  model: string;
  created_at: string;
  status_changed_at: string | null;
}

const PRIORITY_ORDER = { high: 0, med: 1, low: 2 } as const;

export async function listBlueprints(siteId: string, status: BlueprintStatus): Promise<Blueprint[]> {
  const { data, error } = await db()
    .from("blueprints")
    .select("*")
    .eq("site_id", siteId)
    .eq("status", status)
    .order(status === "open" ? "created_at" : "status_changed_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  const rows = data as Blueprint[];
  return status === "open" ? rows.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]) : rows;
}

export async function countBlueprints(siteId: string): Promise<Record<BlueprintStatus, number>> {
  const counts = { open: 0, done: 0, skipped: 0 };
  await Promise.all(
    (Object.keys(counts) as BlueprintStatus[]).map(async (status) => {
      const { count, error } = await db()
        .from("blueprints")
        .select("id", { count: "exact", head: true })
        .eq("site_id", siteId)
        .eq("status", status);
      if (error) throw error;
      counts[status] = count ?? 0;
    }),
  );
  return counts;
}

export interface BlueprintRun {
  status: "running" | "succeeded" | "failed";
  min_impressions: number;
  pages_considered: number | null;
  pages_analyzed: number | null;
  blueprints_created: number | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export async function getLatestBlueprintRun(siteId: string): Promise<BlueprintRun | null> {
  const { data, error } = await db()
    .from("blueprint_runs")
    .select("status, min_impressions, pages_considered, pages_analyzed, blueprints_created, error, started_at, finished_at")
    .eq("site_id", siteId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}
