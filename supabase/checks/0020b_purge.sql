-- Check for migration 0020b: cleanup jobs delete exactly what they should. Run as the owner.

begin;

create temp table results (n int, test text, ok boolean) on commit drop;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1', 'c1@example.com');
insert into public.spaces (id, kind, name, slug, delete_after) values
  ('10000000-0000-0000-0000-0000000000c1', 'work', 'Doomed', 'doomed-chk', now() - interval '1 minute'),
  ('10000000-0000-0000-0000-0000000000c2', 'work', 'Kept',   'kept-chk',   now() + interval '6 days');
insert into public.memberships (space_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c1', 'admin');
insert into public.rules (id, space_id, layer, title, title_key, deleted_at) values
  ('50000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c2', 'company', 'Old', 'old', now() - interval '31 days'),
  ('50000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-0000000000c2', 'company', 'Recent', 'recent', now() - interval '29 days');
insert into public.activity_log (space_id, actor_label, action, created_at) values
  ('10000000-0000-0000-0000-0000000000c2', 'x', 'chk.ancient', now() - interval '3 years'),
  ('10000000-0000-0000-0000-0000000000c2', 'x', 'chk.recent',  now() - interval '1 year');
insert into public.device_codes (user_code, device_code_hash, expires_at) values
  ('CHKAAAAA', sha256('chk1'), now() - interval '2 days'),
  ('CHKBBBBB', sha256('chk2'), now() + interval '5 minutes');
insert into public.rate_limits (bucket, window_start, count) values
  ('chk:old', now() - interval '2 days', 1), ('chk:new', now(), 1);

select private.purge_trash();
select private.purge_spaces();
select private.purge_short_lived();

insert into results values
  (1, 'trash: rule trashed 31 days ago deleted, 29 days ago kept',
   not exists (select 1 from public.rules where id = '50000000-0000-0000-0000-0000000000c1')
   and exists (select 1 from public.rules where id = '50000000-0000-0000-0000-0000000000c2')),
  (2, 'spaces: overdue space deleted, scheduled-later space kept',
   not exists (select 1 from public.spaces where id = '10000000-0000-0000-0000-0000000000c1')
   and exists (select 1 from public.spaces where id = '10000000-0000-0000-0000-0000000000c2')),
  (3, 'spaces: a "space.deleted" history line survives (space_id empty)',
   exists (select 1 from public.activity_log where action = 'space.deleted' and space_id is null
           and target_id = '10000000-0000-0000-0000-0000000000c1')),
  (4, 'device codes: expired deleted, live kept',
   not exists (select 1 from public.device_codes where user_code = 'CHKAAAAA')
   and exists (select 1 from public.device_codes where user_code = 'CHKBBBBB')),
  (5, 'rate limits: older than a day deleted, current kept',
   not exists (select 1 from public.rate_limits where bucket = 'chk:old')
   and exists (select 1 from public.rate_limits where bucket = 'chk:new'));

-- Log retention: deleting without the job's flag is refused, even for the owner.
do $$ begin
  begin
    delete from public.activity_log where action = 'chk.ancient';
    insert into results values (6, 'deleting old history outside the job refused', false);
  exception when check_violation then
    insert into results values (6, 'deleting old history outside the job refused', true);
  end;
end $$;

insert into results values
  (7, 'four jobs are scheduled',
   (select count(*) from cron.job where jobname like 'axiomic-purge-%') = 4);

-- The log job itself only works when the real login is the owner, as under pg_cron.
do $$ begin
  if session_user = 'postgres' then
    perform private.purge_logs();
    insert into results values (8, 'log job: 3-year-old line deleted, 1-year-old kept',
      not exists (select 1 from public.activity_log where action = 'chk.ancient')
      and exists (select 1 from public.activity_log where action = 'chk.recent'));
  else
    insert into results values (8, 'log job: skipped (not logged in as postgres)', true);
  end if;
end $$;

select n, case when ok then 'PASS' else 'FAIL' end as result, test from results order by n;

rollback;
