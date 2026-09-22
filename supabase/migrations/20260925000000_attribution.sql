-- Attribution: when a blueprint is marked done, record the page's Search Console
-- numbers for the queries it targeted, then record them again once 14 days of
-- post-change data exist, so the before/after can be compared.

alter table public.blueprints
  -- Queries from page_snapshot.topQueries that the change targets.
  add column target_queries text[],
  add column done_at timestamptz,
  -- blueprint_stats() output for the 14 days before done_at.
  add column baseline_snapshot jsonb,
  -- blueprint_stats() output for the 14 days after done_at.
  add column result_snapshot jsonb,
  -- Before / after / change for clicks, impressions and position.
  add column result_diff jsonb,
  add column result_at timestamptz;

-- Done blueprints still waiting for their result.
create index blueprints_pending_results_idx on public.blueprints (site_id, done_at)
  where status = 'done' and result_snapshot is null;

-- Clicks, impressions and impression-weighted average position for one page over
-- a date range: the whole page, the given queries combined, and each query alone.
create or replace function public.blueprint_stats(
  p_site_id uuid,
  p_page_key text,
  p_queries text[],
  p_start date,
  p_end date
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with page_rows as (
    select lower(a.query) as q, a.clicks, a.impressions, a.position
    from public.gsc_search_analytics a
    where a.site_id = p_site_id
      and a.page_key = p_page_key
      and a.date between p_start and p_end
  ),
  wanted as (
    select distinct lower(q) as q from unnest(coalesce(p_queries, '{}')) as q
  ),
  per_query as (
    select
      w.q,
      coalesce(sum(r.clicks), 0)::integer as clicks,
      coalesce(sum(r.impressions), 0)::integer as impressions,
      case when sum(r.impressions) > 0
        then round((sum(r.position * r.impressions) / sum(r.impressions))::numeric, 2)
      end as position
    from wanted w
    left join page_rows r on r.q = w.q
    group by w.q
  )
  select jsonb_build_object(
    'window', jsonb_build_object('startDate', p_start, 'endDate', p_end),
    'page', (
      select jsonb_build_object(
        'clicks', coalesce(sum(clicks), 0)::integer,
        'impressions', coalesce(sum(impressions), 0)::integer,
        'position', case when sum(impressions) > 0
          then round((sum(position * impressions) / sum(impressions))::numeric, 2) end
      )
      from page_rows
    ),
    'cited', (
      select jsonb_build_object(
        'clicks', coalesce(sum(clicks), 0)::integer,
        'impressions', coalesce(sum(impressions), 0)::integer,
        'position', case when sum(impressions) > 0
          then round((sum(position * impressions) / sum(impressions))::numeric, 2) end
      )
      from page_rows
      where q in (select q from wanted)
    ),
    'queries', coalesce(
      (select jsonb_agg(jsonb_build_object('query', q, 'clicks', clicks, 'impressions', impressions, 'position', position)
                        order by impressions desc, q)
       from per_query),
      '[]'::jsonb
    )
  );
$$;

revoke execute on function public.blueprint_stats from public, anon, authenticated;
