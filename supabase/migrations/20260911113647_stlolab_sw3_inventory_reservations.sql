-- STLOLAB SW3 owner decisions: Main Retail Stock, reserve on submit,
-- release on cancellation. Expiry, payment failure, fulfillment deduction,
-- and returns remain deliberately outside this migration.

alter table public.inventory_balances
  add column if not exists reserved_quantity integer not null default 0;

alter table public.inventory_balances drop constraint if exists inventory_balances_reserved_nonnegative;
alter table public.inventory_balances add constraint inventory_balances_reserved_nonnegative
  check (reserved_quantity >= 0);
alter table public.inventory_balances drop constraint if exists inventory_balances_reserved_not_above_on_hand;
alter table public.inventory_balances add constraint inventory_balances_reserved_not_above_on_hand
  check (reserved_quantity <= quantity_on_hand);

create table if not exists public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.inventory_locations(id) on delete restrict,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  quantity integer not null,
  status text not null default 'ACTIVE',
  idempotency_key text not null,
  released_at timestamptz,
  release_idempotency_key text,
  created_at timestamptz not null default now(),
  constraint inventory_reservations_quantity_positive check (quantity > 0),
  constraint inventory_reservations_status_check check (status in ('ACTIVE', 'RELEASED')),
  constraint inventory_reservations_release_shape check (
    (status = 'ACTIVE' and released_at is null and release_idempotency_key is null)
    or (status = 'RELEASED' and released_at is not null and btrim(coalesce(release_idempotency_key, '')) <> '')
  ),
  constraint inventory_reservations_order_item_unique unique (order_item_id),
  constraint inventory_reservations_idempotency_unique unique (idempotency_key)
);

create index if not exists inventory_reservations_active_balance_idx
  on public.inventory_reservations(location_id, variant_id) where status = 'ACTIVE';
create index if not exists inventory_reservations_order_idx
  on public.inventory_reservations(order_id);

alter table public.inventory_reservations enable row level security;
revoke all on table public.inventory_reservations from public, anon, authenticated;
grant all on table public.inventory_reservations to service_role;

alter table public.orders
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text,
  add column if not exists cancellation_idempotency_key text;

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('awaiting_payment', 'paid', 'ready_to_release', 'released', 'completed', 'cancelled'));
alter table public.orders drop constraint if exists orders_cancellation_shape_check;
alter table public.orders add constraint orders_cancellation_shape_check check (
  (status <> 'cancelled' and cancelled_at is null and cancellation_idempotency_key is null)
  or (status = 'cancelled' and cancelled_at is not null and btrim(coalesce(cancellation_idempotency_key, '')) <> '')
);
create unique index if not exists orders_stlolab_cancellation_idempotency_unique
  on public.orders(cancellation_idempotency_key) where cancellation_idempotency_key is not null;

alter table public.stlolab_checkout_config drop constraint if exists stlolab_checkout_inventory_policy_check;
alter table public.stlolab_checkout_config add constraint stlolab_checkout_inventory_policy_check
  check (inventory_policy in ('UNCONFIRMED', 'RESERVE_ON_SUBMIT'));

create or replace function private.stlolab_reserve_order_item_sw3()
returns trigger
language plpgsql
security invoker
set search_path = ''
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
  where location_id = v_config.inventory_location_id and variant_id = new.variant_id
  for update;
  if not found or v_balance.quantity_on_hand - v_balance.reserved_quantity < new.quantity then
    raise exception 'variant is unavailable after active reservations' using errcode = '22003';
  end if;

  update public.inventory_balances
  set reserved_quantity = reserved_quantity + new.quantity, updated_at = now()
  where id = v_balance.id;

  insert into public.inventory_reservations(
    location_id, variant_id, order_id, order_item_id, quantity, idempotency_key
  ) values (
    v_config.inventory_location_id, new.variant_id, new.order_id, new.id, new.quantity,
    'STLOLAB-RESERVE:' || new.order_id::text || ':' || new.variant_id::text
  );
  return new;
