import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeminiClient } from "./gemini";

vi.mock("server-only", () => ({}));
vi.mock("./visual", () => ({ captureSite: vi.fn(), launchBrowser: vi.fn() }));

let gmail: { configured: boolean; address: string | null; from: string | null } = { configured: true, address: "jake@gmail.com", from: "jake@gmail.com" };
let loginError: Error | null = null;
vi.mock("./gmail", () => ({
  gmailStatus: () => gmail,
  checkGmailLogin: async () => {
    if (loginError) throw loginError;
  },
  createGmailDraft: vi.fn(),
}));

// A small in-memory stand-in for the tables these functions use.
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
let nextId = 1;

class Query {
  private filters: [string, unknown][] = [];
  private order?: { col: string; asc: boolean };
  private max?: number;
  private pending: Row[] | null = null;
  constructor(
    private table: string,
    private action: "select" | "update" | "insert",
    private payload?: Row | Row[],
  ) {}
  select() {
    if (this.action === "insert") {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload!]).map((r) => ({ id: `id${nextId++}`, created_at: new Date(nextId * 1000).toISOString(), ...r }));
      tables[this.table].push(...rows);
      this.pending = rows;
    }
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push([col, value]);
    return this;
  }
  orderBy(col: string, asc: boolean) {
    this.order = { col, asc };
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  private rows(): Row[] {
    if (this.pending) return this.pending;
    let rows = tables[this.table].filter((r) => this.filters.every(([c, v]) => r[c] === v));
    if (this.order) {
      const { col, asc } = this.order;
      rows = [...rows].sort((a, b) => (String(a[col] ?? "") < String(b[col] ?? "") ? -1 : 1) * (asc ? 1 : -1));
    }
    return this.max === undefined ? rows : rows.slice(0, this.max);
  }
  single() {
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }
  maybeSingle() {
    return this.single();
  }
  then(resolve: (v: { data: unknown; error: null }) => unknown) {
    if (this.action === "update") {
      tables[this.table].filter((r) => this.filters.every(([c, v]) => r[c] === v)).forEach((r) => Object.assign(r, this.payload));
      return Promise.resolve({ data: null, error: null }).then(resolve);
    }
    return Promise.resolve({ data: this.rows(), error: null }).then(resolve);
  }
}

vi.mock("./supabase", () => ({
  db: () => ({
    from: (table: string) => {
      const q = (action: "select" | "update" | "insert", payload?: Row | Row[]) => {
        const query = new Query(table, action, payload);
        // supabase-js spells ordering `order`; keep the class method name free for `select`.
        return Object.assign(query, { order: (col: string, o?: { ascending?: boolean }) => query.orderBy(col, o?.ascending !== false) });
      };
      return { select: () => q("select"), update: (v: Row) => q("update", v), insert: (v: Row | Row[]) => q("insert", v) };
    },
  }),
}));

const { discoverForSearch, draftProspect, processProspect, redraftExisting, runOutreachLoop } = await import("./outreach-auto");

const prospect = (over: Row = {}): Row => ({
  id: "p1",
  created_at: "2026-10-18T00:00:00Z",
  business_name: "Smith & Sons Plumbing",
  website: "https://smithplumbing.com",
  owner_name: null,
  city: "Foxboro, MA",
  notes: null,
  status: "queued",
  research: null,
  one_pager: null,
  message: null,
  subject: null,
  email: null,
  source: "auto",
  search_id: null,
  attempts: 0,
  draft_state: "none",
  gmail_draft_id: null,
  drafted_at: null,
  draft_error: null,
  skip_reason: null,
  ...over,
});

const facts = (over: Row = {}) =>
  ({
    url: "https://smithplumbing.com",
    title: "Smith Plumbing",
    h1: ["Plumbing"],
    text: "Smith & Sons since 1998",
    emails: ["info@smithplumbing.com"],
    pagesRead: ["https://smithplumbing.com"],
    ...over,
  }) as never;

