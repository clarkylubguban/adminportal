-- Master Catalog Brand foundation.
-- Brand is canonical reference data and every Product must belong to one Brand.

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  brand_code text not null,
  name text not null,
  ownership_type text not null,
  owner_name text not null,
  website_slug text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references public.admin_users(user_id) on delete set null,
  updated_by_user_id uuid references public.admin_users(user_id) on delete set null,
  constraint brands_brand_code_not_blank
    check (length(btrim(brand_code)) > 0),
  constraint brands_name_not_blank
    check (length(btrim(name)) > 0),
  constraint brands_owner_name_not_blank
    check (length(btrim(owner_name)) > 0),
  constraint brands_ownership_type_check
    check (ownership_type in ('internal', 'partner')),
  constraint brands_status_check
    check (status in ('active', 'archived')),
  constraint brands_website_slug_not_blank
    check (website_slug is null or length(btrim(website_slug)) > 0)
);

create unique index if not exists brands_brand_code_lower_key
  on public.brands (lower(brand_code));
create unique index if not exists brands_name_lower_key
  on public.brands (lower(name));
create unique index if not exists brands_website_slug_lower_key
  on public.brands (lower(website_slug))
  where website_slug is not null;
create index if not exists brands_status_idx
  on public.brands (status);
create index if not exists brands_created_by_user_id_idx
  on public.brands (created_by_user_id);
create index if not exists brands_updated_by_user_id_idx
  on public.brands (updated_by_user_id);

insert into public.brands (
  id,
  brand_code,
  name,
  ownership_type,
  owner_name,
  website_slug,
  status
)
values
  ('11111111-1111-4111-8111-111111111111', 'STLO', 'STLO', 'internal', 'Clark', 'stlo', 'active'),
  ('22222222-2222-4222-8222-222222222222', 'TRRY', 'TRRY Apparel', 'internal', 'TRRY Operations', 'trry-apparel', 'active'),
  ('33333333-3333-4333-8333-333333333333', 'GENERIC', 'Generic / Unbranded', 'internal', 'TRRY Operations', null, 'active')
on conflict (id) do update
set
  brand_code = excluded.brand_code,
  name = excluded.name,
  ownership_type = excluded.ownership_type,
  owner_name = excluded.owner_name,
  website_slug = excluded.website_slug,
  status = excluded.status;

do $$
begin
  if exists (select 1 from public.products) then
    raise exception using
      errcode = '23514',
      message = 'PRODUCT_BRAND_MAPPING_GATE_REQUIRED',
      detail = 'Existing Product rows require explicit Product-to-Brand mapping before Brand Foundation can make products.brand_id required.';
  end if;
end;
$$;

alter table public.products
  add column if not exists brand_id uuid;

update public.products
set brand_id = null
where brand_id is null;

alter table public.products
  alter column brand_id set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_brand_id_fkey') then
    alter table public.products
      add constraint products_brand_id_fkey
      foreign key (brand_id)
      references public.brands(id)
      on delete restrict;
  end if;
end;
$$;

create index if not exists products_brand_id_idx
  on public.products (brand_id);

create or replace function public.normalize_brand_before_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.brand_code := upper(btrim(coalesce(new.brand_code, '')));
  new.name := btrim(coalesce(new.name, ''));
  new.owner_name := btrim(coalesce(new.owner_name, ''));
  new.ownership_type := lower(btrim(coalesce(new.ownership_type, '')));
  new.status := lower(btrim(coalesce(new.status, '')));
  new.website_slug := nullif(btrim(new.website_slug), '');

  if tg_op = 'UPDATE' and old.brand_code is distinct from new.brand_code then
    raise exception using errcode = '42501', message = 'BRAND_CODE_IMMUTABLE';
  end if;

  return new;
end;
$$;

create or replace function public.set_brand_audit_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor_user_id uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    new.created_by_user_id := v_actor_user_id;
    new.updated_by_user_id := v_actor_user_id;
  elsif tg_op = 'UPDATE' then
    new.created_by_user_id := old.created_by_user_id;
    new.updated_by_user_id := v_actor_user_id;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

create or replace function public.prevent_brand_archive_with_products()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and old.status = 'active'
    and new.status = 'archived'
    and exists (select 1 from public.products product where product.brand_id = new.id)
  then
    raise exception using errcode = '23514', message = 'BRAND_HAS_ASSIGNED_PRODUCTS';
  end if;

  return new;
end;
$$;

create or replace function public.reject_brand_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'BRAND_DELETE_DISABLED';
end;
$$;

create or replace function public.validate_product_brand_assignment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.brand_id is null then
    raise exception using errcode = '23502', message = 'PRODUCT_BRAND_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.brands brand
    where brand.id = new.brand_id
      and brand.status = 'active'
  ) then
    raise exception using errcode = '23514', message = 'PRODUCT_BRAND_MUST_BE_ACTIVE';
  end if;

  return new;
end;
$$;

drop trigger if exists normalize_brand_before_write on public.brands;
create trigger normalize_brand_before_write
before insert or update on public.brands
for each row execute function public.normalize_brand_before_write();

drop trigger if exists set_brands_audit_fields on public.brands;
create trigger set_brands_audit_fields
before insert or update on public.brands
for each row execute function public.set_brand_audit_fields();

drop trigger if exists prevent_brand_archive_with_products on public.brands;
create trigger prevent_brand_archive_with_products
before update of status on public.brands
for each row execute function public.prevent_brand_archive_with_products();

drop trigger if exists reject_brand_delete on public.brands;
create trigger reject_brand_delete
before delete on public.brands
for each row execute function public.reject_brand_delete();

drop trigger if exists validate_product_brand_assignment on public.products;
create trigger validate_product_brand_assignment
before insert or update of brand_id on public.products
for each row execute function public.validate_product_brand_assignment();

alter table public.brands enable row level security;

revoke all privileges on table public.brands from anon;
revoke all privileges on table public.brands from authenticated;
grant select, insert, update on table public.brands to authenticated;
grant all on table public.brands to service_role;

drop policy if exists "Active admins can read brands" on public.brands;
create policy "Active admins can read brands"
on public.brands
for select
to authenticated
using (public.is_active_admin_user(array['owner','admin','staff','viewer']));

drop policy if exists "Active owners and admins can insert brands" on public.brands;
create policy "Active owners and admins can insert brands"
on public.brands
for insert
to authenticated
with check (public.is_active_admin_user(array['owner','admin']));

drop policy if exists "Active owners and admins can update brands" on public.brands;
create policy "Active owners and admins can update brands"
on public.brands
for update
to authenticated
using (public.is_active_admin_user(array['owner','admin']))
with check (public.is_active_admin_user(array['owner','admin']));

revoke all on function public.normalize_brand_before_write() from public;
revoke all on function public.normalize_brand_before_write() from anon;
revoke all on function public.normalize_brand_before_write() from authenticated;
revoke all on function public.set_brand_audit_fields() from public;
revoke all on function public.set_brand_audit_fields() from anon;
revoke all on function public.set_brand_audit_fields() from authenticated;
revoke all on function public.prevent_brand_archive_with_products() from public;
revoke all on function public.prevent_brand_archive_with_products() from anon;
revoke all on function public.prevent_brand_archive_with_products() from authenticated;
revoke all on function public.reject_brand_delete() from public;
revoke all on function public.reject_brand_delete() from anon;
revoke all on function public.reject_brand_delete() from authenticated;
revoke all on function public.validate_product_brand_assignment() from public;
revoke all on function public.validate_product_brand_assignment() from anon;
revoke all on function public.validate_product_brand_assignment() from authenticated;
