-- Migration 0001: profiles (each person's name card).
-- Design: docs/DB-DESIGN.md 6.1 and 8.3. Deletion guard comes later (DECISIONS #34).


-- ===== Part 1 of 5: the card =====
-- id is the same as the Supabase user's id. Delete the user -> the card goes too.

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_url   text check (avatar_url is null or avatar_url ~ '^https://'),
  email        text,                                 -- a copy, for admins; kept in sync below
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Locked from the start. Who may read it comes with the policies (migration 0018).
alter table public.profiles enable row level security;


-- ===== Part 2 of 5: find people by email =====
-- Lowercase, so Priya@Co.com and priya@co.com match.
-- NOT unique: one person may sign up with GitHub and Google using the same email.

create index profiles_email_lower_idx on public.profiles (lower(email));


-- ===== Part 3 of 5: the robot that makes the card at sign-up =====
-- Must never crash: a crash here would make the whole sign-up fail.

create function private.handle_new_user()
returns trigger
language plpgsql
security definer          -- runs with the owner's rights, just to write the card
set search_path = ''      -- only fully named things (public.profiles), no look-alike tricks
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);  -- what GitHub/Google sent
  pic  text  := coalesce(meta ->> 'avatar_url', meta ->> 'picture');
begin
  if pic is not null and pic !~ '^https://' then
    pic := null;            -- not https: leave the picture out instead of failing
  end if;

  insert into public.profiles (id, display_name, avatar_url, email)
  values (
    new.id,
    coalesce(                                     -- first one that is not empty wins
      nullif(trim(meta ->> 'full_name'), ''),     -- Google
      nullif(trim(meta ->> 'name'), ''),
      nullif(trim(meta ->> 'user_name'), ''),     -- GitHub username
      nullif(split_part(new.email, '@', 1), ''),  -- email before the @
      'User'                                      -- never empty
    ),
    pic,
    new.email
  );
  return new;
end $$;

create trigger axiomic_on_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();


-- ===== Part 4 of 5, robot A: email follower =====
-- Supabase only changes auth.users.email after the new address is confirmed
-- (the unconfirmed one waits in another column), so copying on change is safe.

create function private.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $$;

create trigger axiomic_on_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function private.sync_profile_email();


-- ===== Part 4 of 5, robot B: "last changed" stamp =====
-- Reused by every later table with updated_at.

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();


-- Robots are only run by the database itself. Nobody may call them directly.
revoke execute on function private.handle_new_user()    from public, anon, authenticated, service_role;
revoke execute on function private.sync_profile_email() from public, anon, authenticated, service_role;
revoke execute on function private.set_updated_at()     from public, anon, authenticated, service_role;


-- ===== Part 5 of 5: account deletion guard =====
-- Moved to migration 0016c (DECISIONS #34).