const sheet = {
  owner_name: null,
  google_listing: "g",
  website_and_phone: "w",
  reviews_and_local_search: "r",
  problem: "p",
  solution: { custom_website: true, google_business_profile: false, local_seo: false, booking_quote_form: false, logo_branding: false },
  solution_note: "n",
  automations: [{ idea: "Missed-call text-back", problem: "Calls probably go to voicemail on jobs.", how: "It texts callers back in seconds." }],
  free_value: { homepage_mockup: true, google_listing_fix: false, review_link_qr: false, site_audit: false },
  free_value_other: null,
};

// A research stand-in that saves a sheet the way researchProspect does.
const research = (ok = true) =>
  vi.fn(async (id: string) => {
    if (!ok) return { ok: false, error: "Gemini is overloaded", usage: { inputTokens: 0, outputTokens: 0, costUsd: 0.01 } };
    Object.assign(tables.outreach_prospects.find((r) => r.id === id)!, { one_pager: sheet, message: "Hi Pat. Jake", subject: "A quick look at Smith", status: "draft", research: { facts: facts() } });
    return { ok: true, usage: { inputTokens: 100, outputTokens: 100, costUsd: 0.05 } };
  });

function deps(over: Record<string, unknown> = {}) {
  const createDraft = vi.fn(async () => ({ id: "draft-1" }));
  return {
    createDraft,
    deps: {
      readSite: vi.fn(async () => facts()),
      research: research(),
      createDraft,
      ...over,
    } as never,
  };
}

const row = (id: string) => tables.outreach_prospects.find((r) => r.id === id)!;

beforeEach(() => {
  tables.outreach_prospects = [prospect()];
  tables.outreach_searches = [];
  tables.outreach_runs = [];
  gmail = { configured: true, address: "jake@gmail.com", from: "jake@gmail.com" };
  loginError = null;
  nextId = 1;
});