end;
$$;

drop trigger if exists reserve_stlolab_order_item_sw3 on public.order_items;
create trigger reserve_stlolab_order_item_sw3
after insert on public.order_items
for each row execute function private.stlolab_reserve_order_item_sw3();

create or replace function private.m2b_apply_stock_movement(
  p_location_id uuid,
  p_variant_id uuid,
  p_movement_type text,
  p_quantity_delta integer,
  p_source_type text,
  p_source_id uuid,
  p_source_reference text,
  p_idempotency_key text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  admin_user public.admin_users;
  balance_row public.inventory_balances;
  existing_movement public.stock_movements;
  next_balance integer;
begin
  admin_user := private.m2b_require_owner_admin();
  if p_movement_type not in ('RECEIPT', 'SALE', 'SALE_VOID', 'RETURN', 'ADJUSTMENT') then
    raise exception 'Unsupported stock movement type: %', p_movement_type using errcode = '22023';
  end if;
  if p_quantity_delta = 0 then raise exception 'Stock movement quantity_delta must not be zero' using errcode = '22023'; end if;
  if btrim(coalesce(p_idempotency_key, '')) = '' then raise exception 'Stock movement idempotency_key is required' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 26082026));
  select * into existing_movement from public.stock_movements where idempotency_key = p_idempotency_key;
  if existing_movement.id is not null then
    return jsonb_build_object('movementId', existing_movement.id, 'idempotent', true, 'balanceAfter', existing_movement.balance_after);
  end if;

  if not exists (
    select 1 from public.inventory_locations il join public.branches branch on branch.id = il.branch_id
    where il.id = p_location_id and il.active is true and branch.active is true
  ) then raise exception 'Active stock location is required' using errcode = '22023'; end if;
  if not private.m2b_variant_is_inventory_eligible(p_variant_id, p_movement_type = 'SALE') then
    raise exception 'Active canonical product variant is required' using errcode = '22023';
  end if;

  insert into public.inventory_balances(location_id, variant_id, quantity_on_hand)
  values (p_location_id, p_variant_id, 0) on conflict (location_id, variant_id) do nothing;
  select * into balance_row from public.inventory_balances
  where location_id = p_location_id and variant_id = p_variant_id for update;
  next_balance := balance_row.quantity_on_hand + p_quantity_delta;
  if next_balance < 0 then
    raise exception 'Insufficient stock for canonical variant % at location %', p_variant_id, p_location_id using errcode = '22003';
  end if;
  if next_balance < balance_row.reserved_quantity then
    raise exception 'Stock movement would consume reserved inventory for canonical variant % at location %', p_variant_id, p_location_id using errcode = '22003';
  end if;

  update public.inventory_balances set quantity_on_hand = next_balance, updated_at = now() where id = balance_row.id;
  insert into public.stock_movements(
    location_id, variant_id, movement_type, quantity_delta, balance_before, balance_after,
    source_type, source_id, source_reference, reason, actor_user_id, idempotency_key
  ) values (
    p_location_id, p_variant_id, p_movement_type, p_quantity_delta, balance_row.quantity_on_hand,
    next_balance, p_source_type, p_source_id, p_source_reference, p_reason, auth.uid(), p_idempotency_key
  ) returning * into existing_movement;
  return jsonb_build_object('movementId', existing_movement.id, 'idempotent', false, 'balanceAfter', existing_movement.balance_after);
end;
$$;

create or replace view public.v_inventory_sellable
with (security_invoker = true)
as
select
  branch.id as branch_id, il.id as location_id, il.location_code, il.name as location_name,
  p.id as product_id, p.name as product_name, pv.id as variant_id, pv.sku, pv.size, pv.color,
  pv.selling_price, ib.quantity_on_hand, ib.reserved_quantity,
  ib.quantity_on_hand - ib.reserved_quantity as sellable_quantity, ib.updated_at
