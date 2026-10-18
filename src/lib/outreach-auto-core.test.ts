import { describe, expect, it } from "vitest";
import {
  blockedHost,
  buildRawEmail,
  pickEmail,
  siteMatchesBusiness,
  toCandidates,
} from "./outreach-auto-core";

describe("toCandidates", () => {
  it("accepts real business sites and remembers them", () => {
    const known = new Set<string>();
    const { accepted, rejected } = toCandidates(
      [
        { name: "Smith & Sons Plumbing", website: "https://www.smithplumbing.com/contact", town: "Foxboro" },
        { name: "Doe Plumbing", website: "doeplumbing.net", town: null },
        { name: "Smith again", website: "http://smithplumbing.com", town: null },
      ],
      known,
    );
    expect(accepted).toEqual([
      { name: "Smith & Sons Plumbing", website: "https://www.smithplumbing.com", town: "Foxboro" },
      { name: "Doe Plumbing", website: "https://doeplumbing.net", town: null },
    ]);
    expect(rejected).toEqual([{ name: "Smith again", why: "already known" }]);
    expect(known).toEqual(new Set(["smithplumbing.com", "doeplumbing.net"]));
  });

  it("drops directories, chains, missing and private websites", () => {
    const { accepted, rejected } = toCandidates(
      [
        { name: "A", website: "https://www.yelp.com/biz/a", town: null },
        { name: "B", website: "https://m.facebook.com/b", town: null },
        { name: "C", website: null, town: null },
        { name: "D", website: "http://192.168.1.5", town: null },
        { name: "E", website: "https://www.roto-rooter.com", town: null },
        { name: "  ", website: "https://ok.example", town: null },
        { name: "F", website: "not a url", town: null },
      ],
      new Set(),
    );
    expect(accepted).toEqual([]);
    expect(rejected.map((r) => [r.name, r.why])).toEqual([
      ["A", "not a business website"],
      ["B", "not a business website"],
      ["C", "no website"],
      ["D", "not a business website"],
      ["E", "not a business website"],
      ["F", "no website"],
    ]);
  });

  it("blocks subdomains of blocked hosts only", () => {
    expect(blockedHost("www.facebook.com")).toBe(true);
    expect(blockedHost("smith.business.site")).toBe(true);
    expect(blockedHost("notfacebook.com")).toBe(false);
  });
});

const facts = (title: string, text = "", url = "https://smithplumbing.com/") => ({ url, title, h1: [], text });

describe("siteMatchesBusiness", () => {
  it("needs one distinctive word of the name on the page or in the domain", () => {
    expect(siteMatchesBusiness("Smith & Sons Plumbing", facts("Smith Plumbing | Foxboro"))).toBe(true);
    expect(siteMatchesBusiness("Smith & Sons Plumbing", facts("Home", "", "https://smithandsons.com/"))).toBe(true);
    expect(siteMatchesBusiness("Smith & Sons Plumbing", facts("Best Pizza in Town", "Order a large pie", "https://pizzaplace.com/"))).toBe(false);
  });

  it("passes names made only of generic words", () => {
    expect(siteMatchesBusiness("Mobile Auto Detailing LLC", facts("Anything"))).toBe(true);
  });
});

describe("pickEmail", () => {
  it("prefers a general inbox on their own domain", () => {
    expect(pickEmail(["bob@gmail.com", "Info@SmithPlumbing.com", "pat@smithplumbing.com"], "https://smithplumbing.com")).toBe("info@smithplumbing.com");
    expect(pickEmail(["pat@smithplumbing.com", "zed@smithplumbing.com"], "https://www.smithplumbing.com")).toBe("pat@smithplumbing.com");
  });

  it("falls back to an outside address and ignores junk", () => {
    expect(pickEmail(["smith.plumbing@gmail.com"], "https://smithplumbing.com")).toBe("smith.plumbing@gmail.com");
    expect(pickEmail(["noreply@smithplumbing.com", "logo@2x.png", "x@sentry.io", "bad@", "user@example.com"], "https://smithplumbing.com")).toBeNull();
    expect(pickEmail([], "https://smithplumbing.com")).toBeNull();
  });
});

describe("buildRawEmail", () => {
  const decode = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");
  const raw = buildRawEmail({ to: "info@smithplumbing.com", subject: "A quick look at Smith – plumbing", text: "Hi Pat — thanks.\nJake" });
  const mime = decode(raw);

  it("is a plain-text message with the right headers and no attachment", () => {
    expect(mime).toContain("To: info@smithplumbing.com\r\n");
    expect(mime).toContain("MIME-Version: 1.0");
    expect(mime).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(mime).not.toMatch(/multipart|attachment|application\/pdf/i);
    expect(mime).not.toMatch(/^From:/m);
  });

  it("encodes a non-ASCII subject and body so they survive", () => {
    const subject = mime.match(/^Subject: =\?UTF-8\?B\?(.+)\?=$/m)![1];
    expect(Buffer.from(subject, "base64").toString("utf8")).toBe("A quick look at Smith – plumbing");
    const body = mime.split("\r\n\r\n")[1].replace(/\r\n/g, "");
    expect(Buffer.from(body, "base64").toString("utf8")).toBe("Hi Pat — thanks.\nJake");
  });

  it("keeps an ASCII subject readable", () => {
    expect(decode(buildRawEmail({ to: "a@b.example", subject: "Hello there", text: "x" }))).toContain("Subject: Hello there\r\n");
  });

  it("refuses line breaks in headers", () => {
    expect(() => buildRawEmail({ to: "a@b.example\r\nBcc: x@y.example", subject: "s", text: "t" })).toThrow(/line breaks/);
    expect(() => buildRawEmail({ to: "a@b.example", subject: "s\nBcc: x@y.example", text: "t" })).toThrow(/line breaks/);
  });
});
