-- Check for migrations 0017-0019: who can read what (DB-DESIGN section 11, RLS matrix).
-- Run as the owner. Builds two fake companies' worth of data, then looks at it AS each
-- person (set role authenticated + their claims), lists PASS/FAIL, then undoes everything.

begin;

create temp table results (n int, test text, ok boolean) on commit drop;
grant insert, select on results to authenticated, anon;

-- Act as someone: claims like the server will set them.
create function pg_temp.act_as(p_user uuid, p_extra jsonb default '{}') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    (jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1') || p_extra)::text, true);
end $$;
grant execute on function pg_temp.act_as(uuid, jsonb) to authenticated;

-- People: A admin, B editor, R reader (all Acme), X outsider.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com', '{"full_name":"Asha"}'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com', '{"full_name":"Bala"}'),
  ('00000000-0000-0000-0000-00000000000e', 'r@example.com', '{"full_name":"Ravi"}'),
  ('00000000-0000-0000-0000-00000000000f', 'x@example.com', '{"full_name":"Xena"}');

-- Acme: team T (projects P1, P2), team T2 (project P3). Module M in P1.
insert into public.spaces (id, kind, name, slug) values ('10000000-0000-0000-0000-000000000001', 'work', 'Acme', 'acme-chk');
insert into public.memberships (space_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'admin'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'editor'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000e', 'reader');
insert into public.teams (id, space_id, name, slug) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Web', 'web'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Data', 'data');
insert into public.projects (id, space_id, team_id, name, slug) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'P1', 'p1'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'P2', 'p2'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'P3', 'p3');
insert into public.modules (id, space_id, project_id, name, path) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'pay', 'src/pay');

