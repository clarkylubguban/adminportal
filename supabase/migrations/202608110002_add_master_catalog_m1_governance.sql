-- Master Catalog M1 governance layer. Additive on top of M0.

alter table public.product_categories
  add column if not exists parent_category_id uuid
    references public.product_categories(id) on delete restrict,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by_user_id uuid
    references public.admin_users(user_id) on delete set null,
  add column if not exists archive_reason text;

alter table public.products
  add column if not exists product_type text not null default 'PHYSICAL',
  add column if not exists readiness_status text not null default 'DRAFT',
  add column if not exists sellable boolean not null default false,
  add column if not exists purchasable boolean not null default false,
  add column if not exists typed_config jsonb not null default '{}'::jsonb,
  add column if not exists eligible_channels text[] not null default '{}'::text[],
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by_user_id uuid
    references public.admin_users(user_id) on delete set null,
  add column if not exists archive_reason text;

alter table public.product_variants
  add column if not exists variant_type text not null default 'STANDARD',
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by_user_id uuid
    references public.admin_users(user_id) on delete set null,
  add column if not exists archive_reason text;

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  storage_path text not null,
  public_url text,
  alt_text text,
  position integer not null default 0,
  is_primary boolean not null default false,
  active boolean not null default true,
  archived_at timestamptz,
  archived_by_user_id uuid references public.admin_users(user_id) on delete set null,
  created_by_user_id uuid references public.admin_users(user_id) on delete set null,
  updated_by_user_id uuid references public.admin_users(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_images_storage_path_not_blank
    check (length(btrim(storage_path)) > 0),
  constraint product_images_position_nonnegative
    check (position >= 0)
);

