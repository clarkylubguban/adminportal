-- Phase 3D-D1: native TRRY Order foundation.
-- Creates a durable Order entity without changing legacy Inquiry-derived order flows.

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_reference text not null,
  source_inquiry_id text not null references public.ops_inquiries(id) on delete restrict,
  status text not null default 'awaiting_payment',
  quoted_amount numeric,
  amount_due numeric,
  quote_breakdown text,
  quote_note text,
  quote_valid_until date,
  quote_approved_at timestamptz,
  customer_name text,
  customer_contact text,
  product text,
  product_desc text,
  quantity text,
  fulfillment_method text,
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_order_reference_key unique (order_reference),
  constraint orders_source_inquiry_id_key unique (source_inquiry_id),
  constraint orders_status_check check (status in ('awaiting_payment')),
  constraint orders_order_reference_format_check check (order_reference ~ '^TRRY-ORD-[A-Z0-9]{8}$'),
  constraint orders_quoted_amount_check check (quoted_amount is null or quoted_amount >= 0),
  constraint orders_amount_due_check check (amount_due is null or amount_due >= 0)
);

alter table public.orders enable row level security;

revoke all privileges on table public.orders from anon;
grant select on table public.orders to authenticated;
grant all on table public.orders to service_role;

drop policy if exists "Active admins can read orders" on public.orders;
create policy "Active admins can read orders"
on public.orders
for select
to authenticated
using (
  exists (
    select 1
    from public.admin_users
    where admin_users.user_id = (select auth.uid())
      and admin_users.is_active = true
      and admin_users.role in ('owner', 'admin', 'staff', 'viewer')
  )
);

drop policy if exists "Active staff can insert orders" on public.orders;
create policy "Active staff can insert orders"
on public.orders
for insert
to authenticated
with check (
  exists (
    select 1
    from public.admin_users
    where admin_users.user_id = (select auth.uid())
      and admin_users.is_active = true
      and admin_users.role in ('owner', 'admin', 'staff')
  )
);

drop policy if exists "Active staff can update orders" on public.orders;
create policy "Active staff can update orders"
on public.orders
for update
to authenticated
using (
  exists (
    select 1
    from public.admin_users
    where admin_users.user_id = (select auth.uid())
      and admin_users.is_active = true
      and admin_users.role in ('owner', 'admin', 'staff')
  )
)
with check (
  exists (
    select 1
    from public.admin_users
    where admin_users.user_id = (select auth.uid())
      and admin_users.is_active = true
      and admin_users.role in ('owner', 'admin', 'staff')
  )
);

comment on table public.orders is 'Native TRRY Order entity created from an approved Inquiry. Phase 3D-D1 foundation only.';
comment on column public.orders.order_reference is 'Human-readable native TRRY Order reference generated server-side.';
comment on column public.orders.source_inquiry_id is 'Originating ops_inquiries.id. Unique to prevent duplicate native Orders for one Inquiry.';
;
