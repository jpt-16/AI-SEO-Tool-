"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ISSUE_TYPES } from "@/lib/audit";
import { markBlueprintDone } from "@/lib/attribution";
import { DEFAULT_MIN_IMPRESSIONS, runBlueprints } from "@/lib/blueprints";
import { isEffort } from "@/lib/effort";
import { runSiteCrawl } from "@/lib/crawl-run";
import { decryptSecret } from "@/lib/crypto";
import { requireEnv } from "@/lib/env";
import { isPublicHostname, normalizeWebsite } from "@/lib/outreach-core";
import { OnePagerSheet } from "@/lib/outreach-sheet";
import { PROSPECT_STATUSES, researchProspect } from "@/lib/outreach";
import { describeGoogleError, getConnection, gscRequester, oauthClient } from "@/lib/google";
import { listSites as listGscProperties } from "@/lib/gsc";
import { SITE_COOKIE } from "@/lib/sites";
import { db } from "@/lib/supabase";
import { syncSite } from "@/lib/sync";

export interface ActionState {
  ok: boolean;
  message: string;
}

export async function selectSite(formData: FormData) {
  const siteId = String(formData.get("siteId") ?? "");
  (await cookies()).set(SITE_COOKIE, siteId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}

export async function saveProperty(_prev: ActionState | null, formData: FormData): Promise<ActionState> {
  const siteId = String(formData.get("siteId") ?? "");
  const property = String(formData.get("property") ?? "");
  const request = await gscRequester();
  if (!request) return { ok: false, message: "Connect Google first." };
  try {
    const properties = await listGscProperties(request);
    if (!properties.some((p) => p.siteUrl === property)) {
      return { ok: false, message: "That property isn't available to the connected Google account." };
    }
  } catch (err) {
    return { ok: false, message: describeGoogleError(err) };
  }
  const { error } = await db().from("sites").update({ gsc_property: property }).eq("id", siteId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true, message: "Property saved." };
}

export async function setSyncEnabled(formData: FormData) {
  const siteId = String(formData.get("siteId") ?? "");
  const enabled = formData.get("enabled") === "true";
  const { error } = await db().from("sites").update({ sync_enabled: enabled }).eq("id", siteId);
  if (error) throw error;
  revalidatePath("/connections");
}

export async function runSync(_prev: ActionState | null, formData: FormData): Promise<ActionState> {
  const result = await syncSite(String(formData.get("siteId") ?? ""), "manual");
  revalidatePath("/", "layout");
  const results = result.blueprintResults ? ` Recorded results for ${result.blueprintResults} blueprints.` : "";
  return result.ok
    ? { ok: true, message: `Synced ${result.rowsFetched.toLocaleString("en-US")} rows.${results}` }
    : { ok: false, message: result.error ?? "Sync failed." };
}

export async function runCrawl(_prev: ActionState | null, formData: FormData): Promise<ActionState> {
  const result = await runSiteCrawl(String(formData.get("siteId") ?? ""), "manual");
  revalidatePath("/", "layout");
  if (!result.ok) return { ok: false, message: result.error ?? "Crawl failed." };
  const failed = result.pagesFailed ? `, ${result.pagesFailed} failed` : "";
  const visual = result.visualError
    ? ` ${result.visualError}`
    : result.visualPages !== undefined
      ? ` Visual scores for ${result.visualPages} pages.`
      : "";
  return { ok: true, message: `Crawled ${result.pagesCrawled} pages${failed}.${visual}` };
}

export async function generateBlueprints(_prev: ActionState | null, formData: FormData): Promise<ActionState> {
  const minImpressions = Math.max(0, Math.floor(Number(formData.get("minImpressions") ?? DEFAULT_MIN_IMPRESSIONS)));
  if (!Number.isFinite(minImpressions)) return { ok: false, message: "Minimum impressions must be a number." };
  const effort = String(formData.get("effort") ?? "");
  const result = await runBlueprints(String(formData.get("siteId") ?? ""), "manual", {
    minImpressions,
    maxPages: 10,
    effort: isEffort(effort) ? effort : undefined,
    recheck: formData.get("recheck") === "1",
  });
  revalidatePath("/blueprints");
  if (!result.ok) return { ok: false, message: result.error ?? "Analysis failed." };
  if (result.pagesConsidered === 0) return { ok: true, message: result.note ?? "No pages qualify." };
  const skipped = result.outcomes.filter((o) => o.outcome === "skipped").length;
  const errors = result.outcomes.filter((o) => o.outcome === "error").length;
  const parts = [`Analyzed ${result.pagesAnalyzed} pages`, `${result.blueprintsCreated} new blueprints`];
  if (result.pagesReused) parts.push(`${result.pagesReused} unchanged, not re-checked`);
  if (skipped) parts.push(`${skipped} already open`);
  if (errors) parts.push(`${errors} failed`);
  parts.push(`cost $${result.usage.costUsd.toFixed(2)}`);
  return { ok: true, message: `${parts.join(" · ")}.` };
}

const BLUEPRINT_STATUSES = ["open", "done", "skipped"] as const;

export async function setBlueprintStatus(formData: FormData) {
  const id = Number(formData.get("id"));
  const status = String(formData.get("status"));
  if (!Number.isInteger(id) || !BLUEPRINT_STATUSES.includes(status as (typeof BLUEPRINT_STATUSES)[number])) {
    throw new Error("Invalid blueprint update.");
  }
  if (status === "done") {
    await markBlueprintDone(id);
  } else {
    // Leaving "done" discards the measurement; marking it done again starts a new one.
    const { error } = await db()
      .from("blueprints")
      .update({
        status,
        status_changed_at: status === "open" ? null : new Date().toISOString(),
        done_at: null,
        baseline_snapshot: null,
        result_snapshot: null,
        result_diff: null,
        result_at: null,
      })
      .eq("id", id);
    // Reopening fails if the page got a new open blueprint since; leave it as is.
    if (error && error.code !== "23505") throw error;
  }
  revalidatePath("/blueprints");
  revalidatePath("/results");
}

export async function disconnectGoogle() {
  const connection = await getConnection();
  if (connection) {
    try {
      const token = decryptSecret(connection.refresh_token_encrypted, requireEnv("TOKEN_ENCRYPTION_KEY"));
      await oauthClient().revokeToken(token);
    } catch {
      // Already revoked or expired on Google's side; removing our copy is what matters.
    }
    const { error } = await db().from("google_connection").delete().eq("id", true);
    if (error) throw error;
  }
  redirect("/connect");
}

export async function setAuditIssue(formData: FormData) {
  const siteId = String(formData.get("siteId") ?? "");
  const pageKey = String(formData.get("pageKey") ?? "");
  const issue = String(formData.get("issue") ?? "");
  // "fixed": hidden until a newer crawl still finds it. "ignored": not an issue, stays hidden.
  // "open": reopen.
  const mode = String(formData.get("mode") ?? "");
  if (!siteId || !(issue in ISSUE_TYPES) || !["fixed", "ignored", "open"].includes(mode)) throw new Error("Invalid audit update.");
  const match = db().from("audit_fixes");
  const { error } =
    mode === "open"
      ? await match.delete().eq("site_id", siteId).eq("page_key", pageKey).eq("issue", issue)
      : await match.upsert(
          { site_id: siteId, page_key: pageKey, issue, kind: mode, fixed_at: new Date().toISOString() },
          { onConflict: "site_id,page_key,issue" },
        );
  if (error) throw error;
  revalidatePath("/audit");
}

// ---- Outreach ----

const clean = (value: FormDataEntryValue | null) => String(value ?? "").trim() || null;

// Adds a prospect, researches them and drafts the sheet (this can take a minute or two).
export async function createProspect(_prev: ActionState | null, formData: FormData): Promise<ActionState> {
  const businessName = clean(formData.get("businessName"));
  if (!businessName) return { ok: false, message: "Enter the business name." };
  const website = normalizeWebsite(String(formData.get("website") ?? ""));
  if (!website) return { ok: false, message: "Enter their website, like example.com." };
  if (!isPublicHostname(new URL(website).hostname)) return { ok: false, message: "That isn't a public website address." };

  const { data, error } = await db()
    .from("outreach_prospects")
    .insert({
      business_name: businessName,
      website,
      owner_name: clean(formData.get("ownerName")),
      city: clean(formData.get("city")),
      notes: clean(formData.get("notes")),
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };

  await researchProspect(data.id, {
    search: formData.get("search") === "1",
    capture: formData.get("capture") === "1",
  });
  revalidatePath("/outreach");
  // A failed draft is shown on the prospect's page, with a button to try again.
  redirect(`/outreach/${data.id}`);
}

export async function researchAgain(_prev: ActionState | null, formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  const result = await researchProspect(id, { search: formData.get("search") === "1", capture: formData.get("capture") === "1" });
  revalidatePath(`/outreach/${id}`);
  revalidatePath("/outreach");
  if (!result.ok) return { ok: false, message: result.error ?? "Research failed." };
  return { ok: true, message: `Redrafted · cost $${result.usage.costUsd.toFixed(3)} (not counting Google Search fees).` };
}

export async function saveSheet(id: string, sheet: unknown, message: string): Promise<ActionState> {
  const parsed = OnePagerSheet.safeParse(sheet);
  if (!parsed.success) return { ok: false, message: "The sheet has a missing field." };
  const { error } = await db()
    .from("outreach_prospects")
    .update({ one_pager: parsed.data, message, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/outreach/${id}`);
  return { ok: true, message: "Saved." };
}

export async function setProspectStatus(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!PROSPECT_STATUSES.includes(status as (typeof PROSPECT_STATUSES)[number])) throw new Error("Invalid status.");
  const { error } = await db().from("outreach_prospects").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
  revalidatePath(`/outreach/${id}`);
  revalidatePath("/outreach");
}

export async function deleteProspect(formData: FormData) {
  const { error } = await db().from("outreach_prospects").delete().eq("id", String(formData.get("id") ?? ""));
  if (error) throw error;
  revalidatePath("/outreach");
  redirect("/outreach");
}
