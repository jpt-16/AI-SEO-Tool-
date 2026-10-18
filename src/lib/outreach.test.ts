import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeminiClient } from "./gemini";

vi.mock("server-only", () => ({}));
vi.mock("./visual", () => ({
  captureSite: vi.fn(async (urls: string[]) => [
    {
      url: urls[0],
      score: { score: 58, checks: [{ key: "mobile", label: "Fits a phone screen", points: 20, max: 20, detail: "ok" }, { key: "tapTargets", label: "Tap targets", points: 5, max: 15, detail: "6 of 9 too small." }] },
      metrics: { aboveFold: { cta: false, ctaText: null } },
    },
  ]),
}));

// An in-memory stand-in for the one table these functions use.
const rows = new Map<string, Record<string, unknown>>();
vi.mock("./supabase", () => ({
  db: () => ({
    from: () => ({
      select: () => ({
        eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: rows.get(id) ?? null, error: null }) }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: async (_c: string, id: string) => {
          rows.set(id, { ...rows.get(id), ...values });
          return { error: null };
        },
      }),
    }),
  }),
}));

const { researchProspect, readSite } = await import("./outreach");

const HTML = `<html><head><title>Smith Plumbing</title></head><body><h1>Plumbing</h1><a href="/contact">Contact</a><p>Call (508) 555-0142</p></body></html>`;
const CONTACT = `<html><body><a href="mailto:hi@smith.example">Email</a></body></html>`;

const fakeFetch = (async (url: string) => {
  const body = url.endsWith("/contact") ? CONTACT : url.endsWith("/missing") ? "" : HTML;
  const res = new Response(body, { status: url.endsWith("/missing") ? 404 : 200, headers: { "content-type": "text/html" } });
  // Response.url is read-only; a real fetch reports the final URL after redirects.
  Object.defineProperty(res, "url", { value: url });
  return res;
}) as unknown as typeof fetch;

const draft = {
  owner_name: "Pat Smith",
  google_listing: "No listing found.",
  website_and_phone: "Phone is plain text.",
  reviews_and_local_search: "No reviews found.",
  problem: "Customers may struggle to call.",
  solution: { custom_website: true, google_business_profile: true, local_seo: true, booking_quote_form: false, logo_branding: false },
  solution_note: "A listing and tap-to-call.",
  free_value: { homepage_mockup: true, google_listing_fix: true, review_link_qr: false, site_audit: false },
  free_value_other: null,
  subject: "A quick look at Smith Plumbing online",
  message: "Hi Pat. Jake",
  unverified: ["Confirm there's no listing."],
};

function client(overrides: Partial<GeminiClient> = {}) {
  const calls = { search: 0, generate: 0, prompts: [] as string[] };
  const c: GeminiClient = {
    async search() {
      calls.search++;
      return { text: "- Listing: not found", sources: [{ title: "Yelp", url: "https://yelp.example/s" }], inputTokens: 1000, outputTokens: 500 };
    },
    async generateJson(request) {
      calls.generate++;
      calls.prompts.push(request.prompt);
      return { parsed: request.schema.parse(draft), inputTokens: 2000, outputTokens: 1000 } as never;
    },
    ...overrides,
  };
  return { c, calls };
}

beforeEach(() => {
  rows.clear();
  rows.set("p1", { id: "p1", business_name: "Smith Plumbing", website: "https://smith.example", owner_name: null, city: "Foxboro, MA", notes: "No listing that I can see", status: "draft" });
});

describe("readSite", () => {
  it("reads the homepage and its contact page", async () => {
    const facts = await readSite("https://smith.example", fakeFetch);
    expect(facts.pagesRead).toEqual(["https://smith.example", "https://smith.example/contact"]);
    expect(facts.emails).toEqual(["hi@smith.example"]);
    expect(facts.phones).toEqual(["(508) 555-0142"]);
  });

  it("refuses private addresses and error pages", async () => {
    await expect(readSite("http://127.0.0.1", fakeFetch)).rejects.toThrow(/public website/);
    await expect(readSite("https://smith.example/missing", fakeFetch)).rejects.toThrow(/HTTP 404/);
  });
});

