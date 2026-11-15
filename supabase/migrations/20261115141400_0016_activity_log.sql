-- Migration 0016: activity_log (append-only history).
-- Design: docs/DB-DESIGN.md 6.14. Never rule text, never a personal rule's title.

create table public.activity_log (
  id          bigint generated always as identity primary key,
  space_id    uuid references public.spaces (id) on delete cascade,     -- null: account-level events
  actor_id    uuid references public.profiles (id) on delete set null,
  actor_label text not null,                                            -- name at the time
  action      text not null,                                            -- e.g. rule.created
  target_type text,
  target_id   uuid,
  meta        jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

alter table public.activity_log enable row level security;

create index activity_log_space_idx   on public.activity_log (space_id, id desc);
create index activity_log_target_idx  on public.activity_log (target_type, target_id);
create index activity_log_created_idx on public.activity_log (created_at);
create index activity_log_actor_idx   on public.activity_log (actor_id);


-- Append-only. Allowed:
--   update: only clearing the actor (account deletion)
--   delete: the row's space is gone (space purge), or the row is 2+ years old and
--           the delete runs inside pg_cron as the owner (retention job)
create function private.forbid_log_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if (new.id, new.space_id, new.action, new.target_type, new.target_id, new.meta, new.created_at)
         is not distinct from
       (old.id, old.space_id, old.action, old.target_type, old.target_id, old.meta, old.created_at)
       and (new.actor_id is not distinct from old.actor_id or new.actor_id is null)
       and (new.actor_label = old.actor_label or new.actor_label = 'deleted user') then
      return new;
    end if;
    raise exception 'activity log cannot be changed' using errcode = 'check_violation';
  end if;

  if old.space_id is not null
     and not exists (select 1 from public.spaces where id = old.space_id) then
    return old;
  end if;

  if old.created_at < now() - interval '2 years'
     and session_user = 'postgres'
     and current_setting('application_name', true) = 'pg_cron' then
    return old;
  end if;

  raise exception 'activity log cannot be deleted' using errcode = 'check_violation';
end $$;

revoke execute on function private.forbid_log_change() from public, anon, authenticated, service_role;

create trigger activity_log_append_only
  before update or delete on public.activity_log
  for each row execute function private.forbid_log_change();
