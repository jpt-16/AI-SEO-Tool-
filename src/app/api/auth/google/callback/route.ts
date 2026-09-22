import { NextResponse, type NextRequest } from "next/server";
import { encryptSecret } from "@/lib/crypto";
import { requireEnv } from "@/lib/env";
import { GSC_SCOPE, OAUTH_STATE_COOKIE, oauthClient } from "@/lib/google";
import { db } from "@/lib/supabase";

function redirectTo(request: NextRequest, path: string) {
  const response = NextResponse.redirect(new URL(path, request.url));
  response.cookies.delete({ name: OAUTH_STATE_COOKIE, path: "/api/auth/google" });
  return response;
}

function fail(request: NextRequest, message: string) {
  return redirectTo(request, `/connect?error=${encodeURIComponent(message)}`);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  if (params.get("error")) return fail(request, "Google sign-in was cancelled.");

  const code = params.get("code");
  const state = params.get("state");
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!code || !state || !expectedState || state !== expectedState) {
    return fail(request, "That sign-in link expired. Try again.");
  }

  const client = oauthClient();
  let tokens;
  try {
    ({ tokens } = await client.getToken(code));
  } catch {
    return fail(request, "Google rejected the sign-in. Try again.");
  }

  if (!tokens.scope?.split(" ").includes(GSC_SCOPE)) {
    return fail(request, "Search Console access wasn't granted. Tick the Search Console box on Google's consent screen.");
  }
  if (!tokens.refresh_token) {
    return fail(request, "Google didn't return a refresh token. Remove the app at myaccount.google.com/permissions, then reconnect.");
  }

  let email: string | null = null;
  if (tokens.id_token) {
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: requireEnv("GOOGLE_CLIENT_ID") });
    email = ticket.getPayload()?.email ?? null;
  }

  const { error } = await db().from("google_connection").upsert({
    id: true,
    google_email: email,
    refresh_token_encrypted: encryptSecret(tokens.refresh_token, requireEnv("TOKEN_ENCRYPTION_KEY")),
    scope: tokens.scope,
    connected_at: new Date().toISOString(),
  });
  if (error) return fail(request, `Couldn't save the connection: ${error.message}`);

  return redirectTo(request, "/connections?connected=1");
}
