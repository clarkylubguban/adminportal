-- STLOLAB SW3 fulfillment lifecycle.
-- The reservation clock is an absolute 72 hours from order creation. An order is
-- eligible only while unpaid and pending handover. Scheduling is intentionally
-- not installed here; the protected expiry RPC must be invoked by staging ops.

alter table public.orders
  add column if not exists payment_state text,
  add column if not exists paid_at timestamptz,
  add column if not exists payment_reference text,
  add column if not exists payment_idempotency_key text,
  add column if not exists fulfillment_state text,
  add column if not exists handed_over_at timestamptz,
  add column if not exists handover_kind text,
  add column if not exists fulfillment_idempotency_key text,
  add column if not exists reservation_expires_at timestamptz,
  add column if not exists expired_at timestamptz;

update public.orders
set payment_state = 'UNPAID', fulfillment_state = 'PENDING',
    reservation_expires_at = created_at + interval '72 hours'
where source_type = 'STLOLAB_RETAIL' and status = 'awaiting_payment'
  and payment_state is null and fulfillment_state is null and reservation_expires_at is null;

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('awaiting_payment', 'paid', 'ready_to_release', 'released', 'completed', 'cancelled', 'expired'));
alter table public.orders drop constraint if exists orders_stlolab_payment_shape_check;
alter table public.orders add constraint orders_stlolab_payment_shape_check check (
  source_type <> 'STLOLAB_RETAIL'
  or (payment_state = 'UNPAID' and paid_at is null and payment_reference is null and payment_idempotency_key is null)
  or (payment_state = 'PAID' and paid_at is not null and btrim(coalesce(payment_reference, '')) <> ''
      and btrim(coalesce(payment_idempotency_key, '')) <> '')
);
alter table public.orders drop constraint if exists orders_stlolab_fulfillment_shape_check;
alter table public.orders add constraint orders_stlolab_fulfillment_shape_check check (
  source_type <> 'STLOLAB_RETAIL'
  or (fulfillment_state = 'PENDING' and handed_over_at is null and handover_kind is null and fulfillment_idempotency_key is null)
  or (fulfillment_state = 'HANDED_OVER' and handed_over_at is not null
      and handover_kind in ('CUSTOMER_PICKUP', 'COURIER_HANDOVER')
      and btrim(coalesce(fulfillment_idempotency_key, '')) <> '')
);
alter table public.orders drop constraint if exists orders_stlolab_expiry_shape_check;
alter table public.orders add constraint orders_stlolab_expiry_shape_check check (
  source_type <> 'STLOLAB_RETAIL'
  or (reservation_expires_at is not null and ((status = 'expired' and expired_at is not null) or (status <> 'expired' and expired_at is null)))
);
create unique index if not exists orders_stlolab_payment_idempotency_unique
  on public.orders(payment_idempotency_key) where payment_idempotency_key is not null;
create unique index if not exists orders_stlolab_fulfillment_idempotency_unique
  on public.orders(fulfillment_idempotency_key) where fulfillment_idempotency_key is not null;
create index if not exists orders_stlolab_expiry_queue_idx
  on public.orders(reservation_expires_at, id)
  where source_type = 'STLOLAB_RETAIL' and status = 'awaiting_payment'
    and payment_state = 'UNPAID' and fulfillment_state = 'PENDING';

alter table public.inventory_reservations
  add column if not exists expires_at timestamptz,
  add column if not exists release_reason text,
  add column if not exists stock_movement_id uuid references public.stock_movements(id) on delete restrict;
update public.inventory_reservations
set expires_at = created_at + interval '72 hours'
where expires_at is null;
alter table public.inventory_reservations alter column expires_at set not null;
alter table public.inventory_reservations drop constraint if exists inventory_reservations_status_check;
alter table public.inventory_reservations add constraint inventory_reservations_status_check
  check (status in ('ACTIVE', 'RELEASED', 'EXPIRED', 'CONSUMED'));
