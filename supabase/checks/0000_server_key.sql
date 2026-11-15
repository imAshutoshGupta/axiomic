-- Check for migration 0000: proves the server key opens nothing on its own (DB-DESIGN T13).
-- Run it logged in AS axiomic_server (see docs/DECISIONS.md #33 for the command).
-- Every line of output should say PASS. Nothing is saved: it all ends in rollback.

begin;

-- 1. Who am I? Must be axiomic_server.
do $$
begin
  if current_user = 'axiomic_server' then
    raise notice 'PASS 1: logged in as axiomic_server';
  else
    raise exception 'FAIL 1: logged in as %, expected axiomic_server', current_user;
  end if;
end $$;

-- 2. Alone, the key must be refused. title_key is allowed for "authenticated" only.
do $$
begin
  perform private.title_key('x');
  raise exception 'FAIL 2: the server key worked on its own (noinherit is not working)';
exception when insufficient_privilege then
  raise notice 'PASS 2: alone, the server key is refused';
end $$;

-- 3. After "act as a signed-in user", the same thing works.
set local role authenticated;
do $$
begin
  if private.title_key('  Deploys ') = 'deploys' then
    raise notice 'PASS 3: acting as a signed-in user, it works';
  else
    raise exception 'FAIL 3: title_key gave a wrong answer';
  end if;
end $$;
reset role;

-- 4. The key must not be able to become a powerful key.
do $$
begin
  set local role service_role;
  raise exception 'FAIL 4: the server key could become service_role';
exception when insufficient_privilege then
  raise notice 'PASS 4: cannot become service_role';
end $$;

-- 5. It may read the key tester directly (empty for now).
do $$
declare n int;
begin
  select count(*) into n from private.key_canary;
  raise notice 'PASS 5: can read key_canary (% rows)', n;
end $$;

rollback;
