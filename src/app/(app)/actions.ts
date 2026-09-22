"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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
  return result.ok
    ? { ok: true, message: `Synced ${result.rowsFetched.toLocaleString("en-US")} rows.` }
    : { ok: false, message: result.error ?? "Sync failed." };
}

export async function runCrawl(_prev: ActionState | null, formData: FormData): Promise<ActionState> {
  const result = await runSiteCrawl(String(formData.get("siteId") ?? ""), "manual");
  revalidatePath("/", "layout");
  if (!result.ok) return { ok: false, message: result.error ?? "Crawl failed." };
  const failed = result.pagesFailed ? `, ${result.pagesFailed} failed` : "";
  return { ok: true, message: `Crawled ${result.pagesCrawled} pages${failed}.` };
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
