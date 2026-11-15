-- Migration 0008: rules (identity and scope; the text lives in rule_versions).
-- Design: docs/DB-DESIGN.md 6.8.

create table public.rules (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references public.spaces (id) on delete cascade,
  layer      text not null check (layer in ('company', 'team', 'project', 'module', 'personal')),
  team_id    uuid,
  project_id uuid,
  module_id  uuid,
  user_id    uuid,
  title      text not null,
  title_key  text not null check (title_key = private.title_key(title)),  -- can't be forged
  locked     boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,                                                  -- trash
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Exactly the one scope column that matches the layer is filled.
  check (
    (layer = 'company'  and team_id is null     and project_id is null     and module_id is null     and user_id is null) or
    (layer = 'team'     and team_id is not null and project_id is null     and module_id is null     and user_id is null) or
    (layer = 'project'  and team_id is null     and project_id is not null and module_id is null     and user_id is null) or
    (layer = 'module'   and team_id is null     and project_id is null     and module_id is not null and user_id is null) or
    (layer = 'personal' and team_id is null     and project_id is null     and module_id is null     and user_id is not null)
  ),
  check (not locked or layer in ('company', 'team')),

  -- Same space everywhere (skipped when the column is empty).
  foreign key (team_id, space_id)    references public.teams (id, space_id)    on delete no action,
  foreign key (project_id, space_id) references public.projects (id, space_id) on delete no action,
  foreign key (module_id, space_id)  references public.modules (id, space_id)  on delete cascade,
  foreign key (space_id, user_id)    references public.memberships (space_id, user_id) on delete cascade,

  unique (id, layer)   -- lets suggestions prove they target a rule of the same layer
);

alter table public.rules enable row level security;

create index rules_team_idx       on public.rules (team_id)           where team_id is not null;
create index rules_project_idx    on public.rules (project_id)        where project_id is not null;
create index rules_module_idx     on public.rules (module_id)         where module_id is not null;
create index rules_personal_idx   on public.rules (space_id, user_id) where user_id is not null;
create index rules_created_by_idx on public.rules (created_by);
create index rules_order_idx      on public.rules (space_id, created_at, id);  -- pulls always in this order

create trigger rules_set_updated_at
  before update on public.rules
  for each row execute function private.set_updated_at();
