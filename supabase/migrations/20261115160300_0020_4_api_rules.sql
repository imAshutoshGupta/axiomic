-- Migration 0020 part 4: saving, trashing, restoring and rolling back rules.
-- Design: docs/DB-DESIGN.md 6.8, 6.9, 8.1, section 5 limits.
-- The server encrypts the text (AES-256-GCM). Its AAD contains the rule id and version
-- number, so the server picks both and this function checks they are right.

-- Create (p_rule_id is new, p_version = 1) or update (p_version = newest + 1).
-- p_scope_id: the team / project / module id for those layers; null for company and personal.
create function api.save_rule(
  p_rule_id uuid, p_version integer, p_space_id uuid, p_layer text, p_scope_id uuid,
  p_title text, p_nonce bytea, p_body bytea, p_key_version smallint, p_locked boolean,
  p_output_sizes jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  r public.rules;
  newest integer;
  is_new boolean;
begin
  select * into r from public.rules where id = p_rule_id for update;   -- queue concurrent saves (R13)
  is_new := not found;

  if is_new then
    r.id := p_rule_id; r.space_id := p_space_id; r.layer := p_layer;
    r.team_id    := case when p_layer = 'team'    then p_scope_id end;
    r.project_id := case when p_layer = 'project' then p_scope_id end;
    r.module_id  := case when p_layer = 'module'  then p_scope_id end;
    r.user_id    := case when p_layer = 'personal' then uid end;
  end if;

  -- 1. Permission, on the rule's real scope (never the caller's word for an existing rule).
  if not private.can_edit_layer(r.layer, r.space_id, r.team_id, r.project_id, r.module_id, r.user_id) then
    perform private.deny('you cannot edit this layer: suggest a change instead');
  end if;

  -- 2. Checks.
  if not is_new and r.deleted_at is not null then perform private.bad_input('this rule is in the trash'); end if;
  perform private.check_scope_open(r.project_id, r.module_id);
  perform private.check_output_size(p_output_sizes);
  if octet_length(p_body) > 65536 + 16 then perform private.bad_input('a rule can be at most 64 KiB'); end if;

  select coalesce(max(version), 0) into newest from public.rule_versions where rule_id = p_rule_id;
  if p_version <> newest + 1 then
    perform private.bad_input(format('someone saved this rule meanwhile (now version %s): reload', newest));
  end if;

  if is_new and (
    select count(*) from public.rules
    where space_id = r.space_id and layer = r.layer and deleted_at is null
      and team_id is not distinct from r.team_id and project_id is not distinct from r.project_id
      and module_id is not distinct from r.module_id and user_id is not distinct from r.user_id
  ) >= 200 then
    perform private.bad_input('this layer already has 200 rules');
  end if;

  -- 3. Write: rule row, then the new version.
  begin
    if is_new then
      insert into public.rules (id, space_id, layer, team_id, project_id, module_id, user_id,
                                title, title_key, locked, created_by)
      values (r.id, r.space_id, r.layer, r.team_id, r.project_id, r.module_id, r.user_id,
              p_title, private.title_key(p_title), coalesce(p_locked, false), uid);
    else
      update public.rules
      set title = p_title, title_key = private.title_key(p_title), locked = coalesce(p_locked, locked)
      where id = p_rule_id;
    end if;
  exception
    when unique_violation then perform private.bad_input('a rule with this title already exists here');
    when check_violation then perform private.bad_input('only company and team rules can be locked');
    when foreign_key_violation then perform private.bad_input('that team, project or module is not in this space');
  end;

  insert into public.rule_versions (rule_id, version, title, nonce, body_ciphertext, key_version, created_by)
  values (p_rule_id, p_version, p_title, p_nonce, p_body, coalesce(p_key_version, 1), uid);

  -- 4. Tell laptops, and write history (never a personal rule's title).
  perform private.bump_counter(r.layer, r.space_id, r.team_id, r.project_id, r.module_id, r.user_id);
  perform private.log(r.space_id, case when is_new then 'rule.created' else 'rule.updated' end, 'rule', p_rule_id,
                      jsonb_build_object('layer', r.layer, 'version', p_version)
                      || case when r.layer <> 'personal' then jsonb_build_object('title', p_title) else '{}' end);
end $$;

-- Rollback: copy an old version forward as a new one (the server re-encrypts it, because
-- the version number is part of the AAD).
create function api.save_rule_version(
  p_rule_id uuid, p_from_version integer, p_version integer,
  p_nonce bytea, p_body bytea, p_key_version smallint, p_output_sizes jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.rules; old_title text;
begin
  perform private.require_user();
  select * into r from public.rules where id = p_rule_id;
  if not found then perform private.deny('not allowed'); end if;
  select title into old_title from public.rule_versions where rule_id = p_rule_id and version = p_from_version;
  if not found then perform private.bad_input('that version does not exist'); end if;
  perform api.save_rule(p_rule_id, p_version, r.space_id, r.layer,
                        coalesce(r.team_id, r.project_id, r.module_id), old_title,
                        p_nonce, p_body, p_key_version, r.locked, p_output_sizes);
end $$;

create function api.trash_rule(p_rule_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.rules;
begin
  perform private.require_user();
  select * into r from public.rules where id = p_rule_id for update;
  if not found or not private.can_edit_layer(r.layer, r.space_id, r.team_id, r.project_id, r.module_id, r.user_id) then
    perform private.deny('you cannot edit this layer');
  end if;
  if r.deleted_at is not null then perform private.bad_input('already in the trash'); end if;
  update public.rules set deleted_at = now() where id = p_rule_id;
  perform private.bump_counter(r.layer, r.space_id, r.team_id, r.project_id, r.module_id, r.user_id);
  perform private.log(r.space_id, 'rule.deleted', 'rule', p_rule_id, jsonb_build_object('layer', r.layer));
end $$;

create function api.restore_rule(p_rule_id uuid, p_output_sizes jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.rules;
begin
  perform private.require_user();
  select * into r from public.rules where id = p_rule_id for update;
  if not found or not private.can_edit_layer(r.layer, r.space_id, r.team_id, r.project_id, r.module_id, r.user_id) then
    perform private.deny('you cannot edit this layer');
  end if;
  if r.deleted_at is null then perform private.bad_input('not in the trash'); end if;
  perform private.check_scope_open(r.project_id, r.module_id);
  perform private.check_output_size(p_output_sizes);
  begin
    update public.rules set deleted_at = null where id = p_rule_id;
  exception when unique_violation then
    perform private.bad_input(format('a rule called %s exists now: rename one of them', r.title));
  end;
  perform private.bump_counter(r.layer, r.space_id, r.team_id, r.project_id, r.module_id, r.user_id);
  perform private.log(r.space_id, 'rule.restored', 'rule', p_rule_id, jsonb_build_object('layer', r.layer));
end $$;
