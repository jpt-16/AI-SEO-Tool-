import { describe, expect, it } from "vitest";
import {
  blockedHost,
  buildEmail,
  buildRawEmail,
  pickEmail,
  siteMatchesBusiness,
  toCandidates,
} from "./outreach-auto-core";
import { sheetHtml } from "./outreach-html";

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

describe("buildEmail", () => {
  it("adds the signature and an opt-out line to the message", () => {
    const email = buildEmail({ businessName: "Smith & Sons", subject: "  A quick look\nat Smith  ", message: "Hi Pat.\n\nJake", postalAddress: "1 Main St, Foxboro MA" });
    expect(email.subject).toBe("A quick look at Smith");
    expect(email.text).toContain("Hi Pat.\n\nJake\n\n--\nJake · Founder, JT Builds Co.");
    expect(email.text).toContain('reply "no thanks"');
    expect(email.text).toContain("1 Main St, Foxboro MA");
    expect(email.attachmentName).toBe("A quick look at Smith & Sons.pdf");
  });

  it("falls back to a plain subject and omits the address when there isn't one", () => {
    const email = buildEmail({ businessName: "Doe/Co <x>", subject: null, message: "Hi" });
    expect(email.subject).toBe("A quick look at Doe/Co <x> online");
    expect(email.attachmentName).toBe("A quick look at DoeCo x.pdf");
    expect(email.text).not.toContain("undefined");
  });
});

describe("buildRawEmail", () => {
  const decode = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");
  const pdf = Buffer.from("%PDF-1.4 fake pdf bytes");
  const raw = buildRawEmail({
    to: "info@smithplumbing.com",
    subject: "A quick look at Smith – plumbing",
    text: "Hi Pat — thanks.\nJake",
    attachment: { filename: "A quick look at Smith.pdf", data: pdf, contentType: "application/pdf" },
    boundary: "BOUNDARY",
  });
  const mime = decode(raw);

  it("is a multipart message with the right headers", () => {
    expect(mime).toContain("To: info@smithplumbing.com\r\n");
    expect(mime).toContain("MIME-Version: 1.0");
    expect(mime).toContain('Content-Type: multipart/mixed; boundary="BOUNDARY"');
    expect(mime.endsWith("--BOUNDARY--\r\n")).toBe(true);
    expect(mime).not.toMatch(/^From:/m);
  });

  it("encodes a non-ASCII subject and body so they survive", () => {
    const subject = mime.match(/^Subject: =\?UTF-8\?B\?(.+)\?=$/m)![1];
    expect(Buffer.from(subject, "base64").toString("utf8")).toBe("A quick look at Smith – plumbing");
    const body = mime.split("--BOUNDARY")[1].split("\r\n\r\n")[1].replace(/\r\n/g, "");
    expect(Buffer.from(body, "base64").toString("utf8")).toBe("Hi Pat — thanks.\nJake");
  });

  it("attaches the PDF intact", () => {
    const part = mime.split("--BOUNDARY")[2];
    expect(part).toContain("Content-Type: application/pdf");
    expect(part).toContain('Content-Disposition: attachment; filename="A quick look at Smith.pdf"');
    const data = part.split("\r\n\r\n")[1].replace(/\r\n/g, "");
    expect(Buffer.from(data, "base64").equals(pdf)).toBe(true);
  });

  it("refuses line breaks in headers", () => {
    const attachment = { filename: "a.pdf", data: pdf, contentType: "application/pdf" };
    expect(() => buildRawEmail({ to: "a@b.example\r\nBcc: x@y.example", subject: "s", text: "t", attachment })).toThrow(/line breaks/);
    expect(() => buildRawEmail({ to: "a@b.example", subject: "s\nBcc: x@y.example", text: "t", attachment })).toThrow(/line breaks/);
  });
});

describe("sheetHtml", () => {
  const sheet = {
    owner_name: null,
    google_listing: "<b>No</b> listing & \"quotes\"",
    website_and_phone: "w",
    reviews_and_local_search: "r",
    problem: "p",
    solution: { custom_website: true, google_business_profile: false, local_seo: false, booking_quote_form: false, logo_branding: false },
    solution_note: "n",
    free_value: { homepage_mockup: false, google_listing_fix: true, review_link_qr: false, site_audit: false },
    free_value_other: null,
  };
  const html = sheetHtml({ business: "Smith <script>alert(1)</script>", dateText: "October 18, 2026", sheet });

  it("escapes everything it prints", () => {
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>No</b>");
    expect(html).toContain("&lt;b&gt;No&lt;/b&gt; listing &amp; &quot;quotes&quot;");
  });

  it("ticks only the chosen options and prints the fixed text", () => {
    expect(html.match(/class="cb on"/g)).toHaveLength(2);
    expect(html).toContain("(781) 248-9834");
    expect(html).toContain("One monthly fee from $97");
  });
});