create table if not exists public.product_variant_sku_history (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  old_sku text,
  new_sku text,
  old_global_sku text,
  new_global_sku text,
  reason text not null,
  overridden_by_user_id uuid not null references public.admin_users(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint product_variant_sku_history_reason_not_blank
    check (length(btrim(reason)) > 0),
  constraint product_variant_sku_history_old_sku_not_blank
    check (old_sku is null or length(btrim(old_sku)) > 0),
  constraint product_variant_sku_history_new_sku_not_blank
    check (new_sku is null or length(btrim(new_sku)) > 0),
  constraint product_variant_sku_history_old_global_sku_not_blank
    check (old_global_sku is null or length(btrim(old_global_sku)) > 0),
  constraint product_variant_sku_history_new_global_sku_not_blank
    check (new_global_sku is null or length(btrim(new_global_sku)) > 0)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'product_categories_no_self_parent') then
    alter table public.product_categories
      add constraint product_categories_no_self_parent
      check (parent_category_id is null or parent_category_id <> id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'product_categories_archive_state_check') then
    alter table public.product_categories
      add constraint product_categories_archive_state_check
      check (
        (
          archived_at is null
          and archived_by_user_id is null
          and archive_reason is null
        )
        or (
          active = false
          and archived_at is not null
          and archive_reason is not null
          and length(btrim(archive_reason)) > 0
        )
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'products_product_type_check') then
    alter table public.products
      add constraint products_product_type_check
      check (product_type in ('PHYSICAL', 'SERVICE', 'MATERIAL_SUPPLY'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'products_readiness_status_check') then
    alter table public.products
      add constraint products_readiness_status_check
      check (readiness_status in ('DRAFT', 'NEEDS_SETUP', 'READY_FOR_SALE', 'READY_FOR_USE', 'ARCHIVED'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'products_typed_config_object_check') then
    alter table public.products
      add constraint products_typed_config_object_check
      check (jsonb_typeof(typed_config) = 'object');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'products_archive_state_check') then
    alter table public.products
      add constraint products_archive_state_check
      check (
        (
          readiness_status <> 'ARCHIVED'
          and archived_at is null
          and archived_by_user_id is null
          and archive_reason is null
        )
        or (
          readiness_status = 'ARCHIVED'
          and active = false
          and archived_at is not null
          and archive_reason is not null
          and length(btrim(archive_reason)) > 0
        )
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'product_variants_variant_type_check') then
    alter table public.product_variants
      add constraint product_variants_variant_type_check
      check (variant_type in ('STANDARD', 'SERVICE_TIER', 'SUPPLY_OPTION'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'product_variants_archive_state_check') then
    alter table public.product_variants
      add constraint product_variants_archive_state_check
      check (
        (
          archived_at is null
          and archived_by_user_id is null
          and archive_reason is null
        )
        or (
          active = false
          and archived_at is not null
          and archive_reason is not null
          and length(btrim(archive_reason)) > 0
        )
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'product_images_archive_state_check') then
    alter table public.product_images
      add constraint product_images_archive_state_check
      check (
        (
          archived_at is null
          and archived_by_user_id is null
        )
        or (
          active = false
          and archived_at is not null
        )
      );
  end if;
end
$$;

create index if not exists product_categories_parent_category_id_idx
  on public.product_categories (parent_category_id);
create index if not exists product_categories_created_by_user_id_idx
  on public.product_categories (created_by_user_id);
create index if not exists product_categories_updated_by_user_id_idx
  on public.product_categories (updated_by_user_id);
create index if not exists product_categories_archived_by_user_id_idx
  on public.product_categories (archived_by_user_id);

create index if not exists products_category_id_idx
  on public.products (category_id);
create index if not exists products_product_type_idx
  on public.products (product_type);
create index if not exists products_readiness_status_idx
  on public.products (readiness_status);
create index if not exists products_active_readiness_status_idx
  on public.products (active, readiness_status);
create index if not exists products_created_by_user_id_idx
  on public.products (created_by_user_id);
create index if not exists products_updated_by_user_id_idx
  on public.products (updated_by_user_id);
create index if not exists products_archived_by_user_id_idx
  on public.products (archived_by_user_id);

create index if not exists product_variants_product_id_idx
  on public.product_variants (product_id);
create index if not exists product_variants_variant_type_idx
  on public.product_variants (variant_type);
create index if not exists product_variants_created_by_user_id_idx
  on public.product_variants (created_by_user_id);
create index if not exists product_variants_updated_by_user_id_idx
  on public.product_variants (updated_by_user_id);
create index if not exists product_variants_archived_by_user_id_idx
  on public.product_variants (archived_by_user_id);

create index if not exists product_images_product_id_active_position_idx
  on public.product_images (product_id, active, position);
create index if not exists product_images_archived_by_user_id_idx
  on public.product_images (archived_by_user_id);
create index if not exists product_images_created_by_user_id_idx
  on public.product_images (created_by_user_id);
create index if not exists product_images_updated_by_user_id_idx
  on public.product_images (updated_by_user_id);
create unique index if not exists product_images_one_active_primary_idx
  on public.product_images (product_id)
  where is_primary = true and active = true and archived_at is null;

create index if not exists product_variant_sku_history_variant_id_idx
  on public.product_variant_sku_history (variant_id);
create index if not exists product_variant_sku_history_overridden_by_user_id_idx
  on public.product_variant_sku_history (overridden_by_user_id);
create unique index if not exists product_variant_sku_history_old_sku_uidx
  on public.product_variant_sku_history (old_sku)
  where old_sku is not null;
create unique index if not exists product_variant_sku_history_old_global_sku_uidx
  on public.product_variant_sku_history (old_global_sku)
  where old_global_sku is not null;

create or replace function public.set_master_catalog_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.prevent_product_category_cycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.parent_category_id is null then
    return new;
  end if;

  if new.parent_category_id = new.id then
    raise exception using errcode = '23514', message = 'CATEGORY_SELF_PARENT_REJECTED';
  end if;

  if exists (
    with recursive ancestors(id, parent_category_id) as (
      select category.id, category.parent_category_id
      from public.product_categories category
      where category.id = new.parent_category_id
      union all
      select parent.id, parent.parent_category_id
      from public.product_categories parent
      join ancestors on ancestors.parent_category_id = parent.id
    )
    select 1 from ancestors where id = new.id
  ) then
    raise exception using errcode = '23514', message = 'CATEGORY_CYCLE_REJECTED';
  end if;

  return new;
end;
$$;

create or replace function public.prevent_unsafe_category_archive()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.archived_at is null then
    return new;
  end if;

  if old.archived_at is not null
    and old.active = new.active
    and old.archive_reason is not distinct from new.archive_reason then
    return new;
  end if;

  if exists (
    with recursive descendants(id) as (
      select category.id
      from public.product_categories category
      where category.parent_category_id = new.id
      union all
      select child.id
      from public.product_categories child
      join descendants on child.parent_category_id = descendants.id
    )
    select 1
    from public.product_categories category
    where category.id in (select id from descendants)
      and category.active = true
      and category.archived_at is null
  ) then
    raise exception using errcode = '23514', message = 'CATEGORY_HAS_ACTIVE_DESCENDANTS';
  end if;

  if exists (
    with recursive subtree(id) as (
      select new.id
      union all
      select child.id
      from public.product_categories child
      join subtree on child.parent_category_id = subtree.id
    )
    select 1
    from public.products product
    where product.category_id in (select id from subtree)
      and product.active = true
      and product.archived_at is null
      and product.readiness_status <> 'ARCHIVED'
  ) then
    raise exception using errcode = '23514', message = 'CATEGORY_HAS_ACTIVE_PRODUCTS';
  end if;

  return new;
end;
$$;

create or replace function public.validate_product_m1_contract()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  channel text;
begin
  if new.product_type not in ('PHYSICAL', 'SERVICE', 'MATERIAL_SUPPLY') then
    raise exception using errcode = '23514', message = 'INVALID_PRODUCT_TYPE';
  end if;

  if new.readiness_status not in ('DRAFT', 'NEEDS_SETUP', 'READY_FOR_SALE', 'READY_FOR_USE', 'ARCHIVED') then
    raise exception using errcode = '23514', message = 'INVALID_READINESS_STATUS';
  end if;

  if jsonb_typeof(new.typed_config) <> 'object' then
    raise exception using errcode = '23514', message = 'TYPED_CONFIG_MUST_BE_OBJECT';
  end if;

  foreach channel in array new.eligible_channels loop
    if channel is null or length(btrim(channel)) = 0 then
      raise exception using errcode = '23514', message = 'BLANK_ELIGIBLE_CHANNEL';
    end if;
  end loop;

  if new.readiness_status = 'ARCHIVED' then
    if new.active <> false
      or new.archived_at is null
      or new.archive_reason is null
      or length(btrim(new.archive_reason)) = 0 then
      raise exception using errcode = '23514', message = 'INVALID_PRODUCT_ARCHIVE_STATE';
    end if;
  elsif new.archived_at is not null
    or new.archived_by_user_id is not null
    or new.archive_reason is not null then
    raise exception using errcode = '23514', message = 'PRODUCT_ARCHIVE_FIELDS_REQUIRE_ARCHIVED_STATUS';
  end if;

  return new;
end;
$$;

create or replace function public.validate_variant_m1_contract()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.variant_type not in ('STANDARD', 'SERVICE_TIER', 'SUPPLY_OPTION') then
    raise exception using errcode = '23514', message = 'INVALID_VARIANT_TYPE';
  end if;

  if new.archived_at is not null then
    if new.active <> false
      or new.archive_reason is null
      or length(btrim(new.archive_reason)) = 0 then
      raise exception using errcode = '23514', message = 'INVALID_VARIANT_ARCHIVE_STATE';
    end if;
  elsif new.archived_by_user_id is not null or new.archive_reason is not null then
    raise exception using errcode = '23514', message = 'VARIANT_ARCHIVE_FIELDS_REQUIRE_ARCHIVED_AT';
  end if;

  return new;
end;
$$;

create or replace function public.validate_product_image_m1_contract()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.archived_at is not null then
    if new.active <> false then
      raise exception using errcode = '23514', message = 'ARCHIVED_IMAGE_CANNOT_BE_ACTIVE';
    end if;
  elsif new.archived_by_user_id is not null then
    raise exception using errcode = '23514', message = 'IMAGE_ARCHIVE_ACTOR_REQUIRES_ARCHIVED_AT';
  end if;

  return new;
end;
$$;

create or replace function public.prevent_direct_variant_sku_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and (old.sku is distinct from new.sku or old.global_sku is distinct from new.global_sku)
    and coalesce(current_setting('trry.master_catalog_sku_override', true), '') <> 'on' then
    raise exception using errcode = '42501', message = 'SKU_OVERRIDE_REQUIRED';
  end if;

  return new;
end;
$$;

create or replace function public.prevent_historical_sku_reuse()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.product_variant_sku_history history
    where history.old_sku = new.sku
  ) then
    raise exception using errcode = '23505', message = 'HISTORICAL_SKU_REUSE_REJECTED';
  end if;

  if exists (
    select 1
    from public.product_variant_sku_history history
    where history.old_global_sku = new.global_sku
  ) then
    raise exception using errcode = '23505', message = 'HISTORICAL_GLOBAL_SKU_REUSE_REJECTED';
  end if;

  return new;
end;
$$;

create or replace function public.prevent_sku_history_changes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'SKU_HISTORY_IMMUTABLE';
end;
$$;

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

  if length(v_new_sku) = 0 then
    v_new_sku := v_variant.sku;
  end if;

  if length(v_new_global_sku) = 0 then
    v_new_global_sku := v_variant.global_sku;
  end if;

  if v_new_sku = v_variant.sku and v_new_global_sku = v_variant.global_sku then
    raise exception using errcode = '23514', message = 'SKU_OVERRIDE_REQUIRES_CHANGE';
  end if;

  if exists (
    select 1
    from public.product_variant_sku_history history
    where history.old_sku = v_new_sku
  ) then
    raise exception using errcode = '23505', message = 'HISTORICAL_SKU_REUSE_REJECTED';
  end if;

  if exists (
    select 1
    from public.product_variant_sku_history history
    where history.old_global_sku = v_new_global_sku
  ) then
    raise exception using errcode = '23505', message = 'HISTORICAL_GLOBAL_SKU_REUSE_REJECTED';
  end if;

  perform set_config('trry.master_catalog_sku_override', 'on', true);

  update public.product_variants
  set
    sku = v_new_sku,
    global_sku = v_new_global_sku,
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
    case when v_variant.sku is distinct from v_new_sku then v_variant.sku else null end,
    case when v_variant.sku is distinct from v_new_sku then v_new_sku else null end,
    case when v_variant.global_sku is distinct from v_new_global_sku then v_variant.global_sku else null end,
    case when v_variant.global_sku is distinct from v_new_global_sku then v_new_global_sku else null end,
    v_reason,
    v_actor_user_id
  );

  return v_updated_variant;
end;
$$;

revoke all on function public.override_product_variant_sku(uuid, text, text, text) from public;
grant execute on function public.override_product_variant_sku(uuid, text, text, text) to authenticated;

create trigger set_product_categories_updated_at
before update on public.product_categories
for each row execute function public.set_master_catalog_updated_at();

create trigger set_products_updated_at
before update on public.products
for each row execute function public.set_master_catalog_updated_at();

create trigger set_product_variants_updated_at
before update on public.product_variants
for each row execute function public.set_master_catalog_updated_at();

create trigger set_product_images_updated_at
before update on public.product_images
for each row execute function public.set_master_catalog_updated_at();

create trigger prevent_product_category_cycle
before insert or update of parent_category_id on public.product_categories
for each row execute function public.prevent_product_category_cycle();

create trigger prevent_unsafe_category_archive
before update of active, archived_at, archive_reason on public.product_categories
for each row execute function public.prevent_unsafe_category_archive();

create trigger validate_products_m1_contract
before insert or update on public.products
for each row execute function public.validate_product_m1_contract();

create trigger validate_product_variants_m1_contract
before insert or update on public.product_variants
for each row execute function public.validate_variant_m1_contract();

create trigger validate_product_images_m1_contract
before insert or update on public.product_images
for each row execute function public.validate_product_image_m1_contract();

create trigger prevent_direct_variant_sku_change
before update of sku, global_sku on public.product_variants
for each row execute function public.prevent_direct_variant_sku_change();

create trigger prevent_historical_sku_reuse
before insert or update of sku, global_sku on public.product_variants
for each row execute function public.prevent_historical_sku_reuse();

create trigger prevent_sku_history_changes
before update or delete on public.product_variant_sku_history
for each row execute function public.prevent_sku_history_changes();

alter table public.product_images enable row level security;
alter table public.product_variant_sku_history enable row level security;

revoke all privileges on table public.product_images from anon;
revoke all privileges on table public.product_variant_sku_history from anon;
revoke all privileges on table public.product_images from authenticated;
revoke all privileges on table public.product_variant_sku_history from authenticated;

grant select, insert, update on table public.product_images to authenticated;
grant select on table public.product_variant_sku_history to authenticated;

grant all on table public.product_images to service_role;
grant all on table public.product_variant_sku_history to service_role;

drop policy if exists "Active admins can write product categories" on public.product_categories;
drop policy if exists "Active admins can write products" on public.products;
drop policy if exists "Active admins can write product variants" on public.product_variants;

drop policy if exists "Active owners and admins can insert product categories" on public.product_categories;
create policy "Active owners and admins can insert product categories"
on public.product_categories
for insert
to authenticated
with check (public.is_active_admin_user(array['owner','admin']));

drop policy if exists "Active owners and admins can update product categories" on public.product_categories;
create policy "Active owners and admins can update product categories"
on public.product_categories
for update
to authenticated
using (public.is_active_admin_user(array['owner','admin']))
with check (public.is_active_admin_user(array['owner','admin']));

drop policy if exists "Active owners and admins can insert products" on public.products;
create policy "Active owners and admins can insert products"
on public.products
for insert
to authenticated
with check (public.is_active_admin_user(array['owner','admin']));

drop policy if exists "Active owners and admins can update products" on public.products;
create policy "Active owners and admins can update products"
on public.products
for update
to authenticated
using (public.is_active_admin_user(array['owner','admin']))
with check (public.is_active_admin_user(array['owner','admin']));

drop policy if exists "Active owners and admins can insert product variants" on public.product_variants;
create policy "Active owners and admins can insert product variants"
on public.product_variants
for insert
to authenticated
with check (public.is_active_admin_user(array['owner','admin']));

drop policy if exists "Active owners and admins can update product variants" on public.product_variants;
create policy "Active owners and admins can update product variants"
on public.product_variants
for update
to authenticated
using (public.is_active_admin_user(array['owner','admin']))
with check (public.is_active_admin_user(array['owner','admin']));

drop policy if exists "Active admins can read product images" on public.product_images;
create policy "Active admins can read product images"
on public.product_images
for select
to authenticated
using (public.is_active_admin_user(array['owner','admin','staff','viewer']));

drop policy if exists "Active owners and admins can insert product images" on public.product_images;
create policy "Active owners and admins can insert product images"
on public.product_images
for insert
to authenticated
with check (public.is_active_admin_user(array['owner','admin']));

drop policy if exists "Active owners and admins can update product images" on public.product_images;
create policy "Active owners and admins can update product images"
on public.product_images
for update
to authenticated
using (public.is_active_admin_user(array['owner','admin']))
with check (public.is_active_admin_user(array['owner','admin']));

drop policy if exists "Active admins can read product variant sku history" on public.product_variant_sku_history;
create policy "Active admins can read product variant sku history"
on public.product_variant_sku_history
for select
to authenticated
using (public.is_active_admin_user(array['owner','admin','staff','viewer']));