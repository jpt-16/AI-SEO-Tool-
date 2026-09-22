import "server-only";
import { cookies } from "next/headers";
import { db } from "./supabase";

export const SITE_COOKIE = "site_id";

export interface Site {
  id: string;
  name: string;
  domain: string;
  gsc_property: string | null;
  sync_enabled: boolean;
}

export async function listSites(): Promise<Site[]> {
  const { data, error } = await db()
    .from("sites")
    .select("id, name, domain, gsc_property, sync_enabled")
    .order("created_at");
  if (error) throw error;
  return data;
}

export async function getCurrentSite(sites?: Site[]): Promise<Site | null> {
  const all = sites ?? (await listSites());
  const selected = (await cookies()).get(SITE_COOKIE)?.value;
  return all.find((s) => s.id === selected) ?? all[0] ?? null;
}
