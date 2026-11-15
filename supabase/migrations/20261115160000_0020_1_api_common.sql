-- Migration 0020 part 1: shared pieces for the write functions (api.*).
-- Design: docs/DB-DESIGN.md 8.1. Every api.* function: security definer, search_path '',
-- first statement = the permission check. Called by our server, as the signed-in user.

-- The server's key may enter the api room (it still has to "act as" a user to do most things).
grant usage on schema api to authenticated, axiomic_server;


-- Refuse with a clear message. 42501 = "not allowed", 22023 = "bad input".
create function private.deny(p_message text) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception '%', p_message using errcode = 'insufficient_privilege';
end $$;

create function private.bad_input(p_message text) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception '%', p_message using errcode = 'invalid_parameter_value';
end $$;

-- Must be signed in. Agent keys may never write. p_browser_only: website session only (no CLI token).
create function private.require_user(p_browser_only boolean default false) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then perform private.deny('sign in first'); end if;
  if private.token_kind() = 'agent' then perform private.deny('agent keys are read-only'); end if;
  if p_browser_only and private.token_kind() is not null then
    perform private.deny('do this on the website');
  end if;
  return uid;
end $$;


-- A new random secret: 32 random bytes, URL-safe text. prefix: e.g. 'axm_'.
create function private.new_secret(p_prefix text default '') returns text
language sql volatile set search_path = ''
return p_prefix || rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');

create function private.hash_secret(p_secret text) returns bytea
language sql immutable set search_path = ''
return sha256(convert_to(p_secret, 'UTF8'));


-- Write one history line, as the signed-in user. Never put rule text or a personal title in meta.
create function private.log(
  p_space_id uuid, p_action text, p_target_type text default null,
  p_target_id uuid default null, p_meta jsonb default '{}'
) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.activity_log (space_id, actor_id, actor_label, action, target_type, target_id, meta)
  values (p_space_id, auth.uid(),
          coalesce((select display_name from public.profiles where id = auth.uid()), 'system'),
          p_action, p_target_type, p_target_id, p_meta);
$$;


-- THE one size check (U3). The server computes, with merge(), the merged size of every
-- project a change reaches and passes {project_id: bytes}. Over 256 KiB -> refused.
create function private.check_output_size(p_sizes jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb;
begin
  if p_sizes is null or jsonb_typeof(p_sizes) <> 'object' then
    perform private.bad_input('output sizes missing');
  end if;
  for k, v in select * from jsonb_each(p_sizes) loop
    if jsonb_typeof(v) <> 'number' or v::numeric > 262144 then
      raise exception 'project % would be too large (over 256 KiB)', k
        using errcode = 'invalid_parameter_value';
    end if;
  end loop;
end $$;


-- Bump the one counter a rule change affects (D3), so laptops know to pull.
create function private.bump_counter(
  p_layer text, p_space_id uuid, p_team_id uuid, p_project_id uuid, p_module_id uuid, p_user_id uuid
) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  case p_layer
    when 'company' then
      update public.spaces set rules_version = rules_version + 1 where id = p_space_id;
    when 'team' then
      update public.teams set rules_version = rules_version + 1 where id = p_team_id;
    when 'project' then
      update public.teams set rules_version = rules_version + 1
      where id = (select team_id from public.projects where id = p_project_id);
    when 'module' then
      update public.teams set rules_version = rules_version + 1
      where id = (select p.team_id from public.modules m join public.projects p on p.id = m.project_id
                  where m.id = p_module_id);
    when 'personal' then
      update public.memberships set personal_version = personal_version + 1
      where space_id = p_space_id and user_id = p_user_id;
  end case;
end $$;


-- Is the project (or the module's project) archived, or the module trashed? Then no saving.
create function private.check_scope_open(p_project_id uuid, p_module_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_module_id is not null then
    if exists (select 1 from public.modules where id = p_module_id and deleted_at is not null) then
      perform private.bad_input('this module is in the trash');
    end if;
    select project_id into p_project_id from public.modules where id = p_module_id;
  end if;
  if p_project_id is not null
     and exists (select 1 from public.projects where id = p_project_id and archived_at is not null) then
    perform private.bad_input('this project is archived');
  end if;
end $$;


-- Rate limits. The route calls this in its OWN transaction before the action: a count
-- bumped inside an action that then fails would be rolled back, and failed guesses
-- are exactly what must count (DECISIONS #37). Limits live here, not in the route.
--   device_start   per IP     10 per 10 minutes
--   device_approve per user   10 per 10 minutes
--   invite_accept  per IP     20 per 10 minutes
create function api.rate_limit(p_kind text, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_key is null or length(p_key) = 0 or length(p_key) > 100 then
    perform private.bad_input('rate limit key missing');
  end if;
  case p_kind
    when 'device_start'   then perform private.hit_rate_limit('device_start:ip:' || p_key, interval '10 minutes', 10);
    when 'device_approve' then perform private.hit_rate_limit('device_approve:user:' || coalesce(auth.uid()::text, 'none'), interval '10 minutes', 10);
    when 'invite_accept'  then perform private.hit_rate_limit('invite_accept:ip:' || p_key, interval '10 minutes', 20);
    else perform private.bad_input('unknown rate limit');
  end case;
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('deny', 'bad_input', 'require_user', 'new_secret', 'hash_secret', 'log',
                        'check_output_size', 'bump_counter', 'check_scope_open')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated, service_role', f.sig);
  end loop;
end $$;
