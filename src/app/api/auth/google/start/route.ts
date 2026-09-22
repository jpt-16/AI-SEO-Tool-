import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { OAUTH_SCOPES, OAUTH_STATE_COOKIE, oauthClient } from "@/lib/google";

export async function GET() {
  const state = randomBytes(24).toString("base64url");
  const url = oauthClient().generateAuthUrl({
    access_type: "offline",
    // select_account: always show the chooser when several Google accounts are signed in.
    // consent: forces a refresh token even if this account connected before.
    prompt: "select_account consent",
    scope: OAUTH_SCOPES,
    state,
  });
  const response = NextResponse.redirect(url);
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: 600,
  });
  return response;
}
