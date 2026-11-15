-- Check for migrations 0002-0016c: every table guard works. Run as the owner (postgres).
-- Builds a fake company, tries good and bad changes, lists PASS/FAIL, then undoes everything.

begin;

create temp table results (n int, test text, ok boolean) on commit drop;

-- Tries a statement that MUST fail. Records PASS if it failed, FAIL if it worked.
create function pg_temp.must_fail(n int, test text, stmt text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
    insert into results values (n, test, false);
  exception when others then
    insert into results values (n, test, true);
  end;
end $$;

-- Tries a statement that MUST work.
create function pg_temp.must_work(n int, test text, stmt text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
    insert into results values (n, test, true);
  exception when others then
    insert into results values (n, test || ' -- ' || sqlerrm, false);
  end;
end $$;

-- People: A (will be the only admin of Acme), B (editor), C (outsider).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com', '{"full_name":"Asha"}'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com', '{"user_name":"bala"}'),
  ('00000000-0000-0000-0000-00000000000c', 'c@example.com', '{}');

-- 1. Sign-up made card + personal space + hidden team + admin membership.
insert into results
select 1, 'sign-up builds card, personal space, hidden team, admin membership',
  exists (select 1 from public.profiles p
          join public.spaces s on s.owner_id = p.id and s.kind = 'personal'
          join public.teams t on t.space_id = s.id and t.hidden
          join public.memberships m on m.space_id = s.id and m.user_id = p.id and m.role = 'admin'
          where p.id = '00000000-0000-0000-0000-00000000000a');

-- A fake company "Acme".
insert into public.spaces (id, kind, name, slug) values
  ('10000000-0000-0000-0000-000000000001', 'work', 'Acme', 'acme-chk');
insert into public.memberships (space_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'admin'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'editor');
insert into public.teams (id, space_id, name, slug) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'General', 'general');
insert into public.projects (id, space_id, team_id, owner_id, name, slug) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'Web', 'web');
insert into public.modules (id, space_id, project_id, name, path) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001', 'payments', 'src/payments');
insert into public.rules (id, space_id, layer, title, title_key) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'company', 'Deploys', 'deploys');
insert into public.rule_versions (rule_id, version, title, nonce, body_ciphertext) values
  ('50000000-0000-0000-0000-000000000001', 1, 'Deploys', '\x000000000000000000000001', '\xdeadbeef');
insert into public.activity_log (space_id, actor_id, actor_label, action) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Asha', 'rule.created');

select pg_temp.must_fail(2, 'forged title_key refused',
  $q$insert into public.rules (space_id, layer, title, title_key)
     values ('10000000-0000-0000-0000-000000000001', 'company', 'Tests', 'fake')$q$);
select pg_temp.must_fail(3, 'team rule without a team refused',
  $q$insert into public.rules (space_id, layer, title, title_key)
     values ('10000000-0000-0000-0000-000000000001', 'team', 'X', 'x')$q$);
select pg_temp.must_fail(4, 'same company title twice refused ("  DEPLOYS ")',
  $q$insert into public.rules (space_id, layer, title, title_key)
     values ('10000000-0000-0000-0000-000000000001', 'company', '  DEPLOYS ', 'deploys')$q$);
select pg_temp.must_fail(5, 'locked personal rule refused',
  $q$insert into public.rules (space_id, layer, user_id, title, title_key, locked)
     values ('10000000-0000-0000-0000-000000000001', 'personal', '00000000-0000-0000-0000-00000000000b', 'Mine', 'mine', true)$q$);
select pg_temp.must_fail(6, 'personal rule for an outsider refused',
  $q$insert into public.rules (space_id, layer, user_id, title, title_key)
     values ('10000000-0000-0000-0000-000000000001', 'personal', '00000000-0000-0000-0000-00000000000c', 'Mine', 'mine')$q$);
select pg_temp.must_fail(7, 'slug change refused',
  $q$update public.spaces set slug = 'acme2' where id = '10000000-0000-0000-0000-000000000001'$q$);
select pg_temp.must_fail(8, 'reserved slug "admin" refused',
  $q$insert into public.spaces (kind, name, slug) values ('work', 'X', 'admin')$q$);
select pg_temp.must_fail(9, 'demoting the only admin refused',
  $q$update public.memberships set role = 'editor'
     where space_id = '10000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-00000000000a'$q$);
