-- Migration 0010: rule_versions (the encrypted text, one row per save; never edited).
-- Design: docs/DB-DESIGN.md 6.9.

create table public.rule_versions (
  id              uuid primary key default gen_random_uuid(),
  rule_id         uuid not null references public.rules (id) on delete cascade,
  version         integer not null check (version >= 1),
  title           text not null,
  nonce           bytea not null check (octet_length(nonce) = 12),
  body_ciphertext bytea not null check (octet_length(body_ciphertext) <= 65536 + 16),  -- 64 KiB + tag
  key_version     smallint not null default 1 check (key_version > 0),
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (rule_id, version)
);

alter table public.rule_versions enable row level security;

create index rule_versions_created_by_idx on public.rule_versions (created_by);


-- Append-only. Allowed: the author's id cleared on account deletion, key rotation
-- (nonce + ciphertext + key_version together), and removal with the parent rule.
create function private.forbid_version_change()
returns trigger
language plpgsql
security definer      -- must see public.rules whoever triggers it
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.rules where id = old.rule_id) then
      return old;   -- parent rule is gone: cascade
    end if;
    raise exception 'rule versions cannot be deleted' using errcode = 'check_violation';
  end if;

  -- Account deletion: only created_by -> null.
  if new.created_by is null and old.created_by is not null
     and (new.id, new.rule_id, new.version, new.title, new.nonce, new.body_ciphertext, new.key_version, new.created_at)
       = (old.id, old.rule_id, old.version, old.title, old.nonce, old.body_ciphertext, old.key_version, old.created_at) then
    return new;
  end if;

  -- Key rotation: new key version, new nonce and ciphertext, everything else the same.
  if new.key_version <> old.key_version and new.nonce <> old.nonce
     and (new.id, new.rule_id, new.version, new.title, new.created_at)
       = (old.id, old.rule_id, old.version, old.title, old.created_at)
     and new.created_by is not distinct from old.created_by then
    return new;
  end if;

  raise exception 'rule versions cannot be changed' using errcode = 'check_violation';
end $$;

revoke execute on function private.forbid_version_change() from public, anon, authenticated, service_role;

create trigger rule_versions_append_only
  before update or delete on public.rule_versions
  for each row execute function private.forbid_version_change();
