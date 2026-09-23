"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { markBlueprintDone } from "@/lib/attribution";
import { DEFAULT_MIN_IMPRESSIONS, runBlueprints } from "@/lib/blueprints";
import { runSiteCrawl } from "@/lib/crawl-run";
import { decryptSecret } from "@/lib/crypto";
import { requireEnv } from "@/lib/env";
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
  const result = await runBlueprints(String(formData.get("siteId") ?? ""), "manual", { minImpressions, maxPages: 10 });
  revalidatePath("/blueprints");
  if (!result.ok) return { ok: false, message: result.error ?? "Analysis failed." };
  if (result.pagesConsidered === 0) return { ok: true, message: result.note ?? "No pages qualify." };
  const skipped = result.outcomes.filter((o) => o.outcome === "skipped").length;
  const errors = result.outcomes.filter((o) => o.outcome === "error").length;
  const parts = [`Analyzed ${result.pagesAnalyzed} pages`, `${result.blueprintsCreated} new blueprints`];
  if (skipped) parts.push(`${skipped} already open`);
  if (errors) parts.push(`${errors} failed`);
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
