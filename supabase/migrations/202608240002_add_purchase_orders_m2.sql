create sequence if not exists public.purchase_order_number_sequence start with 1 increment by 1;

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique default ('PO-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.purchase_order_number_sequence')::text, 4, '0')),
  supplier_id uuid not null references public.suppliers(id),
  status text not null default 'DRAFT',
  order_date date not null default current_date,
  expected_date date,
  supplier_reference text,
  freight_cost numeric(12,2) not null default 0,
  internal_note text,
  created_by_user_id uuid,
  updated_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ordered_at timestamptz,
  archived_at timestamptz,
  constraint purchase_orders_po_number_format check (po_number ~ '^PO-[0-9]{4}-[0-9]{4,}$'),
  constraint purchase_orders_status_check check (status in ('DRAFT','ORDERED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED')),
  constraint purchase_orders_m2_status_check check (status in ('DRAFT','ORDERED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED')),
  constraint purchase_orders_freight_cost_nonnegative check (freight_cost >= 0),
  constraint purchase_orders_ordered_at_check check (status <> 'ORDERED' or ordered_at is not null)
);

create table if not exists public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  variant_id uuid not null references public.product_variants(id),
  product_name_snapshot text not null,
  sku_snapshot text not null,
  variant_label_snapshot text,
  ordered_quantity integer not null,
  unit_cost numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_order_lines_name_required check (btrim(product_name_snapshot) <> ''),
  constraint purchase_order_lines_sku_required check (btrim(sku_snapshot) <> ''),
  constraint purchase_order_lines_ordered_quantity_positive check (ordered_quantity > 0),
  constraint purchase_order_lines_unit_cost_nonnegative check (unit_cost >= 0)
);

create index if not exists purchase_orders_supplier_id_idx on public.purchase_orders(supplier_id);
create index if not exists purchase_orders_status_idx on public.purchase_orders(status);
create index if not exists purchase_orders_expected_date_idx on public.purchase_orders(expected_date);
create index if not exists purchase_order_lines_purchase_order_id_idx on public.purchase_order_lines(purchase_order_id);
create index if not exists purchase_order_lines_variant_id_idx on public.purchase_order_lines(variant_id);

create or replace function public.set_purchase_order_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_purchase_orders_updated_at on public.purchase_orders;
create trigger set_purchase_orders_updated_at
before update on public.purchase_orders
for each row execute function public.set_purchase_order_updated_at();

drop trigger if exists set_purchase_order_lines_updated_at on public.purchase_order_lines;
create trigger set_purchase_order_lines_updated_at
before update on public.purchase_order_lines
for each row execute function public.set_purchase_order_updated_at();

create or replace function public.set_purchase_order_audit_users()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by_user_id = auth.uid();
  end if;
  new.updated_by_user_id = auth.uid();
  return new;
end;
$$;

drop trigger if exists set_purchase_orders_audit_users on public.purchase_orders;
create trigger set_purchase_orders_audit_users
before insert or update on public.purchase_orders
for each row execute function public.set_purchase_order_audit_users();

