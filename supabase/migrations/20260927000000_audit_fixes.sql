-- Site audit: issues you've marked fixed. The issue itself is recomputed from the latest
-- crawl each time; a mark hides it until a newer crawl finds it again.
create table public.audit_fixes (
  site_id uuid not null references public.sites (id) on delete cascade,
  -- '' for site-wide issues (AI crawlers, llms.txt).
  page_key text not null default '',
  -- audit.ts IssueType, e.g. 'meta_long'.
  issue text not null,
  fixed_at timestamptz not null default now(),
  primary key (site_id, page_key, issue)
);

alter table public.audit_fixes enable row level security;
revoke all on public.audit_fixes from anon, authenticated;
