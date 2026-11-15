-- Migration 0022: what the CLI's /api/v1 endpoints need (Phase 2, DECISIONS #57).
--   1. private.resolve_token also returns the token's id, so `axiomic logout` can revoke
--      exactly the token it is using (the server can't read api_tokens itself).
--   2. api.rate_limit learns 'api_token': every Bearer-token request counts against its token.


-- ===== 1. resolve_token: + token_id =====
-- Same checks as before (revoked, expired, idle 90+ days → nothing back). The return type
-- changes, so the function is dropped and made again; its grants are set again below.

drop function private.resolve_token(bytea);

create function private.resolve_token(p_hash bytea)
returns table (token_id uuid, user_id uuid, kind text, project_id uuid)
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
  return query select t.id, t.user_id, t.kind, t.project_id;
end $$;

revoke execute on function private.resolve_token(bytea) from public, anon, authenticated, service_role;
grant execute on function private.resolve_token(bytea) to axiomic_server;


-- ===== 2. rate_limit: + 'api_token' =====
-- 'api_token': 120 requests a minute per token, across pull/whoami/projects/logout. The
-- hook pulls once per Claude Code session, so a real person never gets near it; a runaway
-- script does. p_key = the token's id (from resolve_token). Called by the server right after
-- resolve_token, in the same short transaction, NOT inside pull's snapshot transaction: two
-- sessions starting at once would otherwise both update this counter row and one would fail.
-- create or replace keeps the existing grants (axiomic_server, authenticated).

create or replace function api.rate_limit(p_kind text, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_key is null or length(p_key) = 0 or length(p_key) > 100 then
    perform private.bad_input('rate limit key missing');
  end if;
  case p_kind
    when 'device_start'   then perform private.hit_rate_limit('device_start:ip:' || p_key, interval '10 minutes', 10);
    when 'device_approve' then perform private.hit_rate_limit('device_approve:user:' || coalesce(auth.uid()::text, 'none'), interval '10 minutes', 10);
    when 'invite_accept'  then perform private.hit_rate_limit('invite_accept:ip:' || p_key, interval '10 minutes', 20);
    when 'api_token'      then perform private.hit_rate_limit('api:token:' || p_key, interval '1 minute', 120);
    else perform private.bad_input('unknown rate limit');
  end case;
end $$;