-- Acme rules: one per layer, plus B's personal rule.
insert into public.rules (id, space_id, layer, team_id, project_id, module_id, user_id, title, title_key) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'company',  null, null, null, null, 'C', 'c'),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'team', '20000000-0000-0000-0000-000000000001', null, null, null, 'T', 't'),
  ('50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'team', '20000000-0000-0000-0000-000000000002', null, null, null, 'T2', 't2'),
  ('50000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'project', null, '30000000-0000-0000-0000-000000000001', null, null, 'P1', 'p1'),
  ('50000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'project', null, '30000000-0000-0000-0000-000000000003', null, null, 'P3', 'p3'),
  ('50000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 'module', null, null, '40000000-0000-0000-0000-000000000001', null, 'M', 'm'),
  ('50000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 'personal', null, null, null, '00000000-0000-0000-0000-00000000000b', 'B own', 'b own');
insert into public.rule_versions (rule_id, version, title, nonce, body_ciphertext)
  select id, 1, title, '\x000000000000000000000001', '\x00' from public.rules where space_id = '10000000-0000-0000-0000-000000000001';

-- X's personal space: a project and a personal rule.
insert into public.projects (id, space_id, team_id, name, slug)
  select '30000000-0000-0000-0000-000000000009', s.id, t.id, 'Hobby', 'hobby'
  from public.spaces s join public.teams t on t.space_id = s.id
  where s.owner_id = '00000000-0000-0000-0000-00000000000f';
insert into public.rules (id, space_id, layer, user_id, title, title_key)
  select '50000000-0000-0000-0000-000000000009', s.id, 'personal', '00000000-0000-0000-0000-00000000000f', 'X own', 'x own'
  from public.spaces s where s.owner_id = '00000000-0000-0000-0000-00000000000f';

insert into public.api_tokens (user_id, kind, name, token_hash, prefix) values
  ('00000000-0000-0000-0000-00000000000b', 'cli', 'laptop', sha256('b'), 'axm_b');
insert into public.invites (space_id, email, role, token_hash) values
  ('10000000-0000-0000-0000-000000000001', 'new@example.com', 'reader', sha256('i'));
insert into public.activity_log (space_id, actor_id, actor_label, action) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Asha', 'rule.created');

-- Titles of the rules you can see, sorted, e.g. "B own,C,M,P1,P3,T,T2".
create function pg_temp.seen() returns text language sql as $$
  select coalesce(string_agg(title, ',' order by title), '') from public.rules $$;
grant execute on function pg_temp.seen() to authenticated;


-- ===== X, the outsider =====
select pg_temp.act_as('00000000-0000-0000-0000-00000000000f');
set local role authenticated;
insert into results select 1, 'outsider sees only their own rule', pg_temp.seen() = 'X own';
insert into results select 2, 'outsider sees no Acme space, member, project, version or log',
  not exists (select 1 from public.spaces where slug = 'acme')
  and not exists (select 1 from public.memberships where space_id = '10000000-0000-0000-0000-000000000001')
  and not exists (select 1 from public.projects where space_id = '10000000-0000-0000-0000-000000000001')
  and not exists (select 1 from public.rule_versions)
  and not exists (select 1 from public.activity_log);
insert into results select 3, 'outsider cannot see Asha''s name card',
  not exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-00000000000a');
insert into results select 4, 'the active_rules view also hides Acme (security_invoker works)',
  not exists (select 1 from public.active_rules where space_id = '10000000-0000-0000-0000-000000000001');
reset role;

-- ===== B, editor =====
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
set local role authenticated;
insert into results select 5, 'editor sees every Acme layer and own personal rule',
  pg_temp.seen() = 'B own,C,M,P1,P3,T,T2';
insert into results select 6, 'editor sees versions of rules they can see (7)',
  (select count(*) from public.rule_versions) = 7;
insert into results select 7, 'editor sees own token, not the hash column',
  (select count(*) from public.api_tokens) = 1;
reset role;

-- ===== R, reader =====
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
set local role authenticated;
insert into results select 8, 'reader does NOT see Bala''s personal rule', pg_temp.seen() = 'C,M,P1,P3,T,T2';
insert into results select 9, 'reader sees no invites and no tokens of others',
  not exists (select 1 from public.invites) and not exists (select 1 from public.api_tokens);
insert into results select 10, 'reader sees co-workers'' name cards but not the outsider''s',
  exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-00000000000b')
  and not exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-00000000000f');
reset role;

-- ===== A, admin: without 2FA, then with =====
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
insert into results select 11, 'admin WITHOUT 2FA: no personal rules of others, no invites',
  pg_temp.seen() = 'C,M,P1,P3,T,T2' and not exists (select 1 from public.invites);
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a', '{"aal":"aal2"}');
set local role authenticated;
insert into results select 12, 'admin WITH 2FA: sees personal rules and invites',
  pg_temp.seen() = 'B own,C,M,P1,P3,T,T2' and exists (select 1 from public.invites);
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a', '{"aal":"aal2","axm_kind":"cli"}');
set local role authenticated;
insert into results select 13, 'admin through a CLI token is not admin (no others'' personal rules)',
  pg_temp.seen() = 'C,M,P1,P3,T,T2';
reset role;

-- ===== B's agent key for project P1 =====
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b',
  '{"axm_kind":"agent","axm_project_id":"30000000-0000-0000-0000-000000000001"}');
set local role authenticated;
insert into results select 14, 'agent key: company + its team + its project + module, nothing else',
  pg_temp.seen() = 'C,M,P1,T';
insert into results select 15, 'agent key sees only its own project',
  (select string_agg(slug, ',') from public.projects) = 'p1';
reset role;

-- ===== X's agent key for their hobby project =====
select pg_temp.act_as('00000000-0000-0000-0000-00000000000f',
  '{"axm_kind":"agent","axm_project_id":"30000000-0000-0000-0000-000000000009"}');
set local role authenticated;
insert into results select 16, 'agent key never gets personal rules, even the owner''s', pg_temp.seen() = '';
reset role;

-- ===== Writes =====
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
set local role authenticated;
do $$ begin
  update public.profiles set display_name = 'Bala K' where id = '00000000-0000-0000-0000-00000000000b';
  insert into results select 17, 'you can rename yourself',
    (select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000000b') = 'Bala K';
end $$;
do $$ declare n int; begin
  update public.profiles set display_name = 'hacked' where id = '00000000-0000-0000-0000-00000000000a';
  get diagnostics n = row_count;
  insert into results values (18, 'you cannot rename someone else', n = 0);
end $$;
do $$ begin
  begin
    update public.profiles set email = 'evil@example.com' where id = '00000000-0000-0000-0000-00000000000b';
    insert into results values (19, 'you cannot change your email column', false);
  exception when insufficient_privilege then
    insert into results values (19, 'you cannot change your email column', true);
  end;
end $$;
do $$ begin
  begin
    insert into public.rules (space_id, layer, title, title_key)
    values ('10000000-0000-0000-0000-000000000001', 'company', 'Z', 'z');
    insert into results values (20, 'browser cannot write rules directly', false);
  exception when insufficient_privilege then
    insert into results values (20, 'browser cannot write rules directly', true);
  end;
end $$;
do $$ begin
  begin
    perform token_hash from public.api_tokens;
    insert into results values (21, 'token hash column is unreadable', false);
  exception when insufficient_privilege then
    insert into results values (21, 'token hash column is unreadable', true);
  end;
end $$;
do $$ begin
  begin
    perform 1 from public.device_codes;
    insert into results values (22, 'device codes are invisible', false);
  exception when insufficient_privilege then
    insert into results values (22, 'device codes are invisible', true);
  end;
end $$;
reset role;

-- ===== anon, a signed-out visitor =====
set local role anon;
do $$ begin
  begin
    perform 1 from public.rules;
    insert into results values (23, 'signed-out visitor cannot read rules', false);
  exception when insufficient_privilege then
    insert into results values (23, 'signed-out visitor cannot read rules', true);
  end;
end $$;
reset role;

select n, case when ok then 'PASS' else 'FAIL' end as result, test from results order by n;

rollback;
