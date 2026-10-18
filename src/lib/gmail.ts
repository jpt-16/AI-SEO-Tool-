import "server-only";
import { buildRawEmail } from "./outreach-auto-core";
import { describeGoogleError, getConnection, GMAIL_SCOPE, gscRequester } from "./google";

// Creates drafts in the connected account's Gmail. GMAIL_SCOPE also allows sending, but nothing
// in this tool calls a send endpoint, and a test checks that.
const DRAFTS_URL = "https://gmail.googleapis.com/gmail/v1/users/me/drafts";

export async function gmailStatus(): Promise<{ connected: boolean; allowed: boolean; email: string | null }> {
  const connection = await getConnection();
  if (!connection) return { connected: false, allowed: false, email: null };
  return { connected: true, allowed: connection.scope.split(" ").includes(GMAIL_SCOPE), email: connection.google_email };
}

type Requester = (opts: { url: string; method: "POST"; data: unknown }) => Promise<{ data: unknown }>;

export interface DraftInput {
  to: string;
  subject: string;
  text: string;
}

export async function createGmailDraft(input: DraftInput, request?: Requester): Promise<{ id: string }> {
  const send = request ?? ((await gscRequester()) as Requester | null);
  if (!send) throw new Error("Connect Google first.");
  try {
    const { data } = await send({ url: DRAFTS_URL, method: "POST", data: { message: { raw: buildRawEmail(input) } } });
    const id = (data as { id?: string }).id;
    if (!id) throw new Error("Gmail didn't return a draft id.");
    return { id };
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 403 && /insufficient|scope/i.test(describeGoogleError(err))) {
      throw new Error("Google hasn't allowed Gmail drafts yet. Reconnect Google and tick the Gmail box.");
    }
    throw new Error(describeGoogleError(err));
  }
}
