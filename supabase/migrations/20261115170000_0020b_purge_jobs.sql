-- Migration 0020b: cleanup jobs, run inside the database by pg_cron as the owner.
-- Design: docs/DB-DESIGN.md 6.17. The app holds no login that can delete history.
-- Times are UTC (02:30 UTC = 08:00 in India).

create extension if not exists pg_cron with schema pg_catalog;


-- Log retention needs a way to tell "the cleanup job" from anyone else. The job sets a
-- flag for its own transaction; the guard also requires the real login to be the owner
-- (an app login can set the flag but has no delete right and is not "postgres").
-- Replaces the application_name check from 0016 (DECISIONS #38).
create or replace function private.forbid_log_change()
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
     and current_setting('axiomic.log_purge', true) = 'on' then
    return old;
  end if;

  raise exception 'activity log cannot be deleted' using errcode = 'check_violation';
end $$;


-- Trash: rules and modules trashed more than 30 days ago (versions and suggestions go too).
create function private.purge_trash() returns void
language sql security definer set search_path = '' as $$
  delete from public.rules   where deleted_at < now() - interval '30 days';
  delete from public.modules where deleted_at < now() - interval '30 days';
$$;

-- Spaces whose 7-day deletion time has passed. A history line survives (space_id null).
create function private.purge_spaces() returns void
language plpgsql security definer set search_path = '' as $$
declare s record;
begin
  for s in select id, name from public.spaces where delete_after < now() for update skip locked loop
    perform private.log(null, 'space.deleted', 'space', s.id, jsonb_build_object('name', s.name));
    delete from public.spaces where id = s.id;
  end loop;
end $$;

-- History older than 2 years.
create function private.purge_logs() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('axiomic.log_purge', 'on', true);
  delete from public.activity_log where created_at < now() - interval '2 years';
  perform set_config('axiomic.log_purge', 'off', true);
end $$;

-- Login codes, invites and rate-limit counters that are no longer needed.
create function private.purge_short_lived() returns void
language sql security definer set search_path = '' as $$
  delete from public.device_codes
   where expires_at < now() - interval '1 day' or consumed_at < now() - interval '1 day';
  delete from public.invites
   where expires_at  < now() - interval '90 days'
      or accepted_at < now() - interval '90 days'
      or revoked_at  < now() - interval '90 days';
  delete from public.rate_limits where window_start < now() - interval '24 hours';   -- IPs: 24 h max
$$;

revoke execute on function private.purge_trash()       from public, anon, authenticated, service_role;
revoke execute on function private.purge_spaces()      from public, anon, authenticated, service_role;
revoke execute on function private.purge_logs()        from public, anon, authenticated, service_role;
revoke execute on function private.purge_short_lived() from public, anon, authenticated, service_role;


-- Schedules (cron.schedule replaces a job with the same name, so re-running is safe).
select cron.schedule('axiomic-purge-trash',       '30 2 * * *', 'select private.purge_trash()');
select cron.schedule('axiomic-purge-spaces',      '5 * * * *',  'select private.purge_spaces()');
select cron.schedule('axiomic-purge-logs',        '45 2 * * *', 'select private.purge_logs()');
select cron.schedule('axiomic-purge-short-lived', '15 * * * *', 'select private.purge_short_lived()');
