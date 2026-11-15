-- Migration 0009: one live rule per title in each scope.
-- Design: docs/DB-DESIGN.md 6.8. Trashed rules don't count.

create unique index rules_title_company  on public.rules (space_id, title_key)
  where layer = 'company'  and deleted_at is null;
create unique index rules_title_team     on public.rules (team_id, title_key)
  where layer = 'team'     and deleted_at is null;
create unique index rules_title_project  on public.rules (project_id, title_key)
  where layer = 'project'  and deleted_at is null;
create unique index rules_title_module   on public.rules (module_id, title_key)
  where layer = 'module'   and deleted_at is null;
create unique index rules_title_personal on public.rules (space_id, user_id, title_key)
  where layer = 'personal' and deleted_at is null;
