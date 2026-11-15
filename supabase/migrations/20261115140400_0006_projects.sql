-- Migration 0006: projects (one per repo).
-- Design: docs/DB-DESIGN.md 6.6.

create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces (id) on delete cascade,
  team_id     uuid not null,
  owner_id    uuid,                              -- project layer owner; must be a member
  name        text not null,
  slug        text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,30}$'),
  archived_at timestamptz,                       -- retired, not deleted
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (space_id, slug),
  unique (id, space_id),
  -- A team with projects cannot be deleted. "no action" (not "restrict") checks at the
  -- end of the statement, so deleting a whole space still works (DECISIONS #35).
  foreign key (team_id, space_id) references public.teams (id, space_id) on delete no action,
  -- Only a member can own it; a removed member stops being owner.
  foreign key (space_id, owner_id) references public.memberships (space_id, user_id)
    on delete set null (owner_id)
);

alter table public.projects enable row level security;

create index projects_team_idx  on public.projects (team_id);
create index projects_owner_idx on public.projects (space_id, owner_id);

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function private.set_updated_at();

create trigger projects_forbid_slug_change
  before update of slug on public.projects
  for each row execute function private.forbid_slug_change();
