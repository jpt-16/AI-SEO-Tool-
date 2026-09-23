# JT Builds Co. — SEO Workbench

Internal SEO tool for auditing JT Builds Co. client sites. **Phase 1** connects Google Search Console
(read-only) and pulls the last 90 days of query + page performance into Supabase, starting with
Clover Downs Detailing (`cloverdownsdetailing.com`).

Stack: Next.js 16 (App Router) · Tailwind CSS 4 · Supabase (Postgres) · Vercel (hosting + daily cron).
Styled with the "Nocturne" tokens from jtbuildsco.com.

## What it does

- **Google OAuth2** with the `webmasters.readonly` scope (plus `openid email` to show which account is
  connected). The refresh token is AES-256-GCM encrypted before it's stored and never reaches the browser.
- **Sync** pulls Search Analytics for the last 90 days (ending 2 days ago, Pacific time):
  - `date × query × page` rows → `gsc_search_analytics` (clicks, impressions, CTR, position), paging
    25,000 rows per request.
  - Daily totals for the last 180 days → `gsc_daily_totals`. These power the totals and the
    "vs prior 90 days" comparison, and match the Search Console UI because they include anonymized queries.
  - Re-syncing upserts, so running it twice never duplicates rows. Every run is logged in `gsc_sync_runs`.
- **Screens:** Connect → Search performance (totals, Queries/Pages tables, filter, CSV export) →
  Connections (account, property picker, daily sync toggle, sync history).
- **Triggers:** "Sync now" button, `POST /api/gsc/sync`, and a Vercel Cron job every day at 11:00 UTC.
- The app sits behind HTTP Basic auth (`ADMIN_USERNAME` / `ADMIN_PASSWORD`), except the public
  homepage, privacy policy and terms.

## Setup

### 1. Supabase

1. Create a project (or reuse one).
2. Run the files in `supabase/migrations/` in order — paste each into the SQL Editor, or
   `supabase link` + `supabase db push`. It creates the tables, two report functions, and a
   `sites` row for Clover Downs Detailing.
3. From **Project Settings → API**, copy the project URL and the **service role / secret** key.
   All tables have RLS on with no policies, so only that server-side key can read them.

### 2. Google Cloud

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project.
2. **APIs & Services → Library**: enable **Google Search Console API**.
3. **OAuth consent screen** (Google Auth Platform): user type **External**, add your email, and add the
   scope `.../auth/webmasters.readonly`.
4. **Publish the app** ("In production"). While it's in *Testing*, Google expires refresh tokens after
   7 days and syncs will start failing. You'll see an "unverified app" warning when you connect; that's
   expected for a private tool. Click **Advanced → Go to (app)**.
5. **Credentials → Create OAuth client ID → Web application**. Add these authorized redirect URIs:
   - `http://localhost:3000/api/auth/google/callback`
   - `https://<your-vercel-domain>/api/auth/google/callback`

### 3. Environment variables

Copy `.env.example` to `.env.local` and fill it in:

| Variable | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | From the OAuth client |
| `GOOGLE_REDIRECT_URI` | The callback URL for this environment (must match exactly) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | From Supabase |
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Your login for the app |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | From console.anthropic.com → API Keys (Blueprints feature) |

### 4. Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

Sign in with your admin login, click **Continue with Google**, and approve with the Google account that
has access to cloverdownsdetailing.com in Search Console. Then, on **Connections**, pick the property
(`sc-domain:cloverdownsdetailing.com` or the URL-prefix one) and click **Run sync now**.

### 5. Deploy to Vercel

1. Import the repo in Vercel.
2. Add all the environment variables above. Set `GOOGLE_REDIRECT_URI` to the production callback URL.
3. Deploy. The daily sync is registered automatically from `vercel.json`, and Vercel sends
   `CRON_SECRET` as a Bearer token.
4. Open the production URL and connect Google there. The connection is stored in Supabase, so it's shared
   by every environment that uses the same database.

## Public pages

`/` (what the tool is), `/privacy` and `/terms` are public; everything else stays behind the admin
login. Google needs all three reachable without signing in before it will verify the OAuth app and
move it out of Testing mode (which is what stops the 7-day token expiry). Operator details live in
`src/lib/legal.ts`; bump `LEGAL_UPDATED` when the policy changes. Every response also carries security
headers (HSTS, no framing, nosniff, strict referrer, permissions policy).

## API

```bash
# Sync every client with daily sync on
curl -u "$ADMIN_USERNAME:$ADMIN_PASSWORD" -X POST https://<domain>/api/gsc/sync

# Sync one client
curl -u "$ADMIN_USERNAME:$ADMIN_PASSWORD" -X POST "https://<domain>/api/gsc/sync?siteId=<uuid>"
```

