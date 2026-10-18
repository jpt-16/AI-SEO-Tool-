// Cold-outreach one-pager: what we know about a prospect (read from their site, checked on
// Google) and the filled-in sheet. Pure, so it's testable; outreach.ts does the fetching.
import { load } from "cheerio";
import { extractPage, pageKey, visibleText } from "./crawl";
import { OUTREACH } from "./outreach-sheet";

// ---- Reading their website ----

export interface PageFacts {
  url: string;
  title: string | null;
  metaDescription: string | null;
  h1: string[];
  h2: string[];
  wordCount: number;
  schemaTypes: string[];
  // Digits-only phones are de-duplicated; shown as found.
  phones: string[];
  hasTelLink: boolean;
  emails: string[];
  socials: string[];
  googleBusinessLinks: string[];
  hasForm: boolean;
  formMentionsQuote: boolean;
  platform: string | null;
  hasViewportMeta: boolean;
  copyrightYear: number | null;
  mentionsReviews: boolean;
  // Start of the visible text, so the model can tell what the business does.
  text: string;
}

const PHONE = /\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;
const SOCIAL = /(facebook\.com|instagram\.com|youtube\.com|tiktok\.com|linkedin\.com|twitter\.com|x\.com|nextdoor\.com|yelp\.com|angi\.com|thumbtack\.com|houzz\.com)\//i;
const GOOGLE_BUSINESS = /(google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|g\.page|business\.google\.com|g\.co\/kgs)/i;
const PLATFORMS: [RegExp, string][] = [
  [/wix(static)?\.com|wixsite/i, "Wix"],
  [/squarespace/i, "Squarespace"],
  [/wp-content|wp-includes|wordpress/i, "WordPress"],
  [/cdn\.shopify|shopify/i, "Shopify"],
  [/godaddy|secureserver\.net/i, "GoDaddy"],
  [/weebly/i, "Weebly"],
  [/webflow/i, "Webflow"],
];
const TEXT_CHARS = 1500;

export function extractFacts(html: string, pageUrl: string): PageFacts {
  const $ = load(html);
  const page = extractPage(html, pageUrl);
  const body = $("body").clone();
  body.find("script, style, noscript, template, svg, iframe, [hidden], [aria-hidden='true']").remove();
  const text = visibleText(body.toArray());

  const hrefs = $("a[href]").toArray().map((el) => $(el).attr("href")!.trim());
  const telLinks = hrefs.filter((h) => /^tel:/i.test(h)).map((h) => decodeURIComponent(h.replace(/^tel:/i, "")).trim());
  const phones = new Map<string, string>();
  for (const raw of [...telLinks, ...(text.match(PHONE) ?? [])]) {
    const digits = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    if (digits.length === 10 && !phones.has(digits)) phones.set(digits, raw);
  }

  const emails = [...new Set(hrefs.filter((h) => /^mailto:/i.test(h)).map((h) => h.replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase()))].filter(Boolean);
  const absolute = hrefs.flatMap((h) => {
    try {
      return [new URL(h, pageUrl).href];
    } catch {
      return [];
    }
  });
  const forms = $("form").toArray().filter((el) => $(el).find("input, textarea, select").length > 0);
  const generator = $('meta[name="generator" i]').attr("content") ?? "";
  const sniff = `${generator} ${html.slice(0, 200_000)}`;
  const years = [...text.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(20\d\d)/gi)].map((m) => Number(m[1]));

  return {
    url: pageUrl,
    title: page.title,
    metaDescription: page.metaDescription,
    h1: page.h1,
    h2: page.h2.slice(0, 12),
    wordCount: page.wordCount,
    schemaTypes: page.schemaTypes,
    phones: [...phones.values()],
    hasTelLink: telLinks.some((t) => t.replace(/\D/g, "").length >= 10),
    emails,
    socials: [...new Set(absolute.filter((u) => SOCIAL.test(u)))].slice(0, 8),
    googleBusinessLinks: [...new Set(absolute.filter((u) => GOOGLE_BUSINESS.test(u)))].slice(0, 3),
    hasForm: forms.length > 0,
    formMentionsQuote: forms.some((el) => /\b(quote|estimate|book|booking|appointment|schedule|request)\b/i.test($(el).text() + " " + $(el).find("button, input[type=submit]").toArray().map((b) => $(b).attr("value") ?? "").join(" "))),
    platform: PLATFORMS.find(([re]) => re.test(sniff))?.[1] ?? null,
    hasViewportMeta: /width\s*=\s*device-width/i.test($('meta[name="viewport" i]').attr("content") ?? ""),
    copyrightYear: years.length ? Math.max(...years) : null,
    mentionsReviews: /\b(reviews?|testimonials?|five.star|5.star)\b/i.test(text),
    text: text.slice(0, TEXT_CHARS),
  };
}

