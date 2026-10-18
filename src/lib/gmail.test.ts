import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("imapflow", () => ({ ImapFlow: class {} }));

const { checkGmailLogin, createGmailDraft, describeGmailError, gmailConfig, gmailStatus } = await import("./gmail");

const env = { GMAIL_ADDRESS: " jake@gmail.com ", GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop" };
const input = { to: "info@smith.example", subject: "Hello – there", text: "Hi Pat — thanks." };

// An IMAP connection that records what it was asked to do.
function fakeImap(options: { folders?: { path: string; specialUse?: string }[]; connectError?: unknown; append?: unknown } = {}) {
  const calls: unknown[][] = [];
  const factory = vi.fn((config: { address: string; password: string }) => ({
    connect: async () => {
      calls.push(["connect", config]);
      if (options.connectError) throw options.connectError;
    },
    list: async () => {
      calls.push(["list"]);
      return options.folders ?? [{ path: "INBOX" }, { path: "[Gmail]/Drafts", specialUse: "\\Drafts" }];
    },
    append: async (...args: unknown[]) => {
      calls.push(["append", ...args]);
      return options.append === undefined ? { destination: "[Gmail]/Drafts", uidValidity: BigInt(7), uid: 42 } : options.append;
    },
    logout: async () => {
      calls.push(["logout"]);
    },
  }));
  return { calls, factory: factory as never };
}

describe("gmailConfig / gmailStatus", () => {
  it("trims the address and strips the spaces Google puts in app passwords", () => {
    expect(gmailConfig(env)).toEqual({ address: "jake@gmail.com", password: "abcdefghijklmnop" });
    expect(gmailStatus(env)).toEqual({ configured: true, address: "jake@gmail.com" });
  });

  it("is not configured without both values", () => {
    expect(gmailStatus({ GMAIL_ADDRESS: "jake@gmail.com" })).toEqual({ configured: false, address: null });
    expect(gmailStatus({ GMAIL_APP_PASSWORD: "x" }).configured).toBe(false);
    expect(gmailStatus({}).configured).toBe(false);
  });
});

describe("createGmailDraft", () => {
  it("appends one message flagged as a draft to the Drafts folder, and returns its id", async () => {
    const { calls, factory } = fakeImap();
    const draft = await createGmailDraft(input, factory, env);
    expect(draft).toEqual({ id: "7:42" });
    expect(calls.map((c) => c[0])).toEqual(["connect", "list", "append", "logout"]);
    expect(calls[0][1]).toEqual({ address: "jake@gmail.com", password: "abcdefghijklmnop" });

    const [, folder, raw, flags] = calls[2] as [string, string, string, string[]];
    expect(folder).toBe("[Gmail]/Drafts");
    expect(flags).toEqual(["\\Draft"]);
    expect(raw).toContain("From: jake@gmail.com\r\n");
    expect(raw).toContain("To: info@smith.example\r\n");
    expect(raw).toMatch(/Subject: =\?UTF-8\?B\?/);
    expect(raw).toContain("Content-Type: text/plain; charset=UTF-8");
  });

  it("finds the Drafts folder by its special use, whatever it's called", async () => {
    const { calls, factory } = fakeImap({ folders: [{ path: "INBOX" }, { path: "[Gmail]/Brouillons", specialUse: "\\Drafts" }] });
    await createGmailDraft(input, factory, env);
    expect((calls[2] as unknown[])[1]).toBe("[Gmail]/Brouillons");
  });

  it("explains a rejected app password, and still logs out", async () => {
    const { calls, factory } = fakeImap({ connectError: Object.assign(new Error("Invalid credentials"), { authenticationFailed: true }) });
    await expect(createGmailDraft(input, factory, env)).rejects.toThrow(/rejected the address or app password/);
    expect(calls.at(-1)).toEqual(["logout"]);
  });

  it("reports a draft Gmail didn't accept, and a missing setup", async () => {
    await expect(createGmailDraft(input, fakeImap({ append: false }).factory, env)).rejects.toThrow(/didn't accept the draft/);
    await expect(createGmailDraft(input, fakeImap().factory, {})).rejects.toThrow(/GMAIL_ADDRESS and GMAIL_APP_PASSWORD/);
  });

  it("refuses line breaks in headers instead of sending them to Gmail", async () => {
    const { calls, factory } = fakeImap();
    await expect(createGmailDraft({ ...input, to: "a@b.example\r\nBcc: x@y.example" }, factory, env)).rejects.toThrow(/line breaks/);
    expect(calls.some((c) => c[0] === "append")).toBe(false);
  });
});

describe("checkGmailLogin", () => {
  it("connects and logs out without touching any mailbox", async () => {
    const { calls, factory } = fakeImap();
    await checkGmailLogin(factory, env);
    expect(calls.map((c) => c[0])).toEqual(["connect", "logout"]);
  });

  it("fails with a plain message on a bad login or missing setup", async () => {
    const bad = fakeImap({ connectError: Object.assign(new Error("x"), { authenticationFailed: true }) });
    await expect(checkGmailLogin(bad.factory, env)).rejects.toThrow(/app password/);
    await expect(checkGmailLogin(fakeImap().factory, {})).rejects.toThrow(/isn't set up/);
  });
});

describe("describeGmailError", () => {
  it("covers network and server errors", () => {
    expect(describeGmailError({ code: "ENOTFOUND" })).toMatch(/Couldn't reach Gmail/);
    expect(describeGmailError({ responseText: "Quota exceeded" })).toBe("Gmail error: Quota exceeded");
  });
});

// An app password can do much more than save drafts, so the promise not to read or send mail
// rests on the code. These tests fail if anything starts to.
describe("the tool only saves drafts", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(path);
    }
  };
  walk("src");
  const source = files.map((f) => ({ f, text: readFileSync(f, "utf8") }));

  it("never uses SMTP or a mail-sending library", () => {
    const offenders = source.filter(({ text }) => /nodemailer|smtp\.|createTransport|sendMail|messages\.send|drafts\.send|gmail\.send/i.test(text)).map((s) => s.f);
    expect(offenders).toEqual([]);
  });

  it("never reads a mailbox: no fetch, search, download, open, or lock calls on IMAP", () => {
    const gmail = source.find((s) => s.f.endsWith("gmail.ts"))!.text;
    expect(gmail).not.toMatch(/\.(fetch|fetchOne|fetchAll|search|download|downloadMany|mailboxOpen|getMailboxLock|messageMove|messageDelete|messageFlagsAdd|idle)\s*\(/);
    // The only IMAP commands used are these.
    const used = [...gmail.matchAll(/client\.(\w+)\(/g)].map((m) => m[1]);
    expect(new Set(used)).toEqual(new Set(["connect", "list", "append", "logout"]));
  });

  it("is the only file that imports the IMAP library", () => {
    expect(source.filter(({ text }) => /from "imapflow"/.test(text)).map((s) => s.f)).toEqual([join("src", "lib", "gmail.ts")]);
  });
});
