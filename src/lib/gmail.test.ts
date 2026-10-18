import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./google", () => ({
  GMAIL_SCOPE: "https://www.googleapis.com/auth/gmail.compose",
  getConnection: async () => null,
  gscRequester: async () => null,
  describeGoogleError: (err: unknown) => (err as { response?: { data?: { error?: { message?: string } } }; message?: string })?.response?.data?.error?.message ?? (err as Error).message,
}));

const { createGmailDraft } = await import("./gmail");

const input = {
  to: "info@smith.example",
  subject: "Hello",
  text: "Hi",
  attachment: { filename: "a.pdf", data: Buffer.from("pdf"), contentType: "application/pdf" },
};

describe("createGmailDraft", () => {
  it("posts one raw message to the drafts endpoint and returns the draft id", async () => {
    const calls: { url: string; method: string; data: { message: { raw: string } } }[] = [];
    const draft = await createGmailDraft(input, async (opts) => {
      calls.push(opts as never);
      return { data: { id: "r123", message: { id: "m1" } } };
    });
    expect(draft).toEqual({ id: "r123" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/drafts");
    expect(calls[0].method).toBe("POST");
    expect(Buffer.from(calls[0].data.message.raw, "base64url").toString()).toContain("To: info@smith.example");
  });

  it("explains a missing permission and passes other Google errors through", async () => {
    const forbidden = (message: string) => async () => {
      throw Object.assign(new Error(message), { response: { status: 403, data: { error: { message } } } });
    };
    await expect(createGmailDraft(input, forbidden("Request had insufficient authentication scopes."))).rejects.toThrow(/Reconnect Google and tick the Gmail box/);
    await expect(createGmailDraft(input, forbidden("Gmail API has not been used in project 123 before or it is disabled."))).rejects.toThrow(/Gmail API has not been used/);
  });

  it("fails clearly when Google isn't connected", async () => {
    await expect(createGmailDraft(input)).rejects.toThrow(/Connect Google first/);
  });
});

// Google has no drafts-only permission, so the tool's promise not to send rests on the code.
describe("the tool never sends email", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(path);
    }
  };
  walk("src");

  it("has no call to a Gmail send endpoint", () => {
    const offenders = files.filter((f) => /drafts\/send|messages\/send|users\.messages\.send|users\.drafts\.send|gmail\.send/i.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("only ever talks to the drafts endpoint of the Gmail API", () => {
    const urls = files.flatMap((f) => readFileSync(f, "utf8").match(/https:\/\/gmail\.googleapis\.com[^"'`\s)]*/g) ?? []);
    expect(urls).toEqual(["https://gmail.googleapis.com/gmail/v1/users/me/drafts"]);
  });
});
