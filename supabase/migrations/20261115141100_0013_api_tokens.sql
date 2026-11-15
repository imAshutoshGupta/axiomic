-- Migration 0013: api_tokens (CLI logins and project agent keys; only hashes stored).
-- Design: docs/DB-DESIGN.md 6.12.

create table public.api_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  kind         text not null check (kind in ('cli', 'agent')),
  project_id   uuid references public.projects (id) on delete cascade,
  name         text not null,
  token_hash   bytea not null unique check (octet_length(token_hash) = 32),  -- SHA-256
  prefix       text not null check (prefix ~ '^axm_'),    -- shown in lists, e.g. axm_7f2c
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,                               -- written at most once an hour
  expires_at   timestamptz,                               -- agent keys: 90 days
  revoked_at   timestamptz,
  check ((kind = 'agent') = (project_id is not null))    -- agent keys belong to one project
);

alter table public.api_tokens enable row level security;

create index api_tokens_user_idx    on public.api_tokens (user_id);
create index api_tokens_project_idx on public.api_tokens (project_id) where project_id is not null;
