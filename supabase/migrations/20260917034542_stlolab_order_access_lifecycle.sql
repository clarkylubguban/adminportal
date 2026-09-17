alter table public.orders
  add column if not exists confirmation_access_version smallint,
  add column if not exists confirmation_token_issued_at timestamptz,
  add column if not exists confirmation_token_expires_at timestamptz,
  add column if not exists confirmation_token_revoked_at timestamptz;

alter table public.orders
  add constraint orders_confirmation_access_lifecycle_check check (
    confirmation_access_version is null
    or (
      confirmation_access_version = 1
      and confirmation_token_issued_at is not null
      and confirmation_token_expires_at > confirmation_token_issued_at
      and (confirmation_token_revoked_at is null or confirmation_token_revoked_at >= confirmation_token_issued_at)
    )
  );

create or replace function private.enforce_new_stlolab_order_access_lifecycle()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = new.id;
  if v_order.source_type = 'STLOLAB_RETAIL' and v_order.confirmation_access_version is distinct from 1 then
    raise exception 'durable confirmation access is required for new STLOLAB orders' using errcode = '23514';
  end if;
  return null;
end;
$$;

drop trigger if exists enforce_new_stlolab_order_access_lifecycle on public.orders;
create constraint trigger enforce_new_stlolab_order_access_lifecycle
after insert on public.orders deferrable initially deferred
for each row execute function private.enforce_new_stlolab_order_access_lifecycle();

create or replace function trry_api.get_stlolab_order_confirmation_sw3(
  p_order_id uuid,
  p_confirmation_token_hash text
)
returns jsonb language sql stable security invoker set search_path = ''
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
    and (
      o.confirmation_access_version is null
      or (
        o.confirmation_access_version = 1
        and o.confirmation_token_revoked_at is null
        and o.confirmation_token_expires_at > clock_timestamp()
      )
    )
$$;

create or replace function trry_api.create_stlolab_order_sw3(
  p_environment text, p_idempotency_key text, p_payload_hash text, p_confirmation_token_hash text,
  p_customer jsonb, p_fulfillment jsonb, p_lines jsonb, p_confirmation_token_expires_at timestamptz
)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_result jsonb;
  v_order_id uuid;
  v_issued_at timestamptz;
  v_expires_at timestamptz;
begin
  if p_confirmation_token_expires_at is null or p_confirmation_token_expires_at <= clock_timestamp() then
    raise exception 'confirmation access expiry must be in the future' using errcode = '22023';
  end if;

  v_result := trry_api.create_stlolab_order_sw3(
    p_environment, p_idempotency_key, p_payload_hash, p_confirmation_token_hash,
    p_customer, p_fulfillment, p_lines
  );
  if v_result is null then
    raise exception 'confirmation access could not be established' using errcode = '22023';
  end if;

  v_order_id := (v_result->>'orderId')::uuid;
  update public.orders
  set confirmation_access_version = 1,
      confirmation_token_issued_at = coalesce(confirmation_token_issued_at, clock_timestamp()),
      confirmation_token_expires_at = coalesce(confirmation_token_expires_at, p_confirmation_token_expires_at),
      updated_at = now()
  where id = v_order_id
    and source_type = 'STLOLAB_RETAIL'
    and confirmation_token_hash = p_confirmation_token_hash
  returning confirmation_token_issued_at, confirmation_token_expires_at
  into v_issued_at, v_expires_at;

  if not found or v_expires_at <= v_issued_at then
    raise exception 'confirmation access could not be established' using errcode = '23514';
  end if;

  return trry_api.get_stlolab_order_confirmation_sw3(v_order_id, p_confirmation_token_hash)
    || jsonb_build_object('accessExpiresAt', v_expires_at);
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
  if v_order.confirmation_access_version = 1 and (
    v_order.confirmation_token_revoked_at is not null
    or v_order.confirmation_token_expires_at <= clock_timestamp()
  ) then return null; end if;
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

revoke all on function private.enforce_new_stlolab_order_access_lifecycle() from public, anon, authenticated;
revoke all on function trry_api.create_stlolab_order_sw3(text,text,text,text,jsonb,jsonb,jsonb,timestamptz) from public, anon, authenticated;
revoke all on function trry_api.get_stlolab_order_confirmation_sw3(uuid,text) from public, anon, authenticated;
revoke all on function trry_api.cancel_stlolab_order_sw3(uuid,text,text,text) from public, anon, authenticated;
grant execute on function trry_api.create_stlolab_order_sw3(text,text,text,text,jsonb,jsonb,jsonb,timestamptz) to service_role;
grant execute on function trry_api.get_stlolab_order_confirmation_sw3(uuid,text) to service_role;
grant execute on function trry_api.cancel_stlolab_order_sw3(uuid,text,text,text) to service_role;

comment on column public.orders.confirmation_access_version is 'Null preserves legacy confirmation access unchanged; version 1 requires an unexpired, unrevoked durable token.';
comment on column public.orders.confirmation_token_expires_at is 'Absolute expiry for durable same-browser confirmation access. Lifetime is configured by the storefront server.';
