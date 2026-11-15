-- Check for migration 0020: the write functions, used as real people would through the server.
-- Run as the owner. Lists PASS/FAIL, then undoes everything (rollback).

begin;

create temp table results (n int, test text, ok boolean) on commit drop;
create temp table kv (k text primary key, v text) on commit drop;
grant all on results, kv to authenticated, anon;

-- Run one statement as someone. expect_ok: should it work (true) or be refused (false)?
-- p_save: keep the statement's single result under this name in kv.
create function pg_temp.run(n int, test text, who text, stmt text, expect_ok boolean, p_save text default null)
returns void language plpgsql as $$
declare claims jsonb; res text;
begin
  claims := case who
    when 'A'  then '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal2"}'
    when 'A5' then jsonb_build_object('sub','00000000-0000-0000-0000-00000000000a','role','authenticated','aal','aal2',
                     'amr', jsonb_build_array(jsonb_build_object('method','totp','timestamp', extract(epoch from now())::bigint)))
    when 'B'  then '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated","aal":"aal1"}'
    when 'R'  then '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated","aal":"aal1"}'
    when 'Bagent' then jsonb_build_object('sub','00000000-0000-0000-0000-00000000000b','role','authenticated',
                     'axm_kind','agent','axm_project_id',(select v from kv where k='p1'))
    when 'Bcli' then '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated","axm_kind":"cli"}'
  end;
  begin
    perform set_config('request.jwt.claims', claims::text, true);
    execute 'set local role authenticated';
    execute stmt into res;
    execute 'reset role';
    if p_save is not null then insert into kv values (p_save, res) on conflict (k) do update set v = excluded.v; end if;
    insert into results values (n, test, expect_ok);
  exception when others then
    insert into results values (n, test || case when expect_ok then ' -- ' || sqlerrm else '' end, not expect_ok);
  end;
end $$;

create function pg_temp.v(k text) returns text language sql as $$ select v from kv where kv.k = $1 $$;
grant execute on function pg_temp.v(text) to authenticated;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com', now(), '{"full_name":"Asha"}'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com', now(), '{"full_name":"Bala"}'),
  ('00000000-0000-0000-0000-00000000000e', 'r@example.com', now(), '{"full_name":"Ravi"}');

-- ===== Company, invites, members =====
select pg_temp.run(1, 'admin creates a company', 'A',
  $q$select api.create_space('Acme', 'acme-test')$q$, true, 'space');
select pg_temp.run(2, 'creator is admin and lead of General',
  'A', $q$select 1 from public.team_memberships tm join public.teams t on t.id = tm.team_id
          where t.slug = 'general' and tm.role = 'lead' and tm.space_id = pg_temp.v('space')::uuid$q$, true);
select pg_temp.run(3, 'taken company address refused', 'B',
  $q$select api.create_space('Other', 'acme-test')$q$, false);
select pg_temp.run(4, 'non-admin cannot invite', 'B',
  $q$select api.create_invite(pg_temp.v('space')::uuid, 'x@example.com', 'reader')$q$, false);
select pg_temp.run(5, 'admin invites Bala as editor', 'A',
  $q$select api.create_invite(pg_temp.v('space')::uuid, 'B@Example.com', 'editor') ->> 'secret'$q$, true, 'inv_b');
select pg_temp.run(6, 'admin invites Ravi as reader', 'A',
  $q$select api.create_invite(pg_temp.v('space')::uuid, 'r@example.com', 'reader') ->> 'secret'$q$, true, 'inv_r');
select pg_temp.run(7, 'Bala cannot accept Ravi''s invite (email mismatch)', 'B',
  $q$select api.accept_invite(pg_temp.v('inv_r'))$q$, false);
