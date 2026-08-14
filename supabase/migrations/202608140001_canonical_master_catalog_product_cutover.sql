-- Canonical Master Catalog product cutover governance.
-- Forward-only local proposal. Do not apply to staging without Owner gate approval.

create extension if not exists pgcrypto;

create or replace function public.generate_master_product_id()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'MP-' || upper(public.gen_random_uuid()::text);
$$;

create or replace function public.generate_master_variant_id()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'MV-' || upper(public.gen_random_uuid()::text);
$$;

create or replace function public.master_catalog_manila_yymmdd()
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(timezone('Asia/Manila', now()), 'YYMMDD');
$$;

create or replace function public.master_catalog_hex_token(p_bytes integer)
returns text
language sql
volatile
set search_path = ''
as $$
  select upper(encode(public.gen_random_bytes(greatest(1, p_bytes)), 'hex'));
$$;

create or replace function public.generate_product_code_candidate()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'PRD-' || public.master_catalog_manila_yymmdd() || '-' || left(public.master_catalog_hex_token(3), 6);
$$;

create or replace function public.generate_global_sku_candidate()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'GSKU-' || public.master_catalog_manila_yymmdd() || '-' || left(public.master_catalog_hex_token(4), 8);
$$;

create or replace function public.normalize_variant_sku_token(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(left(regexp_replace(upper(coalesce(p_value, '')), '[^A-Z0-9]', '', 'g'), 8), ''), 'NA');
$$;

create or replace function public.generate_variant_sku_candidate(
  p_product_code text,
  p_color text,
  p_size text,
  p_suffix integer default 1
)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(btrim(p_product_code), ''), 'PRD-UNSAVED')
    || '-' || public.normalize_variant_sku_token(p_color)
    || '-' || public.normalize_variant_sku_token(p_size)
    || case when coalesce(p_suffix, 1) <= 1 then '' else '-' || lpad(p_suffix::text, 2, '0') end;
$$;

revoke all on function public.generate_master_product_id() from public;
revoke all on function public.generate_master_product_id() from anon;
revoke all on function public.generate_master_product_id() from authenticated;
revoke all on function public.generate_master_variant_id() from public;
revoke all on function public.generate_master_variant_id() from anon;
revoke all on function public.generate_master_variant_id() from authenticated;
revoke all on function public.master_catalog_manila_yymmdd() from public;
revoke all on function public.master_catalog_manila_yymmdd() from anon;
revoke all on function public.master_catalog_manila_yymmdd() from authenticated;
revoke all on function public.master_catalog_hex_token(integer) from public;
revoke all on function public.master_catalog_hex_token(integer) from anon;
revoke all on function public.master_catalog_hex_token(integer) from authenticated;
revoke all on function public.generate_product_code_candidate() from public;
revoke all on function public.generate_product_code_candidate() from anon;
revoke all on function public.generate_product_code_candidate() from authenticated;
revoke all on function public.generate_global_sku_candidate() from public;
revoke all on function public.generate_global_sku_candidate() from anon;
revoke all on function public.generate_global_sku_candidate() from authenticated;
revoke all on function public.normalize_variant_sku_token(text) from public;
revoke all on function public.normalize_variant_sku_token(text) from anon;
revoke all on function public.normalize_variant_sku_token(text) from authenticated;
revoke all on function public.generate_variant_sku_candidate(text, text, text, integer) from public;
revoke all on function public.generate_variant_sku_candidate(text, text, text, integer) from anon;
revoke all on function public.generate_variant_sku_candidate(text, text, text, integer) from authenticated;

create or replace function public.assign_product_canonical_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempt integer := 0;
  v_candidate text;
