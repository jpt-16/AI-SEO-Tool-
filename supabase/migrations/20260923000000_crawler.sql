-- Site crawler: per-page on-page data, keyed so it joins to Search Console rows.

-- One normalization for both sides of the join. Search Console reports the same
-- page as https://www.example.com/x and https://example.com/x/, so the key drops
-- the scheme, a leading "www.", default ports, query, fragment and trailing slash:
--   https://www.Example.com/Services/?a=1#top -> example.com/Services
--   https://example.com                       -> example.com/
create function public.page_key(url text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select host || case when path = '' then '/' else path end
  from (
    select
      regexp_replace(regexp_replace(lower(substring(rest from '^[^/?#]*')), '^www\.', ''), ':(80|443)$', '') as host,
      regexp_replace(coalesce(substring(rest from '^[^/?#]*(/[^?#]*)'), ''), '/+$', '') as path
    from (select regexp_replace(url, '^[a-zA-Z][a-zA-Z0-9+.-]*://', '') as rest) s
  ) parts;
$$;

alter table public.gsc_search_analytics
  add column page_key text generated always as (public.page_key(page)) stored;

create index gsc_search_analytics_page_key_idx on public.gsc_search_analytics (site_id, page_key, date);

create table public.crawl_runs (
  id bigint generated always as identity primary key,
  site_id uuid not null references public.sites (id) on delete cascade,
  trigger text not null check (trigger in ('manual', 'cron', 'api', 'script')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  pages_crawled integer,
  pages_failed integer,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index crawl_runs_site_started_idx on public.crawl_runs (site_id, started_at desc);

create table public.crawl_pages (
  site_id uuid not null references public.sites (id) on delete cascade,
  -- Final URL after redirects.
  url text not null,
  page_key text generated always as (public.page_key(url)) stored,
  status_code integer,
  title text,
  meta_description text,
  h1 text[] not null default '{}',
  h2 text[] not null default '{}',
  word_count integer,
  -- Links to other pages on the same site (self-links and bare #anchors excluded).
  internal_link_count integer,
  json_ld jsonb not null default '[]',
  schema_types text[] not null default '{}',
  in_sitemap boolean not null default false,
  error text,
  crawl_run_id bigint references public.crawl_runs (id) on delete set null,
  crawled_at timestamptz not null default now(),
  unique (site_id, page_key)
);

alter table public.crawl_runs enable row level security;
alter table public.crawl_pages enable row level security;
revoke all on public.crawl_runs, public.crawl_pages from anon, authenticated;

-- Pages tab: every page seen by Search Console or the crawler, with its GSC stats,
-- its top queries, and its current on-page data side by side.
create function public.gsc_page_seo_report(
  p_site_id uuid,
  p_start date,
  p_end date,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  page_key text,
  url text,
  clicks bigint,
  impressions bigint,
  ctr double precision,
  "position" double precision,
  top_queries jsonb,
  title text,
  meta_description text,
  h1 text[],
  word_count integer,
  internal_link_count integer,
  schema_types text[],
  in_sitemap boolean,
  status_code integer,
  crawl_error text,
  crawled_at timestamptz,
  total_count bigint
)
language sql
stable
set search_path = ''
as $$
  with by_query as (
    select r.page_key, r.query,
      sum(r.clicks) as c,
      sum(r.impressions) as i,
      sum(r.position * r.impressions) / nullif(sum(r.impressions), 0) as p,
      min(r.page) as any_page
    from public.gsc_search_analytics r
    where r.site_id = p_site_id and r.date between p_start and p_end
    group by r.page_key, r.query
  ),
  ranked as (
    select q.*, row_number() over (partition by q.page_key order by q.i desc, q.c desc, q.query) as rn
    from by_query q
  ),
  gsc as (
    select q.page_key,
      sum(q.c)::bigint as clicks,
      sum(q.i)::bigint as impressions,
      sum(q.p * q.i) / nullif(sum(q.i), 0) as position,
      min(q.any_page) as any_page,
      jsonb_agg(
        jsonb_build_object('query', q.query, 'clicks', q.c, 'impressions', q.i, 'position', round(q.p::numeric, 1))
        order by q.rn
      ) filter (where q.rn <= 5) as top_queries
    from ranked q
    group by q.page_key
  ),
  crawl as (
    select c.* from public.crawl_pages c where c.site_id = p_site_id
  ),
  joined as (
    select
      coalesce(crawl.page_key, gsc.page_key) as page_key,
      coalesce(crawl.url, gsc.any_page) as url,
      coalesce(gsc.clicks, 0) as clicks,
      coalesce(gsc.impressions, 0) as impressions,
      gsc.clicks::double precision / nullif(gsc.impressions, 0) as ctr,
      gsc.position,
      coalesce(gsc.top_queries, '[]'::jsonb) as top_queries,
      crawl.title,
      crawl.meta_description,
      crawl.h1,
      crawl.word_count,
      crawl.internal_link_count,
      crawl.schema_types,
      crawl.in_sitemap,
      crawl.status_code,
      crawl.error as crawl_error,
      crawl.crawled_at
    from crawl
    full join gsc on gsc.page_key = crawl.page_key
  )
  select j.*, count(*) over ()
  from joined j
  where coalesce(p_search, '') = ''
    or strpos(lower(j.url), lower(p_search)) > 0
    or strpos(lower(coalesce(j.title, '')), lower(p_search)) > 0
  order by j.impressions desc, j.clicks desc, j.url
  limit p_limit offset p_offset;
$$;

revoke execute on function public.gsc_page_seo_report, public.page_key from public, anon, authenticated;
grant execute on function public.gsc_page_seo_report, public.page_key to service_role;

-- Replaced by gsc_page_seo_report.
drop function public.gsc_page_report;
