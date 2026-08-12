-- Disposable local database only. Validates Master Catalog M1 governance.
begin;

create temp table m1_test_results (
  area text not null,
  test_name text not null,
  passed boolean not null,
  primary key (area, test_name)
) on commit drop;

create or replace function public.m1_record_result(p_area text, p_test_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into m1_test_results(area, test_name, passed)
  values (p_area, p_test_name, true)
  on conflict (area, test_name) do update set passed = excluded.passed;
end;
$$;

do $$
declare
  v_owner uuid := '93000000-0000-4000-8000-000000000001';
  v_admin uuid := '93000000-0000-4000-8000-000000000002';
  v_staff uuid := '93000000-0000-4000-8000-000000000003';
  v_viewer uuid := '93000000-0000-4000-8000-000000000004';
  v_category_root uuid;
  v_category_child uuid;
  v_category_grandchild uuid;
  v_category_archive uuid;
  v_category_inactive uuid;
  v_category_assignment_archive uuid;
  v_product_id uuid;
  v_product_2_id uuid;
  v_variant_id uuid;
  v_variant_owner_id uuid;
  v_variant_admin_id uuid;
  v_image_id uuid;
  v_text_value text;
  v_catalog_products_before bigint;
  v_admin_users_before bigint;
  v_ops_inquiries_before bigint;
  v_orders_before bigint;
  v_catalog_products_after bigint;
  v_admin_users_after bigint;
  v_ops_inquiries_after bigint;
  v_orders_after bigint;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'product_categories'
      and column_name in ('description', 'sort_order')
  ) then
    raise exception 'product_categories contains forbidden M1 taxonomy columns';
  end if;
  perform public.m1_record_result('CATEGORY', 'description and sort_order remain absent');
  if to_regclass('public.catalog_products') is not null then
    execute 'select count(*) from public.catalog_products' into v_catalog_products_before;
  end if;
  if to_regclass('public.admin_users') is not null then
    execute 'select count(*) from public.admin_users' into v_admin_users_before;
  end if;
  if to_regclass('public.ops_inquiries') is not null then
    execute 'select count(*) from public.ops_inquiries' into v_ops_inquiries_before;
  end if;
  if to_regclass('public.orders') is not null then
    execute 'select count(*) from public.orders' into v_orders_before;
  end if;

  insert into auth.users(id, email)
  values
    (v_owner, 'm1-owner@example.test'),
    (v_admin, 'm1-admin@example.test'),
    (v_staff, 'm1-staff@example.test'),
    (v_viewer, 'm1-viewer@example.test')
  on conflict (id) do nothing;

  insert into public.admin_users(user_id, email, role, display_name)
  values
    (v_owner, 'm1-owner@example.test', 'owner', 'M1 Owner'),
    (v_admin, 'm1-admin@example.test', 'admin', 'M1 Admin'),
    (v_staff, 'm1-staff@example.test', 'staff', 'M1 Staff'),
    (v_viewer, 'm1-viewer@example.test', 'viewer', 'M1 Viewer')
  on conflict (user_id) do update
  set role = excluded.role,
      is_active = true,
      display_name = excluded.display_name;

  if has_function_privilege('public', 'public.override_product_variant_sku(uuid,text,text,text)', 'EXECUTE') then
    raise exception 'PUBLIC can execute override_product_variant_sku';
  end if;
  perform public.m1_record_result('SECURITY', 'PUBLIC has no execute privilege');

  if has_function_privilege('anon', 'public.override_product_variant_sku(uuid,text,text,text)', 'EXECUTE') then
    raise exception 'anon can execute override_product_variant_sku';
  end if;
  perform public.m1_record_result('SECURITY', 'anon has no execute privilege');

  if not has_function_privilege('authenticated', 'public.override_product_variant_sku(uuid,text,text,text)', 'EXECUTE') then
    raise exception 'authenticated cannot execute override_product_variant_sku';
  end if;
  perform public.m1_record_result('SECURITY', 'authenticated has execute privilege');

  insert into public.product_categories(name, code, created_by_user_id)
  values ('M1 Root', 'M1-ROOT', v_owner)
  returning id into v_category_root;

  insert into public.product_categories(name, code, parent_category_id, created_by_user_id)
  values ('M1 Child', 'M1-CHILD', v_category_root, v_owner)
  returning id into v_category_child;
  perform public.m1_record_result('CATEGORY', 'valid parent assignment passes');

  insert into public.product_categories(name, code, parent_category_id, created_by_user_id)
  values ('M1 Grandchild', 'M1-GRANDCHILD', v_category_child, v_owner)
  returning id into v_category_grandchild;

  begin
    update public.product_categories set parent_category_id = id where id = v_category_child;
    raise exception 'self-parent was accepted';
  exception when check_violation then
    perform public.m1_record_result('CATEGORY', 'self-parent rejected');
  end;

  begin
    update public.product_categories set parent_category_id = v_category_child where id = v_category_root;
    raise exception 'two-node cycle was accepted';
  exception when check_violation then
    perform public.m1_record_result('CATEGORY', 'two-node cycle rejected');
  end;

  begin
    update public.product_categories set parent_category_id = v_category_grandchild where id = v_category_root;
    raise exception 'deeper cycle was accepted';
  exception when check_violation then
    perform public.m1_record_result('CATEGORY', 'deeper recursive cycle rejected');
  end;

  begin
    update public.product_categories
    set active = false, archived_at = now(), archived_by_user_id = v_owner, archive_reason = 'test archive'
    where id = v_category_root;
    raise exception 'archive with active child was accepted';
  exception when check_violation then
    perform public.m1_record_result('CATEGORY', 'unsafe archive with active child rejected');
  end;

  update public.product_categories
  set active = false
  where id = v_category_child;

  begin
    update public.product_categories
    set active = false, archived_at = now(), archived_by_user_id = v_owner, archive_reason = 'test archive'
    where id = v_category_root;
    raise exception 'archive with active descendant was accepted';
  exception when check_violation then
    perform public.m1_record_result('CATEGORY', 'unsafe archive with active descendant rejected');
  end;

  update public.product_categories
  set active = false, archived_at = now(), archived_by_user_id = v_owner, archive_reason = 'temporarily archive grandchild'
  where id = v_category_grandchild;

  update public.product_categories
  set active = false, archived_at = now(), archived_by_user_id = v_owner, archive_reason = 'temporarily archive direct child'
  where id = v_category_child;

  insert into public.products(category_id, master_product_id, product_code, name, created_by_user_id)
  values (v_category_root, 'M1-MP-001', 'M1-PROD-001', 'M1 Product', v_owner)
  returning id into v_product_id;
  perform public.m1_record_result('CATEGORY', 'active category assignment passes');

  update public.product_categories
  set active = false, archived_at = now(), archived_by_user_id = v_owner, archive_reason = 'archive linked category'
  where id = v_category_root;
  perform public.m1_record_result('CATEGORY', 'archive with existing product link passes');

  perform 1 from public.products where id = v_product_id and category_id = v_category_root;
  if not found then
    raise exception 'existing product category link changed during category archive';
  end if;
  perform public.m1_record_result('CATEGORY', 'existing product link survives archive');

  update public.products
  set brand = 'Archived category unrelated update allowed'
  where id = v_product_id;
  perform public.m1_record_result('CATEGORY', 'unrelated product update after category archive passes');

  update public.products
  set category_id = category_id
  where id = v_product_id;
  perform public.m1_record_result('CATEGORY', 'same-category no-op assignment passes');

  update public.product_categories
  set active = false, archived_at = now(), archived_by_user_id = v_owner, archive_reason = 'archive grandchild'
  where id = v_category_grandchild;
  update public.product_categories
  set active = false, archived_at = now(), archived_by_user_id = v_owner, archive_reason = 'archive child'
  where id = v_category_child;

  insert into public.product_categories(name, code, created_by_user_id)
  values ('M1 Archive Category', 'M1-ARCHIVE-CAT', v_owner)
  returning id into v_category_archive;
  update public.product_categories
  set active = false, archived_at = now(), archived_by_user_id = v_owner, archive_reason = 'valid archive'
  where id = v_category_archive;
  perform public.m1_record_result('CATEGORY', 'valid archive passes');

  begin
    insert into public.products(category_id, master_product_id, product_code, name, created_by_user_id)
    values (v_category_archive, 'M1-ARCHIVED-CAT-MP', 'M1-ARCHIVED-CAT-PROD', 'M1 Archived Category Product', v_owner);
    raise exception 'archived category assignment was accepted';
  exception when check_violation then
    perform public.m1_record_result('CATEGORY', 'archived category assignment rejected');
  end;

  insert into public.product_categories(name, code, active, created_by_user_id)
  values ('M1 Inactive Category', 'M1-INACTIVE-CAT', false, v_owner)
  returning id into v_category_inactive;

  begin
    insert into public.products(category_id, master_product_id, product_code, name, created_by_user_id)
    values (v_category_inactive, 'M1-INACTIVE-CAT-MP', 'M1-INACTIVE-CAT-PROD', 'M1 Inactive Category Product', v_owner);
    raise exception 'inactive category assignment was accepted';
  exception when check_violation then
    perform public.m1_record_result('CATEGORY', 'inactive category assignment rejected');
  end;

  begin
    insert into public.products(category_id, master_product_id, product_code, name, created_by_user_id)
    values ('00000000-0000-4000-8000-00000000f001', 'M1-BAD-FK-MP', 'M1-BAD-FK-PROD', 'M1 Bad FK Product', v_owner);
    raise exception 'nonexistent category assignment was accepted';
  exception when foreign_key_violation then
    perform public.m1_record_result('CATEGORY', 'invalid category remains FK rejected');
  end;

  begin
    update public.product_categories set active = true where id = v_category_archive;
    raise exception 'category archive state inconsistency was accepted';
  exception when check_violation then
    perform public.m1_record_result('CATEGORY', 'archive state consistency enforced');
  end;

  update public.product_categories
  set active = true, archived_at = null, archived_by_user_id = null, archive_reason = null
  where id = v_category_archive;
  perform public.m1_record_result('CATEGORY', 'valid reactivation passes');

  update public.products
  set category_id = v_category_archive
  where id = v_product_id;
  perform public.m1_record_result('CATEGORY', 'reassignment to active category passes');

  insert into public.product_categories(name, code, created_by_user_id)
  values ('M1 Assignment Archived Category', 'M1-ASSIGN-ARCHIVE-CAT', v_owner)
  returning id into v_category_assignment_archive;
  update public.product_categories
  set active = false, archived_at = now(), archived_by_user_id = v_owner, archive_reason = 'assignment reject test'
  where id = v_category_assignment_archive;

  begin
    update public.products
    set category_id = v_category_assignment_archive
    where id = v_product_id;
    raise exception 'reassignment to archived category was accepted';
  exception when check_violation then
    perform public.m1_record_result('CATEGORY', 'reassignment to archived category rejected');
  end;

  insert into public.products(category_id, master_product_id, product_code, name, created_by_user_id)
  values (v_category_archive, 'M1-MP-002', 'M1-PROD-002', 'M1 Product 2', v_owner)
  returning id into v_product_2_id;
  perform public.m1_record_result('CATEGORY', 'reactivated category assignment passes');

  foreach v_text_value in array array['PHYSICAL','SERVICE','MATERIAL_SUPPLY']::text[] loop
    update public.products set product_type = v_text_value where id = v_product_id;
  end loop;
  perform public.m1_record_result('PRODUCT', 'valid product types pass');

  begin
    update public.products set product_type = 'UNKNOWN' where id = v_product_id;
    raise exception 'invalid product type accepted';
  exception when check_violation then
    perform public.m1_record_result('PRODUCT', 'invalid product type rejected');
  end;

  foreach v_text_value in array array['DRAFT','NEEDS_SETUP','READY_FOR_SALE','READY_FOR_USE']::text[] loop
    update public.products set readiness_status = v_text_value, active = true, archived_at = null, archived_by_user_id = null, archive_reason = null where id = v_product_id;
  end loop;
  perform public.m1_record_result('PRODUCT', 'valid readiness values pass');

  begin
    update public.products set readiness_status = 'BROKEN' where id = v_product_id;
    raise exception 'invalid readiness accepted';
  exception when check_violation then
    perform public.m1_record_result('PRODUCT', 'invalid readiness rejected');
  end;

  update public.products set typed_config = '{"ok": true}'::jsonb where id = v_product_id;
  perform public.m1_record_result('PRODUCT', 'typed_config object passes');

  begin
    update public.products set typed_config = '["bad"]'::jsonb where id = v_product_id;
    raise exception 'non-object typed_config accepted';
  exception when check_violation then
    perform public.m1_record_result('PRODUCT', 'typed_config non-object rejected');
  end;

  update public.products set eligible_channels = array['ADMIN'] where id = v_product_id;
  begin
    update public.products set eligible_channels = array['ADMIN', '   '] where id = v_product_id;
    raise exception 'blank eligible channel accepted';
  exception when check_violation then
    perform public.m1_record_result('PRODUCT', 'blank eligible channel rejected');
  end;

  begin
    update public.products set readiness_status = 'ARCHIVED', active = true, archived_at = now(), archive_reason = 'bad archive' where id = v_product_id;
    raise exception 'bad product archive state accepted';
  exception when check_violation then
    perform public.m1_record_result('PRODUCT', 'archive state invariant enforced');
  end;

  begin
    insert into public.product_variants(product_id, master_variant_id, sku, global_sku, selling_price, unit_cost)
    values (v_product_id, 'M1-NEG-M0', 'M1-NEG-M0-SKU', 'M1-NEG-M0-GLOBAL', -1, 0);
    raise exception 'M0 negative price protection failed';
  exception when check_violation then
    perform public.m1_record_result('PRODUCT', 'negative legacy M0 protections remain intact');
  end;

  insert into public.product_variants(product_id, master_variant_id, sku, global_sku, created_by_user_id)
  values (v_product_id, 'M1-MV-001', 'M1-SKU-001', 'M1-GLOBAL-001', v_owner)
  returning id into v_variant_id;
  perform public.m1_record_result('SKU', 'initial SKU creation passes');

  foreach v_text_value in array array['STANDARD','SERVICE_TIER','SUPPLY_OPTION']::text[] loop
    update public.product_variants set variant_type = v_text_value where id = v_variant_id;
  end loop;
  perform public.m1_record_result('VARIANT', 'valid variant types pass');

  begin
    update public.product_variants set variant_type = 'BROKEN' where id = v_variant_id;
    raise exception 'invalid variant type accepted';
  exception when check_violation then
    perform public.m1_record_result('VARIANT', 'invalid variant type rejected');
  end;

  begin
    insert into public.product_variants(product_id, master_variant_id, sku, global_sku, selling_price, unit_cost)
    values (v_product_id, 'M1-NEG-SELL', 'M1-NEG-SELL-SKU', 'M1-NEG-SELL-GLOBAL', -0.01, 0);
    raise exception 'negative selling price accepted';
  exception when check_violation then
    perform public.m1_record_result('VARIANT', 'negative selling_price rejected');
  end;

  begin
    insert into public.product_variants(product_id, master_variant_id, sku, global_sku, selling_price, unit_cost)
    values (v_product_id, 'M1-NEG-COST', 'M1-NEG-COST-SKU', 'M1-NEG-COST-GLOBAL', 0, -0.01);
    raise exception 'negative unit cost accepted';
  exception when check_violation then
    perform public.m1_record_result('VARIANT', 'negative unit_cost rejected');
  end;

  begin
    insert into public.product_variants(product_id, master_variant_id, sku, global_sku)
    values (v_product_id, 'M1-DUP-SKU', 'M1-SKU-001', 'M1-DUP-SKU-GLOBAL');
    raise exception 'duplicate sku accepted';
  exception when unique_violation then
    perform public.m1_record_result('VARIANT', 'duplicate SKU rejected');
  end;

  begin
    insert into public.product_variants(product_id, master_variant_id, sku, global_sku)
    values (v_product_id, 'M1-DUP-GLOBAL', 'M1-DUP-GLOBAL-SKU', 'M1-GLOBAL-001');
    raise exception 'duplicate global sku accepted';
  exception when unique_violation then
    perform public.m1_record_result('VARIANT', 'duplicate global SKU rejected');
  end;

  begin
    update public.product_variants set active = true, archived_at = now(), archive_reason = 'bad archive' where id = v_variant_id;
    raise exception 'bad variant archive state accepted';
  exception when check_violation then
    perform public.m1_record_result('VARIANT', 'archive state invariant enforced');
  end;

  insert into public.product_images(product_id, storage_path, is_primary, position, created_by_user_id)
  values (v_product_id, 'catalog/m1/primary.png', true, 0, v_owner)
  returning id into v_image_id;
  perform public.m1_record_result('IMAGES', 'image insert passes');
  perform public.m1_record_result('IMAGES', 'one active primary image passes');

  begin
    insert into public.product_images(product_id, storage_path) values (v_product_id, '   ');
    raise exception 'blank storage_path accepted';
  exception when check_violation then
    perform public.m1_record_result('IMAGES', 'blank storage_path rejected');
  end;

  begin
    insert into public.product_images(product_id, storage_path, position) values (v_product_id, 'catalog/m1/bad-position.png', -1);
    raise exception 'negative position accepted';
  exception when check_violation then
    perform public.m1_record_result('IMAGES', 'negative position rejected');
  end;

  begin
    insert into public.product_images(product_id, storage_path, is_primary) values (v_product_id, 'catalog/m1/second-primary.png', true);
    raise exception 'second active primary accepted';
  exception when unique_violation then
    perform public.m1_record_result('IMAGES', 'second active primary for same product rejected');
  end;

  insert into public.product_images(product_id, storage_path, is_primary) values (v_product_2_id, 'catalog/m1/other-primary.png', true);
  perform public.m1_record_result('IMAGES', 'primary images on different products pass');

  begin
    update public.product_images set active = true, archived_at = now(), archived_by_user_id = v_owner where id = v_image_id;
    raise exception 'archived image active state accepted';
  exception when check_violation then
    perform public.m1_record_result('IMAGES', 'archived image cannot remain active');
  end;

  begin
    update public.product_variants set sku = 'M1-DIRECT-SKU' where id = v_variant_id;
    raise exception 'direct sku mutation accepted';
  exception when insufficient_privilege then
    perform public.m1_record_result('SKU', 'direct SKU mutation rejected');
  end;

  insert into public.product_variants(product_id, master_variant_id, sku, global_sku)
  values (v_product_id, 'M1-MV-OWNER', 'M1-OWNER-OLD-SKU', 'M1-OWNER-OLD-GLOBAL')
  returning id into v_variant_owner_id;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform public.override_product_variant_sku(v_variant_owner_id, 'M1-OWNER-NEW-SKU', 'M1-OWNER-NEW-GLOBAL', 'owner override test');
  perform public.m1_record_result('SKU', 'owner override passes');

  insert into public.product_variants(product_id, master_variant_id, sku, global_sku)
  values (v_product_id, 'M1-MV-ADMIN', 'M1-ADMIN-OLD-SKU', 'M1-ADMIN-OLD-GLOBAL')
  returning id into v_variant_admin_id;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform public.override_product_variant_sku(v_variant_admin_id, 'M1-ADMIN-NEW-SKU', 'M1-ADMIN-NEW-GLOBAL', 'admin override test');
  perform public.m1_record_result('SKU', 'admin override passes');

  perform set_config('request.jwt.claim.sub', v_staff::text, true);
  begin
    perform public.override_product_variant_sku(v_variant_id, 'M1-STAFF-SKU', 'M1-STAFF-GLOBAL', 'staff should fail');
    raise exception 'staff override accepted';
  exception when insufficient_privilege then
    perform public.m1_record_result('SKU', 'staff override rejected');
  end;

  perform set_config('request.jwt.claim.sub', v_viewer::text, true);
  begin
    perform public.override_product_variant_sku(v_variant_id, 'M1-VIEWER-SKU', 'M1-VIEWER-GLOBAL', 'viewer should fail');
    raise exception 'viewer override accepted';
  exception when insufficient_privilege then
    perform public.m1_record_result('SKU', 'viewer override rejected');
  end;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  begin
    perform public.override_product_variant_sku(v_variant_id, 'M1-NO-REASON-SKU', 'M1-NO-REASON-GLOBAL', '   ');
    raise exception 'override without reason accepted';
  exception when check_violation then
    perform public.m1_record_result('SKU', 'override without reason rejected');
  end;

  if not exists (select 1 from public.product_variant_sku_history where variant_id = v_variant_owner_id and old_sku = 'M1-OWNER-OLD-SKU' and new_sku = 'M1-OWNER-NEW-SKU') then
    raise exception 'SKU history row missing';
  end if;
  perform public.m1_record_result('SKU', 'SKU history created');

  if not exists (select 1 from public.product_variant_sku_history where variant_id = v_variant_owner_id and old_global_sku = 'M1-OWNER-OLD-GLOBAL' and new_global_sku = 'M1-OWNER-NEW-GLOBAL') then
    raise exception 'global SKU history row missing';
  end if;
  perform public.m1_record_result('SKU', 'global SKU history created');

  begin
    insert into public.product_variants(product_id, master_variant_id, sku, global_sku)
    values (v_product_id, 'M1-HIST-SKU', 'M1-OWNER-OLD-SKU', 'M1-HIST-GLOBAL-OK');
    raise exception 'historical SKU reuse accepted';
  exception when unique_violation then
    perform public.m1_record_result('SKU', 'historical SKU reuse rejected');
  end;

  begin
    insert into public.product_variants(product_id, master_variant_id, sku, global_sku)
    values (v_product_id, 'M1-HIST-GLOBAL', 'M1-HIST-SKU-OK', 'M1-OWNER-OLD-GLOBAL');
    raise exception 'historical global SKU reuse accepted';
  exception when unique_violation then
    perform public.m1_record_result('SKU', 'historical global SKU reuse rejected');
  end;

  begin
    insert into public.product_variants(product_id, master_variant_id, sku, global_sku)
    values (v_product_id, 'M1-DUP-CURRENT-SKU', 'M1-OWNER-NEW-SKU', 'M1-DUP-CURRENT-GLOBAL-OK');
    raise exception 'duplicate current SKU accepted';
  exception when unique_violation then
    perform public.m1_record_result('SKU', 'duplicate current SKU remains rejected');
  end;

  begin
    insert into public.product_variants(product_id, master_variant_id, sku, global_sku)
    values (v_product_id, 'M1-DUP-CURRENT-GLOBAL', 'M1-DUP-CURRENT-SKU-OK', 'M1-OWNER-NEW-GLOBAL');
    raise exception 'duplicate current global SKU accepted';
  exception when unique_violation then
    perform public.m1_record_result('SKU', 'duplicate current global SKU remains rejected');
  end;

  if to_regclass('public.catalog_products') is not null then
    execute 'select count(*) from public.catalog_products' into v_catalog_products_after;
  end if;
  if to_regclass('public.admin_users') is not null then
    execute 'select count(*) from public.admin_users' into v_admin_users_after;
  end if;
  if to_regclass('public.ops_inquiries') is not null then
    execute 'select count(*) from public.ops_inquiries' into v_ops_inquiries_after;
  end if;
  if to_regclass('public.orders') is not null then
    execute 'select count(*) from public.orders' into v_orders_after;
  end if;

  if v_catalog_products_before is not null and v_catalog_products_after <> v_catalog_products_before then
    raise exception 'catalog_products count changed: % -> %', v_catalog_products_before, v_catalog_products_after;
  end if;
  if v_admin_users_before is not null and v_admin_users_after <> v_admin_users_before + 4 then
    raise exception 'admin_users count unexpected before cleanup: % -> %', v_admin_users_before, v_admin_users_after;
  end if;
  if v_ops_inquiries_before is not null and v_ops_inquiries_after <> v_ops_inquiries_before then
    raise exception 'ops_inquiries count changed: % -> %', v_ops_inquiries_before, v_ops_inquiries_after;
  end if;
  if v_orders_before is not null and v_orders_after <> v_orders_before then
    raise exception 'orders count changed: % -> %', v_orders_before, v_orders_after;
  end if;

  raise notice 'PRESERVATION COUNTS BEFORE CLEANUP catalog_products % / %, admin_users % / %, ops_inquiries % / %, orders % / %',
    v_catalog_products_before, v_catalog_products_after,
    v_admin_users_before, v_admin_users_after,
    v_ops_inquiries_before, v_ops_inquiries_after,
    v_orders_before, v_orders_after;

  perform public.m1_record_result('PRESERVATION', 'catalog_products unchanged');
  perform public.m1_record_result('PRESERVATION', 'ops_inquiries unchanged');
  perform public.m1_record_result('PRESERVATION', 'orders unchanged');
