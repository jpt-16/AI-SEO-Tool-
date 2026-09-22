-- AI blueprints: one recommended change per page, produced by Claude from the
-- page's on-page data and its Search Console queries.

create table public.blueprint_runs (
  id bigint generated always as identity primary key,
  site_id uuid not null references public.sites (id) on delete cascade,
  trigger text not null check (trigger in ('manual', 'cron', 'api', 'script')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  model text not null,
  min_impressions integer not null,
  pages_considered integer,
  pages_analyzed integer,
  blueprints_created integer,
  -- Per-page outcome: [{page_key, outcome: "blueprint" | "none" | "error", error?}]
  results jsonb not null default '[]',
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index blueprint_runs_site_started_idx on public.blueprint_runs (site_id, started_at desc);

create table public.blueprints (
  id bigint generated always as identity primary key,
  site_id uuid not null references public.sites (id) on delete cascade,
  page_key text not null,
  url text not null,
  finding text not null,
  reasoning text not null,
  -- Null means "keep the current one".
  proposed_title text,
  proposed_meta text,
  priority text not null check (priority in ('high', 'med', 'low')),
  status text not null default 'open' check (status in ('open', 'done', 'skipped')),
  -- The exact page data Claude saw, so a later re-check can compare before/after.
  page_snapshot jsonb not null,
  model text not null,
  run_id bigint references public.blueprint_runs (id) on delete set null,
  created_at timestamptz not null default now(),
  status_changed_at timestamptz
);

create index blueprints_site_status_idx on public.blueprints (site_id, status, created_at desc);
-- At most one open blueprint per page; re-runs skip pages that already have one.
create unique index blueprints_one_open_per_page on public.blueprints (site_id, page_key) where status = 'open';

alter table public.blueprint_runs enable row level security;
alter table public.blueprints enable row level security;
revoke all on public.blueprint_runs, public.blueprints from anon, authenticated;
