-- Migration 0004: teams, and the sign-up robot now also makes the personal space.
-- Design: docs/DB-DESIGN.md 6.4, 8.3.

create table public.teams (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid not null references public.spaces (id) on delete cascade,
  name          text not null,
  slug          text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,30}$'),
  hidden        boolean not null default false,   -- only the personal space's "Personal" team
  rules_version bigint not null default 0,        -- bumped when a team/project/module rule changes
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (space_id, slug),
  unique (id, space_id)                            -- lets other tables prove "same space"
);

alter table public.teams enable row level security;

create trigger teams_set_updated_at
  before update on public.teams
  for each row execute function private.set_updated_at();

create trigger teams_forbid_slug_change
  before update of slug on public.teams
  for each row execute function private.forbid_slug_change();


-- Sign-up robot, full version: card -> personal space -> hidden "Personal" team -> admin membership.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta     jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  pic      text  := coalesce(meta ->> 'avatar_url', meta ->> 'picture');
  space_id uuid;
begin
  if pic is not null and pic !~ '^https://' then
    pic := null;
  end if;

  insert into public.profiles (id, display_name, avatar_url, email)
  values (
    new.id,
    coalesce(
      nullif(trim(meta ->> 'full_name'), ''),
      nullif(trim(meta ->> 'name'), ''),
      nullif(trim(meta ->> 'user_name'), ''),
      nullif(split_part(new.email, '@', 1), ''),
      'User'
    ),
    pic,
    new.email
  );

  -- Personal space. Slug "u-" + 28 characters of a hash of the WHOLE user id: ids that
  -- start alike (time-based ids) still get different slugs. Never shown in a company URL.
  insert into public.spaces (kind, name, slug, owner_id)
  values ('personal', 'Personal',
          'u-' || left(encode(sha256(convert_to(new.id::text, 'UTF8')), 'hex'), 28),
          new.id)
  returning id into space_id;

  insert into public.teams (space_id, name, slug, hidden)
  values (space_id, 'Personal', 'personal', true);

  insert into public.memberships (space_id, user_id, role)
  values (space_id, new.id, 'admin');

  return new;
end $$;

revoke execute on function private.handle_new_user() from public, anon, authenticated, service_role;