select pg_temp.run(8, 'Bala accepts own invite', 'B', $q$select api.accept_invite(pg_temp.v('inv_b'))$q$, true);
select pg_temp.run(9, 'invite link works only once', 'B', $q$select api.accept_invite(pg_temp.v('inv_b'))$q$, false);
select pg_temp.run(10, 'Ravi accepts own invite', 'R', $q$select api.accept_invite(pg_temp.v('inv_r'))$q$, true);
select pg_temp.run(11, 'admin with 2FA can invite more people', 'A',
  $q$select api.create_invite(pg_temp.v('space')::uuid, 'y@example.com', 'reader')$q$, true);
select pg_temp.run(12, 'demoting the only admin refused', 'A',
  $q$select api.set_role(pg_temp.v('space')::uuid, '00000000-0000-0000-0000-00000000000a', 'editor')$q$, false);

-- ===== Projects and rules =====
select pg_temp.run(13, 'editor creates a project (becomes owner)', 'B',
  $q$select api.create_project(pg_temp.v('space')::uuid,
       (select id from public.teams where space_id = pg_temp.v('space')::uuid and slug = 'general'), 'Web', 'web')$q$,
  true, 'p1');
select pg_temp.run(14, 'reader cannot create a project', 'R',
  $q$select api.create_project(pg_temp.v('space')::uuid,
       (select id from public.teams where space_id = pg_temp.v('space')::uuid and slug = 'general'), 'X', 'x')$q$, false);
insert into kv values ('r_company', gen_random_uuid()), ('r_project', gen_random_uuid()),
                      ('r_personal', gen_random_uuid()), ('r_clash', gen_random_uuid()), ('sug', gen_random_uuid());
select pg_temp.run(15, 'admin saves a company rule', 'A',
  $q$select api.save_rule(pg_temp.v('r_company')::uuid, 1, pg_temp.v('space')::uuid, 'company', null,
       'Deploys', '\x000000000000000000000001', '\x01', 1::smallint, true, '{}')$q$, true);
select pg_temp.run(16, 'editor cannot save a company rule', 'B',
  $q$select api.save_rule(gen_random_uuid(), 1, pg_temp.v('space')::uuid, 'company', null,
       'Other', '\x000000000000000000000001', '\x01', 1::smallint, false, '{}')$q$, false);
select pg_temp.run(17, 'project owner saves a project rule', 'B',
  $q$select api.save_rule(pg_temp.v('r_project')::uuid, 1, pg_temp.v('space')::uuid, 'project', pg_temp.v('p1')::uuid,
       'Testing', '\x000000000000000000000001', '\x01', 1::smallint, false, '{}')$q$, true);
select pg_temp.run(18, 'stale version number refused', 'B',
  $q$select api.save_rule(pg_temp.v('r_project')::uuid, 1, pg_temp.v('space')::uuid, 'project', pg_temp.v('p1')::uuid,
       'Testing', '\x000000000000000000000002', '\x02', 1::smallint, false, '{}')$q$, false);
select pg_temp.run(19, 'next version saves', 'B',
  $q$select api.save_rule(pg_temp.v('r_project')::uuid, 2, null, null, null,
       'Testing', '\x000000000000000000000002', '\x02', 1::smallint, false, '{}')$q$, true);
select pg_temp.run(20, 'same title in the same layer refused', 'B',
  $q$select api.save_rule(pg_temp.v('r_clash')::uuid, 1, pg_temp.v('space')::uuid, 'project', pg_temp.v('p1')::uuid,
       ' TESTING ', '\x000000000000000000000001', '\x01', 1::smallint, false, '{}')$q$, false);
select pg_temp.run(21, 'too-large project output refused', 'B',
  $q$select api.save_rule(pg_temp.v('r_project')::uuid, 3, null, null, null,
       'Testing', '\x000000000000000000000003', '\x03', 1::smallint, false,
       jsonb_build_object(pg_temp.v('p1'), 300000))$q$, false);
