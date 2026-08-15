create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'staff', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

revoke all privileges
on table public.admin_users
from anon;

grant select
on table public.admin_users
to authenticated;

grant all
on table public.admin_users
to service_role;

drop policy if exists "Admin users can read own row" on public.admin_users;
create policy "Admin users can read own row"
on public.admin_users
for select
to authenticated
using ((select auth.uid()) = user_id);

create table if not exists public.ops_inquiries (
  id text primary key,
  customer_name text,
  contact text,
  notes text,
  customer_notes text,
  source text,
  message text,
  product text,
  quantity text,
  priority text not null default 'normal',
  status text not null default 'new',
  next_action text,
  due_date date,
  follow_up_date date,
  odoo_so text,
  estimated_value numeric,
  fulfillment_method text,
  delivery_city text,
  delivery_address text,
  delivery_landmark text,
  tracking_substatus text,
  tracking_note text,
  tracking_updated_at timestamptz,
  quoted_amount numeric,
  amount_due numeric,
  quote_status text,
  quote_approved_at timestamptz,
  quote_published_at timestamptz,
  quote_change_request text,
  quote_breakdown text,
  quote_notes text,
  quote_valid_until date,
  artwork_status text,
  artwork_url text,
  artwork_approved_at timestamptz,
  artwork_revision_request text,
  payment_status text,
  payment_label text,
  payment_instructions text,
  payment_proof_path text,
  payment_proof_submitted_at timestamptz,
  payment_confirmed_at timestamptz,
  payment_confirmed_amount numeric,
  payment_review_note text,
  payment_rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ops_inquiries enable row level security;

revoke all privileges
on table public.ops_inquiries
from anon;

grant select, insert, update
on table public.ops_inquiries
to authenticated;

grant all
on table public.ops_inquiries
to service_role;

drop policy if exists "Admin users can read ops inquiries" on public.ops_inquiries;
create policy "Admin users can read ops inquiries"
on public.ops_inquiries
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

drop policy if exists "Admin and staff can insert ops inquiries" on public.ops_inquiries;
create policy "Admin and staff can insert ops inquiries"
on public.ops_inquiries
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

drop policy if exists "Admin and staff can update ops inquiries" on public.ops_inquiries;
create policy "Admin and staff can update ops inquiries"
on public.ops_inquiries
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

insert into storage.buckets (id, name, public, file_size_limit)
values ('inquiry-artworks', 'inquiry-artworks', false, 10485760)
on conflict (id) do nothing;

create table if not exists public.clients (
  id text primary key,
  name text,
  client_name text,
  business_name text,
  company_name text,
  primary_contact text,
  contact_name text,
  contact_email text,
  email text,
  contact_number text,
  phone text,
  portal_domain text,
  domain text,
  slug text,
  address text,
  city text,
  location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reorder_requests (
  id text primary key,
  client_id text,
  request_no text,
  request_number text,
  order_no text,
  code text,
  requested_by text,
  requester_name text,
  contact_name text,
  requester_role text,
  role text,
  requester_email text,
  email text,
  requester_phone text,
  phone text,
  assigned_staff_names text,
  assigned_staff text,
  staff_names text,
  total_quantity integer,
  quantity integer,
  qty integer,
  total_items integer,
  item_count integer,
  items_count integer,
  fulfillment text,
  fulfillment_method text,
  delivery_method text,
  needed_date date,
  needed_by date,
  date_needed date,
  production_note text,
  needed_label text,
  status text,
  request_status text,
  ship_to text,
  delivery_name text,
  ship_address text,
  delivery_address text,
  address text,
  product_name text,
  item_name text,
  items text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.request_items (
  id uuid primary key default gen_random_uuid(),
  request_id text,
  reorder_request_id text,
  product_name text,
  item_name text,
  name text,
  description text,
  quantity integer,
  qty integer,
  total_quantity integer,
  size_summary text,
  sizes text,
  size text,
  created_at timestamptz not null default now()
);

alter table public.clients enable row level security;
alter table public.reorder_requests enable row level security;
alter table public.request_items enable row level security;

revoke all privileges on table public.clients from anon;
revoke all privileges on table public.reorder_requests from anon;
revoke all privileges on table public.request_items from anon;

grant select on table public.clients to authenticated;
grant select on table public.reorder_requests to authenticated;
grant select on table public.request_items to authenticated;
grant all on table public.clients to service_role;
grant all on table public.reorder_requests to service_role;
grant all on table public.request_items to service_role;

drop policy if exists "Admin users can read clients" on public.clients;
create policy "Admin users can read clients"
on public.clients
for select
to authenticated
using (
  exists (
    select 1 from public.admin_users
    where admin_users.user_id = (select auth.uid())
      and admin_users.role in ('admin', 'staff', 'viewer')
  )
);

drop policy if exists "Admin users can read reorder requests" on public.reorder_requests;
create policy "Admin users can read reorder requests"
on public.reorder_requests
for select
to authenticated
using (
  exists (
    select 1 from public.admin_users
    where admin_users.user_id = (select auth.uid())
      and admin_users.role in ('admin', 'staff', 'viewer')
  )
);

drop policy if exists "Admin users can read request items" on public.request_items;
create policy "Admin users can read request items"
on public.request_items
for select
to authenticated
using (
  exists (
    select 1 from public.admin_users
    where admin_users.user_id = (select auth.uid())
      and admin_users.role in ('admin', 'staff', 'viewer')
  )
);

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

grant all
on table public.catalog_products
to service_role;

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
);;
