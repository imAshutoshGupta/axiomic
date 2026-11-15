-- Migration 0018: access rules (row-level security policies) — who may READ what.
-- Design: docs/DB-DESIGN.md 7.2. Browsers never write tables; all writes go through
-- api.* functions (0020). The one exception: your own name and picture.
-- Two layers of locks: GRANT says which tables/columns a role may touch at all,
-- the POLICY says which rows. Both must allow it.

-- ===== profiles: yourself, and people you share a space with =====
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_space_with(id));

create policy profiles_update_own on public.profiles for update to authenticated
  using      (id = (select auth.uid()) and private.token_kind() is null)
  with check (id = (select auth.uid()) and private.token_kind() is null);

-- ===== spaces =====
grant select on public.spaces to authenticated;
create policy spaces_read on public.spaces for select to authenticated
  using (private.is_member(id) or private.is_space_owner(id));

-- ===== memberships, teams, team_memberships: members of the space =====
grant select on public.memberships to authenticated;
create policy memberships_read on public.memberships for select to authenticated
  using (private.is_member(space_id));

grant select on public.teams to authenticated;
create policy teams_read on public.teams for select to authenticated
  using (private.is_member(space_id));

grant select on public.team_memberships to authenticated;
create policy team_memberships_read on public.team_memberships for select to authenticated
  using (private.is_member(space_id));

-- ===== projects and modules: through the project door =====
grant select on public.projects to authenticated;
create policy projects_read on public.projects for select to authenticated
  using (private.can_read_project(id));

grant select on public.modules to authenticated;
create policy modules_read on public.modules for select to authenticated
  using (private.can_read_project(project_id));

-- ===== rules, versions, suggestions =====
grant select on public.rules to authenticated;
create policy rules_read on public.rules for select to authenticated
  using (private.can_read_rule(layer, space_id, team_id, project_id, module_id, user_id));

-- A version is visible when its rule is (the rules policy applies inside this check).
grant select on public.rule_versions to authenticated;
create policy rule_versions_read on public.rule_versions for select to authenticated
  using (exists (select 1 from public.rules r where r.id = rule_id));

grant select on public.suggestions to authenticated;
create policy suggestions_read on public.suggestions for select to authenticated
  using (private.can_read_suggestion(created_by, layer, space_id, team_id, project_id, module_id));

-- ===== invites: admins of the space; never the secret's hash =====
grant select (id, space_id, email, role, team_id, expires_at, accepted_at, accepted_by,
              revoked_at, created_by, created_at)
  on public.invites to authenticated;
create policy invites_read on public.invites for select to authenticated
  using (private.is_admin(space_id));

-- ===== api_tokens: your own; never the hash =====
grant select (id, user_id, kind, project_id, name, prefix, created_at, last_used_at,
              expires_at, revoked_at)
  on public.api_tokens to authenticated;
create policy api_tokens_read_own on public.api_tokens for select to authenticated
  using (user_id = (select auth.uid()));

-- ===== client_status: your own, or people who can edit the project =====
grant select on public.client_status to authenticated;
create policy client_status_read on public.client_status for select to authenticated
  using (user_id = (select auth.uid()) or private.can_edit_project(project_id));

-- ===== activity_log: members of the space, or your own account-level events =====
grant select on public.activity_log to authenticated;
create policy activity_log_read on public.activity_log for select to authenticated
  using (private.is_member(space_id) or (space_id is null and actor_id = (select auth.uid())));

-- ===== device_codes, rate_limits, key_canary: no grants, no policies. Invisible. =====