Returns `{ results: [{ siteId, ok, rowsFetched, startDate, endDate, error? }] }`, with HTTP 502 if any
site failed.

## Crawler

`src/lib/crawl.ts` crawls a client site with `fetch` + Cheerio (every client site so far is
server-rendered, so no headless browser is needed). It seeds from the sitemap (found via `robots.txt`,
or `/sitemap.xml`) plus the homepage, follows internal links to catch pages missing from the sitemap,
and respects `robots.txt` rules for `User-agent: *`. For each page it stores the title tag, meta
description, all H1/H2 text, visible word count, internal link count and every JSON-LD block in
`crawl_pages`.

Rows are keyed by `(site_id, page_key)`. `page_key` is a normalized URL (no scheme, `www.`, query,
fragment or trailing slash), computed by the same `public.page_key()` function on
`gsc_search_analytics`, so `https://www.site.com/x/` in Search Console joins to the crawled
`https://site.com/x`. Re-running a crawl updates each page's row; it never adds duplicates.

Run it any of three ways:

```bash
npm run crawl                               # every site (reads .env.local; needs Node 22+)
npm run crawl -- cloverdownsdetailing.com   # one site
curl -u "$ADMIN_USERNAME:$ADMIN_PASSWORD" -X POST https://<domain>/api/crawl   # deployed app
```

Or click **Crawl site** on the Pages tab. Every site is also re-crawled automatically each Monday at
10:00 UTC (`/api/cron/crawl`, Bearer `CRON_SECRET`), each site in its own function call so each gets the
full 5-minute limit. On Vercel, visual capture stops starting new pages after 4 minutes; pages it
doesn't reach keep their previous scores and the crawl bar says so. The Pages tab shows every page's Search Console stats and top
queries next to its current title, meta description, H1 and content facts. Query words that don't appear
in the page's title are underlined.

## Visual scoring

Every crawl also opens each page in headless Chromium (`src/lib/visual.ts`) and scores its design
and usability on a phone screen, 0–100 (`src/lib/visual-core.ts`):

| Check | Points |
| --- | --- |
| Fits a phone screen: responsive viewport tag, no sideways scrolling | 20 |
| Readable text size: share of text at 12px or larger | 15 |
| Text contrast: share of text meeting WCAG AA (4.5:1, or 3:1 for large text) | 20 |
| Tap targets: 24×24px or spaced per WCAG 2.5.8 | 15 |
| First screen: an H1 and a call/text/quote/contact button visible without scrolling | 20 |
| Images: none broken, alt text present | 10 |

Captures are built to repeat exactly: one fixed 390×844 viewport, scale, user agent, locale and
timezone; wait for network idle (not just DOMContentLoaded); inject
`* { animation: none !important; transition: none !important; }` before the first paint and again after
load; scroll once through the page so lazy images and scroll-reveal content load, then wait for the
network to go quiet again; then a fixed 500ms settle before measuring and taking the first-screen
screenshot. Check it any time:

```bash
npm run visual-check -- https://cloverdownsdetailing.com/ https://jtbuildsco.com/pricing --runs=3
```

It captures each URL several times and compares the scores, every raw measurement and the screenshot
bytes. Tested on 30 pages across both sites over three crawls: 89 of 90 captures matched exactly, and the
one outlier was a page that came back without its header in one crawl, not a timing difference. Each
capture now records the page's HTTP status and failed requests, and the dashboard warns when either is
off. JavaScript-timed carousels are the one thing the freeze can't stop; they can change which slide
is captured.

Chromium comes from `@sparticuz/chromium` on Vercel, where it runs single-process, so each page gets
its own browser (about 5 seconds a page). Locally, set `CHROMIUM_PATH` or run
`npx playwright-core install chromium` once. `VISUAL_CAPTURE=off` skips the step. A failed capture never
fails the crawl.

## AEO / GEO checks

Static checks for AI answer engines (`src/lib/aeo.ts`); no model calls:

- **AI crawlers:** robots.txt is parsed per user-agent group for GPTBot, ClaudeBot, Google-Extended,
  PerplexityBot and anthropic-ai. Each is marked allowed, blocked (the home page is disallowed) or
  partly blocked (some crawled pages are disallowed), using its own group if it has one, else `*`.
- **llms.txt:** checks `/llms.txt` exists as text (not an HTML soft 404) with a `# Name` title, a `> `
  summary and links, and whether `/llms-full.txt` exists too.
- **Answer extractability, per page:** finds questions in `<details>`/`<summary>`, `<dt>`/`<dd>`,
  question headings, bold-question paragraphs and FAQPage schema, plus the page's opening paragraph.
  Each answer scores up to 100: a first block of 10–60 words (40), a first sentence of 25 words or
  fewer (30), and a first sentence that doesn't start with a pronoun like "It" or "This" (30).

