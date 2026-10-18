import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  buildDraftPrompt,
  buildSearchPrompt,
  extractFacts,
  isPublicHostname,
  mergeFacts,
  normalizeWebsite,
  usefulLinks,
  type ResearchBundle,
} from "./outreach-core";
import { FREE_VALUE_ITEMS, OnePagerOutput, OnePagerSheet, sheetFromDraft, sheetToText, SOLUTION_ITEMS } from "./outreach-sheet";

const HOME = `<!doctype html><html><head>
<title>Smith &amp; Sons Plumbing</title>
<meta name="description" content="Plumbers in Foxboro.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="WordPress 6.4">
<script type="application/ld+json">{"@type":"Plumber"}</script></head>
<body><h1>Plumbing you can trust</h1><h2>Drain cleaning</h2>
<a href="tel:+1 (508) 555-0142">Call us</a><a href="mailto:Hello@Smith.example?subject=hi">Email</a>
<a href="https://www.facebook.com/smithplumbing/">Facebook</a>
<a href="https://maps.app.goo.gl/abc123">Find us</a>
<a href="/contact">Contact</a><a href="/about-us">About</a><a href="/blog/post-1">Blog</a><a href="/services">Services</a>
<form action="/send"><input name="name"><textarea></textarea><button>Request a quote</button></form>
<p>Family owned since 1998. Read our reviews. Phone (508) 555-0142 or 508.555.0199.</p>
<footer>© 2019 Smith &amp; Sons Plumbing</footer></body></html>`;

describe("extractFacts", () => {
  const f = extractFacts(HOME, "https://smith.example/");

  it("finds the phone numbers, de-duplicated, and the tap-to-call link", () => {
    expect(f.phones).toEqual(["+1 (508) 555-0142", "508.555.0199"]);
    expect(f.hasTelLink).toBe(true);
  });

  it("finds email, socials, Google Maps links and the form", () => {
    expect(f.emails).toEqual(["hello@smith.example"]);
    expect(f.socials).toEqual(["https://www.facebook.com/smithplumbing/"]);
    expect(f.googleBusinessLinks).toEqual(["https://maps.app.goo.gl/abc123"]);
    expect(f.hasForm).toBe(true);
    expect(f.formMentionsQuote).toBe(true);
  });

  it("reads the platform, viewport, footer year, schema and reviews mention", () => {
    expect(f).toMatchObject({ platform: "WordPress", hasViewportMeta: true, copyrightYear: 2019, schemaTypes: ["Plumber"], mentionsReviews: true });
    expect(f.title).toBe("Smith & Sons Plumbing");
    expect(f.h1).toEqual(["Plumbing you can trust"]);
  });

  it("reports what's missing on a bare page", () => {
    const bare = extractFacts("<html><body><p>Hello</p></body></html>", "https://x.example/");
    expect(bare).toMatchObject({ phones: [], hasTelLink: false, emails: [], hasForm: false, platform: null, hasViewportMeta: false, copyrightYear: null, mentionsReviews: false });
  });
});

describe("usefulLinks / mergeFacts", () => {
  it("picks the contact, about and services pages only", () => {
    expect(usefulLinks(HOME, "https://smith.example/")).toEqual([
      "https://smith.example/contact",
      "https://smith.example/about-us",
      "https://smith.example/services",
    ]);
  });

  it("takes contact details from any page and the rest from the homepage", () => {
    const home = extractFacts("<html><head><title>Home</title></head><body><h1>Hi</h1><p>Plumbing</p></body></html>", "https://smith.example/");
    const contact = extractFacts('<html><body><a href="tel:5085550142">x</a><a href="mailto:a@b.example">e</a><p>Contact us</p></body></html>', "https://smith.example/contact");
    const merged = mergeFacts([home, contact]);
    expect(merged.title).toBe("Home");
    expect(merged.phones).toEqual(["5085550142"]);
    expect(merged.emails).toEqual(["a@b.example"]);
    expect(merged.hasTelLink).toBe(true);
    expect(merged.pagesRead).toEqual(["https://smith.example/", "https://smith.example/contact"]);
    expect(merged.text).toContain("[/contact]");
  });
});

describe("input checks", () => {
  it("normalizes a website to its origin", () => {
    expect(normalizeWebsite("smith.example/contact?x=1")).toBe("https://smith.example");
    expect(normalizeWebsite("  http://www.smith.example/  ")).toBe("http://www.smith.example");
    expect(normalizeWebsite("javascript:alert(1)")).toBeNull();
    expect(normalizeWebsite("ftp://smith.example")).toBeNull();
    expect(normalizeWebsite("localhost")).toBeNull();
    expect(normalizeWebsite("")).toBeNull();
  });

  it("refuses addresses inside a network", () => {
    for (const host of ["localhost", "127.0.0.1", "10.1.2.3", "192.168.0.5", "172.20.0.1", "169.254.169.254", "0.0.0.0", "[::1]", "printer.local", "db.internal", "intranet"]) {
      expect(isPublicHostname(host), host).toBe(false);
    }
    for (const host of ["smith.example", "www.smith.example", "8.8.8.8", "172.32.0.1"]) expect(isPublicHostname(host), host).toBe(true);
  });
});

