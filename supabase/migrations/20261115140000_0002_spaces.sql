-- Migration 0002: spaces (a company, or one person's private area).
-- Design: docs/DB-DESIGN.md 6.2.

create table public.spaces (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('work', 'personal')),
  name          text not null,
  slug          text not null unique
                check (slug ~ '^[a-z0-9][a-z0-9-]{1,30}$')
                check (slug not in ('admin', 'api', 'app', 'auth', 'axiomic', 'blog', 'dashboard',
                                    'docs', 'help', 'invite', 'login', 'logout', 'mail', 'new',
                                    'privacy', 'security', 'settings', 'signup', 'status',
                                    'support', 'terms', 'www')),
  owner_id      uuid references public.profiles (id) on delete cascade,  -- personal spaces only
  rules_version bigint not null default 0,      -- bumped when a company rule changes
  delete_after  timestamptz,                    -- scheduled deletion (7 days, cancellable)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ((kind = 'personal') = (owner_id is not null))  -- personal <=> has an owner
);

alter table public.spaces enable row level security;

-- One personal space per person.
create unique index spaces_one_personal_per_owner on public.spaces (owner_id) where kind = 'personal';

create trigger spaces_set_updated_at
  before update on public.spaces
  for each row execute function private.set_updated_at();


-- Slugs never change (they are in URLs and in each repo's axiomic.json).
-- One guard, reused by teams and projects.
create function private.forbid_slug_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slug is distinct from old.slug then
    raise exception 'slug cannot be changed' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke execute on function private.forbid_slug_change() from public, anon, authenticated, service_role;

create trigger spaces_forbid_slug_change
  before update of slug on public.spaces
  for each row execute function private.forbid_slug_change();
