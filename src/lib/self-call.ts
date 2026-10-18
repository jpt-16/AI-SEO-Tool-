import "server-only";
import { headers } from "next/headers";
import { requireEnv } from "./env";

// Only the two cron routes carry headless Chromium (about 100 MB each). Everything else that
// needs the browser, like the Crawl button or researching a prospect, calls one of them over HTTP
// instead of launching Chromium itself. That keeps the other functions small: Vercel counts every
// function of every stored deployment against Functions Storage.

// This deployment's own address, from the request being handled.
export async function selfOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) throw new Error("Couldn't work out this site's address.");
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

// Calls a cron route of this deployment as the cron job would, with CRON_SECRET.
export async function callCron<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(path, await selfOrigin());
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${requireEnv("CRON_SECRET")}` },
    cache: "no-store",
    // The route stops at 300s; give up just after rather than hang.
    signal: AbortSignal.timeout(295_000),
  });
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!body) throw new Error(`The background job returned HTTP ${res.status}.`);
  if (res.status === 401) throw new Error("The background job rejected CRON_SECRET.");
  return body;
}
