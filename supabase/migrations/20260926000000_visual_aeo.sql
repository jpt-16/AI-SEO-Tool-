-- Visual scoring and AEO/GEO checks, stored with each crawl.
--  crawl_pages: a deterministic visual score from a headless-browser capture (with a
--  first-screen screenshot), and an answer-extractability score from the HTML.
--  crawl_runs: site-level AEO results (AI crawler access in robots.txt, llms.txt).

alter table public.crawl_pages
  add column visual_score integer,
  -- Per-check points and details (visual-core.ts VisualCheck[]).
  add column visual_checks jsonb,
  -- Raw measurements the score came from.
  add column visual_metrics jsonb,
  add column visual_error text,
  add column visual_captured_at timestamptz,
  -- First-screen JPEG, base64, served by /api/screenshot.
  add column screenshot_jpeg text,
  add column screenshot_sha256 text,
  add column answer_score integer,
  -- aeo.ts AnswerCheck: every question found and how quotable its answer is.
  add column answer_check jsonb;

alter table public.crawl_runs
  -- aeo.ts SiteAeo: AI crawler access and llms.txt.
  add column aeo jsonb,
  add column visual_pages integer,
  add column visual_failed integer,
  add column visual_error text;

-- The Pages tab report gains the new per-page fields (return type changes, so recreate).
drop function public.gsc_page_seo_report(uuid, date, date, text, integer, integer);

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
  visual_score integer,
  visual_checks jsonb,
  visual_capture jsonb,
  visual_error text,
  visual_captured_at timestamptz,
  has_screenshot boolean,
  answer_score integer,
  answer_check jsonb,
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
      crawl.crawled_at,
      crawl.visual_score,
      crawl.visual_checks,
      jsonb_build_object(
        'networkIdle', crawl.visual_metrics -> 'networkIdle',
        'status', crawl.visual_metrics -> 'status',
        'failedRequests', crawl.visual_metrics -> 'failedRequests'
      ) as visual_capture,
      crawl.visual_error,
      crawl.visual_captured_at,
      crawl.screenshot_jpeg is not null as has_screenshot,
      crawl.answer_score,
      crawl.answer_check
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

revoke execute on function public.gsc_page_seo_report from public, anon, authenticated;
grant execute on function public.gsc_page_seo_report to service_role;