alter table public.inventory_reservations drop constraint if exists inventory_reservations_release_shape;
alter table public.inventory_reservations add constraint inventory_reservations_release_shape check (
  (status = 'ACTIVE' and released_at is null and release_idempotency_key is null and release_reason is null and stock_movement_id is null)
  or (status in ('RELEASED', 'EXPIRED') and released_at is not null
      and btrim(coalesce(release_idempotency_key, '')) <> '' and btrim(coalesce(release_reason, '')) <> ''
      and stock_movement_id is null)
  or (status = 'CONSUMED' and released_at is not null and btrim(coalesce(release_idempotency_key, '')) <> ''
      and release_reason = 'FULFILLMENT_HANDOVER' and stock_movement_id is not null)
);
create index if not exists inventory_reservations_expiry_idx
  on public.inventory_reservations(expires_at, order_id) where status = 'ACTIVE';
create index if not exists inventory_reservations_stock_movement_idx
  on public.inventory_reservations(stock_movement_id) where stock_movement_id is not null;

alter table public.stlolab_fulfillment_options
  add column if not exists option_code text,
  add column if not exists coverage_mode text,
  add column if not exists coverage_rules jsonb not null default '{}'::jsonb,
  add column if not exists customer_instructions text;
update public.stlolab_fulfillment_options
set option_code = coalesce(option_code, upper(method)),
    coverage_mode = coalesce(coverage_mode, case when method = 'pickup' then 'PICKUP' else 'UNCONFIRMED' end)
where option_code is null or coverage_mode is null;
alter table public.stlolab_fulfillment_options alter column option_code set not null;
alter table public.stlolab_fulfillment_options alter column coverage_mode set not null;
alter table public.stlolab_fulfillment_options drop constraint if exists stlolab_fulfillment_options_pkey;
alter table public.stlolab_fulfillment_options add primary key (environment, option_code);
alter table public.stlolab_fulfillment_options drop constraint if exists stlolab_fulfillment_option_code_check;
alter table public.stlolab_fulfillment_options add constraint stlolab_fulfillment_option_code_check
  check (option_code ~ '^[A-Z0-9_-]{2,40}$');
alter table public.stlolab_fulfillment_options drop constraint if exists stlolab_fulfillment_coverage_check;
alter table public.stlolab_fulfillment_options add constraint stlolab_fulfillment_coverage_check check (
  (method = 'pickup' and coverage_mode = 'PICKUP')
  or (method = 'delivery' and coverage_mode in ('UNCONFIRMED', 'EXPLICIT_BARANGAYS', 'NATIONWIDE'))
);

create or replace function private.stlolab_place_key(value text)
returns text language sql immutable security invoker set search_path = ''
as $$ select regexp_replace(lower(btrim(coalesce(value, ''))), '[^a-z0-9]+', '', 'g') $$;

create or replace function private.stlolab_reserve_order_item_sw3()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_config public.stlolab_checkout_config%rowtype;
  v_balance public.inventory_balances%rowtype;
begin
  select * into v_order from public.orders where id = new.order_id;
  if v_order.source_type <> 'STLOLAB_RETAIL' then return new; end if;
  select * into v_config from public.stlolab_checkout_config where environment = 'staging';
  if not found or not v_config.enabled or v_config.inventory_policy <> 'RESERVE_ON_SUBMIT'
     or v_config.inventory_location_id is null then
    raise exception 'reserve-on-submit inventory configuration is required' using errcode = '55000';
  end if;
  select * into v_balance from public.inventory_balances
  where location_id = v_config.inventory_location_id and variant_id = new.variant_id for update;
  if not found or v_balance.quantity_on_hand - v_balance.reserved_quantity < new.quantity then
    raise exception 'variant is unavailable after active reservations' using errcode = '22003';
  end if;
  update public.inventory_balances set reserved_quantity = reserved_quantity + new.quantity, updated_at = now()
  where id = v_balance.id;
  insert into public.inventory_reservations(
    location_id, variant_id, order_id, order_item_id, quantity, idempotency_key, expires_at
  ) values (
    v_config.inventory_location_id, new.variant_id, new.order_id, new.id, new.quantity,
    'STLOLAB-RESERVE:' || new.order_id::text || ':' || new.variant_id::text, v_order.reservation_expires_at
  );
  return new;
