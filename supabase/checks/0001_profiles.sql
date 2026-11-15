-- Check for migration 0001: the name-card robots work. Run as the owner (postgres).
-- Creates fake sign-ups, checks their cards, then undoes everything (rollback).

begin;

-- Google-style sign-up: full name + https picture.
insert into auth.users (id, email, raw_user_meta_data)
values ('00000000-0000-0000-0000-0000000000a1', 'priya@example.com',
        '{"full_name": "Priya Sharma", "picture": "https://example.com/p.png"}');

-- GitHub-style sign-up: only a username, and an insecure picture link.
insert into auth.users (id, email, raw_user_meta_data)
values ('00000000-0000-0000-0000-0000000000a2', 'rahul@example.com',
        '{"user_name": "rahul-dev", "avatar_url": "http://example.com/r.png"}');

-- Sign-up with nothing useful at all.
insert into auth.users (id, email, raw_user_meta_data)
values ('00000000-0000-0000-0000-0000000000a3', null, null);

-- Email change on Priya. (The "last changed" stamp can't be checked inside one
-- transaction: the clock stands still until it ends.)
update auth.users set email = 'priya@new.example.com'
where id = '00000000-0000-0000-0000-0000000000a1';

select
  case when count(*) = 3 then 'PASS' else 'FAIL' end as "1 three cards made",
  case when bool_and(
         (id = '00000000-0000-0000-0000-0000000000a1' and display_name = 'Priya Sharma'
            and avatar_url = 'https://example.com/p.png' and email = 'priya@new.example.com')
      or (id = '00000000-0000-0000-0000-0000000000a2' and display_name = 'rahul-dev'
            and avatar_url is null)
      or (id = '00000000-0000-0000-0000-0000000000a3' and display_name = 'User'))
       then 'PASS' else 'FAIL' end as "2 names, pictures, email sync"
from public.profiles
where id::text like '00000000-0000-0000-0000-0000000000a%';

rollback;
