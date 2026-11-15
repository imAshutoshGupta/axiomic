-- Migration 0020 part 7: account functions, and who may call what.
-- Design: docs/DB-DESIGN.md 8.1 (T7, U6), 4.1.

-- Can you delete your account? Lists work spaces where you are the only admin and
-- others remain (those block deletion until you hand over). The deletion itself is
-- auth.admin.deleteUser on the server; the 0016c guard does the rest.
create function api.can_delete_account() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := private.require_user(true); blocking jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('space_id', s.id, 'name', s.name)), '[]') into blocking
  from public.memberships m join public.spaces s on s.id = m.space_id and s.kind = 'work'
  where m.user_id = uid and m.role = 'admin'
    and not exists (select 1 from public.memberships o where o.space_id = m.space_id and o.role = 'admin' and o.user_id <> uid)
    and exists (select 1 from public.memberships o where o.space_id = m.space_id and o.user_id <> uid);
  return jsonb_build_object('ok', blocking = '[]'::jsonb, 'blocking_spaces', blocking);
end $$;

-- DPDP right of access (U6): everything about you, as one JSON. Rule and suggestion text is
-- still encrypted here; the server decrypts it before the download.
create function api.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := private.require_user(true);
begin
  return jsonb_build_object(
    'profile', (select to_jsonb(p) from public.profiles p where p.id = uid),
    'memberships', (select coalesce(jsonb_agg(jsonb_build_object(
                       'space', s.name, 'kind', s.kind, 'role', m.role, 'since', m.created_at)), '[]')
                    from public.memberships m join public.spaces s on s.id = m.space_id where m.user_id = uid),
    'personal_rules', (select coalesce(jsonb_agg(jsonb_build_object(
                         'rule_id', r.id, 'space', s.name, 'title', v.title, 'version', v.version,
                         'nonce', encode(v.nonce, 'base64'), 'ciphertext', encode(v.body_ciphertext, 'base64'),
                         'key_version', v.key_version, 'saved_at', v.created_at, 'trashed_at', r.deleted_at)
                         order by r.id, v.version), '[]')
                       from public.rules r join public.spaces s on s.id = r.space_id
                       join public.rule_versions v on v.rule_id = r.id
                       where r.layer = 'personal' and r.user_id = uid),
    'suggestions', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', g.id, 'kind', g.kind, 'layer', g.layer, 'title', g.proposed_title, 'status', g.status,
                      'nonce', encode(g.nonce, 'base64'), 'ciphertext', encode(g.body_ciphertext, 'base64'),
                      'key_version', g.key_version, 'created_at', g.created_at) order by g.created_at), '[]')
                    from public.suggestions g where g.created_by = uid),
    'activity', (select coalesce(jsonb_agg(jsonb_build_object(
                   'action', l.action, 'target_type', l.target_type, 'at', l.created_at) order by l.id), '[]')
                 from public.activity_log l where l.actor_id = uid),
    'tokens', (select coalesce(jsonb_agg(jsonb_build_object(
                 'kind', t.kind, 'name', t.name, 'prefix', t.prefix, 'created_at', t.created_at,
                 'last_used_at', t.last_used_at, 'revoked_at', t.revoked_at) order by t.created_at), '[]')
               from public.api_tokens t where t.user_id = uid)
  );
end $$;


-- ===== Who may call what =====
-- Every api.* function: signed-in users (the server "acts as" them). Each one checks
-- permissions itself as its first step.
-- Three are called by the server's key BEFORE anyone is signed in: starting and collecting
-- a device login, and the device_start rate limit. Plus private.resolve_token.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api'
  loop
    execute format('revoke execute on function %s from public, anon, service_role', f.sig);
    if f.proname in ('start_device_login', 'collect_device_token') then
      execute format('grant execute on function %s to axiomic_server', f.sig);
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

grant execute on function api.rate_limit(text, text) to axiomic_server;
grant execute on function private.resolve_token(bytea) to axiomic_server;