end;
$$;

create or replace function trry_api.create_stlolab_order_sw3(
  p_environment text, p_idempotency_key text, p_payload_hash text, p_confirmation_token_hash text,
  p_customer jsonb, p_fulfillment jsonb, p_lines jsonb
)
returns jsonb language plpgsql security invoker set search_path = ''
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
  v_option_code text := upper(btrim(coalesce(p_fulfillment->>'optionCode', '')));
  v_address jsonb := coalesce(p_fulfillment->'address', '{}'::jsonb);
  v_barangay_key text := private.stlolab_place_key(p_fulfillment->'address'->>'barangay');
  v_line jsonb; v_catalog record; v_quantity integer; v_submitted_minor bigint; v_unit_minor bigint;
  v_subtotal_minor bigint := 0; v_fee_minor bigint; v_order_id uuid := gen_random_uuid();
  v_order_reference text; v_product_snapshot text := ''; v_quantity_snapshot text := '';
  v_balance integer; v_attempt integer; v_now timestamptz := clock_timestamp();
begin
  if p_environment <> 'staging' then raise exception 'STLOLAB checkout is staging-only' using errcode = '22023'; end if;
  if p_idempotency_key !~ '^[A-Za-z0-9_-]{16,120}$' or p_payload_hash !~ '^[a-f0-9]{64}$'
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
  if not found or not v_config.enabled then raise exception 'STLOLAB checkout is not enabled' using errcode = '55000'; end if;
  if v_config.inventory_policy <> 'RESERVE_ON_SUBMIT' or v_config.inventory_location_id is null then
    raise exception 'reserve-on-submit inventory configuration is required' using errcode = '55000';
  end if;
  select * into v_option from public.stlolab_fulfillment_options
  where environment = p_environment and option_code = v_option_code and method = v_method and enabled;
  if not found then raise exception 'fulfillment option is not enabled' using errcode = '22023'; end if;
  if v_option.requires_address and (
    btrim(coalesce(v_address->>'line1', '')) = '' or v_barangay_key = '' or btrim(coalesce(v_address->>'city', '')) = ''
    or btrim(coalesce(v_address->>'province', '')) = '' or btrim(coalesce(v_address->>'postalCode', '')) = ''
  ) then raise exception 'complete delivery address including barangay is required' using errcode = '22023'; end if;
  if v_method = 'pickup' and btrim(coalesce(p_fulfillment->>'pickupCode', '')) <> v_option.pickup_code then
    raise exception 'invalid pickup location' using errcode = '22023';
  end if;
  if v_option.coverage_mode = 'UNCONFIRMED' then raise exception 'delivery coverage is not configured' using errcode = '55000'; end if;
  if v_option.coverage_mode = 'EXPLICIT_BARANGAYS' then
    if exists (select 1 from jsonb_array_elements_text(coalesce(v_option.coverage_rules->'excludedBarangays', '[]'::jsonb)) item
      where private.stlolab_place_key(item) = v_barangay_key) then
      raise exception 'address is excluded from local delivery' using errcode = '22023';
    end if;
    if not exists (select 1 from jsonb_array_elements_text(coalesce(v_option.coverage_rules->'allowedBarangays', '[]'::jsonb)) item
      where private.stlolab_place_key(item) = v_barangay_key) then
      raise exception 'address is not in configured local delivery coverage' using errcode = '22023';
    end if;
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
  for v_line in select value from jsonb_array_elements(p_lines) order by value->>'variantId' loop
    begin v_quantity := (v_line->>'quantity')::integer; v_submitted_minor := (v_line->>'unitPriceMinor')::bigint;
    exception when others then raise exception 'invalid checkout line' using errcode = '22023'; end;
    if v_quantity not between 1 and 99 then raise exception 'invalid line quantity' using errcode = '22023'; end if;
    select pv.id as variant_id, pv.selling_price, pv.size, pv.color, pv.sku,
      p.id as product_id, p.product_code, p.name as product_name into v_catalog
    from public.product_variants pv join public.products p on p.id = pv.product_id
    where pv.id = (v_line->>'variantId')::uuid and pv.active and pv.archived_at is null and pv.selling_price > 0
      and p.active and p.archived_at is null and p.sellable and p.readiness_status = 'READY_FOR_SALE'
      and p.product_type = 'PHYSICAL' and 'STLOLAB' = any(p.eligible_channels);
    if not found then raise exception 'product variant is not eligible for STLOLAB checkout' using errcode = '22023'; end if;
    v_unit_minor := round(v_catalog.selling_price * 100)::bigint;
    if v_submitted_minor <> v_unit_minor then raise exception 'submitted price does not match canonical price' using errcode = '22023'; end if;
    select ib.quantity_on_hand - ib.reserved_quantity into v_balance from public.inventory_balances ib
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
    id, order_reference, source_type, source_channel, status, customer_id, customer_name, customer_contact,
    customer_email, product, product_desc, quantity, fulfillment_method, fulfillment_details, currency,
    subtotal_amount, fulfillment_amount, total_amount, quoted_amount, amount_due, confirmation_token_hash,
    payment_state, fulfillment_state, reservation_expires_at, created_at, updated_at
  ) values (
    v_order_id, v_order_reference, 'STLOLAB_RETAIL', 'STLOLAB', 'awaiting_payment', v_customer_id, v_customer_name,
    v_customer_mobile, nullif(v_customer_email, ''), v_product_snapshot, 'Direct STLOLAB retail checkout',
    v_quantity_snapshot, v_method,
    jsonb_build_object('method', v_method, 'optionCode', v_option.option_code,
      'address', case when v_option.requires_address then v_address else null end,
      'pickupCode', case when v_method = 'pickup' then v_option.pickup_code else null end,
      'label', v_option.customer_label, 'instructions', v_option.customer_instructions),
    'PHP', v_subtotal_minor / 100.0, v_fee_minor / 100.0, (v_subtotal_minor + v_fee_minor) / 100.0,
    (v_subtotal_minor + v_fee_minor) / 100.0, (v_subtotal_minor + v_fee_minor) / 100.0,
    p_confirmation_token_hash, 'UNPAID', 'PENDING', v_now + interval '72 hours', v_now, v_now
  );
  for v_line in select value from jsonb_array_elements(p_lines) order by value->>'variantId' loop
    select pv.id as variant_id, pv.selling_price, pv.size, pv.color, pv.sku,
      p.id as product_id, p.product_code, p.name as product_name into v_catalog
    from public.product_variants pv join public.products p on p.id = pv.product_id
    where pv.id = (v_line->>'variantId')::uuid;
    v_quantity := (v_line->>'quantity')::integer;
    insert into public.order_items(order_id, product_id, variant_id, product_code, product_name, sku, size, color, quantity, unit_price, line_total)
    values (v_order_id, v_catalog.product_id, v_catalog.variant_id, v_catalog.product_code, v_catalog.product_name,
      v_catalog.sku, v_catalog.size, v_catalog.color, v_quantity, v_catalog.selling_price, v_catalog.selling_price * v_quantity);
  end loop;
  insert into public.stlolab_checkout_requests(environment, idempotency_key, payload_hash, order_id)
  values (p_environment, p_idempotency_key, p_payload_hash, v_order_id);
  return trry_api.get_stlolab_order_confirmation_sw3(v_order_id, p_confirmation_token_hash);
