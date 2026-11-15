-- Migration 0020 part 6: tokens, the CLI's device login, and pull reporting.
-- Design: docs/DB-DESIGN.md 6.12, 6.13, 6.15, 10.
-- Tokens: "axm_" + 32 random bytes. Only the SHA-256 is stored; the raw token is returned once.

-- ===== Tokens =====

create function private.mint_token(p_user_id uuid, p_kind text, p_project_id uuid, p_name text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare tok text := private.new_secret('axm_'); tid uuid;
begin
  insert into public.api_tokens (user_id, kind, project_id, name, token_hash, prefix, expires_at)
  values (p_user_id, p_kind, p_project_id, left(coalesce(nullif(trim(p_name), ''), p_kind), 100),
          private.hash_secret(tok), left(tok, 8),
          case when p_kind = 'agent' then now() + interval '90 days' end)
  returning id into tid;
  return jsonb_build_object('token_id', tid, 'token', tok, 'prefix', left(tok, 8));
end $$;

-- From the website only. CLI tokens normally come from the device login below.
-- Agent keys: one project, read-only, 90 days; made by people who can edit that project.
create function api.issue_token(p_kind text, p_project_id uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(true); p record; sid uuid; res jsonb;
begin
  if p_kind = 'agent' then
    select * into p from public.projects where id = p_project_id;
    if not found or not private.can_edit_project(p_project_id) then
      perform private.deny('project editors only');
    end if;
    if p.archived_at is not null then perform private.bad_input('this project is archived'); end if;
    sid := p.space_id;
  elsif p_kind = 'cli' then
    if p_project_id is not null then perform private.bad_input('CLI tokens are not tied to a project'); end if;
  else
    perform private.bad_input('kind must be cli or agent');
  end if;
  res := private.mint_token(uid, p_kind, p_project_id, p_name);
  perform private.log(sid, 'token.created', 'token', (res ->> 'token_id')::uuid,
                      jsonb_build_object('kind', p_kind, 'prefix', res ->> 'prefix'));
  return res;
end $$;

-- Your own tokens only (R11). Tokens belong to the person, not the company.
create function api.revoke_token(p_token_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); t record;
begin
  if uid is null then perform private.deny('sign in first'); end if;
  select * into t from public.api_tokens where id = p_token_id for update;
  if not found or t.user_id <> uid then perform private.deny('not your token'); end if;
  update public.api_tokens set revoked_at = coalesce(revoked_at, now()) where id = p_token_id;
  perform private.log(null, 'token.revoked', 'token', p_token_id, jsonb_build_object('prefix', t.prefix));
end $$;

-- A project's agent keys, for its editors. Never the hash.
create function api.list_agent_keys(p_project_id uuid)
returns table (id uuid, name text, prefix text, user_id uuid, created_at timestamptz,
               last_used_at timestamptz, expires_at timestamptz, revoked_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_edit_project(p_project_id) or private.token_kind() = 'agent' then
    perform private.deny('project editors only');
  end if;
  return query
    select t.id, t.name, t.prefix, t.user_id, t.created_at, t.last_used_at, t.expires_at, t.revoked_at
    from public.api_tokens t where t.project_id = p_project_id and t.kind = 'agent'
    order by t.created_at;
end $$;

-- Called by the server's key BEFORE it knows who is asking: turns a Bearer token's hash
-- into who/what. Refuses revoked, expired, and CLI tokens unused for 90 days.
-- Notes "last used" at most once an hour.
create function private.resolve_token(p_hash bytea)
returns table (user_id uuid, kind text, project_id uuid)
language plpgsql volatile security definer set search_path = '' as $$
declare t record;
begin
  select * into t from public.api_tokens a where a.token_hash = p_hash;
  if not found or t.revoked_at is not null
     or (t.expires_at is not null and t.expires_at < now())
     or (t.kind = 'cli' and coalesce(t.last_used_at, t.created_at) < now() - interval '90 days') then
    return;   -- nothing back = not valid
  end if;
  if t.last_used_at is null or t.last_used_at < now() - interval '1 hour' then
    update public.api_tokens a set last_used_at = now() where a.id = t.id;
  end if;
  return query select t.user_id, t.kind, t.project_id;
end $$;


-- ===== Pull reporting (who is up to date, 6.13) =====

-- Called by the pull route, in the same transaction as the read, with the counters it read.
-- Refuses numbers higher than the real ones, so even a server bug can't fake "green".
-- Agent-key pulls are not recorded (S5).
create function api.report_pull(
  p_project_id uuid, p_space_version bigint, p_team_version bigint, p_personal_version bigint,
  p_cli_version text
) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); p record; sv bigint; tv bigint; pv bigint;
begin
  if uid is null then perform private.deny('sign in first'); end if;
  if private.token_kind() = 'agent' then return; end if;
  if not private.can_read_project(p_project_id) then perform private.deny('no access to this project'); end if;
  select * into p from public.projects where id = p_project_id;
  select rules_version into sv from public.spaces where id = p.space_id;
  select rules_version into tv from public.teams where id = p.team_id;
  select personal_version into pv from public.memberships where space_id = p.space_id and user_id = uid;
  if p_space_version > sv or p_team_version > tv or p_personal_version > coalesce(pv, 0) then
    perform private.bad_input('reported versions are newer than the real ones');
  end if;
  insert into public.client_status (project_id, user_id, space_version, team_version, personal_version,
                                    team_id, last_pull_at, cli_version)
  values (p_project_id, uid, p_space_version, p_team_version, p_personal_version, p.team_id, now(),
          left(p_cli_version, 40))
  on conflict (project_id, user_id) do update set
    space_version = excluded.space_version, team_version = excluded.team_version,
    personal_version = excluded.personal_version, team_id = excluded.team_id,
    last_pull_at = excluded.last_pull_at, cli_version = excluded.cli_version;
end $$;


-- ===== Device login: CLI shows a code, you approve it on the website =====

-- 1. CLI asks to log in (no user yet: called by the server's key).
--    p_client_info is BUILT BY THE SERVER (browser/OS, country, time), never CLI text (S14).
create function api.start_device_login(p_client_info text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   -- 32 letters, no I O 0 1
  device_code text := private.new_secret();
  code text; b bytea; tries int := 0; expires timestamptz;
begin
  loop
    b := extensions.gen_random_bytes(8);
    code := '';
    for i in 0..7 loop
      code := code || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
    end loop;
    begin
      insert into public.device_codes (user_code, device_code_hash, client_info)
      values (code, private.hash_secret(device_code), left(p_client_info, 120))
      returning expires_at into expires;
      exit;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 5 then raise; end if;
    end;
  end loop;
  return jsonb_build_object('device_code', device_code,
                            'user_code', left(code, 4) || '-' || right(code, 4),
                            'expires_at', expires);
end $$;

-- 2a. Website: show what the code belongs to before approving.
create function api.peek_device_code(p_user_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d record;
begin
  perform private.require_user(true);
  select * into d from public.device_codes
  where user_code = upper(replace(trim(p_user_code), '-', ''))
    and approved_at is null and consumed_at is null and expires_at > now();
  if not found then perform private.bad_input('that code is not valid (or has expired)'); end if;
  return jsonb_build_object('client_info', d.client_info, 'created_at', d.created_at);
end $$;

-- 2b. Website: approve it. (The route calls api.rate_limit('device_approve', …) first.)
create function api.approve_device_code(p_user_code text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(true); d record;
begin
  select * into d from public.device_codes
  where user_code = upper(replace(trim(p_user_code), '-', ''))
    and approved_at is null and consumed_at is null and expires_at > now()
  for update;
  if not found then perform private.bad_input('that code is not valid (or has expired)'); end if;
  update public.device_codes set approved_by = uid, approved_at = now() where id = d.id;
  perform private.log(null, 'device.approved', 'device_code', d.id);
end $$;

-- 3. CLI polls with its secret device code (server's key, no user). Never raises, so the
--    attempt counter is kept. The token is made here, at collect, so it is never stored raw.
create function api.collect_device_token(p_device_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d record; res jsonb;
begin
  select * into d from public.device_codes where device_code_hash = private.hash_secret(p_device_code) for update;
  if not found or d.consumed_at is not null then
    return jsonb_build_object('status', 'invalid');
  end if;
  if d.expires_at < now() or d.attempts >= 300 then
    return jsonb_build_object('status', 'expired');
  end if;
  if d.approved_at is null then
    update public.device_codes set attempts = attempts + 1 where id = d.id;
    return jsonb_build_object('status', 'pending');
  end if;
  res := private.mint_token(d.approved_by, 'cli', null, 'CLI login ' || to_char(now(), 'YYYY-MM-DD'));
  update public.device_codes set consumed_at = now(), token_id = (res ->> 'token_id')::uuid where id = d.id;
  return jsonb_build_object('status', 'approved', 'token', res ->> 'token');
end $$;

revoke execute on function private.mint_token(uuid, text, uuid, text) from public, anon, authenticated, service_role;
revoke execute on function private.resolve_token(bytea) from public, anon, authenticated, service_role;
