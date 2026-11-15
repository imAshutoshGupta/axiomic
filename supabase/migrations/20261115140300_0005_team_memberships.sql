-- Migration 0005: team_memberships (who is in which team, lead or member).
-- Design: docs/DB-DESIGN.md 6.5.

create table public.team_memberships (
  team_id    uuid not null,
  space_id   uuid not null,            -- copied from the team; kept honest by the keys below
  user_id    uuid not null,
  role       text not null check (role in ('lead', 'member')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id),
  -- The team must be in this space, and the person must be a member of this space.
  foreign key (team_id, space_id)  references public.teams (id, space_id) on delete cascade,
  foreign key (space_id, user_id)  references public.memberships (space_id, user_id) on delete cascade
);

alter table public.team_memberships enable row level security;

create index team_memberships_member_idx on public.team_memberships (space_id, user_id);
create index team_memberships_user_idx   on public.team_memberships (user_id);
