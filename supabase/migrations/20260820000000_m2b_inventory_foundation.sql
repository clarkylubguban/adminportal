create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
create schema if not exists trry_api;

revoke all on schema private from public;
grant usage on schema trry_api to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public;

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  branch_code text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint branches_code_not_blank check (btrim(branch_code) <> ''),
  constraint branches_name_not_blank check (btrim(name) <> '')
);

create table if not exists public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  location_code text not null,
  name text not null,
  location_type text not null default 'RETAIL',
  active boolean not null default true,
  is_default_retail boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_locations_type_check check (location_type in ('RETAIL', 'STOCKROOM', 'PRODUCTION', 'OTHER')),
  constraint inventory_locations_code_not_blank check (btrim(location_code) <> ''),
  constraint inventory_locations_name_not_blank check (btrim(name) <> ''),
  constraint inventory_locations_branch_code_unique unique (branch_id, location_code)
);

create table if not exists public.inventory_balances (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.inventory_locations(id) on delete restrict,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  quantity_on_hand integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint inventory_balances_quantity_nonnegative check (quantity_on_hand >= 0),
  constraint inventory_balances_location_variant_unique unique (location_id, variant_id)
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.inventory_locations(id) on delete restrict,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  movement_type text not null,
  quantity_delta integer not null,
  balance_before integer not null,
  balance_after integer not null,
  source_type text,
  source_id uuid,
  source_reference text,
  reason text,
  actor_user_id uuid not null default auth.uid(),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint stock_movements_type_check check (movement_type in ('RECEIPT', 'SALE', 'SALE_VOID', 'RETURN', 'ADJUSTMENT')),
  constraint stock_movements_delta_nonzero check (quantity_delta <> 0),
  constraint stock_movements_balances_nonnegative check (balance_before >= 0 and balance_after >= 0),
  constraint stock_movements_idempotency_unique unique (idempotency_key)
);

create unique index if not exists inventory_locations_default_retail_unique
  on public.inventory_locations (branch_id)
  where is_default_retail;

create index if not exists inventory_locations_branch_id_idx on public.inventory_locations (branch_id);
create index if not exists inventory_balances_variant_id_idx on public.inventory_balances (variant_id);
create index if not exists stock_movements_variant_created_idx on public.stock_movements (variant_id, created_at desc);
create index if not exists stock_movements_location_created_idx on public.stock_movements (location_id, created_at desc);
create index if not exists stock_movements_source_idx on public.stock_movements (source_type, source_id);

drop trigger if exists set_branches_updated_at on public.branches;
create trigger set_branches_updated_at before update on public.branches for each row execute function public.set_updated_at();

drop trigger if exists set_inventory_locations_updated_at on public.inventory_locations;
create trigger set_inventory_locations_updated_at before update on public.inventory_locations for each row execute function public.set_updated_at();

drop trigger if exists set_inventory_balances_updated_at on public.inventory_balances;
create trigger set_inventory_balances_updated_at before update on public.inventory_balances for each row execute function public.set_updated_at();

create or replace function private.prevent_stock_movement_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'stock_movements is immutable; write a reversal movement instead';
end;
$$;

drop trigger if exists prevent_stock_movement_update on public.stock_movements;
create trigger prevent_stock_movement_update before update on public.stock_movements for each row execute function private.prevent_stock_movement_mutation();

drop trigger if exists prevent_stock_movement_delete on public.stock_movements;
create trigger prevent_stock_movement_delete before delete on public.stock_movements for each row execute function private.prevent_stock_movement_mutation();

create or replace function private.m2b_current_admin_user()
returns public.admin_users
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select au.*
  from public.admin_users au
  where au.user_id = auth.uid()
    and au.is_active = true
  limit 1
$$;

create or replace function private.m2b_require_owner_admin()
returns public.admin_users
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  admin_user public.admin_users;
begin
  select * into admin_user from private.m2b_current_admin_user();

  if admin_user.id is null then
    raise exception 'Active Admin Portal Owner/Admin identity is required'
      using errcode = '42501';
  end if;

  if lower(admin_user.role::text) not in ('owner', 'admin') then
    raise exception 'Admin Portal Owner/Admin role is required'
      using errcode = '42501';
  end if;

  return admin_user;
end;
$$;

create or replace function private.m2b_is_owner_admin()
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select exists (
    select 1
    from public.admin_users au
    where au.user_id = auth.uid()
      and au.is_active = true
      and lower(au.role::text) in ('owner', 'admin')
  )
$$;

