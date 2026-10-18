import "server-only";
import { ImapFlow } from "imapflow";
import { buildMessage } from "./outreach-auto-core";

// Saves draft emails into the operator's own Gmail over IMAP, signed in with an app password
// (Google account → Security → 2-Step Verification → App passwords). That needs no Google
// OAuth approval. An app password can do more than drafts, so this module only ever calls two
// IMAP commands, LIST (to find the Drafts folder) and APPEND (to add a draft). It never reads
// mail and never sends it (no SMTP at all); a test enforces both.
const HOST = "imap.gmail.com";
const FALLBACK_DRAFTS_FOLDER = "[Gmail]/Drafts";

export interface GmailConfig {
  // The account the app password belongs to: where drafts are saved.
  address: string;
  password: string;
  // The "From" shown on each draft. Defaults to the account's own address; set OUTREACH_FROM to
  // one of its aliases (say jake@jtbuildsco.com on a Workspace account) to send as that instead.
  from: string;
}

export function gmailConfig(env: Record<string, string | undefined> = process.env): GmailConfig | null {
  const address = env.GMAIL_ADDRESS?.trim();
  // Google shows app passwords as four groups of four letters with spaces.
  const password = env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  return address && password ? { address, password, from: env.OUTREACH_FROM?.trim() || address } : null;
}

export function gmailStatus(env: Record<string, string | undefined> = process.env): { configured: boolean; address: string | null; from: string | null } {
  const config = gmailConfig(env);
  return { configured: Boolean(config), address: config?.address ?? null, from: config?.from ?? null };
}

export interface DraftInput {
  to: string;
  subject: string;
  text: string;
}

type ImapLike = Pick<ImapFlow, "connect" | "list" | "append" | "logout">;
export type ImapFactory = (config: GmailConfig) => ImapLike;

const defaultFactory: ImapFactory = (config) =>
  new ImapFlow({ host: HOST, port: 993, secure: true, auth: { user: config.address, pass: config.password }, logger: false });

export function describeGmailError(err: unknown): string {
  const e = err as { authenticationFailed?: boolean; responseText?: string; response?: string; message?: string; code?: string };
  if (e?.authenticationFailed) {
    return "Gmail rejected the address or app password. Check GMAIL_ADDRESS and GMAIL_APP_PASSWORD in Vercel (the app password, not your normal password).";
  }
  if (e?.code === "ENOTFOUND" || e?.code === "ETIMEDOUT" || e?.code === "ECONNRESET") return `Couldn't reach Gmail (${e.code}). Try again.`;
  const detail = e?.responseText || e?.response || e?.message;
  return `Gmail error: ${detail ?? "unknown"}`;
}

// Fails fast, with a plain message, when the address or app password is wrong.
export async function checkGmailLogin(factory: ImapFactory = defaultFactory, env: Record<string, string | undefined> = process.env): Promise<void> {
  const config = gmailConfig(env);
  if (!config) throw new Error("Gmail isn't set up: add GMAIL_ADDRESS and GMAIL_APP_PASSWORD in Vercel.");
  const client = factory(config);
  try {
    await client.connect();
  } catch (err) {
    throw new Error(describeGmailError(err));
  } finally {
    await client.logout().catch(() => {});
  }
}

// Adds one draft to the Drafts folder. Returns an id for it, if Gmail reports one.
export async function createGmailDraft(
  input: DraftInput,
  factory: ImapFactory = defaultFactory,
  env: Record<string, string | undefined> = process.env,
): Promise<{ id: string }> {
  const config = gmailConfig(env);
  if (!config) throw new Error("Gmail isn't set up: add GMAIL_ADDRESS and GMAIL_APP_PASSWORD in Vercel.");
  const raw = buildMessage({ from: config.from, to: input.to, subject: input.subject, text: input.text });
  const client = factory(config);
  try {
    await client.connect();
    const folders = await client.list();
    const drafts = folders.find((f) => f.specialUse === "\\Drafts")?.path ?? FALLBACK_DRAFTS_FOLDER;
    const result = await client.append(drafts, raw, ["\\Draft"]);
    if (!result) throw new Error("Gmail didn't accept the draft.");
    return { id: result.uid !== undefined ? `${result.uidValidity ?? ""}:${result.uid}` : result.destination };
  } catch (err) {
    throw new Error(describeGmailError(err));
  } finally {
    await client.logout().catch(() => {});
  }
}
