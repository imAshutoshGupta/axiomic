-- Migration 0019: views that hide trashed rows. The merge/pull reads only these.
-- Design: docs/DB-DESIGN.md 8.2.
-- security_invoker = true is CRITICAL: without it a view runs as its owner and skips
-- row-level security, showing every company's rules. A test checks it.

create view public.active_rules with (security_invoker = true) as
  select * from public.rules where deleted_at is null;

create view public.active_modules with (security_invoker = true) as
  select * from public.modules where deleted_at is null;

revoke all on public.active_rules, public.active_modules from anon, service_role;
grant select on public.active_rules, public.active_modules to authenticated;
