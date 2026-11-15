-- Migration 0012: invites (the only way into a work space).
-- Design: docs/DB-DESIGN.md 6.11. Sending invite emails waits for the email provider (#29).

create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces (id) on delete cascade,
  email       text not null check (email = lower(email)),
  role        text not null check (role in ('admin', 'editor', 'reader')),
  team_id     uuid references public.teams (id) on delete set null,
  token_hash  bytea not null unique check (octet_length(token_hash) = 32),  -- SHA-256 of the link secret
  expires_at  timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  revoked_at  timestamptz,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.invites enable row level security;

-- One open invite per email per space (an expired one is resent, not duplicated).
create unique index invites_one_open
  on public.invites (space_id, email)
  where accepted_at is null and revoked_at is null;

create index invites_team_idx        on public.invites (team_id);
create index invites_accepted_by_idx on public.invites (accepted_by);
create index invites_created_by_idx  on public.invites (created_by);
