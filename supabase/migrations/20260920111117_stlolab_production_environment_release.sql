-- Forward-only release support for exact staging and production environments.
-- This migration seeds no environment configuration and leaves every gate closed.

alter table public.orders
  add column if not exists checkout_environment text;

update public.orders o
set checkout_environment = r.environment
from public.stlolab_checkout_requests r
where r.order_id = o.id
  and o.source_type = 'STLOLAB_RETAIL'
  and o.checkout_environment is null;

alter table public.orders drop constraint if exists orders_stlolab_checkout_environment_check;
alter table public.orders add constraint orders_stlolab_checkout_environment_check check (
  (source_type = 'STLOLAB_RETAIL' and checkout_environment in ('staging', 'production'))
  or (source_type <> 'STLOLAB_RETAIL' and checkout_environment is null)
);

comment on column public.orders.checkout_environment is
  'Exact STLOLAB checkout environment used to select inventory and fulfillment configuration.';

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
  if v_order.checkout_environment not in ('staging', 'production') then
    raise exception 'valid checkout environment is required' using errcode = '55000';
  end if;
  select * into v_config from public.stlolab_checkout_config
  where environment = v_order.checkout_environment;
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
  if p_environment not in ('staging', 'production') then
    raise exception 'unsupported STLOLAB checkout environment' using errcode = '22023';
  end if;
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
    payment_state, fulfillment_state, reservation_expires_at, checkout_environment, created_at, updated_at
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
    p_confirmation_token_hash, 'UNPAID', 'PENDING', v_now + interval '72 hours', p_environment, v_now, v_now
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

revoke all on function private.stlolab_reserve_order_item_sw3() from public, anon, authenticated;
revoke all on function trry_api.create_stlolab_order_sw3(text,text,text,text,jsonb,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function trry_api.create_stlolab_order_sw3(text,text,text,text,jsonb,jsonb,jsonb)
  to service_role;

comment on function trry_api.create_stlolab_order_sw3(text,text,text,text,jsonb,jsonb,jsonb) is
  'Canonical STLOLAB checkout for exact staging or production configuration; disabled when no enabled environment row exists.';
