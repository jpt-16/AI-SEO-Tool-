-- Automatic outreach: saved "trade + town" searches that find businesses, a queue of
-- prospects waiting to be researched, and the Gmail draft made for each.
create table public.outreach_searches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  trade text not null,
  town text not null,
  enabled boolean not null default true,
  last_run_at timestamptz,
  unique (trade, town)
);

alter table public.outreach_searches enable row level security;
revoke all on public.outreach_searches from anon, authenticated;

alter table public.outreach_prospects
  add column search_id uuid references public.outreach_searches (id) on delete set null,
  add column source text not null default 'manual' check (source in ('manual', 'auto')),
  -- Where the draft is addressed: found on their site.
  add column email text,
  add column subject text,
  add column attempts integer not null default 0,
  add column draft_state text not null default 'none' check (draft_state in ('none', 'created', 'no_email', 'failed', 'skipped')),
  add column gmail_draft_id text,
  add column drafted_at timestamptz,
  add column draft_error text,
  -- Why an automatic prospect was dropped before drafting.
  add column skip_reason text;

alter table public.outreach_prospects drop constraint outreach_prospects_status_check;
alter table public.outreach_prospects
  add constraint outreach_prospects_status_check check (status in ('queued', 'draft', 'sent', 'replied', 'passed'));

create index outreach_prospects_queue_idx on public.outreach_prospects (created_at) where status = 'queued';

create table public.outreach_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text not null check (trigger in ('cron', 'manual')),
  found integer not null default 0,
  drafted integer not null default 0,
  no_email integer not null default 0,
  skipped integer not null default 0,
  failed integer not null default 0,
  cost_usd numeric(10, 4),
  error text
);

alter table public.outreach_runs enable row level security;
revoke all on public.outreach_runs from anon, authenticated;
