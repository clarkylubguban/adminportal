-- STLOLAB SW3 checkout foundation.
-- No configuration row is seeded: live ordering remains closed until the owner
-- confirms fulfillment fees/options and inventory timing/location.

create schema if not exists trry_api;

alter table public.orders
  alter column source_inquiry_id drop not null,
  add column if not exists source_type text not null default 'INQUIRY',
  add column if not exists source_channel text,
  add column if not exists currency text not null default 'PHP',
  add column if not exists subtotal_amount numeric(14, 2),
  add column if not exists fulfillment_amount numeric(14, 2),
  add column if not exists total_amount numeric(14, 2),
  add column if not exists customer_email text,
  add column if not exists fulfillment_details jsonb,
  add column if not exists confirmation_token_hash text;

alter table public.orders drop constraint if exists orders_source_type_check;
alter table public.orders add constraint orders_source_type_check
  check (source_type in ('INQUIRY', 'STLOLAB_RETAIL'));
alter table public.orders drop constraint if exists orders_source_shape_check;
alter table public.orders add constraint orders_source_shape_check check (
  (source_type = 'INQUIRY' and source_inquiry_id is not null)
  or (source_type = 'STLOLAB_RETAIL' and source_inquiry_id is null and source_channel = 'STLOLAB')
);
alter table public.orders drop constraint if exists orders_currency_check;
alter table public.orders add constraint orders_currency_check check (currency = 'PHP');
alter table public.orders drop constraint if exists orders_retail_amounts_check;
alter table public.orders add constraint orders_retail_amounts_check check (
  source_type <> 'STLOLAB_RETAIL'
  or (
    subtotal_amount is not null and subtotal_amount >= 0
    and fulfillment_amount is not null and fulfillment_amount >= 0
    and total_amount = subtotal_amount + fulfillment_amount
    and quoted_amount = total_amount
    and amount_due = total_amount
  )
);
alter table public.orders drop constraint if exists orders_confirmation_hash_check;
alter table public.orders add constraint orders_confirmation_hash_check check (
  confirmation_token_hash is null or confirmation_token_hash ~ '^[a-f0-9]{64}$'
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  product_code text not null,
  product_name text not null,
  sku text not null,
  size text,
  color text,
  quantity integer not null,
  unit_price numeric(14, 2) not null,
  line_total numeric(14, 2) not null,
  created_at timestamptz not null default now(),
  constraint order_items_quantity_positive check (quantity between 1 and 99),
  constraint order_items_price_positive check (unit_price > 0),
  constraint order_items_total_exact check (line_total = unit_price * quantity),
  constraint order_items_order_variant_unique unique (order_id, variant_id)
);

