// Automatic outreach, the pure parts: finding businesses, choosing who to email, and building
// the email itself. outreach-auto.ts does the fetching and saving.
import { z } from "zod";
import { hostKey } from "./crawl";
import { isPublicHostname, normalizeWebsite, type PageFacts } from "./outreach-core";
import { OUTREACH } from "./outreach-sheet";

// ---- Finding businesses ----

export const DiscoveryOutput = z.object({
  businesses: z.array(
    z.object({
      name: z.string().describe("The business's name as it appears on its own website or listing."),
      website: z.string().nullable().describe("Its own website address, exactly as found in the research. Null if none was found."),
      town: z.string().nullable().describe("The town it is based in, if stated."),
    }),
  ),
});
export type DiscoveredBusiness = z.infer<typeof DiscoveryOutput>["businesses"][number];

export const DISCOVERY_SEARCH_SYSTEM_PROMPT = `You find small local businesses on the web for a web designer looking for new clients.

Use Google Search. List only real businesses that you actually found, each with the address of its OWN website (not a directory, social-media or marketplace page). Never invent a business or guess a website address. Prefer independent, owner-run businesses. Leave out chains, franchises, national brands, directories, lead-generation sites and anything you can't confirm is a real local business.`;

export function buildDiscoverySearchPrompt(trade: string, town: string, count: number, known: string[]): string {
  return `Find up to ${count} independent ${trade} businesses based in or serving ${town}.

For each, give: the business name, its own website address, and the town it is in.
${known.length ? `\nSkip these, which we already know about: ${known.slice(0, 60).join("; ")}.\n` : ""}
Include only businesses that have their own website. If you find fewer than ${count}, list only the ones you are sure of.`;
}

export const DISCOVERY_EXTRACT_SYSTEM_PROMPT = `You turn research notes into a clean list of businesses. Copy names and website addresses exactly as written in the notes. Never add, correct or guess a website address. If a business has no website in the notes, set its website to null.`;

// Directories, social networks, marketplaces and big chains are never prospects.
const BLOCKED_HOSTS = [
  "facebook.com", "instagram.com", "youtube.com", "tiktok.com", "linkedin.com", "twitter.com", "x.com", "pinterest.com", "nextdoor.com",
  "yelp.com", "angi.com", "angieslist.com", "homeadvisor.com", "thumbtack.com", "houzz.com", "porch.com", "bbb.org", "yellowpages.com", "mapquest.com",
  "google.com", "goo.gl", "bing.com", "apple.com", "tripadvisor.com", "groupon.com", "indeed.com", "glassdoor.com", "manta.com", "alignable.com",
  "wikipedia.org", "reddit.com", "amazon.com", "etsy.com", "ebay.com", "craigslist.org", "linktr.ee", "godaddysites.com", "business.site",
  "homedepot.com", "lowes.com", "sears.com", "roto-rooter.com", "mrrooter.com", "servicemaster.com", "stanleysteemer.com", "chemdry.com", "mrelectric.com", "benjaminfranklinplumbing.com",
];

export const blockedHost = (host: string): boolean => {
  const h = host.toLowerCase().replace(/^www\./, "");
  return BLOCKED_HOSTS.some((b) => h === b || h.endsWith(`.${b}`));
};

export interface Candidate {
  name: string;
  website: string;
  town: string | null;
}

// Business → something we can research: a real website we haven't seen, and not a directory.
// `known` holds the host keys of every prospect so far, and is updated as candidates are accepted.
export function toCandidates(found: DiscoveredBusiness[], known: Set<string>): { accepted: Candidate[]; rejected: { name: string; why: string }[] } {
  const accepted: Candidate[] = [];
  const rejected: { name: string; why: string }[] = [];
  for (const b of found) {
    const name = b.name.trim();
    if (!name) continue;
    const website = b.website ? normalizeWebsite(b.website) : null;
    if (!website) {
      rejected.push({ name, why: "no website" });
      continue;
    }
    const host = new URL(website).hostname;
    if (!isPublicHostname(host) || blockedHost(host)) {
      rejected.push({ name, why: "not a business website" });
      continue;
    }
    const key = hostKey(website);
    if (known.has(key)) {
      rejected.push({ name, why: "already known" });
      continue;
    }
    known.add(key);
    accepted.push({ name, website, town: b.town?.trim() || null });
  }
  return { accepted, rejected };
}

// ---- Is this the right website, and who do we email? ----

