create temp table if not exists master_catalog_t31_results (
  label text primary key
);

grant select, insert on master_catalog_t31_results to authenticated;

create or replace function pg_temp.t31_record_result(p_label text)
returns void
language plpgsql
as $$
begin
  insert into master_catalog_t31_results(label)
  values (p_label)
  on conflict (label) do nothing;
end;
$$;

do $$
declare
  v_approved_codes text[] := array[
    'M1-QA-ROOT-20260812011129542',
    'M1-QA-CHILD-20260812011129542',
    'M1-QA-SIBLING-20260812011129542',
    'M1-QA-INACTIVE-20260812011129542',
    'T-SHIRT-OVERSIZE'
  ];
  v_owner uuid := '95000000-0000-4000-8000-000000000001';
  v_admin uuid := '95000000-0000-4000-8000-000000000002';
  v_staff uuid := '95000000-0000-4000-8000-000000000003';
  v_viewer uuid := '95000000-0000-4000-8000-000000000004';
  v_physical_root uuid;
  v_physical_child uuid;
  v_service_root uuid;
  v_material_root uuid;
  v_unused uuid;
  v_used uuid;
  v_product_id uuid;
begin
  if (
    select count(*)
    from public.product_categories
    where code = any(v_approved_codes)
      and product_type = 'PHYSICAL'
  ) = 5 then
    perform pg_temp.t31_record_result('approved staging categories mapped to physical');
  end if;

  insert into auth.users(id, email)
  values
    (v_owner, 't31-owner@example.test'),
    (v_admin, 't31-admin@example.test'),
    (v_staff, 't31-staff@example.test'),
    (v_viewer, 't31-viewer@example.test')
  on conflict (id) do nothing;

  insert into public.admin_users(user_id, email, role, display_name)
  values
    (v_owner, 't31-owner@example.test', 'owner', 'T31 Owner'),
    (v_admin, 't31-admin@example.test', 'admin', 'T31 Admin'),
    (v_staff, 't31-staff@example.test', 'staff', 'T31 Staff'),
    (v_viewer, 't31-viewer@example.test', 'viewer', 'T31 Viewer')
  on conflict (user_id) do update
  set role = excluded.role,
      is_active = true,
      display_name = excluded.display_name;

  insert into public.product_categories(name, code, product_type, created_by_user_id)
  values
    ('T31 Physical Root', 'T31-PHY-ROOT', 'PHYSICAL', v_owner),
    ('T31 Service Root', 'T31-SVC-ROOT', 'SERVICE', v_owner),
    ('T31 Material Root', 'T31-MAT-ROOT', 'MATERIAL_SUPPLY', v_owner);

  select id into v_physical_root from public.product_categories where code = 'T31-PHY-ROOT';
  select id into v_service_root from public.product_categories where code = 'T31-SVC-ROOT';
  select id into v_material_root from public.product_categories where code = 'T31-MAT-ROOT';
  perform pg_temp.t31_record_result('all three approved product types accepted');

  begin
    insert into public.product_categories(name, code, product_type, created_by_user_id)
    values ('T31 Missing Type', 'T31-MISSING-TYPE', null, v_owner);
    raise exception 'missing product type accepted';
  exception when not_null_violation then
    perform pg_temp.t31_record_result('missing product type rejected');
  end;

  begin
    insert into public.product_categories(name, code, product_type, created_by_user_id)
    values ('T31 Invalid Type', 'T31-INVALID-TYPE', 'BROKEN', v_owner);
    raise exception 'invalid product type accepted';
  exception when check_violation then
    perform pg_temp.t31_record_result('invalid product type rejected');
  end;

  insert into public.product_categories(name, code, product_type, parent_category_id, created_by_user_id)
  values ('T31 Physical Child', 'T31-PHY-CHILD', 'PHYSICAL', v_physical_root, v_owner)
  returning id into v_physical_child;
  perform pg_temp.t31_record_result('same-type parent accepted');

  begin
    insert into public.product_categories(name, code, product_type, parent_category_id, created_by_user_id)
    values ('T31 Cross Type Child', 'T31-CROSS-TYPE-CHILD', 'SERVICE', v_physical_root, v_owner);
    raise exception 'cross-type parent accepted';
  exception when check_violation then
    perform pg_temp.t31_record_result('cross-type parent rejected');
  end;

  begin
    insert into public.product_categories(name, code, product_type, parent_category_id, created_by_user_id)
    values ('T31 Grandchild', 'T31-GRANDCHILD', 'PHYSICAL', v_physical_child, v_owner);
    raise exception 'third-level category accepted';
  exception when check_violation then
    perform pg_temp.t31_record_result('hierarchy depth remains limited to two');
  end;

  insert into public.products(category_id, product_type, master_product_id, product_code, name, created_by_user_id)
  values (v_physical_child, 'PHYSICAL', 'T31-MP-001', 'T31-PROD-001', 'T31 Physical Product', v_owner)
  returning id into v_product_id;
  perform pg_temp.t31_record_result('matching product category assignment accepted');

  begin
    insert into public.products(category_id, product_type, master_product_id, product_code, name, created_by_user_id)
    values (v_service_root, 'PHYSICAL', 'T31-MP-BAD-TYPE', 'T31-PROD-BAD-TYPE', 'T31 Bad Type Product', v_owner);
    raise exception 'product/category type mismatch accepted';
  exception when check_violation then
    perform pg_temp.t31_record_result('product/category type mismatch rejected');
  end;

  insert into public.product_categories(name, code, product_type, created_by_user_id)
  values ('T31 Unused Category', 'T31-UNUSED-CAT', 'PHYSICAL', v_owner)
  returning id into v_unused;

  update public.product_categories set product_type = 'SERVICE' where id = v_unused;
  perform pg_temp.t31_record_result('changing unused category type accepted');

  insert into public.product_categories(name, code, product_type, created_by_user_id)
  values ('T31 Used Category', 'T31-USED-CAT', 'PHYSICAL', v_owner)
  returning id into v_used;

  insert into public.products(category_id, product_type, master_product_id, product_code, name, created_by_user_id)
  values (v_used, 'PHYSICAL', 'T31-MP-USED', 'T31-PROD-USED', 'T31 Used Product', v_owner);

  begin
    update public.product_categories set product_type = 'SERVICE' where id = v_used;
    raise exception 'in-use category type change accepted';
  exception when check_violation then
    perform pg_temp.t31_record_result('changing in-use category type rejected');
  end;

  update public.product_categories
  set active = false, archived_at = now(), archived_by_user_id = v_owner, archive_reason = 't31 archive test'
  where id = v_unused;

  update public.product_categories
  set active = true, archived_at = null, archived_by_user_id = null, archive_reason = null
  where id = v_unused;
  perform pg_temp.t31_record_result('archive and reactivate behavior remains working');