create table if not exists public.stlolab_checkout_config (
  environment text primary key,
  enabled boolean not null default false,
  inventory_policy text not null default 'UNCONFIRMED',
  inventory_location_id uuid references public.inventory_locations(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stlolab_checkout_environment_check check (environment in ('staging', 'production')),
  constraint stlolab_checkout_inventory_policy_check check (
    inventory_policy in ('UNCONFIRMED', 'VALIDATE_ONLY', 'DEDUCT_ON_SUBMIT')
  ),
  constraint stlolab_checkout_inventory_config_check check (
    inventory_policy = 'UNCONFIRMED' or inventory_location_id is not null
  )
);

create table if not exists public.stlolab_fulfillment_options (
  environment text not null references public.stlolab_checkout_config(environment) on delete cascade,
  method text not null,
  enabled boolean not null default false,
  fee_amount numeric(14, 2) not null,
  requires_address boolean not null,
  pickup_code text,
  customer_label text not null,
  primary key (environment, method),
  constraint stlolab_fulfillment_method_check check (method in ('pickup', 'delivery')),
  constraint stlolab_fulfillment_fee_check check (fee_amount >= 0),
  constraint stlolab_fulfillment_label_check check (btrim(customer_label) <> ''),
  constraint stlolab_fulfillment_pickup_check check (
    (method = 'pickup' and not requires_address and btrim(coalesce(pickup_code, '')) <> '')
    or (method = 'delivery' and requires_address and pickup_code is null)
  )
);

create table if not exists public.stlolab_checkout_requests (
  id uuid primary key default gen_random_uuid(),
  environment text not null,
  idempotency_key text not null,
  payload_hash text not null,
  order_id uuid not null references public.orders(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint stlolab_checkout_requests_key_unique unique (environment, idempotency_key),
  constraint stlolab_checkout_requests_key_check check (idempotency_key ~ '^[A-Za-z0-9_-]{16,120}$'),
  constraint stlolab_checkout_requests_hash_check check (payload_hash ~ '^[a-f0-9]{64}$')
);

create index if not exists order_items_order_id_idx on public.order_items(order_id);
create index if not exists order_items_variant_id_idx on public.order_items(variant_id);

alter table public.order_items enable row level security;
alter table public.stlolab_checkout_config enable row level security;
alter table public.stlolab_fulfillment_options enable row level security;
alter table public.stlolab_checkout_requests enable row level security;

revoke all on table public.order_items from public, anon, authenticated;
revoke all on table public.stlolab_checkout_config from public, anon, authenticated;
revoke all on table public.stlolab_fulfillment_options from public, anon, authenticated;
revoke all on table public.stlolab_checkout_requests from public, anon, authenticated;
grant all on table public.order_items to service_role;
grant all on table public.stlolab_checkout_config to service_role;
grant all on table public.stlolab_fulfillment_options to service_role;
grant all on table public.stlolab_checkout_requests to service_role;

create or replace function trry_api.create_stlolab_order_sw3(
  p_environment text,
  p_idempotency_key text,
  p_payload_hash text,
  p_confirmation_token_hash text,
  p_customer jsonb,
  p_fulfillment jsonb,
  p_lines jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_config public.stlolab_checkout_config%rowtype;
  v_option public.stlolab_fulfillment_options%rowtype;
  v_existing public.stlolab_checkout_requests%rowtype;
  v_customer_id uuid;
  v_customer_name text := btrim(coalesce(p_customer->>'fullName', ''));
  v_customer_mobile text := btrim(coalesce(p_customer->>'mobile', ''));
  v_customer_email text := lower(btrim(coalesce(p_customer->>'email', '')));
  v_mobile_normalized text;
  v_method text := lower(btrim(coalesce(p_fulfillment->>'method', '')));
  v_address jsonb := coalesce(p_fulfillment->'address', '{}'::jsonb);
  v_line jsonb;
  v_catalog record;
  v_quantity integer;
  v_submitted_minor bigint;
  v_unit_minor bigint;
  v_subtotal_minor bigint := 0;
  v_fee_minor bigint;
  v_order_id uuid := gen_random_uuid();
  v_order_reference text;
  v_product_snapshot text := '';
  v_quantity_snapshot text := '';
  v_balance integer;
  v_attempt integer;
begin
  if p_environment <> 'staging' then
    raise exception 'STLOLAB checkout is staging-only' using errcode = '22023';
  end if;
  if p_idempotency_key !~ '^[A-Za-z0-9_-]{16,120}$'
     or p_payload_hash !~ '^[a-f0-9]{64}$'
     or p_confirmation_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid checkout security values' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_environment || ':' || p_idempotency_key, 11092026));
  select * into v_existing from public.stlolab_checkout_requests
  where environment = p_environment and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.payload_hash <> p_payload_hash then
      raise exception 'idempotency key was already used for different checkout data' using errcode = '23505';
    end if;
    return trry_api.get_stlolab_order_confirmation_sw3(v_existing.order_id, p_confirmation_token_hash);
  end if;

  select * into v_config from public.stlolab_checkout_config where environment = p_environment;
  if not found or not v_config.enabled then
    raise exception 'STLOLAB checkout is not enabled' using errcode = '55000';
  end if;
  if v_config.inventory_policy = 'UNCONFIRMED' then
    raise exception 'inventory policy is not configured' using errcode = '55000';
  end if;
  if v_config.inventory_policy = 'DEDUCT_ON_SUBMIT' then
    raise exception 'inventory deduction timing is not accepted' using errcode = '55000';
  end if;

  select * into v_option from public.stlolab_fulfillment_options
  where environment = p_environment and method = v_method and enabled;
  if not found then raise exception 'fulfillment method is not enabled' using errcode = '22023'; end if;
  if v_option.requires_address and (
    btrim(coalesce(v_address->>'line1', '')) = '' or btrim(coalesce(v_address->>'city', '')) = ''
    or btrim(coalesce(v_address->>'province', '')) = '' or btrim(coalesce(v_address->>'postalCode', '')) = ''
  ) then raise exception 'complete delivery address is required' using errcode = '22023'; end if;
  if v_method = 'pickup' and btrim(coalesce(p_fulfillment->>'pickupCode', '')) <> v_option.pickup_code then
    raise exception 'invalid pickup location' using errcode = '22023';
  end if;

  if v_customer_name = '' or length(v_customer_name) > 240 then raise exception 'valid customer name is required' using errcode = '22023'; end if;
  v_mobile_normalized := public.normalize_ph_mobile(v_customer_mobile);
  if v_mobile_normalized is null then raise exception 'valid Philippine mobile is required' using errcode = '22023'; end if;
  if v_customer_email <> '' and v_customer_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'valid customer email is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 20 then
    raise exception 'checkout lines are required' using errcode = '22023';
  end if;

  select id into v_customer_id from public.customers where mobile_normalized = v_mobile_normalized limit 1;
  if v_customer_id is null then
    begin
      insert into public.customers(full_name, mobile_raw, first_source)
      values (v_customer_name, v_customer_mobile, 'STLO_WEB') returning id into v_customer_id;
    exception when unique_violation then
      select id into v_customer_id from public.customers where mobile_normalized = v_mobile_normalized limit 1;
    end;
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    begin
      v_quantity := (v_line->>'quantity')::integer;
      v_submitted_minor := (v_line->>'unitPriceMinor')::bigint;
    exception when others then
      raise exception 'invalid checkout line' using errcode = '22023';
    end;
    if v_quantity not between 1 and 99 then raise exception 'invalid line quantity' using errcode = '22023'; end if;

    select pv.id as variant_id, pv.selling_price, pv.size, pv.color, pv.sku,
      p.id as product_id, p.product_code, p.name as product_name into v_catalog
    from public.product_variants pv join public.products p on p.id = pv.product_id
    where pv.id = (v_line->>'variantId')::uuid
      and pv.active is true and pv.archived_at is null and pv.selling_price > 0
      and p.active is true and p.archived_at is null and p.sellable is true
      and p.readiness_status = 'READY_FOR_SALE' and p.product_type = 'PHYSICAL'
      and 'STLOLAB' = any(p.eligible_channels);
    if not found then raise exception 'product variant is not eligible for STLOLAB checkout' using errcode = '22023'; end if;
    v_unit_minor := round(v_catalog.selling_price * 100)::bigint;
    if v_submitted_minor <> v_unit_minor then raise exception 'submitted price does not match canonical price' using errcode = '22023'; end if;

    select ib.quantity_on_hand into v_balance from public.inventory_balances ib
    where ib.location_id = v_config.inventory_location_id and ib.variant_id = v_catalog.variant_id for update;
    if v_balance is null or v_balance < v_quantity then raise exception 'variant is unavailable' using errcode = '22003'; end if;

    v_subtotal_minor := v_subtotal_minor + v_unit_minor * v_quantity;
    v_product_snapshot := concat_ws(', ', nullif(v_product_snapshot, ''), v_catalog.product_name || ' (' || coalesce(v_catalog.size, '-') || ')');
    v_quantity_snapshot := concat_ws(', ', nullif(v_quantity_snapshot, ''), coalesce(v_catalog.size, '-') || ': ' || v_quantity);
  end loop;

  v_fee_minor := round(v_option.fee_amount * 100)::bigint;
  for v_attempt in 1..8 loop
    v_order_reference := 'TRRY-ORD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.orders where order_reference = v_order_reference);
  end loop;

  insert into public.orders(
    id, order_reference, source_type, source_channel, status, customer_id, customer_name,
    customer_contact, customer_email, product, product_desc, quantity, fulfillment_method,
    fulfillment_details, currency, subtotal_amount, fulfillment_amount, total_amount,
    quoted_amount, amount_due, confirmation_token_hash
  ) values (
    v_order_id, v_order_reference, 'STLOLAB_RETAIL', 'STLOLAB', 'awaiting_payment', v_customer_id,
    v_customer_name, v_customer_mobile, nullif(v_customer_email, ''), v_product_snapshot,
    'Direct STLOLAB retail checkout', v_quantity_snapshot, v_method,
    jsonb_build_object('method', v_method, 'address', case when v_option.requires_address then v_address else null end,
      'pickupCode', case when v_method = 'pickup' then v_option.pickup_code else null end,
      'label', v_option.customer_label), 'PHP', v_subtotal_minor / 100.0, v_fee_minor / 100.0,
    (v_subtotal_minor + v_fee_minor) / 100.0, (v_subtotal_minor + v_fee_minor) / 100.0,
    (v_subtotal_minor + v_fee_minor) / 100.0, p_confirmation_token_hash
  );

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    select pv.id as variant_id, pv.selling_price, pv.size, pv.color, pv.sku,
      p.id as product_id, p.product_code, p.name as product_name into v_catalog from public.product_variants pv
    join public.products p on p.id = pv.product_id where pv.id = (v_line->>'variantId')::uuid;
    v_quantity := (v_line->>'quantity')::integer;
    insert into public.order_items(order_id, product_id, variant_id, product_code, product_name, sku, size, color, quantity, unit_price, line_total)
    values (v_order_id, v_catalog.product_id, v_catalog.variant_id, v_catalog.product_code, v_catalog.product_name, v_catalog.sku,
      v_catalog.size, v_catalog.color, v_quantity, v_catalog.selling_price, v_catalog.selling_price * v_quantity);
  end loop;

  insert into public.stlolab_checkout_requests(environment, idempotency_key, payload_hash, order_id)
  values (p_environment, p_idempotency_key, p_payload_hash, v_order_id);
  return trry_api.get_stlolab_order_confirmation_sw3(v_order_id, p_confirmation_token_hash);
end;
$$;

create or replace function trry_api.get_stlolab_order_confirmation_sw3(
  p_order_id uuid,
  p_confirmation_token_hash text
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'orderId', o.id, 'orderReference', o.order_reference, 'status', o.status,
    'customerName', o.customer_name, 'customerEmail', o.customer_email,
    'fulfillment', o.fulfillment_details, 'currency', o.currency,
    'subtotalMinor', round(o.subtotal_amount * 100)::bigint,
    'fulfillmentMinor', round(o.fulfillment_amount * 100)::bigint,
    'totalMinor', round(o.total_amount * 100)::bigint,
    'createdAt', o.created_at,
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
      'productCode', i.product_code, 'productName', i.product_name, 'variantId', i.variant_id,
      'sku', i.sku, 'size', i.size, 'color', i.color, 'quantity', i.quantity,
      'unitPriceMinor', round(i.unit_price * 100)::bigint,
      'lineTotalMinor', round(i.line_total * 100)::bigint
    ) order by i.created_at, i.id) from public.order_items i where i.order_id = o.id), '[]'::jsonb)
  )
  from public.orders o
  where o.id = p_order_id and o.source_type = 'STLOLAB_RETAIL'
    and o.confirmation_token_hash = p_confirmation_token_hash
$$;

revoke all on function trry_api.create_stlolab_order_sw3(text,text,text,text,jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function trry_api.get_stlolab_order_confirmation_sw3(uuid,text) from public, anon, authenticated;
grant usage on schema trry_api to service_role;
grant execute on function trry_api.create_stlolab_order_sw3(text,text,text,text,jsonb,jsonb,jsonb) to service_role;
grant execute on function trry_api.get_stlolab_order_confirmation_sw3(uuid,text) to service_role;

comment on table public.stlolab_checkout_config is 'Owner-controlled SW3 gate. No row is seeded by this migration.';
comment on column public.stlolab_checkout_config.inventory_policy is 'UNCONFIRMED blocks checkout. VALIDATE_ONLY checks without movement. DEDUCT_ON_SUBMIT remains blocked pending owner acceptance.';
