-- Migration 0007: modules (a folder inside a project with its own rules).
-- Design: docs/DB-DESIGN.md 6.7. Name and path rules copy packages/shared/src/paths.ts.

create table public.modules (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references public.spaces (id) on delete cascade,
  project_id uuid not null,
  name       text not null
             check (length(name) <= 64 and name ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),   -- isSafeModuleName
  path       text not null
             check (path ~ '^[A-Za-z0-9._/-]{1,255}$')     -- plain characters only, 1-255 long
             check (path !~ '(^/|/$|//)')                    -- no leading/trailing/double slash
             check (path !~ '(^|/)\.{1,2}(/|$)')             -- no "." or ".." folder
             check (path !~* '(^|/)\.git(/|$)')              -- never Git's own folder
             check (path !~ '\.(/|$)'),                      -- no folder ending in "." (Windows drops it)
  owner_id   uuid,                                           -- must be a member
  deleted_at timestamptz,                                    -- trash
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, space_id),
  foreign key (project_id, space_id) references public.projects (id, space_id) on delete no action,
  foreign key (space_id, owner_id) references public.memberships (space_id, user_id)
    on delete set null (owner_id)
);

alter table public.modules enable row level security;

-- macOS and Windows treat "API" and "api" as the same file, so compare lowercase.
create unique index modules_name_unique on public.modules (project_id, lower(name)) where deleted_at is null;
create unique index modules_path_unique on public.modules (project_id, lower(path)) where deleted_at is null;
create index modules_owner_idx on public.modules (space_id, owner_id);

create trigger modules_set_updated_at
  before update on public.modules
  for each row execute function private.set_updated_at();