end;
$$;

create or replace function public.assert_master_catalog_t31_category_rls(
  p_actor uuid,
  p_label text,
  p_can_mutate boolean,
  p_seed_category uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_category_id uuid;
begin
  perform set_config('request.jwt.claim.sub', p_actor::text, true);

  perform 1 from public.product_categories where id = p_seed_category;
  if not found then raise exception '% category read failed', p_label; end if;
  perform pg_temp.t31_record_result('rls ' || p_label || ' read passes');

  if p_can_mutate then
    insert into public.product_categories(name, code, product_type, created_by_user_id)
    values ('T31 RLS ' || p_label || ' Category', 'T31-RLS-' || upper(p_label) || '-CAT', 'PHYSICAL', p_actor)
    returning id into v_category_id;

    update public.product_categories set name = name where id = v_category_id;
    perform pg_temp.t31_record_result('rls ' || p_label || ' write passes');
  else
    begin
      insert into public.product_categories(name, code, product_type, created_by_user_id)
      values ('T31 RLS ' || p_label || ' Denied', 'T31-RLS-' || upper(p_label) || '-DENIED', 'PHYSICAL', p_actor);
      raise exception '% category mutation accepted', p_label;
    exception when insufficient_privilege then
      perform pg_temp.t31_record_result('rls ' || p_label || ' mutation rejected');
    end;
  end if;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', false);
select public.assert_master_catalog_t31_category_rls('95000000-0000-4000-8000-000000000001', 'owner', true, (select id from public.product_categories where code = 'T31-PHY-ROOT'));
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000002', false);
select public.assert_master_catalog_t31_category_rls('95000000-0000-4000-8000-000000000002', 'admin', true, (select id from public.product_categories where code = 'T31-PHY-ROOT'));
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000003', false);
select public.assert_master_catalog_t31_category_rls('95000000-0000-4000-8000-000000000003', 'staff', false, (select id from public.product_categories where code = 'T31-PHY-ROOT'));
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000004', false);
select public.assert_master_catalog_t31_category_rls('95000000-0000-4000-8000-000000000004', 'viewer', false, (select id from public.product_categories where code = 'T31-PHY-ROOT'));
reset role;

do $$
declare
  v_required text[] := array[
    'all three approved product types accepted',
    'missing product type rejected',
    'invalid product type rejected',
    'same-type parent accepted',
    'cross-type parent rejected',
    'hierarchy depth remains limited to two',
    'matching product category assignment accepted',
    'product/category type mismatch rejected',
    'changing unused category type accepted',
    'changing in-use category type rejected',
    'archive and reactivate behavior remains working',
    'approved staging categories mapped to physical',
    'rls owner read passes',
    'rls owner write passes',
    'rls admin read passes',
    'rls admin write passes',
    'rls staff read passes',
    'rls staff mutation rejected',
    'rls viewer read passes',
    'rls viewer mutation rejected'
  ];
  v_missing text[];
begin
  select array_agg(required.label)
  into v_missing
  from unnest(v_required) as required(label)
  where not exists (
    select 1 from master_catalog_t31_results result where result.label = required.label
  );

  if v_missing is not null then
    raise exception 'missing T3.1 validation results: %', v_missing;
  end if;
end;
$$;
