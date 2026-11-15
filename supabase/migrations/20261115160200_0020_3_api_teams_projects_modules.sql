-- Migration 0020 part 3: teams, projects, modules.
-- Design: docs/DB-DESIGN.md 6.4-6.7, 7.2 (write table), 8.1.

-- ===== Teams (work spaces only; a personal space keeps its one hidden team) =====

create function api.create_team(p_space_id uuid, p_name text, p_slug text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare tid uuid;
begin
  perform private.require_user(true);
  if not private.is_admin(p_space_id) then perform private.deny('admins only'); end if;
  if not private.is_work_space(p_space_id) then perform private.bad_input('personal spaces have one team'); end if;
  begin
    insert into public.teams (space_id, name, slug) values (p_space_id, trim(p_name), p_slug) returning id into tid;
  exception
    when unique_violation then perform private.bad_input('a team with that address exists');
    when check_violation then perform private.bad_input('that address is not allowed');
  end;
  perform private.log(p_space_id, 'team.created', 'team', tid);
  return tid;
end $$;

create function api.rename_team(p_team_id uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  perform private.require_user(true);
  select * into t from public.teams where id = p_team_id;
  if not found or t.hidden or not (private.is_admin(t.space_id) or private.owns_team_layer(p_team_id)) then
    perform private.deny('admins or team leads only');
  end if;
  update public.teams set name = trim(p_name) where id = p_team_id;
  perform private.log(t.space_id, 'team.renamed', 'team', p_team_id);
end $$;

-- Refused while the team has projects or team rules (the keys decide that).
create function api.delete_team(p_team_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  perform private.require_user(true);
  select * into t from public.teams where id = p_team_id;
  if not found or t.hidden or not private.is_admin(t.space_id) then perform private.deny('admins only'); end if;
  begin
    delete from public.teams where id = p_team_id;
  exception when foreign_key_violation then
    perform private.bad_input('move or delete this team''s projects and rules first');
  end;
  perform private.log(t.space_id, 'team.deleted', 'team', p_team_id, jsonb_build_object('name', t.name));
end $$;

-- Add a person, or change their team role (lead/member).
create function api.set_team_member(p_team_id uuid, p_user_id uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  perform private.require_user(true);
  select * into t from public.teams where id = p_team_id;
  if not found or t.hidden or not (private.is_admin(t.space_id) or private.owns_team_layer(p_team_id)) then
    perform private.deny('admins or team leads only');
  end if;
  begin
    insert into public.team_memberships (team_id, space_id, user_id, role)
    values (p_team_id, t.space_id, p_user_id, p_role)
    on conflict (team_id, user_id) do update set role = excluded.role;
  exception
    when foreign_key_violation then perform private.bad_input('that person is not a member of this space');
    when check_violation then perform private.bad_input('role must be lead or member');
  end;
  perform private.log(t.space_id, 'team.member_set', 'team', p_team_id,
                      jsonb_build_object('user_id', p_user_id, 'role', p_role));
end $$;

-- Admins and leads can remove anyone from the team; anyone can remove themselves.
create function api.remove_team_member(p_team_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(true); t record;
begin
  select * into t from public.teams where id = p_team_id;
  if not found or t.hidden
     or not (p_user_id = uid or private.is_admin(t.space_id) or private.owns_team_layer(p_team_id)) then
    perform private.deny('admins or team leads only');
  end if;
  delete from public.team_memberships where team_id = p_team_id and user_id = p_user_id;
  perform private.log(t.space_id, 'team.member_removed', 'team', p_team_id, jsonb_build_object('user_id', p_user_id));
end $$;


-- ===== Projects =====

-- You become the owner. A personal space's project goes into its hidden team.
create function api.create_project(p_space_id uuid, p_team_id uuid, p_name text, p_slug text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); pid uuid; tid uuid := p_team_id;
begin
  if not private.can_edit(p_space_id) then perform private.deny('editors and admins only'); end if;
  if not private.is_work_space(p_space_id) then
    select id into tid from public.teams where space_id = p_space_id and hidden;
  end if;
  begin
    insert into public.projects (space_id, team_id, owner_id, name, slug)
    values (p_space_id, tid, uid, trim(p_name), p_slug) returning id into pid;
  exception
    when unique_violation then perform private.bad_input('a project with that address exists');
    when check_violation then perform private.bad_input('that address is not allowed');
    when foreign_key_violation or not_null_violation then perform private.bad_input('that team is not in this space');
  end;
  perform private.log(p_space_id, 'project.created', 'project', pid);
  return pid;
end $$;

create function api.rename_project(p_project_id uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare p record;
begin
  perform private.require_user();
  select * into p from public.projects where id = p_project_id;
  if not found or not (private.can_edit(p.space_id) or private.owns_project_layer(p_project_id)) then
    perform private.deny('editors, admins or the project owner only');
  end if;
  update public.projects set name = trim(p_name) where id = p_project_id;
  perform private.log(p.space_id, 'project.renamed', 'project', p_project_id);
end $$;

-- Archive (retire) or un-archive. Archived projects keep their rules but can't be changed.
create function api.set_project_archived(p_project_id uuid, p_archived boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare p record;
begin
  perform private.require_user();
  select * into p from public.projects where id = p_project_id;
  if not found or not (private.can_edit(p.space_id) or private.owns_project_layer(p_project_id)) then
    perform private.deny('editors, admins or the project owner only');
  end if;
  update public.projects set archived_at = case when p_archived then coalesce(archived_at, now()) end
  where id = p_project_id;
  perform private.bump_counter('project', p.space_id, null, p_project_id, null, null);
  perform private.log(p.space_id, case when p_archived then 'project.archived' else 'project.unarchived' end,
                      'project', p_project_id);
end $$;

-- Only an empty project (no rules, no modules, even in the trash) can be deleted.
create function api.delete_project(p_project_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare p record;
begin
  perform private.require_user(true);
  select * into p from public.projects where id = p_project_id;
  if not found or not private.is_admin(p.space_id) then perform private.deny('admins only'); end if;
  begin
    delete from public.projects where id = p_project_id;
  exception when foreign_key_violation then
    perform private.bad_input('this project still has rules or modules (check the trash): archive it instead');
  end;
  perform private.log(p.space_id, 'project.deleted', 'project', p_project_id, jsonb_build_object('name', p.name));
end $$;

-- New owner must be a member with edit rights (D7, R21).
create function api.transfer_project_owner(p_project_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare p record;
begin
  perform private.require_user(true);
  select * into p from public.projects where id = p_project_id for update;
  if not found or not (private.is_admin(p.space_id) or private.owns_project_layer(p_project_id)) then
    perform private.deny('admins or the project owner only');
  end if;
  if not exists (select 1 from public.memberships where space_id = p.space_id and user_id = p_user_id
                 and role in ('admin', 'editor')) then
    perform private.bad_input('the new owner must be an editor or admin of this space');
  end if;
  update public.projects set owner_id = p_user_id where id = p_project_id;
  perform private.log(p.space_id, 'project.owner_changed', 'project', p_project_id,
                      jsonb_build_object('old_owner', p.owner_id, 'new_owner', p_user_id));
end $$;

-- Admin only, same space. Bumps both teams so every laptop re-pulls (S9).
create function api.move_project(p_project_id uuid, p_team_id uuid, p_output_sizes jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare p record;
begin
  perform private.require_user(true);
  select * into p from public.projects where id = p_project_id for update;
  if not found or not private.is_admin(p.space_id) then perform private.deny('admins only'); end if;
  if not private.is_work_space(p.space_id) then perform private.bad_input('personal spaces have one team'); end if;
  perform private.check_output_size(p_output_sizes);
  begin
    update public.projects set team_id = p_team_id where id = p_project_id;
  exception when foreign_key_violation then
    perform private.bad_input('that team is not in this space');
  end;
  update public.teams set rules_version = rules_version + 1 where id in (p.team_id, p_team_id);
  perform private.log(p.space_id, 'project.moved', 'project', p_project_id,
                      jsonb_build_object('from_team', p.team_id, 'to_team', p_team_id));
end $$;


-- ===== Modules =====

create function api.create_module(p_project_id uuid, p_name text, p_path text, p_owner_id uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare p record; mid uuid;
begin
  perform private.require_user();
  select * into p from public.projects where id = p_project_id;
  if not found or not private.can_edit_project(p_project_id) then
    perform private.deny('editors, admins or the project owner only');
  end if;
  perform private.check_scope_open(p_project_id, null);
  if p_owner_id is not null and not exists (select 1 from public.memberships where space_id = p.space_id
                                            and user_id = p_owner_id and role in ('admin', 'editor')) then
    perform private.bad_input('the owner must be an editor or admin of this space');
  end if;
  begin
    insert into public.modules (space_id, project_id, name, path, owner_id)
    values (p.space_id, p_project_id, p_name, p_path, p_owner_id) returning id into mid;
  exception
    when unique_violation then perform private.bad_input('a module with that name or folder exists');
    when check_violation then perform private.bad_input('that name or folder is not allowed');
  end;
  perform private.bump_counter('project', p.space_id, null, p_project_id, null, null);
  perform private.log(p.space_id, 'module.created', 'module', mid);
  return mid;
end $$;

-- Name/folder: project editors or the module owner. Owner: project editors only.
create function api.edit_module(p_module_id uuid, p_name text, p_path text, p_owner_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare m record; proj_edit boolean;
begin
  perform private.require_user();
  select * into m from public.modules where id = p_module_id for update;
  if not found then perform private.deny('not allowed'); end if;
  proj_edit := private.can_edit_project(m.project_id);
  if not (proj_edit or private.owns_module_layer(p_module_id)) then
    perform private.deny('project editors or the module owner only');
  end if;
  if p_owner_id is distinct from m.owner_id then
    if not proj_edit then perform private.deny('only project editors can change the owner'); end if;
    if p_owner_id is not null and not exists (select 1 from public.memberships where space_id = m.space_id
                                              and user_id = p_owner_id and role in ('admin', 'editor')) then
      perform private.bad_input('the owner must be an editor or admin of this space');
    end if;
  end if;
  perform private.check_scope_open(m.project_id, null);
  begin
    update public.modules set name = p_name, path = p_path, owner_id = p_owner_id where id = p_module_id;
  exception
    when unique_violation then perform private.bad_input('a module with that name or folder exists');
    when check_violation then perform private.bad_input('that name or folder is not allowed');
  end;
  perform private.bump_counter('module', m.space_id, null, null, p_module_id, null);
  perform private.log(m.space_id, 'module.edited', 'module', p_module_id);
end $$;

-- Module and its rules go to the trash together (30 days).
create function api.trash_module(p_module_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  perform private.require_user();
  select * into m from public.modules where id = p_module_id for update;
  if not found or not private.can_edit_project(m.project_id) then
    perform private.deny('project editors only');
  end if;
  if m.deleted_at is not null then perform private.bad_input('already in the trash'); end if;
  update public.modules set deleted_at = now() where id = p_module_id;
  update public.rules set deleted_at = now() where module_id = p_module_id and deleted_at is null;
  perform private.bump_counter('module', m.space_id, null, null, p_module_id, null);
  perform private.log(m.space_id, 'module.trashed', 'module', p_module_id);
end $$;

-- Restores the module and the rules trashed with it. Clear message if the name is taken (R17).
create function api.restore_module(p_module_id uuid, p_output_sizes jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  perform private.require_user();
  select * into m from public.modules where id = p_module_id for update;
  if not found or not private.can_edit_project(m.project_id) then
    perform private.deny('project editors only');
  end if;
  if m.deleted_at is null then perform private.bad_input('not in the trash'); end if;
  perform private.check_scope_open(m.project_id, null);
  perform private.check_output_size(p_output_sizes);
  begin
    update public.modules set deleted_at = null where id = p_module_id;
  exception when unique_violation then
    perform private.bad_input('a module with that name or folder exists now: rename one of them');
  end;
  update public.rules set deleted_at = null where module_id = p_module_id and deleted_at = m.deleted_at;
  perform private.bump_counter('module', m.space_id, null, null, p_module_id, null);
  perform private.log(m.space_id, 'module.restored', 'module', p_module_id);
end $$;
