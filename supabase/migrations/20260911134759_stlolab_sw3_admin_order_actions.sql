-- This definition must remain after POS M3B and the SW3 reservation migration.
-- It preserves both applications' existing actor checks while enforcing the
-- reservation floor for every shared SALE movement.
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
  balance_row public.inventory_balances;
  existing_movement public.stock_movements;
  next_balance integer;
  pos_authorized boolean := false;
begin
  if p_movement_type = 'SALE' then
    if not private.m2b_is_owner_admin()
      and to_regprocedure('private.m3b_is_active_pos_staff()') is not null then
      execute 'select private.m3b_is_active_pos_staff()' into pos_authorized;
    end if;
    if not private.m2b_is_owner_admin() and not pos_authorized then
      raise exception 'Active Admin Portal Owner/Admin or POS staff identity is required' using errcode = '42501';
    end if;
  else
    perform private.m2b_require_owner_admin();
  end if;

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

revoke all on function private.m2b_apply_stock_movement(uuid,uuid,text,integer,text,uuid,text,text,text) from public, anon, authenticated;

create table if not exists public.order_payment_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  event_type text not null,
  previous_state text not null,
  next_state text not null,
  payment_method text not null,
  amount numeric(14, 2) not null,
  payment_reference text not null,
  internal_note text,
  actor_user_id uuid not null references public.admin_users(user_id) on delete restrict,
  actor_role text not null,
  source text not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  constraint order_payment_events_type_check check (event_type = 'PAYMENT_CONFIRMED'),
  constraint order_payment_events_state_check check (previous_state = 'UNPAID' and next_state = 'PAID'),
  constraint order_payment_events_method_check check (payment_method in ('cash', 'gcash', 'bank_transfer', 'card', 'other')),
  constraint order_payment_events_amount_check check (amount > 0 and amount = round(amount, 2)),
  constraint order_payment_events_reference_check check (btrim(payment_reference) <> '' and char_length(payment_reference) <= 120),
  constraint order_payment_events_note_check check (internal_note is null or char_length(internal_note) <= 500),
  constraint order_payment_events_actor_role_check check (actor_role in ('owner', 'admin')),
  constraint order_payment_events_source_check check (source = 'ADMIN_PORTAL'),
  constraint order_payment_events_idempotency_check check (
    char_length(idempotency_key) between 16 and 120
    and idempotency_key ~ '^[A-Za-z0-9_-]+$'
  )
);

create index if not exists order_payment_events_order_created_idx
  on public.order_payment_events(order_id, created_at desc);

alter table public.order_payment_events enable row level security;
revoke all on table public.order_payment_events from public, anon, authenticated;
grant select on table public.order_payment_events to authenticated;

drop policy if exists order_payment_events_admin_read on public.order_payment_events;
create policy order_payment_events_admin_read on public.order_payment_events
  for select to authenticated
  using (public.is_active_admin_user(array['owner', 'admin']));

create or replace function private.prevent_order_payment_event_changes_sw3()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  raise exception 'order payment events are append-only' using errcode = '42501';
end;
$$;

drop trigger if exists order_payment_events_append_only on public.order_payment_events;
create trigger order_payment_events_append_only
before update or delete on public.order_payment_events
for each row execute function private.prevent_order_payment_event_changes_sw3();

create or replace function trry_api.confirm_stlolab_order_payment_sw3(
  p_order_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_payment_reference text,
  p_internal_note text,
  p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_admin public.admin_users%rowtype;
  v_order public.orders%rowtype;
  v_existing public.order_payment_events%rowtype;
  v_method text := lower(btrim(coalesce(p_payment_method, '')));
  v_reference text := btrim(coalesce(p_payment_reference, ''));
  v_note text := nullif(btrim(coalesce(p_internal_note, '')), '');
  v_transition jsonb;
begin
  v_admin := private.m2b_require_owner_admin();
  if v_method not in ('cash', 'gcash', 'bank_transfer', 'card', 'other') then
    raise exception 'valid payment method is required' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'valid payment amount is required' using errcode = '22023';
  end if;
  if v_reference = '' or char_length(v_reference) > 120 then
    raise exception 'durable payment reference is required' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'payment note is too long' using errcode = '22023';
  end if;
  if p_idempotency_key !~ '^[A-Za-z0-9_-]{16,120}$' then
    raise exception 'valid idempotency key is required' using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.source_type <> 'STLOLAB_RETAIL' then
    raise exception 'STLOLAB order not found' using errcode = 'P0002';
  end if;

  select * into v_existing from public.order_payment_events
  where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.order_id = v_order.id
      and v_existing.amount = p_amount
      and v_existing.payment_method = v_method
      and v_existing.payment_reference = v_reference then
      return jsonb_build_object(
        'orderId', v_order.id, 'paymentState', v_order.payment_state,
        'fulfillmentState', v_order.fulfillment_state, 'paymentReference', v_order.payment_reference,
        'paidAt', v_order.paid_at, 'idempotent', true
      );
    end if;
    raise exception 'payment idempotency replay conflicts with saved confirmation' using errcode = '23505';
  end if;

  if p_amount <> v_order.total_amount then
    raise exception 'full canonical order amount is required' using errcode = '22023';
  end if;
  if v_order.payment_state = 'PAID' then
    raise exception 'payment is already confirmed' using errcode = '23505';
  end if;

  v_transition := trry_api.mark_stlolab_order_paid_sw3(v_order.id, v_reference, p_idempotency_key);

  insert into public.order_payment_events(
    order_id, event_type, previous_state, next_state, payment_method, amount,
    payment_reference, internal_note, actor_user_id, actor_role, source, idempotency_key
  ) values (
    v_order.id, 'PAYMENT_CONFIRMED', 'UNPAID', 'PAID', v_method, p_amount,
    v_reference, v_note, v_admin.user_id, lower(v_admin.role::text), 'ADMIN_PORTAL', p_idempotency_key
  );

  return v_transition || jsonb_build_object(
    'paymentReference', v_reference,
    'paidAt', (select paid_at from public.orders where id = v_order.id),
    'paymentMethod', v_method,
    'amount', p_amount
  );
end;
$$;

revoke all on function private.prevent_order_payment_event_changes_sw3() from public, anon, authenticated;
revoke all on function trry_api.mark_stlolab_order_paid_sw3(uuid,text,text) from public, anon, authenticated;
revoke all on function trry_api.confirm_stlolab_order_payment_sw3(uuid,numeric,text,text,text,text) from public, anon, authenticated;
grant usage on schema trry_api to authenticated;
grant execute on function trry_api.confirm_stlolab_order_payment_sw3(uuid,numeric,text,text,text,text) to authenticated;

comment on table public.order_payment_events is 'Append-only canonical payment confirmations for native Orders; browser-provided state is never authoritative.';
comment on function trry_api.confirm_stlolab_order_payment_sw3(uuid,numeric,text,text,text,text) is 'Validates and records canonical Admin payment evidence before invoking the protected STLOLAB paid-state transition atomically.';
