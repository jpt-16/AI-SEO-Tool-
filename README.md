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
- The whole app sits behind HTTP Basic auth (`ADMIN_USERNAME` / `ADMIN_PASSWORD`).

## Setup

### 1. Supabase

1. Create a project (or reuse one).
2. Run `supabase/migrations/20260922000000_gsc_connector.sql` — paste it into the SQL Editor, or
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

## API

```bash
# Sync every client with daily sync on
curl -u "$ADMIN_USERNAME:$ADMIN_PASSWORD" -X POST https://<domain>/api/gsc/sync

# Sync one client
curl -u "$ADMIN_USERNAME:$ADMIN_PASSWORD" -X POST "https://<domain>/api/gsc/sync?siteId=<uuid>"
```

Returns `{ results: [{ siteId, ok, rowsFetched, startDate, endDate, error? }] }`, with HTTP 502 if any
site failed.

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