begin
  if tg_op = 'INSERT' then
    loop
      new.master_product_id := public.generate_master_product_id();
      exit when not exists (
        select 1 from public.products product where product.master_product_id = new.master_product_id
      );
      v_attempt := v_attempt + 1;
      if v_attempt >= 20 then
        raise exception using errcode = '23505', message = 'MASTER_PRODUCT_ID_GENERATION_COLLISION';
      end if;
    end loop;

    v_attempt := 0;
    loop
      v_candidate := public.generate_product_code_candidate();
      exit when not exists (
        select 1 from public.products product where product.product_code = v_candidate
      );
      v_attempt := v_attempt + 1;
      if v_attempt >= 50 then
        raise exception using errcode = '23505', message = 'PRODUCT_CODE_GENERATION_COLLISION';
      end if;
    end loop;
    new.product_code := v_candidate;
  elsif tg_op = 'UPDATE' then
    if old.master_product_id is distinct from new.master_product_id then
      raise exception using errcode = '42501', message = 'MASTER_PRODUCT_ID_IMMUTABLE';
    end if;
    if old.product_code is distinct from new.product_code then
      raise exception using errcode = '42501', message = 'PRODUCT_CODE_IMMUTABLE';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.assign_variant_canonical_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempt integer := 0;
  v_product_code text;
  v_candidate text;
begin
  if tg_op = 'INSERT' then
    loop
      new.master_variant_id := public.generate_master_variant_id();
      exit when not exists (
        select 1 from public.product_variants variant where variant.master_variant_id = new.master_variant_id
      );
      v_attempt := v_attempt + 1;
      if v_attempt >= 20 then
        raise exception using errcode = '23505', message = 'MASTER_VARIANT_ID_GENERATION_COLLISION';
      end if;
    end loop;

    v_attempt := 0;
    loop
      v_candidate := public.generate_global_sku_candidate();
      exit when not exists (
        select 1 from public.product_variants variant where variant.global_sku = v_candidate
      );
      v_attempt := v_attempt + 1;
      if v_attempt >= 50 then
        raise exception using errcode = '23505', message = 'GLOBAL_SKU_GENERATION_COLLISION';
      end if;
    end loop;
    new.global_sku := v_candidate;

    select product.product_code
    into v_product_code
    from public.products product
    where product.id = new.product_id;

    if v_product_code is null then
      return new;
    end if;

    v_attempt := 1;
    loop
      v_candidate := public.generate_variant_sku_candidate(v_product_code, new.color, new.size, v_attempt);
      exit when not exists (
        select 1 from public.product_variants variant where variant.sku = v_candidate
      );
      v_attempt := v_attempt + 1;
      if v_attempt > 99 then
        raise exception using errcode = '23505', message = 'VARIANT_SKU_GENERATION_COLLISION';
      end if;
    end loop;
    new.sku := v_candidate;
  elsif tg_op = 'UPDATE' then
    if old.master_variant_id is distinct from new.master_variant_id then
      raise exception using errcode = '42501', message = 'MASTER_VARIANT_ID_IMMUTABLE';
    end if;
    if old.global_sku is distinct from new.global_sku then
      raise exception using errcode = '42501', message = 'GLOBAL_SKU_IMMUTABLE';
    end if;
    if old.sku is distinct from new.sku
      and coalesce(current_setting('trry.master_catalog_sku_override', true), '') <> 'on' then
      raise exception using errcode = '42501', message = 'SKU_OVERRIDE_REQUIRED';
    end if;
  end if;

  return new;
end;
$$;

create unique index if not exists product_variants_master_variant_id_key
  on public.product_variants (master_variant_id);

drop trigger if exists assign_product_canonical_identity on public.products;
create trigger assign_product_canonical_identity
before insert or update of master_product_id, product_code on public.products
for each row execute function public.assign_product_canonical_identity();

drop trigger if exists assign_variant_canonical_identity on public.product_variants;
create trigger assign_variant_canonical_identity
before insert or update of master_variant_id, sku, global_sku on public.product_variants
for each row execute function public.assign_variant_canonical_identity();

