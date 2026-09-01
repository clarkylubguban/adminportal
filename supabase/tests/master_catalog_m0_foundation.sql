-- Disposable local database only. Validates the approved Master Catalog M0 foundation contract.
begin;

do $$
declare
  v_admin_user_id uuid := '91000000-0000-4000-8000-000000000001';
  v_category_id uuid;
  v_product_id uuid;
  v_catalog_products_count bigint;
  v_admin_users_count bigint;
  v_columns text[];
  v_forbidden_columns text[];
  v_forbidden_tables text[];
begin
  select count(*) into v_catalog_products_count from public.catalog_products;
  select count(*) into v_admin_users_count from public.admin_users;

  select array_agg(column_name::text order by ordinal_position)
  into v_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'product_categories';

  if v_columns <> array[
    'id',
    'name',
    'code',
    'active',
    'created_by_user_id',
    'updated_by_user_id',
    'created_at',
    'updated_at'
  ] then
    raise exception 'product_categories column shape mismatch: %', v_columns;
  end if;

  select array_agg(column_name::text order by ordinal_position)
  into v_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'products';

  if v_columns <> array[
    'id',
    'category_id',
    'master_product_id',
    'product_code',
    'name',
    'description',
    'brand',
    'active',
    'created_by_user_id',
    'updated_by_user_id',
    'created_at',
    'updated_at'
  ] then
    raise exception 'products column shape mismatch: %', v_columns;
  end if;

  select array_agg(column_name::text order by ordinal_position)
  into v_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'product_variants';

  if v_columns <> array[
    'id',
    'product_id',
    'master_variant_id',
    'sku',
    'global_sku',
    'barcode',
    'size',
    'color',
    'selling_price',
    'unit_cost',
    'active',
    'created_by_user_id',
    'updated_by_user_id',
    'created_at',
    'updated_at'
  ] then
    raise exception 'product_variants column shape mismatch: %', v_columns;
  end if;

  select array_agg(table_name || '.' || column_name order by table_name, column_name)
  into v_forbidden_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('product_categories', 'products', 'product_variants')
    and column_name in (
      'slug',
      'sort_order',
      'is_active',
      'parent_id',
      'business_id',
      'subcategory_id'
    );

  if v_forbidden_columns is not null then
    raise exception 'forbidden M0 drift columns present: %', v_forbidden_columns;
  end if;

  select array_agg(table_name::text order by table_name)
  into v_forbidden_tables
  from information_schema.tables
  where table_schema = 'public'
    and table_type = 'BASE TABLE'
    and (
      table_name in ('staff_profiles', 'businesses')
      or table_name like 'inventory%'
    );

  if v_forbidden_tables is not null then
    raise exception 'forbidden M0 tables present: %', v_forbidden_tables;
  end if;

  insert into auth.users (id, email)
  values (v_admin_user_id, 'm0-validation@example.test')
  on conflict (id) do nothing;

  insert into public.admin_users (user_id, email, role)
  values (v_admin_user_id, 'm0-validation@example.test', 'admin')
  on conflict (user_id) do nothing;

  insert into public.product_categories (
    name, code, created_by_user_id, updated_by_user_id
  )
  values (
    'Uniforms', 'UNIF', v_admin_user_id, v_admin_user_id
  )
  returning id into v_category_id;

  begin
    insert into public.product_categories (name, code)
    values ('   ', 'BLANK-NAME');
    raise exception 'blank category name was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.product_categories (name, code)
    values ('Blank Category Code', '   ');
    raise exception 'blank category code was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.product_categories (name, code)
    values ('Uniforms', 'UNIF-DUP-NAME');
    raise exception 'duplicate category name was accepted';
  exception when unique_violation then null;
  end;

  begin
    insert into public.product_categories (name, code)
    values ('Duplicate Category Code', 'UNIF');
    raise exception 'duplicate category code was accepted';
  exception when unique_violation then null;
  end;

  insert into public.products (
    category_id,
    master_product_id,
    product_code,
    name,
    description,
    brand,
    created_by_user_id,
    updated_by_user_id
  )
  values (
    v_category_id,
    'MP-001',
    'PROD-001',
    'Admin Polo',
    'M0 validation product',
    'TRRY',
    v_admin_user_id,
    v_admin_user_id
  )
  returning id into v_product_id;

  begin
    insert into public.products (category_id, master_product_id, product_code, name)
    values ('91000000-0000-4000-8000-000000000099', 'MP-MISSING-CAT', 'PROD-MISSING-CAT', 'Missing Category');
    raise exception 'invalid category FK was accepted';
  exception when foreign_key_violation then null;
  end;

  begin
    delete from public.product_categories where id = v_category_id;
    raise exception 'category deletion while referenced was accepted';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into public.products (category_id, master_product_id, product_code, name)
    values (v_category_id, 'MP-BLANK-NAME', 'PROD-BLANK-NAME', '   ');
    raise exception 'blank product name was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.products (category_id, master_product_id, product_code, name)
    values (v_category_id, '   ', 'PROD-BLANK-MASTER', 'Blank Master Product');
    raise exception 'blank master_product_id was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.products (category_id, master_product_id, product_code, name)
    values (v_category_id, 'MP-BLANK-CODE', '   ', 'Blank Product Code');
    raise exception 'blank product_code was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.products (category_id, master_product_id, product_code, name)
    values (v_category_id, 'MP-001', 'PROD-DUP-MASTER', 'Duplicate Master Product');
    raise exception 'duplicate master_product_id was accepted';
  exception when unique_violation then null;
  end;

  begin
    insert into public.products (category_id, master_product_id, product_code, name)
    values (v_category_id, 'MP-DUP-CODE', 'PROD-001', 'Duplicate Product Code');
    raise exception 'duplicate product_code was accepted';
  exception when unique_violation then null;
  end;

  insert into public.product_variants (
    product_id,
    master_variant_id,
    sku,
    global_sku,
    barcode,
    size,
    color,
    selling_price,
    unit_cost,
    created_by_user_id,
    updated_by_user_id
  )
  values (
    v_product_id,
    'MV-001',
    'SKU-001',
    'GLOBAL-001',
    'BAR-001',
    'Small',
    'Navy',
    1250.00,
    700.00,
    v_admin_user_id,
    v_admin_user_id
  );

  begin
    insert into public.product_variants (product_id, master_variant_id, sku, global_sku)
    values ('91000000-0000-4000-8000-000000000098', 'MV-MISSING-PROD', 'SKU-MISSING-PROD', 'GLOBAL-MISSING-PROD');
    raise exception 'invalid product FK was accepted';
  exception when foreign_key_violation then null;
  end;

  begin
    delete from public.products where id = v_product_id;
    raise exception 'product deletion while referenced was accepted';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into public.product_variants (product_id, master_variant_id, sku, global_sku)
    values (v_product_id, 'MV-DUP-SKU', 'SKU-001', 'GLOBAL-DUP-SKU');
    raise exception 'duplicate sku was accepted';
  exception when unique_violation then null;
  end;

  begin
    insert into public.product_variants (product_id, master_variant_id, sku, global_sku)
    values (v_product_id, 'MV-DUP-GLOBAL', 'SKU-DUP-GLOBAL', 'GLOBAL-001');
    raise exception 'duplicate global_sku was accepted';
  exception when unique_violation then null;
  end;

  begin
    insert into public.product_variants (product_id, master_variant_id, sku, global_sku)
    values (v_product_id, 'MV-001', 'SKU-DUP-MASTER-VARIANT', 'GLOBAL-DUP-MASTER-VARIANT');
    raise exception 'duplicate product/master_variant_id was accepted';
  exception when unique_violation then null;
  end;

  begin
    insert into public.product_variants (product_id, master_variant_id, sku, global_sku)
    values (v_product_id, '   ', 'SKU-BLANK-MASTER-VARIANT', 'GLOBAL-BLANK-MASTER-VARIANT');
    raise exception 'blank master_variant_id was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.product_variants (product_id, master_variant_id, sku, global_sku)
    values (v_product_id, 'MV-BLANK-SKU', '   ', 'GLOBAL-BLANK-SKU');
    raise exception 'blank sku was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.product_variants (product_id, master_variant_id, sku, global_sku)
    values (v_product_id, 'MV-BLANK-GLOBAL', 'SKU-BLANK-GLOBAL', '   ');
    raise exception 'blank global_sku was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.product_variants (
      product_id, master_variant_id, sku, global_sku, selling_price, unit_cost
    )
    values (
      v_product_id, 'MV-NEG-SELL', 'SKU-NEG-SELL', 'GLOBAL-NEG-SELL', -0.01, 0
    );
    raise exception 'negative selling_price was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.product_variants (
      product_id, master_variant_id, sku, global_sku, selling_price, unit_cost
    )
    values (
      v_product_id, 'MV-NEG-COST', 'SKU-NEG-COST', 'GLOBAL-NEG-COST', 0, -0.01
    );
    raise exception 'negative unit_cost was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.product_categories (name, code, created_by_user_id)
    values ('Invalid Audit Category', 'INVALID-AUDIT', '91000000-0000-4000-8000-000000000097');
    raise exception 'invalid non-null audit FK was accepted';
  exception when foreign_key_violation then null;
  end;

  if (select count(*) from public.catalog_products) <> v_catalog_products_count then
    raise exception 'catalog_products row count changed during M0 validation';
  end if;

  if (select count(*) from public.admin_users) <> v_admin_users_count + 1 then
    raise exception 'admin_users changed beyond the disposable validation admin row';
  end if;

  raise notice 'Master Catalog M0 approved contract validation passed';
end;
$$;

rollback;