end;
$$;

create or replace function trry_api.mark_stlolab_order_paid_sw3(
  p_order_id uuid, p_payment_reference text, p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_order public.orders%rowtype;
begin
  perform private.m2b_require_owner_admin();
  if btrim(coalesce(p_payment_reference, '')) = '' or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,120}$' then
    raise exception 'valid payment reference and idempotency key are required' using errcode = '22023';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.source_type <> 'STLOLAB_RETAIL' then raise exception 'STLOLAB order not found' using errcode = 'P0002'; end if;
  if v_order.payment_state = 'PAID' then
    if v_order.payment_reference <> btrim(p_payment_reference) then
      raise exception 'payment replay conflicts with saved payment reference' using errcode = '23505';
    end if;
    return jsonb_build_object('orderId', v_order.id, 'paymentState', v_order.payment_state,
      'fulfillmentState', v_order.fulfillment_state, 'idempotent', true);
  end if;
  if v_order.status in ('cancelled', 'expired') then raise exception 'closed order cannot be marked paid' using errcode = '55000'; end if;
  update public.orders set payment_state = 'PAID', paid_at = clock_timestamp(),
    payment_reference = btrim(p_payment_reference), payment_idempotency_key = p_idempotency_key,
    status = case when fulfillment_state = 'HANDED_OVER' then status else 'paid' end, updated_at = now()
  where id = v_order.id;
  return jsonb_build_object('orderId', v_order.id, 'paymentState', 'PAID',
    'fulfillmentState', v_order.fulfillment_state, 'idempotent', false);