create or replace function public.create_purchase_order(
  p_supplier_id uuid,
  p_expected_date date default null,
  p_supplier_reference text default null,
  p_freight_cost numeric default 0,
  p_internal_note text default null,
  p_status text default 'DRAFT',
  p_lines jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_status text := upper(coalesce(p_status, 'DRAFT'));
  v_po public.purchase_orders%rowtype;
  v_supplier public.suppliers%rowtype;
  v_line jsonb;
  v_saved_line public.purchase_order_lines%rowtype;
  v_product public.products%rowtype;
  v_variant public.product_variants%rowtype;
  v_lines jsonb := '[]'::jsonb;
  v_ordered_quantity integer;
  v_unit_cost numeric;
  v_variant_label text;
begin
  if v_actor is null then
    raise exception 'Authentication is required.';
  end if;

  if not public.is_active_admin_user(array['owner','admin']) then
    raise exception 'Only Owner and Admin roles can create purchase orders.';
  end if;

  if v_status not in ('DRAFT','ORDERED') then
    raise exception 'M2 can only create Draft or Ordered purchase orders.';
  end if;

  if coalesce(p_freight_cost, 0) < 0 then
    raise exception 'Freight cost cannot be negative.';
  end if;

  select * into v_supplier
  from public.suppliers
  where id = p_supplier_id
    and active is true
    and archived_at is null;

  if not found then
    raise exception 'Active supplier is required.';
  end if;

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one order line.';
  end if;

  insert into public.purchase_orders (
    supplier_id,
    status,
    expected_date,
    supplier_reference,
    freight_cost,
    internal_note,
    ordered_at
  ) values (
    p_supplier_id,
    v_status,
    p_expected_date,
    nullif(btrim(coalesce(p_supplier_reference, '')), ''),
    coalesce(p_freight_cost, 0),
    nullif(btrim(coalesce(p_internal_note, '')), ''),
    case when v_status = 'ORDERED' then now() else null end
  )
  returning * into v_po;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_ordered_quantity := coalesce((v_line->>'ordered_quantity')::integer, 0);
    v_unit_cost := coalesce((v_line->>'unit_cost')::numeric, 0);

    if v_ordered_quantity <= 0 then
      raise exception 'Line quantity must be a positive whole number.';
    end if;

    if v_unit_cost < 0 then
      raise exception 'Line unit cost cannot be negative.';
    end if;

    select * into v_variant
    from public.product_variants
    where id = (v_line->>'variant_id')::uuid
      and active is true
      and archived_at is null;

    if not found or btrim(coalesce(v_variant.sku, '')) = '' then
      raise exception 'Each line must use an active product variant with a SKU.';
    end if;

    select * into v_product
    from public.products
    where id = (v_line->>'product_id')::uuid
      and id = v_variant.product_id
      and active is true
      and archived_at is null
      and product_type = 'PHYSICAL';

    if not found then
      raise exception 'Each line must use an active physical product.';
    end if;

    v_variant_label := nullif(array_to_string(array_remove(array[v_variant.color, v_variant.size], null), ' / '), '');

    insert into public.purchase_order_lines (
      purchase_order_id,
      product_id,
      variant_id,
      product_name_snapshot,
      sku_snapshot,
      variant_label_snapshot,
      ordered_quantity,
      unit_cost
    ) values (
      v_po.id,
      v_product.id,
      v_variant.id,
      v_product.name,
      v_variant.sku,
      v_variant_label,
      v_ordered_quantity,
      v_unit_cost
    )
    returning * into v_saved_line;

    v_lines := v_lines || jsonb_build_array(to_jsonb(v_saved_line));
  end loop;

  return jsonb_build_object(
    'purchase_order', to_jsonb(v_po),
    'supplier', to_jsonb(v_supplier),
    'lines', v_lines
  );
end;
$$;

create or replace function public.mark_purchase_order_ordered(
  p_purchase_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_po public.purchase_orders%rowtype;
  v_supplier public.suppliers%rowtype;
  v_lines jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'Authentication is required.';
  end if;

  if not public.is_active_admin_user(array['owner','admin']) then
    raise exception 'Only Owner and Admin roles can mark purchase orders Ordered.';
  end if;

  select * into v_po
  from public.purchase_orders
  where id = p_purchase_order_id
    and archived_at is null
  for update;

  if not found then
    raise exception 'Purchase order is required.';
  end if;

  if v_po.status <> 'DRAFT' then
    raise exception 'Only Draft purchase orders can be marked Ordered.';
  end if;

  update public.purchase_orders
  set status = 'ORDERED',
      ordered_at = now()
  where id = v_po.id
  returning * into v_po;

  select * into v_supplier
  from public.suppliers
  where id = v_po.supplier_id;

  select coalesce(jsonb_agg(to_jsonb(line_row) order by line_row.created_at asc), '[]'::jsonb)
  into v_lines
  from public.purchase_order_lines line_row
  where line_row.purchase_order_id = v_po.id;

  return jsonb_build_object(
    'purchase_order', to_jsonb(v_po),
    'supplier', to_jsonb(v_supplier),
    'lines', v_lines
  );
end;
$$;

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;

revoke all on table public.purchase_orders from anon;
revoke all on table public.purchase_order_lines from anon;
grant select, insert, update on table public.purchase_orders to authenticated;
grant select, insert, update on table public.purchase_order_lines to authenticated;
grant all on table public.purchase_orders to service_role;
grant all on table public.purchase_order_lines to service_role;
grant usage, select on sequence public.purchase_order_number_sequence to authenticated;
revoke execute on function public.create_purchase_order(uuid,date,text,numeric,text,text,jsonb) from public;
revoke execute on function public.create_purchase_order(uuid,date,text,numeric,text,text,jsonb) from anon;
grant execute on function public.create_purchase_order(uuid,date,text,numeric,text,text,jsonb) to authenticated;
revoke execute on function public.mark_purchase_order_ordered(uuid) from public;
revoke execute on function public.mark_purchase_order_ordered(uuid) from anon;
grant execute on function public.mark_purchase_order_ordered(uuid) to authenticated;

drop policy if exists "purchase orders read active admin" on public.purchase_orders;
create policy "purchase orders read active admin"
on public.purchase_orders
for select
to authenticated
using (public.is_active_admin_user(array['owner','admin','staff']));

drop policy if exists "purchase orders write owner admin" on public.purchase_orders;
create policy "purchase orders write owner admin"
on public.purchase_orders
for insert
to authenticated
with check (public.is_active_admin_user(array['owner','admin']));

drop policy if exists "purchase orders update owner admin" on public.purchase_orders;
create policy "purchase orders update owner admin"
on public.purchase_orders
for update
to authenticated
using (public.is_active_admin_user(array['owner','admin']))
with check (public.is_active_admin_user(array['owner','admin']));

drop policy if exists "purchase order lines read active admin" on public.purchase_order_lines;
create policy "purchase order lines read active admin"
on public.purchase_order_lines
for select
to authenticated
using (public.is_active_admin_user(array['owner','admin','staff']));

drop policy if exists "purchase order lines write owner admin" on public.purchase_order_lines;
create policy "purchase order lines write owner admin"
on public.purchase_order_lines
for insert
to authenticated
with check (public.is_active_admin_user(array['owner','admin']));

drop policy if exists "purchase order lines update owner admin" on public.purchase_order_lines;
create policy "purchase order lines update owner admin"
on public.purchase_order_lines
for update
to authenticated
using (public.is_active_admin_user(array['owner','admin']))
with check (public.is_active_admin_user(array['owner','admin']));