select pg_temp.run(22, 'missing size info refused', 'B',
  $q$select api.save_rule(pg_temp.v('r_project')::uuid, 3, null, null, null,
       'Testing', '\x000000000000000000000003', '\x03', 1::smallint, false, null)$q$, false);
select pg_temp.run(23, 'reader cannot edit the project rule', 'R',
  $q$select api.save_rule(pg_temp.v('r_project')::uuid, 3, null, null, null,
       'Testing', '\x000000000000000000000003', '\x03', 1::smallint, false, '{}')$q$, false);
select pg_temp.run(24, 'reader saves a personal rule', 'R',
  $q$select api.save_rule(pg_temp.v('r_personal')::uuid, 1, pg_temp.v('space')::uuid, 'personal', null,
       'My style', '\x000000000000000000000001', '\x01', 1::smallint, false, '{}')$q$, true);
insert into results select 25, 'counters bumped: company 1, team 2, personal 1',
  (select rules_version from public.spaces where id = (select v from kv where k='space')::uuid) = 1
  and (select t.rules_version from public.teams t join public.projects p on p.team_id = t.id
       where p.id = (select v from kv where k='p1')::uuid) = 2
  and (select personal_version from public.memberships
       where space_id = (select v from kv where k='space')::uuid and user_id = '00000000-0000-0000-0000-00000000000e') = 1;

-- ===== Suggestions =====
select pg_temp.run(26, 'reader suggests a change to the project rule', 'R',
  $q$select api.create_suggestion(pg_temp.v('sug')::uuid, pg_temp.v('space')::uuid, 'update', null, null,
       pg_temp.v('r_project')::uuid, null, 'Testing', '\x000000000000000000000009', '\x09', 1::smallint, 2)$q$, true);
select pg_temp.run(27, 'suggesting on a locked rule refused', 'R',
  $q$select api.create_suggestion(gen_random_uuid(), pg_temp.v('space')::uuid, 'update', null, null,
       pg_temp.v('r_company')::uuid, null, 'Deploys', '\x000000000000000000000009', '\x09', 1::smallint, 1)$q$, false);
select pg_temp.run(28, 'reader cannot approve', 'R',
  $q$select api.decide_suggestion(pg_temp.v('sug')::uuid, 'approve', null, pg_temp.v('r_project')::uuid, 3,
       '\x000000000000000000000003', '\x03', 1::smallint, '{}')$q$, false);
select pg_temp.run(29, 'project owner approves: becomes version 3', 'B',
  $q$select api.decide_suggestion(pg_temp.v('sug')::uuid, 'approve', 'thanks', pg_temp.v('r_project')::uuid, 3,
       '\x000000000000000000000003', '\x03', 1::smallint, '{}')$q$, true);
insert into results select 30, 'version 3 exists and suggestion is approved',
  exists (select 1 from public.rule_versions where rule_id = (select v from kv where k='r_project')::uuid and version = 3)
  and (select status from public.suggestions where id = (select v from kv where k='sug')::uuid) = 'approved';

-- ===== Tokens and agent keys =====
select pg_temp.run(31, 'project owner makes an agent key', 'B',
  $q$select api.issue_token('agent', pg_temp.v('p1')::uuid, 'CI') ->> 'token'$q$, true, 'agent_tok');
select pg_temp.run(32, 'agent key cannot save rules', 'Bagent',
  $q$select api.save_rule(pg_temp.v('r_project')::uuid, 4, null, null, null,
       'Testing', '\x000000000000000000000004', '\x04', 1::smallint, false, '{}')$q$, false);
select pg_temp.run(33, 'CLI token cannot make tokens (website only)', 'Bcli',
  $q$select api.issue_token('cli', null, 'x')$q$, false);
insert into results select 34, 'token stored only as a hash, resolvable by hash',
  exists (select 1 from private.resolve_token(sha256(convert_to((select v from kv where k='agent_tok'), 'UTF8'))))
  and not exists (select 1 from public.api_tokens where prefix = (select v from kv where k='agent_tok'));