end;
$$;

create or replace function trry_api.handover_stlolab_order_sw3(
  p_order_id uuid, p_handover_kind text, p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_order public.orders%rowtype; v_reservation public.inventory_reservations%rowtype;
  v_movement jsonb; v_kind text := upper(btrim(coalesce(p_handover_kind, '')));
begin
  perform private.m2b_require_owner_admin();
  if v_kind not in ('CUSTOMER_PICKUP', 'COURIER_HANDOVER') or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,120}$' then
    raise exception 'valid handover kind and idempotency key are required' using errcode = '22023';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.source_type <> 'STLOLAB_RETAIL' then raise exception 'STLOLAB order not found' using errcode = 'P0002'; end if;
  if v_order.fulfillment_state = 'HANDED_OVER' then
    if v_order.handover_kind <> v_kind then
      raise exception 'handover replay conflicts with saved handover kind' using errcode = '23505';
    end if;
    return jsonb_build_object('orderId', v_order.id, 'paymentState', v_order.payment_state,
      'fulfillmentState', v_order.fulfillment_state, 'handoverKind', v_order.handover_kind, 'idempotent', true);
  end if;
  if v_order.status in ('cancelled', 'expired') then raise exception 'closed order cannot be handed over' using errcode = '55000'; end if;
  if (v_order.fulfillment_method = 'pickup' and v_kind <> 'CUSTOMER_PICKUP')
     or (v_order.fulfillment_method = 'delivery' and v_kind <> 'COURIER_HANDOVER') then
    raise exception 'handover kind does not match fulfillment method' using errcode = '22023';
  end if;
  if not exists (select 1 from public.inventory_reservations where order_id = v_order.id and status = 'ACTIVE') then
    raise exception 'active order reservation is required for handover' using errcode = '23514';
  end if;
  for v_reservation in
    select * from public.inventory_reservations where order_id = v_order.id and status = 'ACTIVE'
    order by location_id, variant_id for update
  loop
    perform 1 from public.inventory_balances where location_id = v_reservation.location_id
      and variant_id = v_reservation.variant_id for update;
    update public.inventory_balances set reserved_quantity = reserved_quantity - v_reservation.quantity, updated_at = now()
    where location_id = v_reservation.location_id and variant_id = v_reservation.variant_id
      and reserved_quantity >= v_reservation.quantity;
    if not found then raise exception 'reservation balance is inconsistent' using errcode = '23514'; end if;
    v_movement := private.m2b_apply_stock_movement(
      v_reservation.location_id, v_reservation.variant_id, 'SALE', -v_reservation.quantity,
      'ORDER', v_order.id, v_order.order_reference,
      'STLOLAB-HANDOVER:' || v_order.id::text || ':' || v_reservation.variant_id::text,
      case when v_kind = 'CUSTOMER_PICKUP' then 'STLOLAB customer pickup' else 'STLOLAB courier handover' end
    );
    update public.inventory_reservations set status = 'CONSUMED', released_at = clock_timestamp(),
      release_idempotency_key = p_idempotency_key, release_reason = 'FULFILLMENT_HANDOVER',
      stock_movement_id = (v_movement->>'movementId')::uuid
    where id = v_reservation.id and status = 'ACTIVE';
  end loop;
  update public.orders set fulfillment_state = 'HANDED_OVER', handed_over_at = clock_timestamp(),
    handover_kind = v_kind, fulfillment_idempotency_key = p_idempotency_key, status = 'released', updated_at = now()
  where id = v_order.id;
  return jsonb_build_object('orderId', v_order.id, 'paymentState', v_order.payment_state,
    'fulfillmentState', 'HANDED_OVER', 'handoverKind', v_kind, 'idempotent', false);
