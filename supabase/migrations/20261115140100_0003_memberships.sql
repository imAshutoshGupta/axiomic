-- Migration 0003: memberships (who is in which space, with which role).
-- Design: docs/DB-DESIGN.md 6.3.

create table public.memberships (
  space_id         uuid not null references public.spaces (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  role             text not null check (role in ('admin', 'editor', 'reader')),
  personal_version bigint not null default 0,  -- bumped when this person's personal rules here change
  created_at       timestamptz not null default now(),
  primary key (space_id, user_id)
);

alter table public.memberships enable row level security;

create index memberships_user_idx on public.memberships (user_id);


-- A space must always keep at least one admin.
-- Runs only on role changes and removals ("of role": saving a personal rule bumps
-- personal_version on this row and must not run this or lock the space).
create function private.ensure_space_has_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
begin
  -- Not losing an admin? Nothing to check.
  if old.role <> 'admin' or (tg_op = 'UPDATE' and new.role = 'admin') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select kind, owner_id into s from public.spaces where id = old.space_id;

  -- 1. The space itself is being deleted (its row is already gone).
  if not found then
    return old;
  end if;

  -- 2. A personal space whose owner is deleting their account.
  if s.kind = 'personal' and not exists (select 1 from public.profiles where id = s.owner_id) then
    return old;
  end if;

  -- 3. Lock the space so two admins demoting each other at once take turns.
  perform 1 from public.spaces where id = old.space_id for update;

  if not exists (
    select 1 from public.memberships
    where space_id = old.space_id and role = 'admin' and user_id <> old.user_id
  ) then
    raise exception 'a space must keep at least one admin' using errcode = 'check_violation';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

revoke execute on function private.ensure_space_has_admin() from public, anon, authenticated, service_role;

create trigger memberships_keep_an_admin
  before update of role or delete on public.memberships
  for each row execute function private.ensure_space_has_admin();
