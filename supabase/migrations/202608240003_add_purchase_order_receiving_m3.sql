-- M3 — Purchase Order Receiving & Inventory Posting
-- Manual quantity receiving only. Barcode / scanner / label printing intentionally stays outside this migration.

alter table public.purchase_order_lines
  add column if not exists received_quantity integer not null default 0,
  add column if not exists last_received_at timestamptz;

alter table public.purchase_order_lines
  drop constraint if exists purchase_order_lines_received_quantity_valid;
alter table public.purchase_order_lines
  add constraint purchase_order_lines_received_quantity_valid
  check (received_quantity >= 0 and received_quantity <= ordered_quantity);

create sequence if not exists public.purchase_order_receipt_number_sequence start with 1 increment by 1;

create table if not exists public.purchase_order_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique default ('RCV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.purchase_order_receipt_number_sequence')::text, 4, '0')),
  purchase_order_id uuid not null references public.purchase_orders(id),
  location_id uuid not null references public.inventory_locations(id),
  reference text,
  note text,
  idempotency_key text not null unique,
  received_by_user_id uuid not null,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint purchase_order_receipts_number_format check (receipt_number ~ '^RCV-[0-9]{4}-[0-9]{4,}$'),
  constraint purchase_order_receipts_idempotency_required check (btrim(idempotency_key) <> '')
);

create table if not exists public.purchase_order_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.purchase_order_receipts(id) on delete cascade,
  purchase_order_line_id uuid not null references public.purchase_order_lines(id),
  variant_id uuid not null references public.product_variants(id),
  quantity integer not null,
  unit_cost numeric(12,2) not null default 0,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint purchase_order_receipt_lines_quantity_positive check (quantity > 0),
  constraint purchase_order_receipt_lines_unit_cost_nonnegative check (unit_cost >= 0),
  constraint purchase_order_receipt_lines_receipt_line_unique unique (receipt_id, purchase_order_line_id)
);

create index if not exists purchase_order_receipts_purchase_order_id_idx on public.purchase_order_receipts(purchase_order_id);
create index if not exists purchase_order_receipts_received_at_idx on public.purchase_order_receipts(received_at desc);
create index if not exists purchase_order_receipt_lines_receipt_id_idx on public.purchase_order_receipt_lines(receipt_id);
create index if not exists purchase_order_receipt_lines_purchase_order_line_id_idx on public.purchase_order_receipt_lines(purchase_order_line_id);
create index if not exists purchase_order_receipt_lines_variant_id_idx on public.purchase_order_receipt_lines(variant_id);