revoke all on function public.assign_product_canonical_identity() from public;
revoke all on function public.assign_product_canonical_identity() from anon;
revoke all on function public.assign_product_canonical_identity() from authenticated;
revoke all on function public.assign_variant_canonical_identity() from public;
revoke all on function public.assign_variant_canonical_identity() from anon;
revoke all on function public.assign_variant_canonical_identity() from authenticated;

drop trigger if exists prevent_direct_variant_sku_change on public.product_variants;

create or replace function public.override_product_variant_sku(
  p_variant_id uuid,
  p_new_sku text,
  p_new_global_sku text,
  p_reason text
)
returns public.product_variants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := (select auth.uid());
  v_variant public.product_variants%rowtype;
  v_updated_variant public.product_variants%rowtype;
  v_new_sku text := btrim(coalesce(p_new_sku, ''));
  v_new_global_sku text := btrim(coalesce(p_new_global_sku, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_actor_user_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.admin_users admin_user
    where admin_user.user_id = v_actor_user_id
      and admin_user.is_active = true
      and admin_user.role in ('owner', 'admin')
  ) then
    raise exception using errcode = '42501', message = 'SKU_OVERRIDE_FORBIDDEN';
  end if;

  if length(v_reason) = 0 then
    raise exception using errcode = '23514', message = 'SKU_OVERRIDE_REASON_REQUIRED';
  end if;

  select *
  into v_variant
  from public.product_variants
  where id = p_variant_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'VARIANT_NOT_FOUND';
  end if;

  if length(v_new_global_sku) > 0 and v_new_global_sku <> v_variant.global_sku then
    raise exception using errcode = '42501', message = 'GLOBAL_SKU_IMMUTABLE';
  end if;

  if length(v_new_sku) = 0 then
    v_new_sku := v_variant.sku;
  end if;

  if v_new_sku = v_variant.sku then
    raise exception using errcode = '23514', message = 'SKU_OVERRIDE_REQUIRES_CHANGE';
  end if;

  if exists (
    select 1
    from public.product_variant_sku_history history
    where history.old_sku = v_new_sku
  ) then
    raise exception using errcode = '23505', message = 'HISTORICAL_SKU_REUSE_REJECTED';
  end if;

  perform set_config('trry.master_catalog_sku_override', 'on', true);

  update public.product_variants
  set
    sku = v_new_sku,
    updated_by_user_id = v_actor_user_id
  where id = v_variant.id
  returning * into v_updated_variant;

  insert into public.product_variant_sku_history (
    variant_id,
    old_sku,
    new_sku,
    old_global_sku,
    new_global_sku,
    reason,
    overridden_by_user_id
  )
  values (
    v_variant.id,
    v_variant.sku,
    v_new_sku,
    null,
    null,
    v_reason,
    v_actor_user_id
  );

  return v_updated_variant;
end;
$$;

revoke all on function public.override_product_variant_sku(uuid, text, text, text) from public;
revoke all on function public.override_product_variant_sku(uuid, text, text, text) from anon;
revoke all on function public.override_product_variant_sku(uuid, text, text, text) from authenticated;
grant execute on function public.override_product_variant_sku(uuid, text, text, text) to authenticated;

create or replace function public.validate_product_images_canonical_contract()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_active_count integer;
  v_distinct_positions integer;
  v_primary_count integer;
  v_min_position integer;
  v_primary_bad_count integer;
begin
  v_product_id := coalesce(new.product_id, old.product_id);

  select
    count(*) filter (where image.active = true and image.archived_at is null),
    count(distinct image.position) filter (where image.active = true and image.archived_at is null),
    count(*) filter (where image.active = true and image.archived_at is null and image.is_primary = true),
    min(image.position) filter (where image.active = true and image.archived_at is null),
    count(*) filter (where image.active = true and image.archived_at is null and image.is_primary = true and image.position <> 0)
  into v_active_count, v_distinct_positions, v_primary_count, v_min_position, v_primary_bad_count
  from public.product_images image
  where image.product_id = v_product_id;

  if v_active_count = 0 then
    return null;
  end if;

  if v_active_count > 6 then
    raise exception using errcode = '23514', message = 'PRODUCT_IMAGE_LIMIT_EXCEEDED';
  end if;

  if v_distinct_positions <> v_active_count then
    raise exception using errcode = '23514', message = 'PRODUCT_IMAGE_DUPLICATE_POSITION';
  end if;

  if v_min_position <> 0 then
    raise exception using errcode = '23514', message = 'PRODUCT_IMAGE_FIRST_POSITION_REQUIRED';
  end if;

  if v_primary_count <> 1 then
    raise exception using errcode = '23514', message = 'PRODUCT_IMAGE_ONE_PRIMARY_REQUIRED';
  end if;

  if v_primary_bad_count > 0 then
    raise exception using errcode = '23514', message = 'PRODUCT_IMAGE_PRIMARY_POSITION_ZERO_REQUIRED';
  end if;

  return null;
end;
$$;

create unique index if not exists product_images_one_active_position_idx
  on public.product_images (product_id, position)
  where active = true and archived_at is null;

drop trigger if exists validate_product_images_canonical_contract_insert on public.product_images;
drop trigger if exists validate_product_images_canonical_contract_update on public.product_images;
drop trigger if exists validate_product_images_canonical_contract_delete on public.product_images;
create constraint trigger validate_product_images_canonical_contract_insert
after insert on public.product_images
deferrable initially deferred
for each row execute function public.validate_product_images_canonical_contract();
create constraint trigger validate_product_images_canonical_contract_update
after update on public.product_images
deferrable initially deferred
for each row execute function public.validate_product_images_canonical_contract();
create constraint trigger validate_product_images_canonical_contract_delete
after delete on public.product_images
deferrable initially deferred
for each row execute function public.validate_product_images_canonical_contract();

revoke all on function public.validate_product_images_canonical_contract() from public;
revoke all on function public.validate_product_images_canonical_contract() from anon;
revoke all on function public.validate_product_images_canonical_contract() from authenticated;

create or replace function public.set_product_images_for_product(
  p_product_id uuid,
  p_images jsonb
)
returns setof public.product_images
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor_user_id uuid := (select auth.uid());
  v_image jsonb;
  v_image_count integer;
  v_index integer := 0;
  v_ids uuid[] := array[]::uuid[];
  v_existing_id uuid;
  v_storage_path text;
  v_public_url text;
  v_alt_text text;
begin
  if v_actor_user_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1 from public.admin_users admin_user
    where admin_user.user_id = v_actor_user_id
      and admin_user.is_active = true
      and admin_user.role in ('owner', 'admin')
  ) then
    raise exception using errcode = '42501', message = 'PRODUCT_IMAGE_MUTATION_FORBIDDEN';
  end if;

  if not exists (select 1 from public.products product where product.id = p_product_id for update) then
    raise exception using errcode = 'P0002', message = 'PRODUCT_NOT_FOUND';
  end if;

  v_image_count := jsonb_array_length(coalesce(p_images, '[]'::jsonb));
  if v_image_count > 6 then
    raise exception using errcode = '23514', message = 'PRODUCT_IMAGE_LIMIT_EXCEEDED';
  end if;

  update public.product_images
  set active = false,
      is_primary = false,
      position = position + 10000,
      updated_by_user_id = v_actor_user_id,
      archived_at = coalesce(archived_at, now()),
      archived_by_user_id = coalesce(archived_by_user_id, v_actor_user_id)
  where product_id = p_product_id
    and active = true
    and archived_at is null;

  for v_image in select * from jsonb_array_elements(coalesce(p_images, '[]'::jsonb)) loop
    v_existing_id := nullif(v_image->>'id', '')::uuid;
    v_storage_path := btrim(coalesce(v_image->>'storagePath', v_image->>'storage_path', ''));
    v_public_url := nullif(btrim(coalesce(v_image->>'publicUrl', v_image->>'public_url', '')), '');
    v_alt_text := nullif(btrim(coalesce(v_image->>'altText', v_image->>'alt_text', '')), '');

    if length(v_storage_path) = 0 then
      raise exception using errcode = '23514', message = 'PRODUCT_IMAGE_STORAGE_PATH_REQUIRED';
    end if;

    if v_existing_id is not null and exists (
      select 1 from public.product_images image where image.id = v_existing_id and image.product_id = p_product_id
    ) then
      update public.product_images
      set storage_path = v_storage_path,
          public_url = v_public_url,
          alt_text = v_alt_text,
          position = v_index,
          is_primary = (v_index = 0),
          active = true,
          archived_at = null,
          archived_by_user_id = null,
          updated_by_user_id = v_actor_user_id
      where id = v_existing_id;
      v_ids := array_append(v_ids, v_existing_id);
    else
      insert into public.product_images(
        product_id,
        storage_path,
        public_url,
        alt_text,
        position,
        is_primary,
        active,
        created_by_user_id,
        updated_by_user_id
      ) values (
        p_product_id,
        v_storage_path,
        v_public_url,
        v_alt_text,
        v_index,
        (v_index = 0),
        true,
        v_actor_user_id,
        v_actor_user_id
      ) returning id into v_existing_id;
      v_ids := array_append(v_ids, v_existing_id);
    end if;

    v_index := v_index + 1;
  end loop;

  return query
  select *
  from public.product_images image
  where image.product_id = p_product_id
    and image.active = true
    and image.archived_at is null
  order by image.position asc, image.created_at asc;
