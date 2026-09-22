-- Google Search Console connector: client sites, the Google connection,
-- synced Search Analytics rows, daily totals and a sync log.
-- Every table is RLS-enabled with no policies: only the service role
-- (used server-side by the Next.js app) can read or write.

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text not null unique,
  gsc_property text,
  sync_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

-- Single-row table: this tool connects one Google account.
create table public.google_connection (
  id boolean primary key default true check (id),
  google_email text,
  refresh_token_encrypted text not null,
  scope text not null,
  connected_at timestamptz not null default now()
);

create table public.gsc_search_analytics (
  site_id uuid not null references public.sites (id) on delete cascade,
  date date not null,
  query text not null,
  page text not null,
  clicks integer not null,
  impressions integer not null,
  ctr double precision not null,
  position double precision not null,
  synced_at timestamptz not null default now(),
  primary key (site_id, date, query, page)
);

-- Totals from a date-only request. Unlike summing query rows, these include
-- anonymized queries, so they match the Search Console UI.
create table public.gsc_daily_totals (
  site_id uuid not null references public.sites (id) on delete cascade,
  date date not null,
  clicks integer not null,
  impressions integer not null,
  ctr double precision not null,
  position double precision not null,
  synced_at timestamptz not null default now(),
  primary key (site_id, date)
);

create table public.gsc_sync_runs (
  id bigint generated always as identity primary key,
  site_id uuid not null references public.sites (id) on delete cascade,
  trigger text not null check (trigger in ('manual', 'cron', 'api')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  start_date date,
  end_date date,
  rows_fetched integer,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index gsc_sync_runs_site_started_idx on public.gsc_sync_runs (site_id, started_at desc);

alter table public.sites enable row level security;
alter table public.google_connection enable row level security;
alter table public.gsc_search_analytics enable row level security;
alter table public.gsc_daily_totals enable row level security;
alter table public.gsc_sync_runs enable row level security;

revoke all on public.sites, public.google_connection, public.gsc_search_analytics,
  public.gsc_daily_totals, public.gsc_sync_runs from anon, authenticated;

-- Queries tab: one row per query with its best landing page.
create function public.gsc_query_report(
  p_site_id uuid,
  p_start date,
  p_end date,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  query text,
  top_page text,
  clicks bigint,
  impressions bigint,
  ctr double precision,
  "position" double precision,
  total_count bigint
)
language sql
stable
set search_path = ''
as $$
  with scoped as (
    select r.query, r.page, r.clicks, r.impressions, r.position
    from public.gsc_search_analytics r
    where r.site_id = p_site_id
      and r.date between p_start and p_end
      and (coalesce(p_search, '') = '' or strpos(lower(r.query), lower(p_search)) > 0)
  ),
  agg as (
    select s.query,
      sum(s.clicks)::bigint as clicks,
      sum(s.impressions)::bigint as impressions,
      sum(s.position * s.impressions) / nullif(sum(s.impressions), 0) as position
    from scoped s
    group by s.query
  ),
  top as (
    select distinct on (x.query) x.query, x.page
    from (
      select s.query, s.page, sum(s.clicks) as c, sum(s.impressions) as i
      from scoped s
      group by s.query, s.page
    ) x
    order by x.query, x.c desc, x.i desc
  )
  select a.query, t.page, a.clicks, a.impressions,
    a.clicks::double precision / nullif(a.impressions, 0),
    a.position,
    count(*) over ()
  from agg a
  join top t on t.query = a.query
  order by a.clicks desc, a.impressions desc, a.query
  limit p_limit offset p_offset;
$$;

-- Pages tab: one row per page with its best query.
create function public.gsc_page_report(
  p_site_id uuid,
  p_start date,
  p_end date,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  page text,
  top_query text,
  clicks bigint,
  impressions bigint,
  ctr double precision,
  "position" double precision,
  total_count bigint
)
language sql
stable
set search_path = ''
as $$
  with scoped as (
    select r.query, r.page, r.clicks, r.impressions, r.position
    from public.gsc_search_analytics r
    where r.site_id = p_site_id
      and r.date between p_start and p_end
      and (coalesce(p_search, '') = '' or strpos(lower(r.page), lower(p_search)) > 0)
  ),
  agg as (
    select s.page,
      sum(s.clicks)::bigint as clicks,
      sum(s.impressions)::bigint as impressions,
      sum(s.position * s.impressions) / nullif(sum(s.impressions), 0) as position
    from scoped s
    group by s.page
  ),
  top as (
    select distinct on (x.page) x.page, x.query
    from (
      select s.page, s.query, sum(s.clicks) as c, sum(s.impressions) as i
      from scoped s
      group by s.page, s.query
    ) x
    order by x.page, x.c desc, x.i desc
  )
  select a.page, t.query, a.clicks, a.impressions,
    a.clicks::double precision / nullif(a.impressions, 0),
    a.position,
    count(*) over ()
  from agg a
  join top t on t.page = a.page
  order by a.clicks desc, a.impressions desc, a.page
  limit p_limit offset p_offset;
$$;

revoke execute on function public.gsc_query_report, public.gsc_page_report from public, anon, authenticated;
grant execute on function public.gsc_query_report, public.gsc_page_report to service_role;

insert into public.sites (name, domain)
values ('Clover Downs Detailing', 'cloverdownsdetailing.com');
