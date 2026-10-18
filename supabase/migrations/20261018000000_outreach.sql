-- Cold outreach: one row per business we're writing to, with what the research found and
-- the filled-in one-pager (the editable copy).
create table public.outreach_prospects (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  business_name text not null,
  website text not null,
  owner_name text,
  city text,
  -- What the sender already knows (Google rating, review count, listing status…).
  notes text,
  status text not null default 'draft' check (status in ('draft', 'sent', 'replied', 'passed')),
  -- Facts read from the site, the phone-screen check and the web search findings.
  research jsonb,
  -- The sheet's fields, as edited.
  one_pager jsonb,
  -- The note that goes with the sheet.
  message text,
  -- Things to double-check before sending.
  unverified jsonb,
  model text,
  cost_usd numeric(10, 4),
  researched_at timestamptz,
  research_error text
);

create index outreach_prospects_created_idx on public.outreach_prospects (created_at desc);

alter table public.outreach_prospects enable row level security;
revoke all on public.outreach_prospects from anon, authenticated;