end;
$$;

revoke all on function public.set_product_images_for_product(uuid, jsonb) from public;
revoke all on function public.set_product_images_for_product(uuid, jsonb) from anon;
revoke all on function public.set_product_images_for_product(uuid, jsonb) from authenticated;
grant execute on function public.set_product_images_for_product(uuid, jsonb) to authenticated;

-- Align catalog image object writes to Owner/Admin only, while preserving public read.
drop policy if exists "Admin and staff can upload catalog images" on storage.objects;
drop policy if exists "Admin and staff can update catalog images" on storage.objects;
drop policy if exists "Admin and staff can delete catalog images" on storage.objects;

drop policy if exists "Owners and admins can upload catalog images" on storage.objects;
create policy "Owners and admins can upload catalog images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'catalog-images'
  and name ~ '^[a-z0-9-]+/[a-z0-9-]+/[^/].*$'
  and name !~ '(^|/)\.\.(/|$)'
  and exists (
    select 1
    from public.admin_users
    where admin_users.user_id = (select auth.uid())
      and admin_users.is_active = true
      and admin_users.role in ('owner', 'admin')
  )
);
drop policy if exists "Owners and admins can update catalog images" on storage.objects;
create policy "Owners and admins can update catalog images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'catalog-images'
  and name ~ '^[a-z0-9-]+/[a-z0-9-]+/[^/].*$'
  and name !~ '(^|/)\.\.(/|$)'
  and exists (
    select 1
    from public.admin_users
    where admin_users.user_id = (select auth.uid())
      and admin_users.is_active = true
      and admin_users.role in ('owner', 'admin')
  )
)
with check (
  bucket_id = 'catalog-images'
  and name ~ '^[a-z0-9-]+/[a-z0-9-]+/[^/].*$'
  and name !~ '(^|/)\.\.(/|$)'
  and exists (
    select 1
    from public.admin_users
    where admin_users.user_id = (select auth.uid())
      and admin_users.is_active = true
      and admin_users.role in ('owner', 'admin')
  )
);

drop policy if exists "Owners and admins can delete catalog images" on storage.objects;
create policy "Owners and admins can delete catalog images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'catalog-images'
  and name ~ '^[a-z0-9-]+/[a-z0-9-]+/[^/].*$'
  and name !~ '(^|/)\.\.(/|$)'
  and exists (
    select 1
    from public.admin_users
    where admin_users.user_id = (select auth.uid())
      and admin_users.is_active = true
      and admin_users.role in ('owner', 'admin')
  )
);