create or replace function public.receive_purchase_order(
  p_purchase_order_id uuid,
  p_location_id uuid,
  p_lines jsonb,
  p_idempotency_key text,
  p_reference text default null,
  p_note text default null
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
  v_receipt public.purchase_order_receipts%rowtype;
  v_existing_receipt public.purchase_order_receipts%rowtype;
  v_po_line public.purchase_order_lines%rowtype;
  v_input jsonb;
  v_qty integer;
  v_remaining integer;
  v_remaining_total integer := 0;
  v_received_total integer := 0;
  v_seen_line_ids uuid[] := array[]::uuid[];
  v_all_lines jsonb := '[]'::jsonb;
  v_receipt_lines jsonb := '[]'::jsonb;
  v_source_reference text;
begin
  if v_actor is null then
    raise exception 'Authentication is required.';
  end if;

  if not public.is_active_admin_user(array['owner','admin']) then
    raise exception 'Only Owner and Admin roles can receive purchase orders.';
  end if;

  if p_purchase_order_id is null then
    raise exception 'Purchase order is required.';
  end if;

  if p_location_id is null then
    raise exception 'Inventory location is required.';
  end if;

  if btrim(coalesce(p_idempotency_key, '')) = '' then
    raise exception 'Receive idempotency key is required.';
  end if;

  -- Serialize retries that carry the same idempotency key so concurrent submits
  -- cannot post the canonical inventory movement twice.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_idempotency_key, 0));

  select * into v_existing_receipt
  from public.purchase_order_receipts
  where idempotency_key = p_idempotency_key;

  if found then
    if v_existing_receipt.purchase_order_id <> p_purchase_order_id then
      raise exception 'Receive idempotency key is already used by another purchase order.';
    end if;
    if v_existing_receipt.location_id <> p_location_id then
      raise exception 'Receive idempotency key was already used with another inventory location.';
    end if;

    select * into v_po
    from public.purchase_orders
    where id = v_existing_receipt.purchase_order_id;

    select * into v_supplier
    from public.suppliers
    where id = v_po.supplier_id;

    select coalesce(jsonb_agg(to_jsonb(line_row) order by line_row.created_at asc), '[]'::jsonb)
    into v_all_lines
    from public.purchase_order_lines line_row
    where line_row.purchase_order_id = v_po.id;

    select coalesce(jsonb_agg(to_jsonb(receipt_line_row) order by receipt_line_row.created_at asc), '[]'::jsonb)
    into v_receipt_lines
    from public.purchase_order_receipt_lines receipt_line_row
    where receipt_line_row.receipt_id = v_existing_receipt.id;

    return jsonb_build_object(
      'purchase_order', to_jsonb(v_po),
      'supplier', to_jsonb(v_supplier),
      'lines', v_all_lines,
      'receipt', to_jsonb(v_existing_receipt),
      'receipt_lines', v_receipt_lines,
      'idempotent_replay', true
    );
  end if;

  select * into v_po
  from public.purchase_orders
  where id = p_purchase_order_id
    and archived_at is null
  for update;

  if not found then
    raise exception 'Purchase order is required.';
  end if;

  if v_po.status not in ('ORDERED','PARTIALLY_RECEIVED') then
    raise exception 'Only Ordered or Partially Received purchase orders can receive stock.';
  end if;

  perform 1
  from public.inventory_locations
  where id = p_location_id;

  if not found then
    raise exception 'Inventory location is required.';
  end if;

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Enter a receive quantity for at least one PO line.';
  end if;

  insert into public.purchase_order_receipts (
    purchase_order_id,
    location_id,
    reference,
    note,
    idempotency_key,
    received_by_user_id
  ) values (
    v_po.id,
    p_location_id,
    nullif(btrim(coalesce(p_reference, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    p_idempotency_key,
    v_actor
  )
  returning * into v_receipt;

  v_source_reference := v_po.po_number || case
    when btrim(coalesce(p_reference, '')) <> '' then ' / ' || btrim(p_reference)
    else ''
  end;

  for v_input in select * from jsonb_array_elements(p_lines)
  loop
    begin
      v_qty := (v_input->>'quantity')::integer;
    exception when others then
      raise exception 'Receive quantity must be a positive whole number.';
    end;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Receive quantity must be a positive whole number.';
    end if;

    select * into v_po_line
    from public.purchase_order_lines
    where id = (v_input->>'purchase_order_line_id')::uuid
      and purchase_order_id = v_po.id
    for update;

    if not found then
      raise exception 'Purchase order line is invalid.';
    end if;

    if v_po_line.id = any(v_seen_line_ids) then
      raise exception 'Each purchase order line can appear only once per receipt.';
    end if;
    v_seen_line_ids := array_append(v_seen_line_ids, v_po_line.id);

    v_remaining := v_po_line.ordered_quantity - v_po_line.received_quantity;
    if v_remaining <= 0 then
      raise exception 'Purchase order line is already fully received.';
    end if;
    if v_qty > v_remaining then
      raise exception 'Receive quantity cannot exceed % remaining.', v_remaining;
    end if;

    -- Canonical stock authority stays in trry_api.receive_inventory.
    -- Because this is a nested function call, its stock movement and every PO update
    -- are committed or rolled back together with this M3 receipt transaction.
    perform trry_api.receive_inventory(
      p_location_id => p_location_id,
      p_variant_id => v_po_line.variant_id,
      p_quantity => v_qty,
      p_idempotency_key => p_idempotency_key || ':' || v_po_line.id::text,
      p_source_reference => v_source_reference,
      p_reason => coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Purchase order receipt ' || v_po.po_number)
    );

    update public.purchase_order_lines
    set received_quantity = received_quantity + v_qty,
        last_received_at = now()
    where id = v_po_line.id
    returning * into v_po_line;

    insert into public.purchase_order_receipt_lines (
      receipt_id,
      purchase_order_line_id,
      variant_id,
      quantity,
      unit_cost,
      received_at
    ) values (
      v_receipt.id,
      v_po_line.id,
      v_po_line.variant_id,
      v_qty,
      v_po_line.unit_cost,
      v_receipt.received_at
    );

    v_received_total := v_received_total + v_qty;
  end loop;

  if v_received_total <= 0 then
    raise exception 'Enter a receive quantity for at least one PO line.';
  end if;

  select coalesce(sum(ordered_quantity - received_quantity), 0)::integer
  into v_remaining_total
  from public.purchase_order_lines
  where purchase_order_id = v_po.id;

  update public.purchase_orders
  set status = case when v_remaining_total = 0 then 'RECEIVED' else 'PARTIALLY_RECEIVED' end
  where id = v_po.id
  returning * into v_po;

  select * into v_supplier
  from public.suppliers
  where id = v_po.supplier_id;

  select coalesce(jsonb_agg(to_jsonb(line_row) order by line_row.created_at asc), '[]'::jsonb)
  into v_all_lines
  from public.purchase_order_lines line_row
  where line_row.purchase_order_id = v_po.id;

  select coalesce(jsonb_agg(to_jsonb(receipt_line_row) order by receipt_line_row.created_at asc), '[]'::jsonb)
  into v_receipt_lines
  from public.purchase_order_receipt_lines receipt_line_row
  where receipt_line_row.receipt_id = v_receipt.id;

  return jsonb_build_object(
    'purchase_order', to_jsonb(v_po),
    'supplier', to_jsonb(v_supplier),
    'lines', v_all_lines,
    'receipt', to_jsonb(v_receipt),
    'receipt_lines', v_receipt_lines,
    'received_units', v_received_total,
    'remaining_units', v_remaining_total,
    'idempotent_replay', false
  );
end;
$$;

alter table public.purchase_order_receipts enable row level security;
alter table public.purchase_order_receipt_lines enable row level security;

revoke all on table public.purchase_order_receipts from anon;
revoke all on table public.purchase_order_receipt_lines from anon;
revoke all on table public.purchase_order_receipts from authenticated;
revoke all on table public.purchase_order_receipt_lines from authenticated;
grant select on table public.purchase_order_receipts to authenticated;
grant select on table public.purchase_order_receipt_lines to authenticated;
grant all on table public.purchase_order_receipts to service_role;
grant all on table public.purchase_order_receipt_lines to service_role;

revoke execute on function public.receive_purchase_order(uuid,uuid,jsonb,text,text,text) from public;
revoke execute on function public.receive_purchase_order(uuid,uuid,jsonb,text,text,text) from anon;
grant execute on function public.receive_purchase_order(uuid,uuid,jsonb,text,text,text) to authenticated;

drop policy if exists "purchase order receipts read active admin" on public.purchase_order_receipts;
create policy "purchase order receipts read active admin"
on public.purchase_order_receipts
for select
to authenticated
using (public.is_active_admin_user(array['owner','admin','staff']));

drop policy if exists "purchase order receipt lines read active admin" on public.purchase_order_receipt_lines;
create policy "purchase order receipt lines read active admin"
on public.purchase_order_receipt_lines
for select
to authenticated
using (public.is_active_admin_user(array['owner','admin','staff']));
