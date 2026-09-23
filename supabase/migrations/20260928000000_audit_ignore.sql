-- "Not an issue": a dismissal that stays across crawls, unlike "fixed", which comes back
-- if a newer crawl still finds the issue. For checks that are judgement calls.
alter table public.audit_fixes
  add column kind text not null default 'fixed' check (kind in ('fixed', 'ignored'));