select pg_temp.must_work(10, 'bumping personal_version is not blocked',
  $q$update public.memberships set personal_version = personal_version + 1
     where space_id = '10000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-00000000000a'$q$);
select pg_temp.must_fail(11, 'module path ../x refused',
  $q$insert into public.modules (space_id, project_id, name, path)
     values ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'a', '../x')$q$);
select pg_temp.must_fail(12, 'module path src/.GIT/x refused',
  $q$insert into public.modules (space_id, project_id, name, path)
     values ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'b', 'src/.GIT/x')$q$);
select pg_temp.must_fail(13, 'module "SRC/Payments" clashes with src/payments',
  $q$insert into public.modules (space_id, project_id, name, path)
     values ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'c', 'SRC/Payments')$q$);
select pg_temp.must_fail(14, 'module in another space''s project refused',
  $q$insert into public.modules (space_id, project_id, name, path)
     select s.id, '30000000-0000-0000-0000-000000000001', 'd', 'd'
     from public.spaces s where s.owner_id = '00000000-0000-0000-0000-00000000000a'$q$);
select pg_temp.must_fail(15, 'team membership for an outsider refused',
  $q$insert into public.team_memberships (team_id, space_id, user_id, role)
     values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'member')$q$);
select pg_temp.must_fail(16, 'project owner who is not a member refused',
  $q$update public.projects set owner_id = '00000000-0000-0000-0000-00000000000c'
     where id = '30000000-0000-0000-0000-000000000001'$q$);
select pg_temp.must_fail(17, 'editing a rule version refused',
  $q$update public.rule_versions set title = 'hacked' where rule_id = '50000000-0000-0000-0000-000000000001'$q$);
select pg_temp.must_fail(18, 'deleting a rule version refused',
  $q$delete from public.rule_versions where rule_id = '50000000-0000-0000-0000-000000000001'$q$);
select pg_temp.must_fail(19, 'editing the activity log refused',
  $q$update public.activity_log set action = 'nothing.happened' where actor_label = 'Asha'$q$);
select pg_temp.must_fail(20, 'deleting the activity log refused',
  $q$delete from public.activity_log where actor_label = 'Asha'$q$);
select pg_temp.must_fail(21, 'deleting a team that has projects refused',
  $q$delete from public.teams where id = '20000000-0000-0000-0000-000000000001'$q$);
select pg_temp.must_fail(22, 'agent key without a project refused',
  $q$insert into public.api_tokens (user_id, kind, name, token_hash, prefix)
     values ('00000000-0000-0000-0000-00000000000a', 'agent', 'ci', sha256('x'), 'axm_x')$q$);
select pg_temp.must_fail(23, 'account deletion of the only admin (with members) refused',
  $q$delete from auth.users where id = '00000000-0000-0000-0000-00000000000a'$q$);
select pg_temp.must_work(24, 'account deletion of an editor works',
  $q$delete from auth.users where id = '00000000-0000-0000-0000-00000000000b'$q$);

insert into results
select 25, 'deleted editor: no longer project owner, personal space gone',
  (select owner_id is null from public.projects where id = '30000000-0000-0000-0000-000000000001')
  and not exists (select 1 from public.spaces where owner_id = '00000000-0000-0000-0000-00000000000b');

select pg_temp.must_work(26, 'deleting a whole company with projects, rules, versions, log works',
  $q$delete from public.spaces where id = '10000000-0000-0000-0000-000000000001'$q$);
select pg_temp.must_work(27, 'account deletion of A (no company left) works',
  $q$delete from auth.users where id = '00000000-0000-0000-0000-00000000000a'$q$);

insert into results
select 28, 'row-level security is on for every table',
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname in ('public', 'private') and c.relkind = 'r' and not c.relrowsecurity);
insert into results
select 29, 'visitors (anon) and service_role have no table rights',
  not exists (select 1 from information_schema.role_table_grants
              where table_schema in ('public', 'private', 'api')
                and grantee in ('anon', 'service_role'));
insert into results
select 30, 'nothing on the live-broadcast list',
  not exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname in ('public', 'private', 'api'));

select n, case when ok then 'PASS' else 'FAIL' end as result, test from results order by n;

rollback;