// Combines the homepage with its contact/about/service pages: contact details from
// anywhere count, everything else comes from the homepage.
export function mergeFacts(pages: PageFacts[]): PageFacts & { pagesRead: string[] } {
  const [home, ...rest] = pages;
  const all = pages;
  const uniq = <T,>(values: T[]) => [...new Set(values)];
  return {
    ...home,
    phones: uniq(all.flatMap((p) => p.phones)),
    hasTelLink: all.some((p) => p.hasTelLink),
    emails: uniq(all.flatMap((p) => p.emails)),
    socials: uniq(all.flatMap((p) => p.socials)).slice(0, 8),
    googleBusinessLinks: uniq(all.flatMap((p) => p.googleBusinessLinks)).slice(0, 3),
    hasForm: all.some((p) => p.hasForm),
    formMentionsQuote: all.some((p) => p.formMentionsQuote),
    mentionsReviews: all.some((p) => p.mentionsReviews),
    schemaTypes: uniq(all.flatMap((p) => p.schemaTypes)).sort(),
    // Other pages' headings and text help the model understand the business.
    h2: uniq([...home.h2, ...rest.flatMap((p) => p.h2)]).slice(0, 16),
    text: [home.text, ...rest.map((p) => `[${new URL(p.url).pathname}] ${p.text.slice(0, 500)}`)].join("\n"),
    pagesRead: all.map((p) => p.url),
  };
}

const USEFUL_PATH = /\/(contact|contact-us|about|about-us|services?|quote|get-a-quote|estimate|book|booking)\/?$/i;

// The few pages worth reading besides the homepage.
export function usefulLinks(html: string, pageUrl: string, max = 3): string[] {
  const { internalLinks } = extractPage(html, pageUrl);
  const picked = new Map<string, string>();
  for (const link of internalLinks) {
    let path: string;
    try {
      path = new URL(link).pathname;
    } catch {
      continue;
    }
    if (USEFUL_PATH.test(path) && !picked.has(pageKey(link))) picked.set(pageKey(link), link);
  }
  return [...picked.values()].slice(0, max);
}

// ---- Input checks ----

export function normalizeWebsite(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".")) return null;
    return new URL("/", url).href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

// Prospect sites are fetched from our server, so refuse addresses that point inside a network.
export function isPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || /\.(local|internal|localdomain|lan|home|corp)$/.test(host)) return false;
  if (host.includes(":")) return false; // IPv6 literal
  const octets = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number);
  if (octets) {
    const [a, b] = octets;
    return !(a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224);
  }
  return /\.[a-z]{2,}$/.test(host);
}

// ---- Prompts ----

export interface ProspectInput {
  businessName: string;
  website: string;
  ownerName: string | null;
  city: string | null;
  notes: string | null;
}

export const SEARCH_SYSTEM_PROMPT = `You research small local businesses on the web for a web designer who is about to send them a friendly, personal note.

Use Google Search. Report only what you actually find, as short plain-text bullet points, and say which source each point came from. If you can't find something, write "not found" for it. Never guess, never fill gaps with what's typical for the trade, and never invent ratings, review counts or names. Make sure each result is really this business (same name and town) and not a similarly named one; if you aren't sure, say so.`;

export function buildSearchPrompt(input: ProspectInput): string {
  return `Business: ${input.businessName}
Website: ${input.website}
${input.city ? `Town / area: ${input.city}\n` : ""}${input.ownerName ? `Owner (given): ${input.ownerName}\n` : ""}
Find:
1. Their Google Business Profile / Google Maps listing: does one exist, does it look complete (hours, photos, services, website link), and what is the star rating and number of reviews, if shown?
2. What recent reviewers say (themes, with a short quote or two if you can find them), and whether the owner replies to reviews.
3. Other listings (Facebook, Yelp, Angi, Nextdoor and similar): which exist.
4. How they appear in local search for what they do in their town (for example "their trade + town"): do they appear on the first page or in the map results? Only say what the results show.
5. The owner's or founder's name, if it is published.`;
}

