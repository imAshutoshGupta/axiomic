-- Migration 0020 part 5: suggestions (propose a change; an owner approves or rejects).
-- Design: docs/DB-DESIGN.md 6.10, 8.1. The server picks p_id first: it is in the AAD.

-- kind 'create': new rule in a layer. 'update': change an existing rule (scope copied from
-- the rule). 'promote': offer one of your personal rules to a work layer.
create function api.create_suggestion(
  p_id uuid, p_space_id uuid, p_kind text, p_layer text, p_scope_id uuid,
  p_rule_id uuid, p_source_rule_id uuid, p_title text,
  p_nonce bytea, p_body bytea, p_key_version smallint, p_base_version integer
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  r public.rules;
  v_layer text := p_layer;
  v_team uuid; v_project uuid; v_module uuid;
  base integer := p_base_version;
begin
  if not private.is_member(p_space_id) then perform private.deny('members only'); end if;

  if p_kind = 'update' then
    select * into r from public.rules where id = p_rule_id and space_id = p_space_id and deleted_at is null;
    if not found or r.layer = 'personal'
       or not private.can_read_rule(r.layer, r.space_id, r.team_id, r.project_id, r.module_id, r.user_id) then
      perform private.bad_input('that rule cannot take suggestions');
    end if;
    if r.locked then perform private.bad_input('this rule is locked'); end if;
    v_layer := r.layer; v_team := r.team_id; v_project := r.project_id; v_module := r.module_id;
  else
    v_team    := case when v_layer = 'team'    then p_scope_id end;
    v_project := case when v_layer = 'project' then p_scope_id end;
    v_module  := case when v_layer = 'module'  then p_scope_id end;
    if v_layer = 'personal' or not private.can_read_rule(v_layer, p_space_id, v_team, v_project, v_module, null) then
      perform private.bad_input('you cannot suggest to that layer');
    end if;
    if p_kind = 'promote' then
      if not exists (select 1 from public.rules where id = p_source_rule_id and space_id = p_space_id
                     and layer = 'personal' and user_id = uid and deleted_at is null) then
        perform private.bad_input('you can only promote your own personal rule');
      end if;
      select max(version) into base from public.rule_versions where rule_id = p_source_rule_id;
    end if;
  end if;
  perform private.check_scope_open(v_project, v_module);

  if (select count(*) from public.suggestions
      where space_id = p_space_id and created_by = uid and status = 'pending') >= 50 then
    perform private.bad_input('you have 50 pending suggestions here: wait for some to be decided');
  end if;

  begin
    insert into public.suggestions (id, space_id, kind, layer, team_id, project_id, module_id,
                                    rule_id, source_rule_id, proposed_title, title_key,
                                    nonce, body_ciphertext, key_version, base_version, created_by)
    values (p_id, p_space_id, p_kind, v_layer, v_team, v_project, v_module,
            case when p_kind = 'update' then p_rule_id end,
            case when p_kind = 'promote' then p_source_rule_id end,
            p_title, private.title_key(p_title), p_nonce, p_body, coalesce(p_key_version, 1), base, uid);
  exception
    when unique_violation then perform private.bad_input('you already have a pending suggestion for this rule');
    when check_violation or foreign_key_violation then perform private.bad_input('that suggestion does not fit its target');
  end;
  perform private.log(p_space_id, 'suggestion.created', 'suggestion', p_id,
                      jsonb_build_object('kind', p_kind, 'layer', v_layer));
end $$;

create function api.withdraw_suggestion(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); s record;
begin
  select * into s from public.suggestions where id = p_id for update;
  if not found or s.created_by is distinct from uid then perform private.deny('only the author can withdraw it'); end if;
  if s.status <> 'pending' then perform private.bad_input('already decided'); end if;
  update public.suggestions set status = 'withdrawn', decided_at = now() where id = p_id;
  perform private.log(s.space_id, 'suggestion.withdrawn', 'suggestion', p_id);
end $$;

-- p_decision: 'approve' or 'reject'. For approve the server re-encrypts the text for the
-- rule version it becomes (p_rule_id: existing rule for update, a new id otherwise).
create function api.decide_suggestion(
  p_id uuid, p_decision text, p_note text,
  p_rule_id uuid, p_version integer, p_nonce bytea, p_body bytea, p_key_version smallint,
  p_output_sizes jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); s record; src record; src_newest integer;
begin
  select * into s from public.suggestions where id = p_id for update;
  if not found or not private.can_edit_layer(s.layer, s.space_id, s.team_id, s.project_id, s.module_id, null) then
    perform private.deny('only the layer owner can decide');
  end if;
  if s.status <> 'pending' then perform private.bad_input('already decided'); end if;

  if p_decision = 'reject' then
    update public.suggestions set status = 'rejected', decided_by = uid, decided_at = now(),
           decision_note = left(p_note, 2000) where id = p_id;
    perform private.log(s.space_id, 'suggestion.rejected', 'suggestion', p_id);
    return;
  elsif p_decision <> 'approve' then
    perform private.bad_input('decision must be approve or reject');
  end if;

  if s.kind = 'update' and p_rule_id is distinct from s.rule_id then
    perform private.bad_input('wrong rule for this suggestion');
  end if;

  -- Becomes a new rule version (or a new rule) through the normal save, with all its checks.
  perform api.save_rule(p_rule_id, p_version, s.space_id, s.layer,
                        coalesce(s.team_id, s.project_id, s.module_id), s.proposed_title,
                        p_nonce, p_body, p_key_version, null, p_output_sizes);

  -- Promote: the personal original goes to the trash, but only if unchanged since.
  if s.kind = 'promote' and s.source_rule_id is not null then
    select * into src from public.rules where id = s.source_rule_id for update;
    select max(version) into src_newest from public.rule_versions where rule_id = s.source_rule_id;
    if src.id is not null and src.deleted_at is null and src_newest = s.base_version then
      update public.rules set deleted_at = now() where id = s.source_rule_id;
      perform private.bump_counter('personal', src.space_id, null, null, null, src.user_id);
    end if;
  end if;

  update public.suggestions set status = 'approved', decided_by = uid, decided_at = now(),
         decision_note = left(p_note, 2000) where id = p_id;
  perform private.log(s.space_id, 'suggestion.approved', 'suggestion', p_id,
                      jsonb_build_object('kind', s.kind, 'rule_id', p_rule_id));
end $$;
