-- Dev seed (design step 0021): fake data to try things on. NEVER for production.
-- Loaded by `npx supabase db reset --remote` (development project only).
-- Rule text is a placeholder, NOT real encryption: it gets replaced by properly encrypted
-- text once the server's encryption exists (step 6c). All emails are @example.com.
--
-- People                 Acme (work)            Globex (work)     Personal spaces
--   Asha  asha@example.com    admin                  -                 yes
--   Bala  bala@example.com    editor, Web lead       -                 yes
--   Ravi  ravi@example.com    reader                 -                 yes
--   Xena  xena@example.com    -                      admin             yes (+ hobby project)
--
-- Acme: teams Web (projects web-app, api) and Data (project pipeline);
--       module "payments" (src/payments) in web-app; a rule in every layer.

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'asha@example.com', now(), '{"full_name": "Asha Rao"}'),
  ('00000000-0000-4000-8000-00000000000b', 'bala@example.com', now(), '{"user_name": "bala-dev"}'),
  ('00000000-0000-4000-8000-00000000000e', 'ravi@example.com', now(), '{"name": "Ravi Kumar"}'),
  ('00000000-0000-4000-8000-00000000000f', 'xena@example.com', now(), '{"full_name": "Xena Iyer"}');
-- (the sign-up robot made each person's card, personal space and hidden team)

-- Companies
insert into public.spaces (id, kind, name, slug) values
  ('10000000-0000-4000-8000-000000000001', 'work', 'Acme', 'acme'),
  ('10000000-0000-4000-8000-000000000002', 'work', 'Globex', 'globex');

insert into public.memberships (space_id, user_id, role) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'admin'),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', 'editor'),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000e', 'reader'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000f', 'admin');

insert into public.teams (id, space_id, name, slug) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Web', 'web'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Data', 'data'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'General', 'general');

insert into public.team_memberships (team_id, space_id, user_id, role) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', 'lead'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000e', 'member'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000f', 'lead');

insert into public.projects (id, space_id, team_id, owner_id, name, slug) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', 'Web app', 'web-app'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', null,                                   'API', 'api'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a', 'Pipeline', 'pipeline');

-- Xena's hobby project, in her personal space's hidden team.
insert into public.projects (id, space_id, team_id, owner_id, name, slug)
select '30000000-0000-4000-8000-000000000009', s.id, t.id, s.owner_id, 'Hobby', 'hobby'
from public.spaces s join public.teams t on t.space_id = s.id and t.hidden
where s.owner_id = '00000000-0000-4000-8000-00000000000f';

insert into public.modules (id, space_id, project_id, owner_id, name, path) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', 'payments', 'src/payments');

-- Rules: one per layer (+ a locked company rule, a team rule a project overrides,
-- personal rules, one rule in the trash).
insert into public.rules (id, space_id, layer, team_id, project_id, module_id, user_id, title, title_key, locked, created_by, deleted_at) values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'company',  null, null, null, null, 'Security', 'security', true,  '00000000-0000-4000-8000-00000000000a', null),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'company',  null, null, null, null, 'Code style', 'code style', false, '00000000-0000-4000-8000-00000000000a', null),
  ('50000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'team', '20000000-0000-4000-8000-000000000001', null, null, null, 'Testing', 'testing', false, '00000000-0000-4000-8000-00000000000b', null),
  ('50000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'team', '20000000-0000-4000-8000-000000000002', null, null, null, 'Notebooks', 'notebooks', false, '00000000-0000-4000-8000-00000000000a', null),
  ('50000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'project', null, '30000000-0000-4000-8000-000000000001', null, null, 'Testing', 'testing', false, '00000000-0000-4000-8000-00000000000b', null),
  ('50000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', 'module', null, null, '40000000-0000-4000-8000-000000000001', null, 'Money', 'money', false, '00000000-0000-4000-8000-00000000000b', null),
  ('50000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', 'personal', null, null, null, '00000000-0000-4000-8000-00000000000b', 'My shortcuts', 'my shortcuts', false, '00000000-0000-4000-8000-00000000000b', null),
  ('50000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000001', 'project', null, '30000000-0000-4000-8000-000000000002', null, null, 'Old rule', 'old rule', false, '00000000-0000-4000-8000-00000000000b', now() - interval '3 days'),
  ('50000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000002', 'company',  null, null, null, null, 'Globex only', 'globex only', false, '00000000-0000-4000-8000-00000000000f', null);

insert into public.rules (id, space_id, layer, user_id, title, title_key, created_by)
select '50000000-0000-4000-8000-000000000009', s.id, 'personal', s.owner_id, 'Hobby notes', 'hobby notes', s.owner_id
from public.spaces s where s.owner_id = '00000000-0000-4000-8000-00000000000f';

-- One version each. Placeholder bytes, NOT real ciphertext (see top).
insert into public.rule_versions (rule_id, version, title, nonce, body_ciphertext, created_by)
select id, 1, title, '\x000000000000000000000000', convert_to('PLACEHOLDER: ' || title, 'UTF8'), created_by
from public.rules where id::text like '50000000-0000-4000-8000-%';

-- Counters as if those saves happened.
update public.spaces set rules_version = 2 where id = '10000000-0000-4000-8000-000000000001';
update public.teams  set rules_version = 3 where id = '20000000-0000-4000-8000-000000000001';

-- A pending suggestion from the reader, and a little history.
insert into public.suggestions (space_id, kind, layer, project_id, proposed_title, title_key, nonce, body_ciphertext, created_by)
values ('10000000-0000-4000-8000-000000000001', 'create', 'project', '30000000-0000-4000-8000-000000000001',
        'Accessibility', 'accessibility', '\x000000000000000000000000', convert_to('PLACEHOLDER', 'UTF8'),
        '00000000-0000-4000-8000-00000000000e');

insert into public.activity_log (space_id, actor_id, actor_label, action, target_type, target_id, meta) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'Asha Rao', 'space.created', 'space', '10000000-0000-4000-8000-000000000001', '{}'),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', 'bala-dev', 'rule.created', 'rule', '50000000-0000-4000-8000-000000000005', '{"layer": "project", "title": "Testing"}');