from public.inventory_balances ib
join public.inventory_locations il on il.id = ib.location_id
join public.branches branch on branch.id = il.branch_id
join public.product_variants pv on pv.id = ib.variant_id
join public.products p on p.id = pv.product_id
join public.brands br on br.id = p.brand_id
join public.product_categories pc on pc.id = p.category_id
where il.active is true and branch.active is true
  and pv.active is true and pv.archived_at is null
  and p.active is true and p.archived_at is null and p.sellable is true
  and p.readiness_status = 'READY_FOR_SALE' and p.product_type = 'PHYSICAL'
  and lower(br.status::text) = 'active' and pc.active is true and pc.archived_at is null;

create or replace function private.protect_stlolab_cancellation_release_sw3()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.source_type = 'STLOLAB_RETAIL' and new.status = 'cancelled' and old.status <> 'cancelled'
     and exists (select 1 from public.inventory_reservations where order_id = old.id and status = 'ACTIVE') then
    raise exception 'active inventory reservations must be released before cancellation' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_stlolab_cancellation_release_sw3 on public.orders;
create trigger protect_stlolab_cancellation_release_sw3
before update of status on public.orders
for each row execute function private.protect_stlolab_cancellation_release_sw3();

create or replace function trry_api.cancel_stlolab_order_sw3(
  p_order_id uuid,
  p_confirmation_token_hash text,
  p_idempotency_key text,
  p_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_reservation public.inventory_reservations%rowtype;
begin
  if p_idempotency_key !~ '^[A-Za-z0-9_-]{16,120}$' then
    raise exception 'invalid cancellation idempotency key' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('STLOLAB-CANCEL:' || p_order_id::text, 11092026));
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.source_type <> 'STLOLAB_RETAIL'
     or v_order.confirmation_token_hash <> p_confirmation_token_hash then
    return null;
  end if;
  if v_order.status = 'cancelled' then
    return trry_api.get_stlolab_order_confirmation_sw3(v_order.id, p_confirmation_token_hash);
  end if;
  if v_order.status <> 'awaiting_payment' then
    raise exception 'order cannot be cancelled in its current state' using errcode = '55000';
  end if;

  for v_reservation in
    select * from public.inventory_reservations where order_id = v_order.id and status = 'ACTIVE' for update
  loop
    perform 1 from public.inventory_balances where location_id = v_reservation.location_id
      and variant_id = v_reservation.variant_id for update;
    update public.inventory_balances
    set reserved_quantity = reserved_quantity - v_reservation.quantity, updated_at = now()
    where location_id = v_reservation.location_id and variant_id = v_reservation.variant_id
      and reserved_quantity >= v_reservation.quantity;
    if not found then raise exception 'reservation balance is inconsistent' using errcode = '23514'; end if;
    update public.inventory_reservations set status = 'RELEASED', released_at = now(),
      release_idempotency_key = p_idempotency_key where id = v_reservation.id and status = 'ACTIVE';
  end loop;

  update public.orders set status = 'cancelled', cancelled_at = now(),
    cancellation_reason = nullif(btrim(coalesce(p_reason, '')), ''),
    cancellation_idempotency_key = p_idempotency_key, updated_at = now()
  where id = v_order.id;
  return trry_api.get_stlolab_order_confirmation_sw3(v_order.id, p_confirmation_token_hash);
end;
$$;

revoke all on function private.stlolab_reserve_order_item_sw3() from public, anon, authenticated;
revoke all on function private.protect_stlolab_cancellation_release_sw3() from public, anon, authenticated;
revoke all on function trry_api.cancel_stlolab_order_sw3(uuid,text,text,text) from public, anon, authenticated;
grant execute on function trry_api.cancel_stlolab_order_sw3(uuid,text,text,text) to service_role;

comment on table public.inventory_reservations is 'Active STLOLAB order commitments. No expiry or fulfillment consumption policy is implied.';
