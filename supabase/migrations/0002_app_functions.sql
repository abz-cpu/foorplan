-- Cloud-sync adapter support: bootstrapping (org-per-user) and RPCs that let
-- the client speak the same flat PropertyRecord/FloorRecord shape the guest
-- (IndexedDB) repositories use, without knowing about the plans/orgs
-- normalisation underneath. All functions run SECURITY INVOKER (the default)
-- unless noted otherwise, so the existing RLS policies from 0001_init.sql
-- still gate every row they touch.

-- created_by can now default to the calling user instead of requiring the
-- client to pass auth.uid() explicitly on every property insert.
alter table properties alter column created_by set default auth.uid();

-- ---------------------------------------------------------------------------
-- Org bootstrapping: every user gets exactly one owned org, auto-created.
-- ---------------------------------------------------------------------------

-- Fires after a new auth.users row is inserted (i.e. on signup). Runs before
-- any session/JWT exists for that user, so it must address the new user by
-- new.id rather than auth.uid(). Needs SECURITY DEFINER because orgs/
-- org_members have no INSERT policy for regular users — org creation is only
-- ever allowed through this bootstrap path.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  insert into orgs (name) values ('My Organisation') returning id into v_org_id;
  insert into org_members (org_id, user_id, role) values (v_org_id, new.id, 'owner');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Idempotent fallback for sessions that predate this migration (or any
-- future case where the trigger didn't run): returns the caller's existing
-- org, creating one only if they don't already have one. Scoped entirely to
-- auth.uid(), so a caller can never create or read another user's org.
create or replace function ensure_org_for_current_user()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from org_members where user_id = auth.uid() limit 1;
  if v_org_id is not null then
    return v_org_id;
  end if;

  insert into orgs (name) values ('My Organisation') returning id into v_org_id;
  insert into org_members (org_id, user_id, role) values (v_org_id, auth.uid(), 'owner');
  return v_org_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Properties: every property implicitly owns exactly one "plan" (the plans
-- table exists for future multi-plan-per-property support, e.g. before/after
-- refurb) — the app doesn't need to know about it yet.
-- ---------------------------------------------------------------------------

create or replace function handle_new_property()
returns trigger
language plpgsql
as $$
begin
  insert into plans (property_id) values (new.id);
  return new;
end;
$$;

drop trigger if exists on_property_created on properties;
create trigger on_property_created
  after insert on properties
  for each row execute function handle_new_property();

-- Patches applied to buildYear/constructionType/heatingSystem live in the
-- property_meta jsonb blob; merge rather than overwrite so a partial patch
-- never clobbers sibling keys.
create or replace function merge_property_meta(p_id uuid, p_meta jsonb)
returns void
language sql
as $$
  update properties
  set property_meta = property_meta || p_meta, updated_at = now()
  where id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- Floors: flatten floors + floor_documents (+ the plans hop) into the single
-- jsonb shape FloorRecord expects, so the client never has to join manually.
-- ---------------------------------------------------------------------------

create or replace function create_floor_for_property(
  p_property_id uuid,
  p_name text,
  p_sort_order int,
  p_doc jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_plan_id uuid;
  v_floor_id uuid;
  v_now timestamptz := now();
begin
  select id into v_plan_id from plans where property_id = p_property_id limit 1;
  if v_plan_id is null then
    insert into plans (property_id) values (p_property_id) returning id into v_plan_id;
  end if;

  insert into floors (plan_id, name, sort_order)
  values (v_plan_id, p_name, p_sort_order)
  returning id into v_floor_id;

  insert into floor_documents (floor_id, doc, updated_at, updated_by)
  values (v_floor_id, p_doc, v_now, auth.uid());

  return jsonb_build_object(
    'id', v_floor_id,
    'propertyId', p_property_id,
    'name', p_name,
    'sortOrder', p_sort_order,
    'doc', p_doc,
    'updatedAt', v_now
  );
end;
$$;

create or replace function get_floor(p_floor_id uuid)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', f.id,
    'propertyId', pl.property_id,
    'name', f.name,
    'sortOrder', f.sort_order,
    'doc', fd.doc,
    'updatedAt', fd.updated_at
  )
  from floors f
  join plans pl on pl.id = f.plan_id
  join floor_documents fd on fd.floor_id = f.id
  where f.id = p_floor_id;
$$;

create or replace function list_floors_for_property(p_property_id uuid)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', f.id,
      'propertyId', p_property_id,
      'name', f.name,
      'sortOrder', f.sort_order,
      'doc', fd.doc,
      'updatedAt', fd.updated_at
    ) order by f.sort_order
  ), '[]'::jsonb)
  from floors f
  join plans pl on pl.id = f.plan_id
  join floor_documents fd on fd.floor_id = f.id
  where pl.property_id = p_property_id;
$$;

-- Atomic save: archive the previous doc into floor_revisions, bump the
-- version, write the new doc, and touch the parent property's updated_at —
-- mirrors GuestFloorRepository.saveDoc's dashboard-sort behaviour, plus real
-- revision history the guest/IndexedDB path doesn't have.
create or replace function save_floor_doc(p_floor_id uuid, p_doc jsonb)
returns void
language plpgsql
as $$
declare
  v_property_id uuid;
  v_now timestamptz := now();
begin
  select p.id into v_property_id
  from floor_documents fd
  join floors f on f.id = fd.floor_id
  join plans pl on pl.id = f.plan_id
  join properties p on p.id = pl.property_id
  where fd.floor_id = p_floor_id;

  if v_property_id is null then
    raise exception 'floor % not found', p_floor_id;
  end if;

  insert into floor_revisions (floor_id, doc, version, created_by)
  select floor_id, doc, version, updated_by from floor_documents where floor_id = p_floor_id;

  update floor_documents
  set doc = p_doc, version = version + 1, updated_at = v_now, updated_by = auth.uid()
  where floor_id = p_floor_id;

  update properties set updated_at = v_now where id = v_property_id;
end;
$$;
