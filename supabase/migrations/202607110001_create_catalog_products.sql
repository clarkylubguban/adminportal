create table if not exists public.catalog_products (
  id uuid primary key default gen_random_uuid(),
  catalog_key text not null,
  name text not null,
  slug text not null,
  category text,
  description text,
  image_url text,
  starting_price numeric,
  price_label text,
  minimum_quantity integer not null default 1,
  available_sizes text[] not null default '{}'::text[],
  available_colors text[] not null default '{}'::text[],
  print_methods text[] not null default '{}'::text[],
  sort_order integer not null default 0,
  is_featured boolean not null default false,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_products_catalog_key_check
    check (catalog_key in ('trry_webapp', 'foghead', 'trry_portal')),
  constraint catalog_products_status_check
    check (status in ('draft', 'published', 'hidden', 'archived')),
  constraint catalog_products_minimum_quantity_check
    check (minimum_quantity >= 1),
  constraint catalog_products_starting_price_check
    check (starting_price is null or starting_price >= 0),
  constraint catalog_products_sort_order_check
    check (sort_order >= 0),
  constraint catalog_products_catalog_key_slug_key unique (catalog_key, slug)
);

create or replace function public.set_catalog_products_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
new.updated_at = now();
return new;
end;
$$;

drop trigger if exists set_catalog_products_updated_at
on public.catalog_products;

create trigger set_catalog_products_updated_at
before update on public.catalog_products
for each row
execute function public.set_catalog_products_updated_at();
alter table public.catalog_products enable row level security;

revoke all privileges
on table public.catalog_products
from anon;

revoke all privileges
on table public.catalog_products
from authenticated;

grant select, insert, update
on table public.catalog_products
to authenticated;

drop policy if exists "Admin users can read catalog products" on public.catalog_products;
create policy "Admin users can read catalog products"
on public.catalog_products
for select
to authenticated
using (
  exists (
    select 1
    from public.admin_users
    where admin_users.user_id = (select auth.uid())
      and admin_users.role in ('admin', 'staff', 'viewer')
  )
);

drop policy if exists "Admin and staff can insert catalog products" on public.catalog_products;
create policy "Admin and staff can insert catalog products"
on public.catalog_products
for insert
to authenticated
with check (
  exists (
    select 1
    from public.admin_users
    where admin_users.user_id = (select auth.uid())
      and admin_users.role in ('admin', 'staff')
  )
);

drop policy if exists "Admin and staff can update catalog products" on public.catalog_products;
create policy "Admin and staff can update catalog products"
on public.catalog_products
for update
to authenticated
using (
  exists (
    select 1
    from public.admin_users
    where admin_users.user_id = (select auth.uid())
      and admin_users.role in ('admin', 'staff')
  )
)
with check (
  exists (
    select 1
    from public.admin_users
    where admin_users.user_id = (select auth.uid())
      and admin_users.role in ('admin', 'staff')
  )
);
