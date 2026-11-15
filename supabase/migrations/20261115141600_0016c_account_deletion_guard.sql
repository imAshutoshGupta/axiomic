-- Migration 0016c: what happens when someone deletes their account.
-- Design: docs/DB-DESIGN.md 8.1 (T7). Moved here from 0001 (DECISIONS #34).

create function private.before_profile_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
begin
  -- Work spaces where this person is the ONLY admin.
  for s in
    select m.space_id
    from public.memberships m
    join public.spaces sp on sp.id = m.space_id and sp.kind = 'work'
    where m.user_id = old.id and m.role = 'admin'
      and not exists (
        select 1 from public.memberships o
        where o.space_id = m.space_id and o.role = 'admin' and o.user_id <> old.id)
  loop
    -- Other people there? Refuse: they would be left with nobody in charge.
    if exists (select 1 from public.memberships o
               where o.space_id = s.space_id and o.user_id <> old.id) then
      raise exception 'hand over admin first: you are the only admin of a space with other members'
        using errcode = 'check_violation';
    end if;
    -- Nobody else: the space is theirs alone, delete it.
    delete from public.spaces where id = s.space_id;
  end loop;

  -- History keeps the event but not the person.
  update public.activity_log
     set actor_label = 'deleted user', actor_id = null
   where actor_id = old.id;

  return old;   -- the personal space goes by cascade
end $$;

revoke execute on function private.before_profile_delete() from public, anon, authenticated, service_role;

create trigger profiles_before_delete
  before delete on public.profiles
  for each row execute function private.before_profile_delete();