describe("processProspect", () => {
  it("researches, drafts and puts the email in Gmail", async () => {
    const d = deps();
    const outcome = await processProspect("p1", d.deps);
    expect(outcome.state).toBe("created");
    expect(d.createDraft).toHaveBeenCalledTimes(1);
    const sent = (d.createDraft.mock.calls[0] as unknown as [{ to: string; subject: string; text: string }])[0];
    expect(sent).toMatchObject({ to: "info@smithplumbing.com", subject: "A quick look at Smith" });
    // The opening, then the one-pager's four parts.
    expect(sent.text.startsWith("Hi Pat. Jake")).toBe(true);
    for (const part of ["- Google listing: g", "What this may mean for your customers", "How I can help", "A few AI automations", "- Missed-call text-back: Calls probably go to voicemail on jobs.", "Free, no strings", 'reply "no thanks"']) expect(sent.text).toContain(part);
    expect(Object.keys(sent)).toEqual(["to", "subject", "text"]);
    expect(row("p1")).toMatchObject({ status: "draft", draft_state: "created", gmail_draft_id: "draft-1", email: "info@smithplumbing.com", draft_error: null });
    expect(outcome.costUsd).toBe(0.05);
  });

  it("skips, without spending on the AI, when there's no email on the site", async () => {
    const d = deps({ readSite: vi.fn(async () => facts({ emails: [] })) });
    const outcome = await processProspect("p1", d.deps);
    expect(outcome.state).toBe("no_email");
    expect(row("p1")).toMatchObject({ status: "passed", draft_state: "no_email" });
    expect((d.deps as { research: ReturnType<typeof vi.fn> }).research).not.toHaveBeenCalled();
    expect(d.createDraft).not.toHaveBeenCalled();
  });

  it("skips a website that isn't theirs, or can't be read", async () => {
    const wrong = deps({ readSite: vi.fn(async () => facts({ title: "Best Pizza", text: "Order a pie", url: "https://pizza.example" })) });
    expect((await processProspect("p1", wrong.deps)).state).toBe("skipped");
    expect(row("p1").skip_reason).toMatch(/doesn't look like this business/);

    tables.outreach_prospects = [prospect()];
    const down = deps({ readSite: vi.fn(async () => { throw new Error("The site returned HTTP 500."); }) });
    expect((await processProspect("p1", down.deps)).state).toBe("skipped");
    expect(row("p1").skip_reason).toMatch(/Couldn't read their website: The site returned HTTP 500/);
  });

  it("retries a failed research once, then gives up", async () => {
    const d = deps({ research: research(false) });
    expect((await processProspect("p1", d.deps)).state).toBe("retry");
    expect(row("p1")).toMatchObject({ status: "queued", attempts: 1 });
    expect((await processProspect("p1", d.deps)).state).toBe("failed");
    expect(row("p1")).toMatchObject({ status: "passed", draft_state: "failed", attempts: 2 });
    expect(String(row("p1").skip_reason)).toContain("Gemini is overloaded");
  });

  it("keeps the sheet and records the error when Gmail refuses", async () => {
    const d = deps({ createDraft: vi.fn(async () => { throw new Error("Google hasn't allowed Gmail drafts yet."); }) });
    const outcome = await processProspect("p1", d.deps);
    expect(outcome.state).toBe("failed");
    expect(row("p1")).toMatchObject({ status: "draft", draft_state: "failed", draft_error: "Google hasn't allowed Gmail drafts yet." });
    expect(row("p1").one_pager).toBeTruthy();
  });

  it("ignores a prospect that isn't queued, so a re-run never doubles up", async () => {
    tables.outreach_prospects = [prospect({ status: "draft", draft_state: "created" })];
    const d = deps();
    expect((await processProspect("p1", d.deps)).state).toBe("skipped");
    expect(d.createDraft).not.toHaveBeenCalled();
  });
});

describe("draftProspect", () => {
  it("uses the address you give over the one found", async () => {
    tables.outreach_prospects = [prospect({ status: "draft", one_pager: sheet, message: "Hi", subject: null, email: "old@x.example" })];
    const d = deps();
    const outcome = await draftProspect("p1", { to: "pat@smithplumbing.com", deps: d.deps });
    expect(outcome.state).toBe("created");
    expect((d.createDraft.mock.calls[0] as unknown as [{ to: string }])[0].to).toBe("pat@smithplumbing.com");
    expect(row("p1").email).toBe("pat@smithplumbing.com");
  });

  it("reports no email when there's no address anywhere", async () => {
    tables.outreach_prospects = [prospect({ status: "draft", one_pager: sheet, message: "Hi", research: { facts: facts({ emails: [] }) } })];
    expect((await draftProspect("p1", { deps: deps().deps })).state).toBe("no_email");
  });

  it("needs a sheet first", async () => {
    expect(await draftProspect("p1", { deps: deps().deps })).toMatchObject({ state: "failed", reason: "There's no sheet to send yet." });
  });
});

function discoveryClient(businesses: { name: string; website: string | null; town: string | null }[]): GeminiClient {
  return {
    search: vi.fn(async () => ({ text: "notes", sources: [], inputTokens: 1000, outputTokens: 500 })),
    generateJson: vi.fn(async (req) => ({ parsed: req.schema.parse({ businesses }), inputTokens: 500, outputTokens: 200 })) as never,
  };
}

describe("redraftExisting", () => {
  it("saves each already-drafted prospect to Gmail again and leaves the others alone", async () => {
    tables.outreach_prospects = [
      prospect({ id: "a", status: "draft", draft_state: "created", one_pager: sheet, message: "Hi A", email: "a@a.example" }),
      prospect({ id: "b", status: "passed", draft_state: "no_email" }),
      prospect({ id: "c", status: "draft", draft_state: "created", one_pager: sheet, message: "Hi C", email: "c@c.example", website: "https://c.example" }),
    ];
    const d = deps();
    const result = await redraftExisting(d.deps);
    expect(result).toEqual({ created: 2, failed: 0 });
    expect(d.createDraft).toHaveBeenCalledTimes(2);
    expect((d.createDraft.mock.calls as unknown as [{ to: string }][]).map((c) => c[0].to)).toEqual(["a@a.example", "c@c.example"]);
  });

  it("counts failures and keeps the first reason", async () => {
    tables.outreach_prospects = [prospect({ id: "a", status: "draft", draft_state: "created", one_pager: sheet, message: "Hi", email: "a@a.example" })];
    const d = deps({ createDraft: vi.fn(async () => { throw new Error("Gmail rejected the address or app password."); }) });
    expect(await redraftExisting(d.deps)).toEqual({ created: 0, failed: 1, error: "Gmail rejected the address or app password." });
  });
});

describe("discoverForSearch", () => {
  const search = { id: "s1", created_at: "", trade: "plumbers", town: "Foxboro, MA", enabled: true, last_run_at: null };

  it("queues new businesses, skipping known hosts, directories and sites without one", async () => {
    tables.outreach_searches = [{ ...search }];
    const client = discoveryClient([
      { name: "Smith & Sons Plumbing", website: "https://www.smithplumbing.com", town: "Foxboro" }, // already a prospect
      { name: "Doe Plumbing", website: "doeplumbing.net", town: "Mansfield" },
      { name: "Roe Pipes", website: "https://yelp.com/biz/roe", town: null },
      { name: "No Site Plumbing", website: null, town: null },
      { name: "Poe Plumbing", website: "poeplumbing.com", town: null },
    ]);
    const found = await discoverForSearch(search, 5, client);
    expect(found.ids).toHaveLength(2);
    const added = tables.outreach_prospects.filter((r) => r.source === "auto" && r.id !== "p1");
    expect(added.map((r) => [r.business_name, r.website, r.city, r.status, r.search_id])).toEqual([
      ["Doe Plumbing", "https://doeplumbing.net", "Mansfield", "queued", "s1"],
      ["Poe Plumbing", "https://poeplumbing.com", "Foxboro, MA", "queued", "s1"],
    ]);
    expect(found.usage.costUsd).toBeGreaterThan(0);
    expect(tables.outreach_searches[0].last_run_at).toBeTruthy();
  });

  it("only takes as many as asked for", async () => {
    tables.outreach_searches = [{ ...search }];
    const client = discoveryClient([
      { name: "A Plumbing", website: "a-plumbing.com", town: null },
      { name: "B Plumbing", website: "b-plumbing.com", town: null },
      { name: "C Plumbing", website: "c-plumbing.com", town: null },
    ]);
    expect((await discoverForSearch(search, 2, client)).ids).toHaveLength(2);
  });
});

describe("runOutreachLoop", () => {
  const ok = { state: "created" as const, costUsd: 0.04 };

  it("won't run until Gmail is set up", async () => {
    gmail = { configured: false, address: null, from: null };
    const runOne = vi.fn();
    const result = await runOutreachLoop({ trigger: "manual", runOne });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/GMAIL_ADDRESS and GMAIL_APP_PASSWORD/);
    expect(runOne).not.toHaveBeenCalled();
    expect(tables.outreach_runs[0].error).toMatch(/GMAIL_APP_PASSWORD/);
    expect(tables.outreach_runs[0].finished_at).toBeTruthy();
  });

  it("stops before searching or researching when the app password is rejected", async () => {
    loginError = new Error("Gmail rejected the address or app password.");
    const runOne = vi.fn();
    const client = discoveryClient([]);
    const result = await runOutreachLoop({ trigger: "cron", runOne, client });
    expect(result).toMatchObject({ ok: false, error: "Gmail rejected the address or app password." });
    expect(runOne).not.toHaveBeenCalled();
    expect(client.search).not.toHaveBeenCalled();
  });

  it("handles the queue first, then tops up from saved searches, and logs the run", async () => {
    tables.outreach_searches = [{ id: "s1", created_at: "", trade: "plumbers", town: "Foxboro, MA", enabled: true, last_run_at: null }];
    const runOne = vi.fn(async (id: string) => (id === "p1" ? ok : { state: "no_email" as const, costUsd: 0 }));
    const client = discoveryClient([{ name: "Doe Plumbing", website: "doeplumbing.net", town: null }]);
    const result = await runOutreachLoop({ trigger: "cron", runOne, client });

    expect(result).toMatchObject({ ok: true, found: 1, drafted: 1, noEmail: 1, failed: 0 });
    expect(runOne.mock.calls.map((c) => c[0])[0]).toBe("p1");
    expect(runOne).toHaveBeenCalledTimes(2);
    expect(result.costUsd).toBeGreaterThan(0.04);
    expect(tables.outreach_runs[0]).toMatchObject({ trigger: "cron", found: 1, drafted: 1, no_email: 1, failed: 0, error: null });
  });

  it("doesn't search when the queue is already full", async () => {
    const stacked = Array.from({ length: 6 }, (_, i) => prospect({ id: `q${i}`, created_at: `2026-10-18T00:0${i}:00Z`, website: `https://q${i}.example` }));
    tables.outreach_prospects = stacked;
    tables.outreach_searches = [{ id: "s1", created_at: "", trade: "plumbers", town: "Foxboro, MA", enabled: true, last_run_at: null }];
    const client = discoveryClient([]);
    await runOutreachLoop({ trigger: "cron", runOne: async () => ok, client });
    expect(client.search).not.toHaveBeenCalled();
  });

  it("counts a crashed business as failed and keeps going", async () => {
    tables.outreach_prospects = [prospect({ id: "a" }), prospect({ id: "b", website: "https://b.example" })];
    const runOne = vi.fn(async (id: string) => {
      if (id === "a") throw new Error("HTTP 504");
      return ok;
    });
    const result = await runOutreachLoop({ trigger: "cron", runOne, client: discoveryClient([]) });
    expect(result).toMatchObject({ ok: true, drafted: 1, failed: 1, error: "HTTP 504" });
  });

  it("shares the open places between the saved searches", async () => {
    tables.outreach_prospects = [];
    tables.outreach_searches = ["plumbers", "roofers", "landscapers"].map((trade, i) => ({ id: `s${i}`, created_at: "", trade, town: "Foxboro, MA", enabled: true, last_run_at: null }));
    const client = discoveryClient([]);
    await runOutreachLoop({ trigger: "cron", runOne: async () => ok, client });
    const asked = (client.search as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[0] as { prompt: string }).prompt);
    // 6 places across 3 searches: 2 each (and a few extra requested to allow for rejects).
    expect(asked).toHaveLength(3);
    for (const prompt of asked) expect(prompt).toContain("Find up to 6 independent");
  });

  it("keeps going when one saved search fails", async () => {
    tables.outreach_prospects = [];
    tables.outreach_searches = [
      { id: "s1", created_at: "", trade: "plumbers", town: "Foxboro, MA", enabled: true, last_run_at: null },
      { id: "s2", created_at: "", trade: "roofers", town: "Foxboro, MA", enabled: true, last_run_at: "2026-10-01T00:00:00Z" },
    ];
    let calls = 0;
    const client: GeminiClient = {
      search: vi.fn(async () => {
        if (calls++ === 0) throw new Error("quota");
        return { text: "n", sources: [], inputTokens: 1, outputTokens: 1 };
      }),
      generateJson: vi.fn(async (req) => ({ parsed: req.schema.parse({ businesses: [{ name: "Ace Roofing", website: "aceroofing.com", town: null }] }), inputTokens: 1, outputTokens: 1 })) as never,
    };
    const result = await runOutreachLoop({ trigger: "cron", runOne: async () => ok, client });
    expect(result).toMatchObject({ ok: true, found: 1, drafted: 1 });
    expect(result.error).toMatch(/plumbers in Foxboro, MA failed: quota/);
  });
});