create or replace function private.m2b_variant_is_inventory_eligible(
  p_variant_id uuid,
  p_require_sellable boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select exists (
    select 1
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    join public.brands br on br.id = p.brand_id
    join public.product_categories pc on pc.id = p.category_id
    where pv.id = p_variant_id
      and pv.active is not false
      and pv.archived_at is null
      and btrim(pv.sku) <> ''
      and pv.selling_price >= 0
      and p.active is not false
      and p.sellable is true
      and p.archived_at is null
      and p.readiness_status = 'READY_FOR_SALE'
      and p.product_type = 'PHYSICAL'
      and lower(br.status::text) = 'active'
      and pc.active is true
      and pc.archived_at is null
      and (p_require_sellable is false or p.sellable is true)
  )
$$;

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

  if p_quantity_delta = 0 then
    raise exception 'Stock movement quantity_delta must not be zero' using errcode = '22023';
  end if;

  if btrim(coalesce(p_idempotency_key, '')) = '' then
    raise exception 'Stock movement idempotency_key is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 26082026));

  select * into existing_movement
  from public.stock_movements
  where idempotency_key = p_idempotency_key;

  if existing_movement.id is not null then
    return jsonb_build_object(
      'movementId', existing_movement.id,
      'idempotent', true,
      'balanceAfter', existing_movement.balance_after
    );
  end if;

  if not exists (
    select 1
    from public.inventory_locations il
    join public.branches branch on branch.id = il.branch_id
    where il.id = p_location_id
      and il.active is true
      and branch.active is true
  ) then
    raise exception 'Active stock location is required' using errcode = '22023';
  end if;

  if not private.m2b_variant_is_inventory_eligible(p_variant_id, p_movement_type = 'SALE') then
    raise exception 'Active canonical product variant is required' using errcode = '22023';
  end if;

  insert into public.inventory_balances (location_id, variant_id, quantity_on_hand)
  values (p_location_id, p_variant_id, 0)
  on conflict (location_id, variant_id) do nothing;

  select * into balance_row
  from public.inventory_balances
  where location_id = p_location_id
    and variant_id = p_variant_id
  for update;

  next_balance := balance_row.quantity_on_hand + p_quantity_delta;
  if next_balance < 0 then
    raise exception 'Insufficient stock for canonical variant % at location %', p_variant_id, p_location_id
      using errcode = '22003';
  end if;

  update public.inventory_balances
  set quantity_on_hand = next_balance,
      updated_at = now()
  where id = balance_row.id;

  insert into public.stock_movements (
    location_id,
    variant_id,
    movement_type,
    quantity_delta,
    balance_before,
    balance_after,
    source_type,
    source_id,
    source_reference,
    reason,
    actor_user_id,
    idempotency_key
  )
  values (
    p_location_id,
    p_variant_id,
    p_movement_type,
    p_quantity_delta,
    balance_row.quantity_on_hand,
    next_balance,
    p_source_type,
    p_source_id,
    p_source_reference,
    p_reason,
    auth.uid(),
    p_idempotency_key
  )
  returning * into existing_movement;

  return jsonb_build_object(
    'movementId', existing_movement.id,
    'idempotent', false,
    'balanceAfter', existing_movement.balance_after
  );
end;
$$;

create or replace function trry_api.receive_inventory(
  p_location_id uuid,
  p_variant_id uuid,
  p_quantity integer,
  p_idempotency_key text,
  p_source_reference text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, trry_api, pg_temp
as $$
begin
  if p_quantity <= 0 then
    raise exception 'Receiving quantity must be positive' using errcode = '22023';
  end if;

  return private.m2b_apply_stock_movement(
    p_location_id,
    p_variant_id,
    'RECEIPT',
    p_quantity,
    'RECEIVING',
    null,
    p_source_reference,
    p_idempotency_key,
    p_reason
  );
end;
$$;

create or replace function trry_api.adjust_inventory(
  p_location_id uuid,
  p_variant_id uuid,
  p_quantity_delta integer,
  p_reason text,
  p_idempotency_key text,
  p_source_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, trry_api, pg_temp
as $$
begin
  if p_quantity_delta = 0 then
    raise exception 'Adjustment quantity_delta must not be zero' using errcode = '22023';
  end if;

  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Adjustment reason is required' using errcode = '22023';
  end if;

  return private.m2b_apply_stock_movement(
    p_location_id,
    p_variant_id,
    'ADJUSTMENT',
    p_quantity_delta,
    'ADJUSTMENT',
    null,
    p_source_reference,
    p_idempotency_key,
    p_reason
  );
end;
$$;

create or replace function private.m2b_record_sale_stock_movement(
  p_location_id uuid,
  p_variant_id uuid,
  p_quantity integer,
  p_sale_id uuid,
  p_sale_reference text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if p_quantity <= 0 then
    raise exception 'Sale quantity must be positive' using errcode = '22023';
  end if;

  return private.m2b_apply_stock_movement(
    p_location_id,
    p_variant_id,
    'SALE',
    -p_quantity,
    'SALE',
    p_sale_id,
    p_sale_reference,
    p_idempotency_key,
    null
  );
end;
$$;

create or replace function private.m2b_record_sale_void_stock_movement(
  p_location_id uuid,
  p_variant_id uuid,
  p_quantity integer,
  p_void_id uuid,
  p_void_reference text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if p_quantity <= 0 then
    raise exception 'Sale void quantity must be positive' using errcode = '22023';
  end if;

  return private.m2b_apply_stock_movement(
    p_location_id,
    p_variant_id,
    'SALE_VOID',
    p_quantity,
    'SALE_VOID',
    p_void_id,
    p_void_reference,
    p_idempotency_key,
    'Sale void reversal'
  );
end;
$$;

create or replace function private.m2b_record_return_stock_movement(
  p_location_id uuid,
  p_variant_id uuid,
  p_quantity integer,
  p_return_id uuid,
  p_return_reference text,
  p_idempotency_key text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if p_quantity <= 0 then
    raise exception 'Return quantity must be positive' using errcode = '22023';
  end if;

  return private.m2b_apply_stock_movement(
    p_location_id,
    p_variant_id,
    'RETURN',
    p_quantity,
    'RETURN',
    p_return_id,
    p_return_reference,
    p_idempotency_key,
    p_reason
  );
end;
$$;

create or replace view public.v_inventory_sellable
with (security_invoker = true)
as
select
  branch.id as branch_id,
  il.id as location_id,
  il.location_code,
  il.name as location_name,
  p.id as product_id,
  p.name as product_name,
  pv.id as variant_id,
  pv.sku,
  pv.size,
  pv.color,
  pv.selling_price,
  ib.quantity_on_hand,
  0::integer as reserved_quantity,
  ib.quantity_on_hand as sellable_quantity,
  ib.updated_at
from public.inventory_balances ib
join public.inventory_locations il on il.id = ib.location_id
join public.branches branch on branch.id = il.branch_id
join public.product_variants pv on pv.id = ib.variant_id
join public.products p on p.id = pv.product_id
join public.brands br on br.id = p.brand_id
join public.product_categories pc on pc.id = p.category_id
where il.active is true
  and branch.active is true
  and pv.active is not false
  and pv.archived_at is null
  and btrim(pv.sku) <> ''
  and pv.selling_price >= 0
  and p.active is not false
  and p.sellable is true
  and p.archived_at is null
  and p.readiness_status = 'READY_FOR_SALE'
  and p.product_type = 'PHYSICAL'
  and lower(br.status::text) = 'active'
  and pc.active is true
  and pc.archived_at is null;

alter table public.branches enable row level security;
alter table public.inventory_locations enable row level security;
alter table public.inventory_balances enable row level security;
alter table public.stock_movements enable row level security;

alter table public.branches force row level security;
alter table public.inventory_locations force row level security;
alter table public.inventory_balances force row level security;
alter table public.stock_movements force row level security;

drop policy if exists branches_m2b_owner_admin_select on public.branches;
create policy branches_m2b_owner_admin_select on public.branches
  for select to authenticated
  using (private.m2b_is_owner_admin());

drop policy if exists inventory_locations_m2b_owner_admin_select on public.inventory_locations;
create policy inventory_locations_m2b_owner_admin_select on public.inventory_locations
  for select to authenticated
  using (private.m2b_is_owner_admin());

drop policy if exists inventory_balances_m2b_owner_admin_select on public.inventory_balances;
create policy inventory_balances_m2b_owner_admin_select on public.inventory_balances
  for select to authenticated
  using (private.m2b_is_owner_admin());

drop policy if exists stock_movements_m2b_owner_admin_select on public.stock_movements;
create policy stock_movements_m2b_owner_admin_select on public.stock_movements
  for select to authenticated
  using (private.m2b_is_owner_admin());

revoke all on public.branches, public.inventory_locations, public.inventory_balances, public.stock_movements from anon, authenticated;
grant select on public.branches, public.inventory_locations, public.inventory_balances, public.stock_movements, public.v_inventory_sellable to authenticated;

revoke all on function private.prevent_stock_movement_mutation() from public;
revoke all on function private.m2b_current_admin_user() from public;
revoke all on function private.m2b_require_owner_admin() from public;
revoke all on function private.m2b_is_owner_admin() from public;
revoke all on function private.m2b_variant_is_inventory_eligible(uuid, boolean) from public;
revoke all on function private.m2b_apply_stock_movement(uuid, uuid, text, integer, text, uuid, text, text, text) from public;
revoke all on function private.m2b_record_sale_stock_movement(uuid, uuid, integer, uuid, text, text) from public;
revoke all on function private.m2b_record_sale_void_stock_movement(uuid, uuid, integer, uuid, text, text) from public;
revoke all on function private.m2b_record_return_stock_movement(uuid, uuid, integer, uuid, text, text, text) from public;

revoke all on function trry_api.receive_inventory(uuid, uuid, integer, text, text, text) from public;
revoke all on function trry_api.adjust_inventory(uuid, uuid, integer, text, text, text) from public;
grant execute on function trry_api.receive_inventory(uuid, uuid, integer, text, text, text) to authenticated;
grant execute on function trry_api.adjust_inventory(uuid, uuid, integer, text, text, text) to authenticated;
