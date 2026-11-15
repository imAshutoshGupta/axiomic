-- Migration 0000: foundation (rooms, keys, locks). No product tables yet.
-- Design: docs/DB-DESIGN.md sections 4.1, 9, 10. Decisions: docs/DECISIONS.md #27-#32.


-- ===== Part 1 of 6: the rooms =====
-- public  already exists: the website may read it (through row-level security).
-- private helpers the database uses on itself. No internet door.
-- api     "change something" actions, only for our server. No internet door.

create schema private;
create schema api;

-- Nobody gets into the new rooms unless a later line says so.
revoke all on schema private from public;
revoke all on schema api from public;


-- ===== Part 2 of 6: the server's key (opens nothing on its own) =====
-- noinherit: being allowed to act as "authenticated" does not give those rights
-- automatically. The server must say "set local role authenticated" first, so a
-- forgotten line fails with an error instead of leaking data.
-- No password here (this file goes into Git). The password is set by hand later.
-- Roles belong to the whole server, not one database, so only create if missing.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'axiomic_server') then
    create role axiomic_server login noinherit;
  end if;
end $$;

grant authenticated to axiomic_server;


-- ===== Part 3 of 6: the backup key (reads everything, changes nothing) =====

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'axiomic_backup') then
    create role axiomic_backup login bypassrls;
  end if;
end $$;

grant pg_read_all_data to axiomic_backup;


-- ===== Part 4 of 6: closed by default =====
-- Supabase hands out rights on everything new in public. Stop that for objects
-- we create (we create them as "postgres"). service_role is included: it is
-- only for deleting accounts, never for reading our data.

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated, service_role;

-- Postgres lets everyone run every new function. Turn that off everywhere.
alter default privileges for role postgres
  revoke execute on functions from public;


-- ===== Part 5 of 6: the live-broadcast check =====
-- Stop if Realtime's broadcast list contains anything from our rooms.

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname in ('public', 'private', 'api')
  ) then
    raise exception 'Realtime must not broadcast axiomic tables';
  end if;
end $$;


-- ===== Part 6 of 6, tool A: the title cleaner =====
-- Same five steps as titleKey() in packages/shared/src/merge.ts, in the same order:
--   1. normalize look-alike letters (NFKC)
--   2. delete invisible characters (same list as INVISIBLE in merge.ts)
--   3. trim spaces at both ends    (the exact characters JavaScript counts as space)
--   4. squash runs of spaces into one space
--   5. lowercase
-- A test must feed the same examples to both versions and compare.

create function private.title_key(title text)
returns text
language sql
immutable          -- same input, same output: allowed inside CHECK rules
strict             -- null in, null out
parallel safe
set search_path = ''
return lower(
  regexp_replace(
    regexp_replace(
      regexp_replace(
        normalize(title, NFKC),
        '[­​-‏⁠-⁤﻿]', '', 'g'),
      '^[\t\n\v\f\r    -   　﻿]+|[\t\n\v\f\r    -   　﻿]+$', '', 'g'),
    '[\t\n\v\f\r    -   　﻿]+', ' ', 'g')
);

revoke execute on function private.title_key(text) from public;
grant usage on schema private to authenticated;
grant execute on function private.title_key(text) to authenticated;


-- ===== Part 6 of 6, tool B: the key tester (canary) =====
-- One row per encryption-key version: a known text locked with that key.
-- At startup the server tries to open it; if that fails, it refuses to save.

create table private.key_canary (
  key_version smallint primary key check (key_version > 0),
  nonce       bytea not null check (octet_length(nonce) = 12),  -- AES-GCM uses 12 bytes
  ciphertext  bytea not null,
  created_at  timestamptz not null default now()
);

-- Every table gets row-level security, even here. Only the server's key may
-- read, directly (it runs before any user signs in). Nobody may write through
-- the app; new rows are added by hand when a key is added.
alter table private.key_canary enable row level security;

grant usage on schema private to axiomic_server;
grant select on private.key_canary to axiomic_server;

create policy key_canary_server_reads on private.key_canary
  for select to axiomic_server
  using (true);
