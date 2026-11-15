-- Migration 0017: helper checks used by the access rules (0018) and write functions (0020).
-- Design: docs/DB-DESIGN.md 7.1. All in private, security definer, stable, search_path ''.
-- "you" = the signed-in user, from the claims the server sets for each request.
-- Agent keys (token_kind = 'agent') can read their one project and can never edit or act as admin.

-- ===== Who is asking =====

-- 'cli', 'agent', or null for a browser session.
create function private.token_kind() returns text
language sql stable security definer set search_path = ''
return nullif(auth.jwt() ->> 'axm_kind', '');

-- The one project an agent key is for (null otherwise).
create function private.token_project() returns uuid
language sql stable security definer set search_path = ''
return nullif(auth.jwt() ->> 'axm_project_id', '')::uuid;


-- ===== Space-level =====

create function private.is_member(p_space_id uuid) returns boolean
language sql stable security definer set search_path = ''
return exists (
  select 1 from public.memberships
  where space_id = p_space_id and user_id = (select auth.uid())
);

-- Admin there; in a work space only with 2FA (aal2). Never through a CLI or agent token
-- (DECISIONS #36): admin powers belong to the website session.
create function private.is_admin(p_space_id uuid) returns boolean
language sql stable security definer set search_path = ''
return private.token_kind() is null
  and exists (
    select 1 from public.memberships m
    join public.spaces s on s.id = m.space_id
    where m.space_id = p_space_id and m.user_id = (select auth.uid()) and m.role = 'admin'
      and (s.kind = 'personal' or coalesce(auth.jwt() ->> 'aal', '') = 'aal2')
  );

create function private.can_edit(p_space_id uuid) returns boolean
language sql stable security definer set search_path = ''
return private.token_kind() is distinct from 'agent'
  and exists (
    select 1 from public.memberships
    where space_id = p_space_id and user_id = (select auth.uid()) and role in ('admin', 'editor')
  );

create function private.is_space_owner(p_space_id uuid) returns boolean
language sql stable security definer set search_path = ''
return exists (
  select 1 from public.spaces where id = p_space_id and owner_id = (select auth.uid())
);

create function private.is_work_space(p_space_id uuid) returns boolean
language sql stable security definer set search_path = ''
return exists (select 1 from public.spaces where id = p_space_id and kind = 'work');

-- Do you and this person share any space? (Lets you see their name card.)
create function private.shares_space_with(p_user_id uuid) returns boolean
language sql stable security definer set search_path = ''
return exists (
  select 1 from public.memberships mine
  join public.memberships theirs on theirs.space_id = mine.space_id
  where mine.user_id = (select auth.uid()) and theirs.user_id = p_user_id
);


-- ===== Project-level =====

-- THE door: may you pull this repo? The only place to change for per-project visibility.
create function private.can_read_project(p_project_id uuid) returns boolean
language sql stable security definer set search_path = ''
return exists (
  select 1 from public.projects p
  where p.id = p_project_id
    and (private.token_project() is null or private.token_project() = p.id)
    and (private.is_member(p.space_id) or private.is_space_owner(p.space_id))
);

-- Has edit rights in that space (admin/editor), and is a member with them.
-- Helper for the three "owns a layer" checks below.
create function private.has_edit_role(p_space_id uuid) returns boolean
language sql stable security definer set search_path = ''
return private.token_kind() is distinct from 'agent'
  and exists (
    select 1 from public.memberships
    where space_id = p_space_id and user_id = (select auth.uid()) and role in ('admin', 'editor')
  );

create function private.owns_team_layer(p_team_id uuid) returns boolean
language sql stable security definer set search_path = ''
return exists (
  select 1 from public.team_memberships tm
  where tm.team_id = p_team_id and tm.user_id = (select auth.uid()) and tm.role = 'lead'
    and private.has_edit_role(tm.space_id)
);

create function private.owns_project_layer(p_project_id uuid) returns boolean
language sql stable security definer set search_path = ''
return exists (
  select 1 from public.projects p
  where p.id = p_project_id and p.owner_id = (select auth.uid())
    and private.has_edit_role(p.space_id)
);

create function private.owns_module_layer(p_module_id uuid) returns boolean
language sql stable security definer set search_path = ''
return exists (
  select 1 from public.modules m
  where m.id = p_module_id and m.owner_id = (select auth.uid())
    and private.has_edit_role(m.space_id)
);

create function private.can_edit_project(p_project_id uuid) returns boolean
language sql stable security definer set search_path = ''
return exists (
  select 1 from public.projects p
  where p.id = p_project_id and private.can_edit(p.space_id)
) or private.owns_project_layer(p_project_id);


-- ===== Rules =====

-- The single read decision for a rule (takes the row's columns, no second lookup).
create function private.can_read_rule(
  p_layer text, p_space_id uuid, p_team_id uuid, p_project_id uuid, p_module_id uuid, p_user_id uuid
) returns boolean
language sql stable security definer set search_path = ''
return case p_layer
  when 'company'  then private.is_member(p_space_id)
  when 'team'     then private.is_member(p_space_id)
                       and (private.token_project() is null
                            or p_team_id = (select team_id from public.projects where id = private.token_project()))
  when 'project'  then private.can_read_project(p_project_id)
  when 'module'   then private.can_read_project((select project_id from public.modules where id = p_module_id))
  when 'personal' then (p_user_id = (select auth.uid()) and private.token_kind() is distinct from 'agent')
                       or private.is_admin(p_space_id)
  else false
end;

-- The single write decision for a rule (used by the api.* functions). Never for agent keys.
create function private.can_edit_layer(
  p_layer text, p_space_id uuid, p_team_id uuid, p_project_id uuid, p_module_id uuid, p_user_id uuid
) returns boolean
language sql stable security definer set search_path = ''
return private.token_kind() is distinct from 'agent'
  and case p_layer
    when 'company'  then private.is_admin(p_space_id)
    when 'team'     then private.is_admin(p_space_id) or private.owns_team_layer(p_team_id)
    when 'project'  then private.is_admin(p_space_id) or private.owns_project_layer(p_project_id)
    when 'module'   then private.is_admin(p_space_id) or private.owns_module_layer(p_module_id)
    when 'personal' then p_user_id = (select auth.uid()) and private.is_member(p_space_id)
    else false
  end;

-- A suggestion: its author, whoever may approve it, or a space admin.
-- (A promote carries someone's personal rule text: not for the whole team.)
create function private.can_read_suggestion(
  p_created_by uuid, p_layer text, p_space_id uuid, p_team_id uuid, p_project_id uuid, p_module_id uuid
) returns boolean
language sql stable security definer set search_path = ''
return p_created_by = (select auth.uid())
  or private.can_edit_layer(p_layer, p_space_id, p_team_id, p_project_id, p_module_id, null)
  or private.is_admin(p_space_id);


-- ===== Who may run them =====
-- Only signed-in users (the access rules run as them). Nobody can call these over the
-- web: the private schema is not published.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('token_kind', 'token_project', 'is_member', 'is_admin', 'can_edit',
                        'is_space_owner', 'is_work_space', 'shares_space_with', 'can_read_project',
                        'has_edit_role', 'owns_team_layer', 'owns_project_layer', 'owns_module_layer',
                        'can_edit_project', 'can_read_rule', 'can_edit_layer', 'can_read_suggestion')
  loop
    execute format('revoke execute on function %s from public, anon, service_role', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