end;
$$;

create or replace function public.assert_master_catalog_m1_rls(
  p_actor uuid,
  p_label text,
  p_can_mutate boolean,
  p_seed_category uuid,
  p_seed_product uuid,
  p_seed_variant uuid,
  p_seed_image uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_category_id uuid;
  v_product_id uuid;
  v_variant_id uuid;
begin
  perform set_config('request.jwt.claim.sub', p_actor::text, true);

  perform 1 from public.product_categories where id = p_seed_category;
  if not found then raise exception '% category read failed', p_label; end if;
  perform 1 from public.products where id = p_seed_product;
  if not found then raise exception '% product read failed', p_label; end if;
  perform 1 from public.product_variants where id = p_seed_variant;
  if not found then raise exception '% variant read failed', p_label; end if;
  perform 1 from public.product_images where id = p_seed_image;
  if not found then raise exception '% image read failed', p_label; end if;
  perform public.m1_record_result('RLS', p_label || ' read passes');

  if p_can_mutate then
    insert into public.product_categories(name, code, created_by_user_id)
    values ('M1 RLS ' || p_label || ' Category', 'M1-RLS-' || upper(p_label) || '-CAT', p_actor)
    returning id into v_category_id;

    insert into public.products(category_id, master_product_id, product_code, name, created_by_user_id)
    values (v_category_id, 'M1-RLS-' || upper(p_label) || '-MP', 'M1-RLS-' || upper(p_label) || '-PROD', 'M1 RLS ' || p_label || ' Product', p_actor)
    returning id into v_product_id;

    insert into public.product_variants(product_id, master_variant_id, sku, global_sku, created_by_user_id)
    values (v_product_id, 'M1-RLS-' || upper(p_label) || '-MV', 'M1-RLS-' || upper(p_label) || '-SKU', 'M1-RLS-' || upper(p_label) || '-GLOBAL', p_actor)
    returning id into v_variant_id;

    insert into public.product_images(product_id, storage_path, created_by_user_id)
    values (v_product_id, 'catalog/m1/rls-' || p_label || '.png', p_actor);

    update public.product_categories set name = name where id = v_category_id;
    update public.products set name = name where id = v_product_id;
    update public.product_variants set color = color where id = v_variant_id;
    update public.product_images set alt_text = alt_text where product_id = v_product_id;
    perform public.m1_record_result('RLS', p_label || ' read/write passes');
  else
    begin
      insert into public.product_categories(name, code, created_by_user_id)
      values ('M1 RLS ' || p_label || ' Denied', 'M1-RLS-' || upper(p_label) || '-DENIED', p_actor);
      raise exception '% mutation accepted', p_label;
    exception when insufficient_privilege then
      perform public.m1_record_result('RLS', p_label || ' mutation rejected');
    end;
  end if;

  begin
    delete from public.product_images where id = p_seed_image;
    raise exception '% delete accepted', p_label;
  exception when insufficient_privilege then
    perform public.m1_record_result('RLS', p_label || ' normal-role DELETE rejected');
  end;
end;
$$;

create or replace function public.assert_master_catalog_m1_anon_override_denied(p_seed_variant uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);

  begin
    perform public.override_product_variant_sku(p_seed_variant, 'M1-ANON-SKU', 'M1-ANON-GLOBAL', 'anon should fail');
    raise exception 'anon override accepted';
  exception when insufficient_privilege then
    perform public.m1_record_result('SECURITY', 'anon cannot execute override');
  end;
end;
$$;

do $$
declare
  v_owner uuid := '93000000-0000-4000-8000-000000000001';
  v_admin uuid := '93000000-0000-4000-8000-000000000002';
  v_staff uuid := '93000000-0000-4000-8000-000000000003';
  v_viewer uuid := '93000000-0000-4000-8000-000000000004';
  v_seed_category uuid;
  v_seed_product uuid;
  v_seed_variant uuid;
  v_seed_image uuid;
begin
  select id into v_seed_category from public.product_categories where code = 'M1-ROOT';
  select id into v_seed_product from public.products where product_code = 'M1-PROD-001';
  select id into v_seed_variant from public.product_variants where sku = 'M1-SKU-001';
  select id into v_seed_image from public.product_images where storage_path = 'catalog/m1/primary.png';

  if v_seed_category is null or v_seed_product is null or v_seed_variant is null or v_seed_image is null then
    raise exception 'RLS seed rows missing';
  end if;
end;
$$;

set local role authenticated;
select public.assert_master_catalog_m1_rls('93000000-0000-4000-8000-000000000001', 'owner', true,
  (select id from public.product_categories where code = 'M1-ROOT'),
  (select id from public.products where product_code = 'M1-PROD-001'),
  (select id from public.product_variants where sku = 'M1-SKU-001'),
  (select id from public.product_images where storage_path = 'catalog/m1/primary.png'));
select public.assert_master_catalog_m1_rls('93000000-0000-4000-8000-000000000002', 'admin', true,
  (select id from public.product_categories where code = 'M1-ROOT'),
  (select id from public.products where product_code = 'M1-PROD-001'),
  (select id from public.product_variants where sku = 'M1-SKU-001'),
  (select id from public.product_images where storage_path = 'catalog/m1/primary.png'));
select public.assert_master_catalog_m1_rls('93000000-0000-4000-8000-000000000003', 'staff', false,
  (select id from public.product_categories where code = 'M1-ROOT'),
  (select id from public.products where product_code = 'M1-PROD-001'),
  (select id from public.product_variants where sku = 'M1-SKU-001'),
  (select id from public.product_images where storage_path = 'catalog/m1/primary.png'));
select public.assert_master_catalog_m1_rls('93000000-0000-4000-8000-000000000004', 'viewer', false,
  (select id from public.product_categories where code = 'M1-ROOT'),
  (select id from public.products where product_code = 'M1-PROD-001'),
  (select id from public.product_variants where sku = 'M1-SKU-001'),
  (select id from public.product_images where storage_path = 'catalog/m1/primary.png'));
reset role;

set local role anon;
select public.assert_master_catalog_m1_anon_override_denied('00000000-0000-4000-8000-000000000000');
reset role;

do $$
declare
  v_required text[] := array[
    'CATEGORY:valid parent assignment passes',
    'CATEGORY:self-parent rejected',
    'CATEGORY:two-node cycle rejected',
    'CATEGORY:deeper recursive cycle rejected',
    'CATEGORY:unsafe archive with active child rejected',
    'CATEGORY:unsafe archive with active descendant rejected',
    'CATEGORY:active category assignment passes',
    'CATEGORY:archive with existing product link passes',
    'CATEGORY:existing product link survives archive',
    'CATEGORY:unrelated product update after category archive passes',
    'CATEGORY:same-category no-op assignment passes',
    'CATEGORY:valid archive passes',
    'CATEGORY:archived category assignment rejected',
    'CATEGORY:inactive category assignment rejected',
    'CATEGORY:invalid category remains FK rejected',
    'CATEGORY:archive state consistency enforced',
    'CATEGORY:valid reactivation passes',
    'CATEGORY:reassignment to active category passes',
    'CATEGORY:reassignment to archived category rejected',
    'CATEGORY:reactivated category assignment passes',
    'CATEGORY:description and sort_order remain absent',
    'PRODUCT:valid product types pass',
    'PRODUCT:invalid product type rejected',
    'PRODUCT:valid readiness values pass',
    'PRODUCT:invalid readiness rejected',
    'PRODUCT:typed_config object passes',
    'PRODUCT:typed_config non-object rejected',
    'PRODUCT:archive state invariant enforced',
    'PRODUCT:negative legacy M0 protections remain intact',
    'VARIANT:valid variant types pass',
    'VARIANT:invalid variant type rejected',
    'VARIANT:negative selling_price rejected',
    'VARIANT:negative unit_cost rejected',
    'VARIANT:duplicate SKU rejected',
    'VARIANT:duplicate global SKU rejected',
    'VARIANT:archive state invariant enforced',
    'IMAGES:image insert passes',
    'IMAGES:blank storage_path rejected',
    'IMAGES:negative position rejected',
    'IMAGES:one active primary image passes',
    'IMAGES:second active primary for same product rejected',
    'IMAGES:primary images on different products pass',
    'IMAGES:archived image cannot remain active',
    'SKU:initial SKU creation passes',
    'SKU:direct SKU mutation rejected',
    'SKU:owner override passes',
    'SKU:admin override passes',
    'SKU:staff override rejected',
    'SKU:viewer override rejected',
    'SKU:override without reason rejected',
    'SKU:SKU history created',
    'SKU:global SKU history created',
    'SKU:historical SKU reuse rejected',
    'SKU:historical global SKU reuse rejected',
    'SKU:duplicate current SKU remains rejected',
    'SKU:duplicate current global SKU remains rejected',
    'SECURITY:PUBLIC has no execute privilege',
    'SECURITY:anon has no execute privilege',
    'SECURITY:authenticated has execute privilege',
    'SECURITY:anon cannot execute override',
    'RLS:owner read passes',
    'RLS:owner read/write passes',
    'RLS:owner normal-role DELETE rejected',
    'RLS:admin read passes',
    'RLS:admin read/write passes',
    'RLS:admin normal-role DELETE rejected',
    'RLS:staff read passes',
    'RLS:staff mutation rejected',
    'RLS:staff normal-role DELETE rejected',
    'RLS:viewer read passes',
    'RLS:viewer mutation rejected',
    'RLS:viewer normal-role DELETE rejected',
    'PRESERVATION:catalog_products unchanged',
    'PRESERVATION:ops_inquiries unchanged',
    'PRESERVATION:orders unchanged'
  ];
  v_missing text[];
begin
  select array_agg(required_item order by required_item)
  into v_missing
  from unnest(v_required) as required_item
  where not exists (
    select 1
    from m1_test_results result
    where result.area || ':' || result.test_name = required_item
      and result.passed = true
  );

  if v_missing is not null then
    raise exception 'missing M1 validation results: %', v_missing;
  end if;

  raise notice 'Master Catalog M1 governance validation passed';
end;
$$;

select area, test_name, passed
from m1_test_results
order by area, test_name;

rollback;