Site results show on the Pages tab under the crawl bar. Each page gets Visual and Answers scores, with
the screenshot, each check and each question under "Visual and answer details".

## Site audit

The **Site audit** page (`src/lib/audit.ts`) turns the latest crawl into one list of problems, grouped by
type, most serious first, then by the search impressions of the pages affected:

- **High:** pages returning errors, AI crawlers blocked in robots.txt, missing titles, pages that
  don't fit a phone screen.
- **Medium:** pages Search Console shows but the crawler couldn't find, titles over 60 characters or
  duplicated, missing meta descriptions or H1s, low contrast, small text, crowded tap targets, no
  headline or call to action on the first screen, answers scoring under 70.
- **Low:** meta descriptions over 155 characters or duplicated, multiple H1s, under 300 words, no
  schema, not in the sitemap, image problems, failed captures, llms.txt problems.

Legal and contact pages skip the word-count, schema and call-to-action checks. **Mark fixed** hides an
issue (stored in `audit_fixes`) until a newer crawl still finds it; then it comes back, flagged as
still present. Issues are recomputed on every view, so nothing goes stale.

## Blueprints (AI review)

`src/lib/blueprints.ts` asks Claude (`claude-sonnet-4-6`, via the Messages API with adaptive thinking)
to review each page people are finding. For every page with more than 20 impressions in the last 90
days (adjustable) that the crawler has seen, it sends the page's title, meta description, H1/H2s, word
count, schema types and its top 5 queries (impressions, clicks, CTR, position). Claude returns
structured JSON, enforced with a Zod schema through `messages.parse()`:

```json
{ "blueprint": { "finding": "…", "reasoning": "…", "proposed_title": "…" | null,
                 "proposed_meta": "…" | null, "priority": "high" | "med" | "low",
                 "target_queries": ["…"] } | null,
  "no_change_reason": "…" | null }
```

`blueprint: null` means there's nothing worth changing. The prompt tells Claude that's a good outcome,
so it doesn't manufacture recommendations. Claude then gives a one-sentence `no_change_reason`, stored in
the run's `results` and listed under the last run on the Blueprints page. `target_queries` are the queries
the change is aimed at; any Claude cites that aren't in the data it saw are dropped. Each finding becomes a row in `blueprints` (`status` open /
done / skipped, `created_at`, `status_changed_at`, plus a `page_snapshot` of exactly what Claude saw).
A page with an open blueprint is skipped on later runs, and every run is logged in `blueprint_runs`.

Needs `ANTHROPIC_API_KEY`. Run it from the **Blueprints** page (**Analyze pages**, up to 10 pages per
click) or with the script:

```bash
npm run blueprints -- --dry-run                     # list qualifying pages, no API calls
npm run blueprints -- --min-impressions=10 --max-pages=5
```

## Results (attribution)

`src/lib/attribution.ts` measures whether a finished blueprint moved anything:

1. **Mark done** records `done_at` and a `baseline_snapshot`: clicks, impressions and
   impression-weighted average position for the page's target queries (combined and one by one) and for
   the whole page, over the 14 days before the change (or up to the last synced day).
2. **Every Search Console sync** (the daily cron, **Sync now**, or `POST /api/gsc/sync`) then looks for done
   blueprints without a `result_snapshot`. Once synced data covers the first 14 full days after the day
   it was marked done (so about 16 days later, given Search Console's 2-day lag), it stores the same numbers
   for that window as `result_snapshot`, plus `result_diff` (before / after / change) and `result_at`.
3. The **Results** page lists done blueprints by the biggest click increase on the targeted queries. Ones
   still waiting show their before numbers and the date the after window completes. The numbers are shown
   as they are, with no scoring.

Both snapshots come from the `blueprint_stats()` SQL function over the synced `gsc_search_analytics` rows,
so they're computed the same way. Reopening or skipping a done blueprint clears its measurement.

## Adding another client

```sql
insert into sites (name, domain) values ('Client Name', 'clientdomain.com');
```

Switch to it with the client picker in the sidebar, then pick its property on **Connections**.

## Data notes

- Search Console hides rare ("anonymized") queries from any request that includes the `query`
  dimension. The Queries table can therefore add up to less than the totals, which come from a
  date-only request.
- In the Queries table, impressions and position are rolled up across all of a query's landing pages.
  This can differ slightly from Search Console's query-only view.
- Dates are Pacific time, same as Search Console.

## Development

```bash
npm run typecheck
npm run lint
npm test
npm run build
```