end;
$$;

create or replace function trry_api.expire_stlolab_reservations_sw3(
  p_as_of timestamptz default clock_timestamp(), p_limit integer default 100
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_order public.orders%rowtype; v_reservation public.inventory_reservations%rowtype;
  v_ids uuid[] := '{}'::uuid[]; v_count integer := 0; v_key text;
begin
  if p_limit not between 1 and 500 then raise exception 'expiry batch limit must be between 1 and 500' using errcode = '22023'; end if;
  if p_as_of > clock_timestamp() then raise exception 'expiry as-of cannot be in the future' using errcode = '22023'; end if;
  for v_order in
    select o.* from public.orders o
    where o.source_type = 'STLOLAB_RETAIL' and o.status = 'awaiting_payment'
      and o.payment_state = 'UNPAID' and o.fulfillment_state = 'PENDING'
      and o.reservation_expires_at <= p_as_of
      and exists (select 1 from public.inventory_reservations r where r.order_id = o.id and r.status = 'ACTIVE')
    order by o.reservation_expires_at, o.id for update skip locked limit p_limit
  loop
    v_key := 'STLOLAB-EXPIRY:' || v_order.id::text;
    for v_reservation in
      select * from public.inventory_reservations where order_id = v_order.id and status = 'ACTIVE'
      order by location_id, variant_id for update
    loop
      perform 1 from public.inventory_balances where location_id = v_reservation.location_id
        and variant_id = v_reservation.variant_id for update;
      update public.inventory_balances set reserved_quantity = reserved_quantity - v_reservation.quantity, updated_at = now()
      where location_id = v_reservation.location_id and variant_id = v_reservation.variant_id
        and reserved_quantity >= v_reservation.quantity;
      if not found then raise exception 'reservation balance is inconsistent' using errcode = '23514'; end if;
      update public.inventory_reservations set status = 'EXPIRED', released_at = p_as_of,
        release_idempotency_key = v_key, release_reason = 'UNPAID_72_HOUR_EXPIRY'
      where id = v_reservation.id and status = 'ACTIVE';
    end loop;
    update public.orders set status = 'expired', expired_at = p_as_of, updated_at = now() where id = v_order.id;
    v_ids := array_append(v_ids, v_order.id); v_count := v_count + 1;
  end loop;
  return jsonb_build_object('expiredCount', v_count, 'orderIds', to_jsonb(v_ids), 'asOf', p_as_of);
end;
$$;

create or replace function trry_api.cancel_stlolab_order_sw3(
  p_order_id uuid, p_confirmation_token_hash text, p_idempotency_key text, p_reason text default null
)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare v_order public.orders%rowtype; v_reservation public.inventory_reservations%rowtype;
begin
  if p_idempotency_key !~ '^[A-Za-z0-9_-]{16,120}$' then raise exception 'invalid cancellation idempotency key' using errcode = '22023'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.source_type <> 'STLOLAB_RETAIL' or v_order.confirmation_token_hash <> p_confirmation_token_hash then return null; end if;
  if v_order.status = 'cancelled' then return trry_api.get_stlolab_order_confirmation_sw3(v_order.id, p_confirmation_token_hash); end if;
  if v_order.status <> 'awaiting_payment' or v_order.payment_state <> 'UNPAID' or v_order.fulfillment_state <> 'PENDING' then
    raise exception 'order cannot be cancelled after payment, expiry, or handover' using errcode = '55000';
  end if;
  for v_reservation in
    select * from public.inventory_reservations where order_id = v_order.id and status = 'ACTIVE'
    order by location_id, variant_id for update
  loop
    perform 1 from public.inventory_balances where location_id = v_reservation.location_id
      and variant_id = v_reservation.variant_id for update;
    update public.inventory_balances set reserved_quantity = reserved_quantity - v_reservation.quantity, updated_at = now()
    where location_id = v_reservation.location_id and variant_id = v_reservation.variant_id
      and reserved_quantity >= v_reservation.quantity;
    if not found then raise exception 'reservation balance is inconsistent' using errcode = '23514'; end if;
    update public.inventory_reservations set status = 'RELEASED', released_at = clock_timestamp(),
      release_idempotency_key = p_idempotency_key, release_reason = 'CUSTOMER_CANCELLATION'
    where id = v_reservation.id and status = 'ACTIVE';
  end loop;
  update public.orders set status = 'cancelled', cancelled_at = clock_timestamp(),
    cancellation_reason = nullif(btrim(coalesce(p_reason, '')), ''), cancellation_idempotency_key = p_idempotency_key,
    updated_at = now() where id = v_order.id;
  return trry_api.get_stlolab_order_confirmation_sw3(v_order.id, p_confirmation_token_hash);
end;
$$;

create or replace function private.protect_stlolab_cancellation_release_sw3()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if old.source_type <> 'STLOLAB_RETAIL' then return new; end if;
  if new.status in ('cancelled', 'expired') and old.status <> new.status
     and exists (select 1 from public.inventory_reservations where order_id = old.id and status = 'ACTIVE') then
    raise exception 'active inventory reservations must be released before closing order' using errcode = '23514';
  end if;
  if new.fulfillment_state = 'HANDED_OVER' and old.fulfillment_state is distinct from 'HANDED_OVER'
     and exists (select 1 from public.inventory_reservations where order_id = old.id and status <> 'CONSUMED') then
    raise exception 'all inventory reservations must be consumed before handover' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.stlolab_place_key(text) from public, anon, authenticated;
revoke all on function private.stlolab_reserve_order_item_sw3() from public, anon, authenticated;
revoke all on function trry_api.mark_stlolab_order_paid_sw3(uuid,text,text) from public, anon, authenticated;
revoke all on function trry_api.handover_stlolab_order_sw3(uuid,text,text) from public, anon, authenticated;
revoke all on function trry_api.expire_stlolab_reservations_sw3(timestamptz,integer) from public, anon, authenticated;
revoke all on function trry_api.cancel_stlolab_order_sw3(uuid,text,text,text) from public, anon, authenticated;
grant usage on schema trry_api to authenticated;
grant execute on function trry_api.mark_stlolab_order_paid_sw3(uuid,text,text) to authenticated;
grant execute on function trry_api.handover_stlolab_order_sw3(uuid,text,text) to authenticated;
grant execute on function trry_api.expire_stlolab_reservations_sw3(timestamptz,integer) to service_role;
grant execute on function trry_api.cancel_stlolab_order_sw3(uuid,text,text,text) to service_role;

comment on column public.orders.reservation_expires_at is 'Absolute instant 72 hours after STLOLAB order creation; timezone display does not alter eligibility.';
comment on column public.orders.payment_state is 'Payment fact kept independent from fulfillment stock movement. No payment-failure policy is implied.';
comment on column public.orders.fulfillment_state is 'PENDING until atomic customer pickup or courier handover consumes reserved stock.';
comment on function trry_api.expire_stlolab_reservations_sw3(timestamptz,integer) is 'Idempotently releases reservations only for unpaid, pending STLOLAB orders at or after their 72-hour deadline.';