const input = { businessName: "Smith & Sons Plumbing", website: "https://smith.example", ownerName: null, city: "Foxboro, MA", notes: "No Google listing that I can see." };

describe("prompts", () => {
  it("asks the search about this business and town", () => {
    const p = buildSearchPrompt(input);
    expect(p).toContain("Smith & Sons Plumbing");
    expect(p).toContain("Foxboro, MA");
  });

  it("gives the draft the notes, site facts, capture and search, and says what's missing", () => {
    const research: ResearchBundle = {
      facts: { ...mergeFacts([extractFacts(HOME, "https://smith.example/")]) },
      factsError: null,
      capture: { score: 62, failed: null, problems: ["Tap targets: 3 of 9 too small"], fitsPhone: true, callToAction: "Call us" },
      search: { text: "- Listing: not found", sources: [{ title: "x", url: "https://yelp.example/s" }] },
      searchError: null,
    };
    const prompt = buildDraftPrompt(input, research, "October 18, 2026");
    for (const part of ["No Google listing that I can see.", "+1 (508) 555-0142", "Tap-to-call link: yes", "62/100", "Listing: not found", "https://yelp.example/s", "Built with: WordPress"]) {
      expect(prompt).toContain(part);
    }

    const missing = buildDraftPrompt(input, { facts: null, factsError: "HTTP 500", capture: null, search: null, searchError: "quota" }, "October 18, 2026");
    expect(missing).toContain("Couldn't read the site: HTTP 500");
    expect(missing).toContain("Not available: quota");
    expect(missing).toContain("Not run.");
  });
});

const draft = {
  owner_name: "Pat Smith",
  google_listing: "I couldn't find a Google listing for Smith & Sons.",
  website_and_phone: "Your number is on the site but isn't tap-to-call.",
  reviews_and_local_search: "I couldn't find reviews online.",
  problem: "Someone searching on a phone may not be able to find you or call quickly.",
  solution: { custom_website: false, google_business_profile: true, local_seo: true, booking_quote_form: false, logo_branding: false },
  solution_note: "A listing plus a tap-to-call button would put you in front of nearby customers.",
  free_value: { homepage_mockup: false, google_listing_fix: true, review_link_qr: true, site_audit: false },
  free_value_other: null,
  subject: "A quick look at Smith & Sons online",
  message: "Hi Pat, I took a quick look at Smith & Sons online and made you a one-page summary. Jake",
  unverified: ["Check there's really no Google listing."],
};

describe("one-pager", () => {
  it("accepts a full draft and keeps only the sheet's fields", () => {
    const sheet = sheetFromDraft(OnePagerOutput.parse(draft));
    expect(Object.keys(sheet)).not.toContain("message");
    expect(Object.keys(sheet)).not.toContain("subject");
    expect(Object.keys(sheet)).not.toContain("unverified");
    expect(OnePagerSheet.safeParse(sheet).success).toBe(true);
  });

  it("rejects a draft missing a field", () => {
    const rest: Partial<typeof draft> = { ...draft };
    delete rest.problem;
    expect(OnePagerOutput.safeParse(rest).success).toBe(false);
  });

  it("has a JSON Schema with every solution and free-value option", () => {
    const schema = z.toJSONSchema(OnePagerOutput) as { properties: Record<string, { properties?: Record<string, unknown> }> };
    expect(Object.keys(schema.properties.solution.properties!)).toEqual(SOLUTION_ITEMS.map((i) => i.key));
    expect(Object.keys(schema.properties.free_value.properties!)).toEqual(FREE_VALUE_ITEMS.map((i) => i.key));
  });

  it("exports the sheet as plain text with only the ticked options", () => {
    const text = sheetToText(sheetFromDraft(OnePagerOutput.parse(draft)), "Smith & Sons Plumbing");
    expect(text).toContain("A quick look, made for Smith & Sons Plumbing");
    expect(text).toContain("How I can help: Google Business Profile, Local SEO");
    expect(text).toContain("Free, no strings: Free Google listing fix, Free review link + QR code");
    expect(text).not.toContain("Custom website");
    expect(text).toContain("(781) 248-9834");
    expect(text).toContain("One monthly fee from $97");
  });
});
