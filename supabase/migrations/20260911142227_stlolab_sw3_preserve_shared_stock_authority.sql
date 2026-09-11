-- Preserve the live staging M3/M4/E7 movement authorization branches while
-- leaving the SW3 reservation floor as the final shared stock invariant.
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
  authorized boolean := false;
begin
  if p_movement_type = 'SALE' then
    authorized := private.m2b_is_owner_admin();
    if authorized is not true and to_regprocedure('private.m3b_is_active_pos_staff()') is not null then
      execute 'select private.m3b_is_active_pos_staff()' into authorized;
    end if;
    if authorized is not true then
      raise exception 'Active Admin Portal Owner/Admin or POS staff identity is required' using errcode = '42501';
    end if;
  elsif p_movement_type in ('SALE_VOID', 'RETURN')
    and to_regprocedure('private.m4_require_pos_staff()') is not null then
    begin
      execute 'select (private.m4_require_pos_staff()).role in (''OWNER'', ''ADMIN'')' into authorized;
    exception when others then
      authorized := false;
    end;
    if authorized is not true then
      raise exception 'Owner or Admin role is required for reversal stock movements' using errcode = '42501';
    end if;
  elsif p_movement_type = 'RECEIPT'
    and to_regprocedure('public.has_admin_action_permission(text)') is not null
    and to_regprocedure('public.has_admin_temporary_module_access(text)') is not null then
    execute $check$
      select public.is_active_admin_user(array['owner','admin'])
        or public.has_admin_action_permission('receive_inventory')
        or public.has_admin_temporary_module_access('inventory')
    $check$ into authorized;
    if authorized is not true then
      raise exception 'Inventory receiving permission is required' using errcode = '42501';
    end if;
  else
    perform private.m2b_require_owner_admin();
  end if;

  if p_movement_type not in ('RECEIPT', 'SALE', 'SALE_VOID', 'RETURN', 'ADJUSTMENT') then
    raise exception 'Unsupported stock movement type: %', p_movement_type using errcode = '22023';
  end if;
  if p_quantity_delta = 0 then
    raise exception 'Stock movement quantity_delta must not be zero' using errcode = '22023';
  end if;
  if btrim(coalesce(p_idempotency_key, '')) = '' then
    raise exception 'Stock movement idempotency_key is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 26082026));
  select * into existing_movement from public.stock_movements where idempotency_key = p_idempotency_key;
  if existing_movement.id is not null then
    return jsonb_build_object('movementId', existing_movement.id, 'idempotent', true, 'balanceAfter', existing_movement.balance_after);
  end if;

  if not exists (
    select 1 from public.inventory_locations il join public.branches branch on branch.id = il.branch_id
    where il.id = p_location_id and il.active is true and branch.active is true
  ) then
    raise exception 'Active stock location is required' using errcode = '22023';
  end if;
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

revoke all on function private.m2b_apply_stock_movement(uuid,uuid,text,integer,text,uuid,text,text,text)
  from public, anon, authenticated;

comment on function private.m2b_apply_stock_movement(uuid,uuid,text,integer,text,uuid,text,text,text) is
  'Canonical shared stock movement authority preserving staging POS/M4/E7 permissions and the SW3 reservation floor.';
