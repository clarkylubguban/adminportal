create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null,
  active boolean not null default true,
  created_by_user_id uuid references public.admin_users(user_id) on delete set null,
  updated_by_user_id uuid references public.admin_users(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_categories_name_not_blank
    check (length(btrim(name)) > 0),
  constraint product_categories_code_not_blank
    check (length(btrim(code)) > 0),
  constraint product_categories_name_key unique (name),
  constraint product_categories_code_key unique (code)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null
    references public.product_categories(id) on delete restrict,
  master_product_id text not null,
  product_code text not null,
  name text not null,
  description text,
  brand text,
  active boolean not null default true,
  created_by_user_id uuid references public.admin_users(user_id) on delete set null,
  updated_by_user_id uuid references public.admin_users(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_master_product_id_not_blank
    check (length(btrim(master_product_id)) > 0),
  constraint products_product_code_not_blank
    check (length(btrim(product_code)) > 0),
  constraint products_name_not_blank
    check (length(btrim(name)) > 0),
  constraint products_master_product_id_key unique (master_product_id),
  constraint products_product_code_key unique (product_code)
);

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null
    references public.products(id) on delete restrict,
  master_variant_id text not null,
  sku text not null,
  global_sku text not null,
  barcode text,
  size text,
  color text,
  selling_price numeric(14, 2) not null default 0,
  unit_cost numeric(14, 2) not null default 0,
  active boolean not null default true,
  created_by_user_id uuid references public.admin_users(user_id) on delete set null,
  updated_by_user_id uuid references public.admin_users(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_variants_master_variant_id_not_blank
    check (length(btrim(master_variant_id)) > 0),
  constraint product_variants_sku_not_blank
    check (length(btrim(sku)) > 0),
  constraint product_variants_global_sku_not_blank
    check (length(btrim(global_sku)) > 0),
  constraint product_variants_selling_price_nonnegative
    check (selling_price >= 0),
  constraint product_variants_unit_cost_nonnegative
    check (unit_cost >= 0),
  constraint product_variants_sku_key unique (sku),
  constraint product_variants_global_sku_key unique (global_sku),
  constraint product_variants_product_id_master_variant_id_key
    unique (product_id, master_variant_id)
);

alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;

revoke all privileges on table public.product_categories from anon;
revoke all privileges on table public.products from anon;
revoke all privileges on table public.product_variants from anon;

grant select, insert, update on table public.product_categories to authenticated;
grant select, insert, update on table public.products to authenticated;
grant select, insert, update on table public.product_variants to authenticated;

grant all on table public.product_categories to service_role;
grant all on table public.products to service_role;
grant all on table public.product_variants to service_role;

drop policy if exists "Active admins can read product categories"
on public.product_categories;
create policy "Active admins can read product categories"
on public.product_categories
for select
to authenticated
using (public.is_active_admin_user(array['owner','admin','staff','viewer']));

drop policy if exists "Active admins can write product categories"
on public.product_categories;
create policy "Active admins can write product categories"
on public.product_categories
for all
to authenticated
using (public.is_active_admin_user(array['owner','admin','staff']))
with check (public.is_active_admin_user(array['owner','admin','staff']));

drop policy if exists "Active admins can read products"
on public.products;
create policy "Active admins can read products"
on public.products
for select
to authenticated
using (public.is_active_admin_user(array['owner','admin','staff','viewer']));

drop policy if exists "Active admins can write products"
on public.products;
create policy "Active admins can write products"
on public.products
for all
to authenticated
using (public.is_active_admin_user(array['owner','admin','staff']))
with check (public.is_active_admin_user(array['owner','admin','staff']));

drop policy if exists "Active admins can read product variants"
on public.product_variants;
create policy "Active admins can read product variants"
on public.product_variants
for select
to authenticated
using (public.is_active_admin_user(array['owner','admin','staff','viewer']));

drop policy if exists "Active admins can write product variants"
on public.product_variants;
create policy "Active admins can write product variants"
on public.product_variants
for all
to authenticated
using (public.is_active_admin_user(array['owner','admin','staff']))
with check (public.is_active_admin_user(array['owner','admin','staff']));