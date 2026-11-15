-- Migration 0020 part 2: spaces, invites, members.
-- Design: docs/DB-DESIGN.md 6.2, 6.3, 6.11, 8.1. Emails are sent by the server, not here
-- (provider on hold, DECISIONS #29); functions return what the server needs to send them.

-- ===== Spaces =====

-- New company: space + "General" team + you as admin and team lead, in one go.
create function api.create_space(p_name text, p_slug text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(true); sid uuid; tid uuid;
begin
  if length(trim(coalesce(p_name, ''))) = 0 then perform private.bad_input('name is required'); end if;
  begin
    insert into public.spaces (kind, name, slug) values ('work', trim(p_name), p_slug) returning id into sid;
  exception
    when unique_violation then perform private.bad_input('that address is taken');
    when check_violation then perform private.bad_input('that address is not allowed');
  end;
  insert into public.memberships (space_id, user_id, role) values (sid, uid, 'admin');
  insert into public.teams (space_id, name, slug) values (sid, 'General', 'general') returning id into tid;
  insert into public.team_memberships (team_id, space_id, user_id, role) values (tid, sid, uid, 'lead');
  perform private.log(sid, 'space.created', 'space', sid);
  return sid;
end $$;

create function api.rename_space(p_space_id uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_user(true);
  if not private.is_admin(p_space_id) then perform private.deny('admins only'); end if;
  if length(trim(coalesce(p_name, ''))) = 0 then perform private.bad_input('name is required'); end if;
  update public.spaces set name = trim(p_name) where id = p_space_id;
  perform private.log(p_space_id, 'space.renamed', 'space', p_space_id);
end $$;

-- 7-day scheduled deletion. Needs the space's address typed again and a 2FA code entered
-- in the last 5 minutes (T4: the newest "totp" entry in amr, not iat).
create function api.schedule_space_deletion(p_space_id uuid, p_typed_slug text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare s record; fresh boolean; after timestamptz := now() + interval '7 days';
begin
  perform private.require_user(true);
  if not private.is_admin(p_space_id) then perform private.deny('admins only'); end if;
  select * into s from public.spaces where id = p_space_id for update;
  if s.kind <> 'work' then perform private.bad_input('a personal space goes with your account'); end if;
  if s.slug <> p_typed_slug then perform private.bad_input('the typed address does not match'); end if;
  select exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]')) a
    where a ->> 'method' = 'totp'
      and (a ->> 'timestamp')::numeric >= extract(epoch from now() - interval '5 minutes')
  ) into fresh;
  if not fresh then perform private.deny('enter your 2FA code again first'); end if;
  update public.spaces set delete_after = after where id = p_space_id;
  perform private.log(p_space_id, 'space.deletion_scheduled', 'space', p_space_id,
                      jsonb_build_object('delete_after', after));
  return after;
end $$;

-- Any admin, or anyone who was an admin in the last 7 days (so a rogue admin who removed
-- the others first can still be stopped, S3).
create function api.cancel_space_deletion(p_space_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(true);
begin
  if not (private.is_admin(p_space_id)
          or (coalesce(auth.jwt() ->> 'aal', '') = 'aal2' and exists (
                select 1 from public.activity_log
                where space_id = p_space_id and target_id = uid
                  and action in ('member.removed', 'member.role_changed')
                  and meta ->> 'old_role' = 'admin'
                  and created_at > now() - interval '7 days'))) then
    perform private.deny('admins only');
  end if;
  update public.spaces set delete_after = null where id = p_space_id and delete_after is not null;
  if not found then perform private.bad_input('no deletion is scheduled'); end if;
  perform private.log(p_space_id, 'space.deletion_cancelled', 'space', p_space_id);
end $$;


-- ===== Invites (the only way into a work space) =====

-- Returns the link secret ONCE, for the server to email. Only its hash is stored.
create function api.create_invite(p_space_id uuid, p_email text, p_role text, p_team_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare secret text := private.new_secret(); iid uuid; mail text := lower(trim(p_email));
begin
  perform private.require_user(true);
  if not private.is_admin(p_space_id) then perform private.deny('admins only'); end if;
  if not private.is_work_space(p_space_id) then perform private.bad_input('only work spaces take invites'); end if;
  if mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform private.bad_input('that is not an email address'); end if;
  if p_team_id is not null and not exists (select 1 from public.teams where id = p_team_id and space_id = p_space_id and not hidden) then
    perform private.bad_input('that team is not in this space');
  end if;
  begin
    insert into public.invites (space_id, email, role, team_id, token_hash, created_by)
    values (p_space_id, mail, p_role, p_team_id, private.hash_secret(secret), auth.uid())
    returning id into iid;
  exception
    when unique_violation then perform private.bad_input('this person already has an open invite: resend it');
    when check_violation then perform private.bad_input('role must be admin, editor or reader');
  end;
  perform private.log(p_space_id, 'invite.created', 'invite', iid, jsonb_build_object('role', p_role));
  return jsonb_build_object('invite_id', iid, 'secret', secret, 'email', mail);
end $$;

-- New secret and 7 more days (an expired invite is renewed, not duplicated).
create function api.resend_invite(p_invite_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare secret text := private.new_secret(); i record;
begin
  perform private.require_user(true);
  select * into i from public.invites where id = p_invite_id for update;
  if not found or not private.is_admin(i.space_id) then perform private.deny('admins only'); end if;
  if i.accepted_at is not null or i.revoked_at is not null then perform private.bad_input('this invite is closed'); end if;
  update public.invites set token_hash = private.hash_secret(secret), expires_at = now() + interval '7 days'
  where id = p_invite_id;
  perform private.log(i.space_id, 'invite.resent', 'invite', p_invite_id);
  return jsonb_build_object('invite_id', p_invite_id, 'secret', secret, 'email', i.email);
end $$;

create function api.revoke_invite(p_invite_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare i record;
begin
  perform private.require_user(true);
  select * into i from public.invites where id = p_invite_id for update;
  if not found or not private.is_admin(i.space_id) then perform private.deny('admins only'); end if;
  update public.invites set revoked_at = now() where id = p_invite_id and revoked_at is null and accepted_at is null;
  perform private.log(i.space_id, 'invite.revoked', 'invite', p_invite_id);
end $$;

-- The invite email must match one of YOUR confirmed emails (any linked GitHub/Google account).
-- The route calls api.rate_limit('invite_accept', <ip>) in its own transaction first.
create function api.accept_invite(p_secret text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(true); i record;
begin
  select * into i from public.invites where token_hash = private.hash_secret(p_secret) for update;
  if not found or i.revoked_at is not null or i.accepted_at is not null or i.expires_at < now() then
    perform private.bad_input('this invite link is not valid any more: ask for a new one');
  end if;
  if not exists (select 1 from auth.users u
                 where u.id = uid and u.email_confirmed_at is not null and lower(u.email) = i.email)
     and not exists (select 1 from auth.identities d
                     where d.user_id = uid and lower(d.identity_data ->> 'email') = i.email
                       and coalesce((d.identity_data ->> 'email_verified')::boolean, false)) then
    perform private.deny(format('This invite is for %s — sign in with the account that uses that email',
                                left(i.email, 1) || '***@' || split_part(i.email, '@', 2)));
  end if;

  insert into public.memberships (space_id, user_id, role) values (i.space_id, uid, i.role)
  on conflict (space_id, user_id) do nothing;   -- already a member: keep the current role
  if i.team_id is not null then
    insert into public.team_memberships (team_id, space_id, user_id, role)
    values (i.team_id, i.space_id, uid, 'member') on conflict do nothing;
  end if;
  update public.invites set accepted_at = now(), accepted_by = uid where id = i.id;
  perform private.log(i.space_id, 'member.joined', 'profile', uid, jsonb_build_object('role', i.role));
  return i.space_id;
end $$;


-- ===== Members =====

-- Returns the layers the person can no longer edit when made a reader (R20, S-low).
create function api.set_role(p_space_id uuid, p_user_id uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare old_role text; s record;
begin
  perform private.require_user(true);
  if not private.is_admin(p_space_id) then perform private.deny('admins only'); end if;
  select * into s from public.spaces where id = p_space_id;
  if s.kind <> 'work' then perform private.bad_input('roles only exist in work spaces'); end if;
  select role into old_role from public.memberships where space_id = p_space_id and user_id = p_user_id for update;
  if not found then perform private.bad_input('not a member'); end if;
  if old_role = 'admin' and p_role <> 'admin' and s.delete_after is not null then
    perform private.deny('admins cannot be demoted while the space is scheduled for deletion');
  end if;
  begin
    update public.memberships set role = p_role where space_id = p_space_id and user_id = p_user_id;
  exception when check_violation then
    perform private.bad_input(sqlerrm);   -- bad role name, or the last admin
  end;
  perform private.log(p_space_id, 'member.role_changed', 'profile', p_user_id,
                      jsonb_build_object('old_role', old_role, 'new_role', p_role));
  if p_role <> 'reader' then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'teams_led',      (select coalesce(jsonb_agg(t.name), '[]') from public.team_memberships tm
                       join public.teams t on t.id = tm.team_id
                       where tm.space_id = p_space_id and tm.user_id = p_user_id and tm.role = 'lead'),
    'projects_owned', (select coalesce(jsonb_agg(name), '[]') from public.projects
                       where space_id = p_space_id and owner_id = p_user_id),
    'modules_owned',  (select coalesce(jsonb_agg(name), '[]') from public.modules
                       where space_id = p_space_id and owner_id = p_user_id and deleted_at is null));
end $$;

-- Removes them and (by cascade) their personal rules in this space (R19). Count is logged, never titles.
create function api.remove_member(p_space_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(true); old_role text; n int;
begin
  if not private.is_admin(p_space_id) then perform private.deny('admins only'); end if;
  if not private.is_work_space(p_space_id) then perform private.bad_input('only work spaces have members'); end if;
  if p_user_id = uid then perform private.bad_input('use "leave space" to remove yourself'); end if;
  select role into old_role from public.memberships where space_id = p_space_id and user_id = p_user_id;
  if not found then perform private.bad_input('not a member'); end if;
  if old_role = 'admin' and exists (select 1 from public.spaces where id = p_space_id and delete_after is not null) then
    perform private.deny('admins cannot be removed while the space is scheduled for deletion');
  end if;
  select count(*) into n from public.rules where space_id = p_space_id and user_id = p_user_id;
  delete from public.memberships where space_id = p_space_id and user_id = p_user_id;
  perform private.log(p_space_id, 'member.removed', 'profile', p_user_id,
                      jsonb_build_object('old_role', old_role, 'personal_rules_removed', n));
end $$;

create function api.leave_space(p_space_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(true); old_role text; n int;
begin
  if not private.is_work_space(p_space_id) then perform private.bad_input('you cannot leave your personal space'); end if;
  select role into old_role from public.memberships where space_id = p_space_id and user_id = uid;
  if not found then perform private.bad_input('you are not a member'); end if;
  if old_role = 'admin' and exists (select 1 from public.spaces where id = p_space_id and delete_after is not null) then
    perform private.deny('admins cannot leave while the space is scheduled for deletion');
  end if;
  select count(*) into n from public.rules where space_id = p_space_id and user_id = uid;
  begin
    delete from public.memberships where space_id = p_space_id and user_id = uid;
  exception when check_violation then
    perform private.bad_input('make someone else admin first');
  end;
  perform private.log(p_space_id, 'member.removed', 'profile', uid,
                      jsonb_build_object('old_role', old_role, 'personal_rules_removed', n, 'left', true));
end $$;
