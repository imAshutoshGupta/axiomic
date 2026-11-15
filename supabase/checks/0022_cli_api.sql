-- Check for migration 0022: resolve_token returns the token id; the per-token API rate limit.
-- Run as the owner. Everything is rolled back.

begin;

create temp table results (n int, test text, ok boolean) on commit drop;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'd1@example.com');

-- A CLI token for that person, made the same way as a real one.
create temp table tok on commit drop as
  select private.mint_token('00000000-0000-0000-0000-0000000000d1', 'cli', null, 'chk') as r;

insert into results values
  (1, 'resolve_token returns the token id, user and kind',
   (select (t.token_id = ((select r from tok) ->> 'token_id')::uuid)
       and t.user_id = '00000000-0000-0000-0000-0000000000d1' and t.kind = 'cli'
    from private.resolve_token(private.hash_secret((select r from tok) ->> 'token')) t));

update public.api_tokens set revoked_at = now() where id = ((select r from tok) ->> 'token_id')::uuid;
insert into results values
  (2, 'a revoked token resolves to nothing',
   not exists (select 1 from private.resolve_token(private.hash_secret((select r from tok) ->> 'token'))));

insert into results values
  (3, 'only the server login may call resolve_token',
   has_function_privilege('axiomic_server', 'private.resolve_token(bytea)', 'execute')
   and not has_function_privilege('authenticated', 'private.resolve_token(bytea)', 'execute')
   and not has_function_privilege('anon', 'private.resolve_token(bytea)', 'execute'));

do $$
declare k text := gen_random_uuid()::text;
begin
  perform api.rate_limit('api_token', k) from generate_series(1, 120);
  insert into results values (4, 'api_token: 120 requests in a minute are fine', true);
  begin
    perform api.rate_limit('api_token', k);
    insert into results values (5, 'api_token: the 121st is refused', false);
  exception when sqlstate 'AX429' then
    insert into results values (5, 'api_token: the 121st is refused', true);
  end;
end $$;

do $$ begin
  perform api.rate_limit('api_token', '');
  insert into results values (6, 'api_token without a key is refused', false);
exception when invalid_parameter_value then
  insert into results values (6, 'api_token without a key is refused', true);
end $$;

select n, case when ok then 'PASS' else 'FAIL' end as result, test from results order by n;

rollback;
