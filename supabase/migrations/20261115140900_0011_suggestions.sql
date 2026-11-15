-- Migration 0011: suggestions (proposed changes waiting for approval).
-- Design: docs/DB-DESIGN.md 6.10. Deviation: DECISIONS #35 (promote check).

create table public.suggestions (
  id              uuid primary key default gen_random_uuid(),
  space_id        uuid not null references public.spaces (id) on delete cascade,
  kind            text not null check (kind in ('create', 'update', 'promote')),
  layer           text not null check (layer in ('company', 'team', 'project', 'module')),  -- never personal
  team_id         uuid,
  project_id      uuid,
  module_id       uuid,
  rule_id         uuid,             -- update: the rule being changed
  source_rule_id  uuid references public.rules (id) on delete set null,  -- promote: the personal rule
  proposed_title  text not null,
  title_key       text not null check (title_key = private.title_key(proposed_title)),
  nonce           bytea not null check (octet_length(nonce) = 12),
  body_ciphertext bytea not null check (octet_length(body_ciphertext) <= 65536 + 16),
  key_version     smallint not null default 1 check (key_version > 0),
  base_version    integer,          -- "changed since you wrote this" warning
  status          text not null default 'pending'
                  check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  decided_by      uuid references public.profiles (id) on delete set null,
  decided_at      timestamptz,
  decision_note   text,

  -- Target scope: exactly the column that matches the layer.
  check (
    (layer = 'company' and team_id is null     and project_id is null     and module_id is null) or
    (layer = 'team'    and team_id is not null and project_id is null     and module_id is null) or
    (layer = 'project' and team_id is null     and project_id is not null and module_id is null) or
    (layer = 'module'  and team_id is null     and project_id is null     and module_id is not null)
  ),
  -- What each kind points at. A promote's source may become empty later, when the
  -- personal rule is deleted (DECISIONS #35); api.create_suggestion requires it at creation.
  check (
    (kind = 'create'  and rule_id is null     and source_rule_id is null) or
    (kind = 'update'  and rule_id is not null and source_rule_id is null) or
    (kind = 'promote' and rule_id is null)
  ),

  -- An update must target a rule of the same layer.
  foreign key (rule_id, layer)       references public.rules (id, layer)       on delete cascade,
  foreign key (team_id, space_id)    references public.teams (id, space_id)    on delete cascade,
  foreign key (project_id, space_id) references public.projects (id, space_id) on delete cascade,
  foreign key (module_id, space_id)  references public.modules (id, space_id)  on delete cascade
);

alter table public.suggestions enable row level security;

-- One pending suggestion per person per rule (update or promote).
create unique index suggestions_one_pending
  on public.suggestions (coalesce(rule_id, source_rule_id), created_by)
  where status = 'pending' and kind <> 'create';

create index suggestions_space_status_idx on public.suggestions (space_id, status);
create index suggestions_rule_idx         on public.suggestions (rule_id)        where rule_id is not null;
create index suggestions_source_idx       on public.suggestions (source_rule_id) where source_rule_id is not null;
create index suggestions_team_idx         on public.suggestions (team_id)        where team_id is not null;
create index suggestions_project_idx      on public.suggestions (project_id)     where project_id is not null;
create index suggestions_module_idx       on public.suggestions (module_id)      where module_id is not null;
create index suggestions_created_by_idx   on public.suggestions (created_by);
create index suggestions_decided_by_idx   on public.suggestions (decided_by);
