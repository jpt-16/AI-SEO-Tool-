import "server-only";
import { OAuth2Client } from "google-auth-library";
import { decryptSecret } from "./crypto";
import { requireEnv } from "./env";
import type { GscRequester } from "./gsc";
import { db } from "./supabase";

export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
// openid + email only identify which Google account is connected.
export const OAUTH_SCOPES = ["openid", "email", GSC_SCOPE];
export const OAUTH_STATE_COOKIE = "gsc_oauth_state";

export function oauthClient(): OAuth2Client {
  return new OAuth2Client({
    clientId: requireEnv("GOOGLE_CLIENT_ID"),
    clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
    redirectUri: requireEnv("GOOGLE_REDIRECT_URI"),
  });
}

export interface GoogleConnection {
  google_email: string | null;
  refresh_token_encrypted: string;
  scope: string;
  connected_at: string;
}

export async function getConnection(): Promise<GoogleConnection | null> {
  const { data, error } = await db().from("google_connection").select("*").maybeSingle();
  if (error) throw error;
  return data;
}

export async function gscRequester(): Promise<GscRequester | null> {
  const connection = await getConnection();
  if (!connection) return null;
  let refreshToken: string;
  try {
    refreshToken = decryptSecret(connection.refresh_token_encrypted, requireEnv("TOKEN_ENCRYPTION_KEY"));
  } catch {
    throw new Error("The saved Google connection can't be read (TOKEN_ENCRYPTION_KEY changed?). Reconnect Google.");
  }
  const client = oauthClient();
  client.setCredentials({ refresh_token: refreshToken });
  return (opts) => client.request(opts);
}

export function isInvalidGrant(err: unknown): boolean {
  const e = err as { response?: { data?: { error?: string } }; message?: string };
  return e?.response?.data?.error === "invalid_grant" || /invalid_grant/.test(e?.message ?? "");
}

export function describeGoogleError(err: unknown): string {
  if (isInvalidGrant(err)) return "Google token expired or was revoked. Reconnect.";
  const e = err as {
    response?: { status?: number; data?: { error?: string | { message?: string }; error_description?: string } };
    message?: string;
  };
  const data = e?.response?.data;
  // OAuth token endpoint errors come back as { error: "invalid_client", error_description }.
  if (data?.error === "invalid_client" || data?.error === "unauthorized_client") {
    return "Google rejected the OAuth client. Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.";
  }
  if (typeof data?.error === "string") return data.error_description ?? data.error;
  const apiMessage = data?.error?.message;
  if (e?.response?.status === 403) return apiMessage ?? "This Google account can't read that Search Console property.";
  return apiMessage ?? e?.message ?? "Unknown error";
}
