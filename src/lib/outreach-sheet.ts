// The one-pager's content, safe to import from client components (no server or HTML-parsing
// dependencies): the template's fixed text, the model's output shape and plain-text export.
import { z } from "zod";

// Printed on every sheet, from the one-pager template.
export const OUTREACH = {
  sender: "Jake",
  role: "Founder, JT Builds Co.",
  phone: "(781) 248-9834",
  contactUrl: "jtbuildsco.com/contact",
  location: "Foxboro, Massachusetts",
  site: "jtbuildsco.com",
  handle: "@JTBUI_LDS",
  price: "One monthly fee from $97. No setup cost, no contract. Cancel whenever you like.",
} as const;

export const SOLUTION_ITEMS = [
  { key: "custom_website", label: "Custom website" },
  { key: "google_business_profile", label: "Google Business Profile" },
  { key: "local_seo", label: "Local SEO" },
  { key: "booking_quote_form", label: "Booking / quote form" },
  { key: "logo_branding", label: "Logo & branding" },
] as const;

export const FREE_VALUE_ITEMS = [
  { key: "homepage_mockup", label: "Free homepage mockup" },
  { key: "google_listing_fix", label: "Free Google listing fix" },
  { key: "review_link_qr", label: "Free review link + QR code" },
  { key: "site_audit", label: "Free 1-page site audit" },
] as const;

const flags = <K extends string>(keys: readonly K[]) => z.object(Object.fromEntries(keys.map((k) => [k, z.boolean()])) as Record<K, z.ZodBoolean>);

// What the model returns. Field descriptions are part of the prompt.
export const OnePagerOutput = z.object({
  owner_name: z.string().nullable().describe("The owner's name only if the sources state it; otherwise null."),
  google_listing: z.string().describe("Section 01, row 'Google listing': what you found about their Google Business Profile. One or two short sentences, around 120 characters."),
  website_and_phone: z.string().describe("Section 01, row 'Website & phone': what you found about their website and how people reach them. One or two short sentences, around 120 characters."),
  reviews_and_local_search: z.string().describe("Section 01, row 'Reviews & local search': what you found about reviews and how they show up locally. One or two short sentences, around 120 characters."),
  problem: z.string().describe("Section 02: what these findings may mean for their customers, in plain words, 2 to 3 sentences, around 350 characters at most. Hedge with 'may' or 'could'."),
  solution: flags(SOLUTION_ITEMS.map((i) => i.key)).describe("Tick only the services that fix something named in the research."),
  solution_note: z.string().describe("Section 03 note: one or two sentences, around 160 characters, saying how those services fit this business."),
  free_value: flags(FREE_VALUE_ITEMS.map((i) => i.key)).describe("Tick the one to three free offers that best fit this business."),
  free_value_other: z.string().nullable().describe("Optional extra free offer, a few words, or null."),
  subject: z.string().describe("Email subject line: specific to this business, under 60 characters, plain, no hype, no clickbait, no ALL CAPS."),
  message: z.string().describe("The opening of the email, before the four sections: one or two warm sentences, first person as the sender, that mention one specific, genuine thing about this business. No greeting, no sign-off, no subject line, nothing about prices or services."),
  unverified: z.array(z.string()).describe("Things the sender should double-check before sending: anything uncertain, inferred, or from a single weak source. Empty if everything is solid."),
});

export type OnePagerDraft = z.infer<typeof OnePagerOutput>;

// The sheet as printed and edited (the draft minus the notes that aren't on it).
export const OnePagerSheet = OnePagerOutput.omit({ subject: true, message: true, unverified: true });
export type OnePagerSheetData = z.infer<typeof OnePagerSheet>;

export const sheetFromDraft = (d: OnePagerDraft): OnePagerSheetData => OnePagerSheet.parse(d);

export function formatToday(date: Date = new Date()): string {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
}

const firstName = (full: string | null) => full?.trim().split(/\s+/)[0] || null;
const GREETING = /^\s*(hi|hello|hey|dear|good (morning|afternoon))\b/i;

export interface Email {
  subject: string;
  text: string;
}

// The email that goes to Gmail: the one-pager's four sections (what we found, what it may mean,
// how we can help, what's free) written out as plain text, after a short personal opening.
export function composeEmail(input: {
  business: string;
  subject: string | null;
  opener: string;
  sheet: OnePagerSheetData;
  postalAddress?: string | null;
}): Email {
  const { sheet } = input;
  const ticked = <T extends { key: string; label: string }>(items: readonly T[], on: Record<string, boolean>) => items.filter((i) => on[i.key]).map((i) => i.label);
  const help = ticked(SOLUTION_ITEMS, sheet.solution);
  const free = [...ticked(FREE_VALUE_ITEMS, sheet.free_value), ...(sheet.free_value_other?.trim() ? [sheet.free_value_other.trim()] : [])];

  const opener = input.opener.trim();
  // Messages drafted before the opener existed already start with a greeting.
  const greeting = GREETING.test(opener) ? [] : [`Hi ${firstName(sheet.owner_name) ?? "there"},`, ""];

  const lines = [
    ...greeting,
    ...(opener ? [opener, ""] : []),
    `Here's what I found when I looked at ${input.business} online:`,
    "",
    `- Google listing: ${sheet.google_listing}`,
    `- Website & phone: ${sheet.website_and_phone}`,
    `- Reviews & local search: ${sheet.reviews_and_local_search}`,
    "",
    "What this may mean for your customers",
    sheet.problem,
    "",
    "How I can help",
    ...(help.length ? [`${help.join(", ")}.`] : []),
    sheet.solution_note,
    OUTREACH.price,
    "",
    "Free, no strings",
    ...(free.length ? [`${free.join(", ")}.`] : []),
    "",
    `Reply to this email, call ${OUTREACH.phone}, or visit ${OUTREACH.contactUrl}. I reply personally within one business day.`,
    "",
    OUTREACH.sender,
    `${OUTREACH.role} · ${OUTREACH.location}`,
    OUTREACH.site,
    "",
    `Not interested? Just reply "no thanks" and I won't email you again.`,
    ...(input.postalAddress ? [input.postalAddress] : []),
  ];
  const subject = (input.subject ?? "").replace(/[\r\n]+/g, " ").trim() || `A quick look at ${input.business} online`;
  return { subject: subject.slice(0, 120), text: `${lines.join("\n")}\n` };
}