export const DRAFT_SYSTEM_PROMPT = `You fill in a one-page "A quick look, made for you" sheet that ${OUTREACH.sender} (founder of JT Builds Co., a small web design and local SEO studio in ${OUTREACH.location}) sends to a local business he has never spoken to. It must read like a friendly, specific note from a real person, not a mass mailing.

You get: what ${OUTREACH.sender} already knows (his notes), facts read directly from the business's website, a phone-screen check of the homepage, and web search findings with sources.

Rules:
- Use only facts in the material you're given. Never invent a rating, review count, ranking, name, price, trade, or town. If something wasn't found, say that plainly ("I couldn't find a Google listing") instead of guessing. ${OUTREACH.sender}'s own notes beat everything else.
- Say what you saw, not what you assume. If the search findings are uncertain or about a possibly different business, leave them out and add the doubt to "unverified".
- Be kind and specific. Never insult their business or call their site bad. Lead with something genuine about the business (what they do, a happy-customer theme, how long they've been around) where the material has it.
- "Their problem" explains, in plain words, what the findings may mean for their customers (for example, someone searching on a phone can't tap to call). Hedge with "may" or "could". No SEO jargon, no scare tactics, no invented statistics.
- Tick only the services that address something in the research, and only the free offers that fit (a business with no Google listing gets "Free Google listing fix"; one with an outdated site gets "Free homepage mockup"; one with happy customers and few reviews gets the review link + QR code; "Free 1-page site audit" fits almost anyone with a site).
- Keep every field short: the sheet has small boxes. The pricing line is printed separately; don't mention prices.
- "message" is a few warm sentences that go with the sheet, mention one specific thing about them, and end with "${OUTREACH.sender}". No subject line, no hype, no "I hope this finds you well".
- "unverified" lists anything ${OUTREACH.sender} should check before sending.`;

export interface CaptureSummary {
  score: number | null;
  failed: string | null;
  // Checks that scored under 70%, in plain words.
  problems: string[];
  fitsPhone: boolean | null;
  callToAction: string | null;
}

export interface ResearchBundle {
  facts: (PageFacts & { pagesRead: string[] }) | null;
  factsError: string | null;
  capture: CaptureSummary | null;
  search: { text: string; sources: { title: string; url: string }[] } | null;
  searchError: string | null;
}

const bool = (v: boolean | null) => (v === null ? "unknown" : v ? "yes" : "no");

export function buildDraftPrompt(input: ProspectInput, research: ResearchBundle, today: string): string {
  const out: string[] = [
    `Today: ${today}`,
    "",
    "## The business",
    `Name: ${input.businessName}`,
    `Website: ${input.website}`,
    `Town / area: ${input.city ?? "not given"}`,
    `Owner (given): ${input.ownerName ?? "not given"}`,
    "",
    `## ${OUTREACH.sender}'s own notes (treat as true)`,
    input.notes?.trim() || "none",
    "",
    "## Read from their website",
  ];
  const f = research.facts;
  if (!f) {
    out.push(`Couldn't read the site: ${research.factsError ?? "unknown error"}.`);
  } else {
    out.push(
      `Pages read: ${f.pagesRead.join(", ")}`,
      `Title: ${f.title ?? "none"}`,
      `Meta description: ${f.metaDescription ?? "none"}`,
      `H1: ${f.h1.join(" | ") || "none"}`,
      `Other headings: ${f.h2.join(" | ") || "none"}`,
      `Word count (homepage): ${f.wordCount}`,
      `Phone numbers shown: ${f.phones.join(", ") || "none found"}`,
      `Tap-to-call link: ${bool(f.hasTelLink)}`,
      `Email addresses: ${f.emails.join(", ") || "none found"}`,
      `Contact/quote/booking form: ${f.hasForm ? (f.formMentionsQuote ? "yes, a quote or booking form" : "yes, a general form") : "none found"}`,
      `Links to Google Maps / Business Profile: ${f.googleBusinessLinks.join(", ") || "none"}`,
      `Social / directory links: ${f.socials.join(", ") || "none"}`,
      `Mentions reviews or testimonials: ${bool(f.mentionsReviews)}`,
      `Structured data (schema): ${f.schemaTypes.join(", ") || "none"}`,
      `Built with: ${f.platform ?? "unknown"}`,
      `Mobile viewport tag: ${bool(f.hasViewportMeta)}`,
      `Copyright year in footer: ${f.copyrightYear ?? "none"}`,
      "",
      "Start of the page text:",
      f.text,
    );
  }
  out.push("", "## Phone-screen check of the homepage (390px wide)");
  const c = research.capture;
  if (!c) out.push("Not run.");
  else if (c.failed) out.push(`Couldn't capture: ${c.failed}`);
  else {
    out.push(
      `Score: ${c.score}/100`,
      `Fits a phone screen without sideways scrolling: ${bool(c.fitsPhone)}`,
      `Call to action visible on the first screen: ${c.callToAction ?? "none found (automatic check, may be wrong)"}`,
      `Weak spots: ${c.problems.join("; ") || "none"}`,
    );
  }
  out.push("", "## Web search findings");
  if (!research.search) out.push(`Not available: ${research.searchError ?? "search was skipped"}.`);
  else {
    out.push(research.search.text, "", `Sources: ${research.search.sources.map((s) => s.url).join(", ") || "none listed"}`);
  }
  return out.join("\n");
}

// ---- Output ----
