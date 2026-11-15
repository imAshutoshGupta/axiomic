-- Migration 0015: client_status (is each laptop up to date on each project?).
-- Design: docs/DB-DESIGN.md 6.13. Written only by the pull route via api.report_pull.

create table public.client_status (
  project_id       uuid not null references public.projects (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  space_version    bigint not null,
  team_version     bigint not null,
  personal_version bigint not null,
  team_id          uuid not null,     -- the team whose counter was read (a snapshot, so no link)
  last_pull_at     timestamptz not null default now(),
  cli_version      text check (length(cli_version) <= 40),
  primary key (project_id, user_id)
);

alter table public.client_status enable row level security;

create index client_status_user_idx on public.client_status (user_id);
