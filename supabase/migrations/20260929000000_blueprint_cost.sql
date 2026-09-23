-- What each blueprint run cost, how hard Claude reasoned, and how many pages reused an
-- earlier "nothing to change" verdict instead of a new call.
alter table public.blueprint_runs
  add column effort text,
  add column pages_reused integer,
  add column input_tokens integer,
  add column output_tokens integer,
  add column cost_usd numeric(10, 4);