describe("researchProspect", () => {
  it("saves the sheet, message, research and cost", async () => {
    const { c, calls } = client();
    const result = await researchProspect("p1", { client: c, fetchImpl: fakeFetch });
    expect(result.ok).toBe(true);
    expect(calls).toMatchObject({ search: 1, generate: 1 });

    const row = rows.get("p1")!;
    expect(row.owner_name).toBe("Pat Smith");
    expect(row.message).toBe("Hi Pat. Jake");
    expect(row.unverified).toEqual(["Confirm there's no listing."]);
    expect(row.research_error).toBeNull();
    expect((row.research as { facts: { pagesRead: string[] }; factsError: string | null })).toMatchObject({ factsError: null, facts: { pagesRead: ["https://smith.example", "https://smith.example/contact"] } });
    expect(Object.keys(row.one_pager as object)).not.toContain("message");
    // 3000 in + 1500 out tokens, at the model's per-million prices.
    expect(Number(row.cost_usd)).toBeGreaterThan(0);

    const research = row.research as { capture: { score: number; problems: string[]; fitsPhone: boolean }; search: { sources: unknown[] } };
    expect(research.capture).toMatchObject({ score: 58, fitsPhone: true, problems: ["Tap targets: 6 of 9 too small."] });
    expect(research.search.sources).toHaveLength(1);
    expect(calls.prompts[0]).toContain("No listing that I can see");
    expect(calls.prompts[0]).toContain("58/100");
  });

  it("keeps the owner the sender gave", async () => {
    rows.set("p1", { ...rows.get("p1"), owner_name: "Dana Smith" });
    await researchProspect("p1", { client: client().c, fetchImpl: fakeFetch });
    expect(rows.get("p1")!.owner_name).toBe("Dana Smith");
  });

  it("still drafts when the search fails, and says so in the prompt", async () => {
    const { c, calls } = client({
      async search() {
        throw new Error("quota exceeded");
      },
    });
    const result = await researchProspect("p1", { client: c, fetchImpl: fakeFetch });
    expect(result.ok).toBe(true);
    expect((rows.get("p1")!.research as { searchError: string }).searchError).toBe("quota exceeded");
    expect(calls.prompts[0]).toContain("Not available: quota exceeded");
  });

  it("skips the search and capture when asked", async () => {
    const { c, calls } = client();
    await researchProspect("p1", { client: c, fetchImpl: fakeFetch, search: false, capture: false });
    expect(calls.search).toBe(0);
    const research = rows.get("p1")!.research as { search: unknown; capture: unknown };
    expect(research.search).toBeNull();
    expect(research.capture).toBeNull();
  });

  it("still drafts from the notes when the site can't be read", async () => {
    const down = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    const { c, calls } = client();
    const result = await researchProspect("p1", { client: c, fetchImpl: down });
    expect(result.ok).toBe(true);
    expect(calls.prompts[0]).toContain("Couldn't read the site");
  });

  it("records the failure when the draft itself fails", async () => {
    const { c } = client({
      async generateJson() {
        throw new Error("Gemini's answer was cut off (max tokens).");
      },
    });
    const result = await researchProspect("p1", { client: c, fetchImpl: fakeFetch });
    expect(result).toMatchObject({ ok: false, error: "Gemini's answer was cut off (max tokens)." });
    expect(rows.get("p1")!.research_error).toBe("Gemini's answer was cut off (max tokens).");
    expect(rows.get("p1")!.one_pager).toBeUndefined();
  });

  it("reports a missing prospect", async () => {
    expect(await researchProspect("nope", { client: client().c })).toMatchObject({ ok: false });
  });
});