select pg_temp.run(35, 'reporting a fake "up to date" refused', 'B',
  $q$select api.report_pull(pg_temp.v('p1')::uuid, 99, 99, 0, '1.0.0')$q$, false);
select pg_temp.run(36, 'reporting the real counters works', 'B',
  $q$select api.report_pull(pg_temp.v('p1')::uuid, 1, 3, 0, '1.0.0')$q$, true);

-- ===== Device login =====
insert into kv select 'dev', api.start_device_login('Chrome on macOS, IN');
select pg_temp.run(37, 'Bala approves the device code', 'B',
  $q$select api.approve_device_code((pg_temp.v('dev')::jsonb) ->> 'user_code')$q$, true);
insert into results select 38, 'CLI collects a token once, then the code is used up',
  (api.collect_device_token((select v from kv where k='dev')::jsonb ->> 'device_code') ->> 'status') = 'approved'
  and (api.collect_device_token((select v from kv where k='dev')::jsonb ->> 'device_code') ->> 'status') = 'invalid';

-- ===== Members, deletion =====
select pg_temp.run(39, 'demoting Bala to reader lists the project they no longer own the layer of', 'A',
  $q$select (api.set_role(pg_temp.v('space')::uuid, '00000000-0000-0000-0000-00000000000b', 'reader')
             -> 'projects_owned' ->> 0)$q$, true, 'lost');
insert into results select 40, '...and it names "Web"', (select v from kv where k='lost') = 'Web';
select pg_temp.run(41, 'scheduling deletion without a fresh 2FA code refused', 'A',
  $q$select api.schedule_space_deletion(pg_temp.v('space')::uuid, 'acme-test')$q$, false);
select pg_temp.run(42, 'scheduling with the wrong typed address refused', 'A5',
  $q$select api.schedule_space_deletion(pg_temp.v('space')::uuid, 'acme')$q$, false);
select pg_temp.run(43, 'scheduling with fresh 2FA + typed address works', 'A5',
  $q$select api.schedule_space_deletion(pg_temp.v('space')::uuid, 'acme-test')$q$, true);
select pg_temp.run(44, 'admin removes Ravi (personal rule goes too)', 'A',
  $q$select api.remove_member(pg_temp.v('space')::uuid, '00000000-0000-0000-0000-00000000000e')$q$, true);
insert into results select 45, 'removal logged with a count, no titles',
  exists (select 1 from public.activity_log where action = 'member.removed'
          and meta ->> 'personal_rules_removed' = '1' and meta::text not like '%My style%')
  and not exists (select 1 from public.rules where id = (select v from kv where k='r_personal')::uuid);
select pg_temp.run(46, 'Asha cannot delete her account yet (others remain)', 'A',
  $q$select (api.can_delete_account() ->> 'ok')::boolean and true$q$, true, 'can_del');
insert into results select 47, '...and the answer is "no"', (select v from kv where k='can_del') = 'false';
select pg_temp.run(48, 'export my data works', 'B', $q$select api.export_my_data() ->> 'profile'$q$, true);

-- ===== Rate limit, and signed-out visitors =====
do $$ begin
  for i in 1..10 loop perform api.rate_limit('device_start', '203.0.113.7'); end loop;
  begin
    perform api.rate_limit('device_start', '203.0.113.7');
    insert into results values (49, '11th device login from one IP in 10 minutes refused', false);
  exception when others then
    insert into results values (49, '11th device login from one IP in 10 minutes refused', true);
  end;
end $$;
set local role anon;
do $$ begin
  begin
    perform api.create_space('x', 'xyz-test');
    insert into results values (50, 'signed-out visitor cannot call any action', false);
  exception when others then
    insert into results values (50, 'signed-out visitor cannot call any action', true);
  end;
end $$;
reset role;

select n, case when ok then 'PASS' else 'FAIL' end as result, test from results order by n;

rollback;