const GENERIC_NAME_WORDS = new Set([
  "the", "and", "of", "llc", "inc", "co", "corp", "company", "services", "service", "solutions", "group", "enterprises", "associates", "pros", "pro",
  "plumbing", "heating", "cooling", "electric", "electrical", "roofing", "landscaping", "lawn", "care", "cleaning", "painting", "paving", "construction",
  "contracting", "contractors", "contractor", "builders", "remodeling", "renovation", "hvac", "mobile", "auto", "detailing", "repair", "home", "master",
]);

// The model can attach the wrong website to a business. A real match mentions at least one of the
// name's distinctive words (on the page or in the domain). Names made only of generic words pass.
export function siteMatchesBusiness(name: string, facts: Pick<PageFacts, "url" | "title" | "h1" | "text">): boolean {
  const words = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !GENERIC_NAME_WORDS.has(w));
  if (words.length === 0) return true;
  const haystack = `${facts.title ?? ""} ${facts.h1.join(" ")} ${facts.text} ${new URL(facts.url).hostname}`.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const squashed = haystack.replace(/ /g, "");
  return words.some((w) => haystack.includes(w) || squashed.includes(w));
}

const BAD_EMAIL = /(^|[._-])(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|abuse|webmaster|privacy|unsubscribe)([._-]|@)|@(sentry|wixpress|example|domain|email|yoursite|yourdomain|test)\.|\.(png|jpe?g|gif|webp|svg|css|js)$/i;
const PREFERRED = ["info", "contact", "hello", "office", "service", "support", "sales", "admin", "quotes", "estimates", "book", "booking"];

// The address most likely to reach a person: on their own domain, and a general inbox over a
// named one.
export function pickEmail(emails: string[], website: string): string | null {
  const host = hostKey(website).split("/")[0];
  const valid = emails.map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !BAD_EMAIL.test(e));
  if (valid.length === 0) return null;
  const rank = (e: string) => {
    const [local, domain] = e.split("@");
    const own = domain === host || domain.endsWith(`.${host}`) || host.endsWith(`.${domain}`);
    const general = PREFERRED.indexOf(local);
    return (own ? 0 : 100) + (general === -1 ? 50 : general);
  };
  return [...valid].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))[0];
}

// ---- The email ----

export interface EmailParts {
  subject: string;
  text: string;
  attachmentName: string;
}

const safeFilename = (s: string) => s.replace(/[^\w &.-]+/g, "").replace(/\s+/g, " ").trim().slice(0, 60) || "Business";

export function buildEmail(input: { businessName: string; subject: string | null; message: string; postalAddress?: string | null }): EmailParts {
  const footer = [
    "--",
    `${OUTREACH.sender} · ${OUTREACH.role} · ${OUTREACH.location}`,
    `${OUTREACH.phone} · ${OUTREACH.site}`,
    "",
    `Not interested? Just reply "no thanks" and I won't email you again.`,
    ...(input.postalAddress ? [input.postalAddress] : []),
  ];
  const subject = (input.subject ?? "").replace(/[\r\n]+/g, " ").trim() || `A quick look at ${input.businessName} online`;
  return {
    subject: subject.slice(0, 120),
    text: `${input.message.trim()}\n\n${footer.join("\n")}\n`,
    attachmentName: `A quick look at ${safeFilename(input.businessName)}.pdf`,
  };
}

const wrap76 = (b64: string) => b64.replace(/.{1,76}/g, "$&\r\n").trimEnd();

// RFC 2047 so a subject with accents or dashes survives.
const encodeHeader = (value: string) => (/^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`);

const MIME_HEADER_INJECTION = /[\r\n]/;

// A multipart email (text + PDF) as the raw message Gmail's drafts API takes (base64url).
export function buildRawEmail(input: { to: string; subject: string; text: string; attachment: { filename: string; data: Buffer; contentType: string }; boundary?: string }): string {
  if (MIME_HEADER_INJECTION.test(input.to) || MIME_HEADER_INJECTION.test(input.subject) || MIME_HEADER_INJECTION.test(input.attachment.filename)) {
    throw new Error("Email headers can't contain line breaks.");
  }
  const boundary = input.boundary ?? `jtb-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const filename = encodeHeader(input.attachment.filename);
  const lines = [
    `To: ${input.to}`,
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(input.text, "utf8").toString("base64")),
    `--${boundary}`,
    `Content-Type: ${input.attachment.contentType}; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(input.attachment.data.toString("base64")),
    `--${boundary}--`,
    "",
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}
