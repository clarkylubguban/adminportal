-- Customer Ecosystem C2.1 - customer identity linking contract.
-- Adds nullable customer links to Inquiries and Orders without historical backfill.
-- Existing name/contact snapshots remain the transaction snapshots.

alter table public.ops_inquiries
  add column if not exists customer_id uuid;

alter table public.orders
  add column if not exists customer_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ops_inquiries'::regclass
      and conname = 'ops_inquiries_customer_id_fkey'
  ) then
    alter table public.ops_inquiries
      add constraint ops_inquiries_customer_id_fkey
      foreign key (customer_id)
      references public.customers(id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_customer_id_fkey'
  ) then
    alter table public.orders
      add constraint orders_customer_id_fkey
      foreign key (customer_id)
      references public.customers(id)
      on delete restrict;
  end if;
end;
$$;

create index if not exists ops_inquiries_customer_id_idx
  on public.ops_inquiries (customer_id)
  where customer_id is not null;

create index if not exists orders_customer_id_idx
  on public.orders (customer_id)
  where customer_id is not null;

create or replace function public.find_or_create_customer_identity_c2_1(
  p_full_name text,
  p_mobile text,
  p_first_source text
)
returns table (
  customer_id uuid,
  customer_reference text,
  full_name text,
  mobile_normalized text,
  first_source text,
  created boolean
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_full_name text := btrim(coalesce(p_full_name, ''));
  v_mobile_raw text := btrim(coalesce(p_mobile, ''));
  v_mobile_normalized text;
  v_first_source text := upper(btrim(coalesce(p_first_source, '')));
  v_existing public.customers%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'admin session required'
      using errcode = '42501';
  end if;

  if not public.is_active_admin_user(array['owner','admin','staff']) then
    raise exception 'active Owner/Admin/Staff access required'
      using errcode = '42501';
  end if;

  if v_full_name = '' then
    raise exception 'customer full name is required'
      using errcode = '23514';
  end if;

  if v_mobile_raw = '' then
    raise exception 'customer mobile is required'
      using errcode = '23514';
  end if;

  v_mobile_normalized := public.normalize_ph_mobile(v_mobile_raw);

  if v_mobile_normalized is null then
    raise exception 'invalid Philippine mobile number'
      using errcode = '23514';
  end if;

  if v_first_source not in ('POS_WALK_IN', 'STLO_WEB', 'TRRY_WEB', 'ADMIN_MANUAL') then
    raise exception 'customer first_source is not allowed'
      using errcode = '23514';
  end if;

  select customers.*
  into v_existing
  from public.customers
  where customers.mobile_normalized = v_mobile_normalized
  limit 1;

  if found then
    customer_id := v_existing.id;
    customer_reference := v_existing.customer_reference;
    full_name := v_existing.full_name;
    mobile_normalized := v_existing.mobile_normalized;
    first_source := v_existing.first_source;
    created := false;
    return next;
    return;
  end if;

  begin
    insert into public.customers (full_name, mobile_raw, first_source)
    values (v_full_name, v_mobile_raw, v_first_source)
    returning customers.*
    into v_existing;

    customer_id := v_existing.id;
    customer_reference := v_existing.customer_reference;
    full_name := v_existing.full_name;
    mobile_normalized := v_existing.mobile_normalized;
    first_source := v_existing.first_source;
    created := true;
    return next;
    return;
  exception
    when unique_violation then
      select customers.*
      into v_existing
      from public.customers
      where customers.mobile_normalized = v_mobile_normalized
      limit 1;

      if not found then
        raise;
      end if;

      customer_id := v_existing.id;
      customer_reference := v_existing.customer_reference;
      full_name := v_existing.full_name;
      mobile_normalized := v_existing.mobile_normalized;
      first_source := v_existing.first_source;
      created := false;
      return next;
      return;
  end;
end;
$$;

revoke all on function public.find_or_create_customer_identity_c2_1(text, text, text) from public;
revoke all on function public.find_or_create_customer_identity_c2_1(text, text, text) from anon;
grant execute on function public.find_or_create_customer_identity_c2_1(text, text, text) to authenticated;
grant execute on function public.find_or_create_customer_identity_c2_1(text, text, text) to service_role;

create or replace function public.protect_ops_inquiry_customer_link_c2_1()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.customer_id is not null
       and not public.is_active_admin_user(array['owner','admin','staff']) then
      raise exception 'active Owner/Admin/Staff access required to link inquiry customer'
        using errcode = '42501';
    end if;

    return new;
  end if;

  if new.customer_id is not distinct from old.customer_id then
    return new;
  end if;

  if old.customer_id is null and new.customer_id is not null then
    if not public.is_active_admin_user(array['owner','admin','staff']) then
      raise exception 'active Owner/Admin/Staff access required to link inquiry customer'
        using errcode = '42501';
    end if;

    return new;
  end if;

  if not public.is_active_admin_user(array['owner','admin']) then
    raise exception 'only Owner/Admin can correct an inquiry customer link'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.orders
    where orders.source_inquiry_id = old.id
  ) then
    raise exception 'inquiry customer link is immutable after order conversion'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_ops_inquiry_customer_link_c2_1 on public.ops_inquiries;
create trigger protect_ops_inquiry_customer_link_c2_1
before insert or update of customer_id on public.ops_inquiries
for each row
execute function public.protect_ops_inquiry_customer_link_c2_1();

create or replace function public.protect_order_customer_snapshot_c2_1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.customer_id is distinct from old.customer_id then
    raise exception 'order customer_id is immutable after creation'
      using errcode = '23514';
  end if;

  if new.customer_name is distinct from old.customer_name then
    raise exception 'order customer_name snapshot is immutable after creation'
      using errcode = '23514';
  end if;

  if new.customer_contact is distinct from old.customer_contact then
    raise exception 'order customer_contact snapshot is immutable after creation'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_order_customer_snapshot_c2_1 on public.orders;
create trigger protect_order_customer_snapshot_c2_1
before update of customer_id, customer_name, customer_contact on public.orders
for each row
execute function public.protect_order_customer_snapshot_c2_1();

comment on column public.ops_inquiries.customer_id is
  'Nullable C2.1 customer identity link. Historical and anonymous inquiries remain null.';
comment on column public.orders.customer_id is
  'Nullable C2.1 customer identity snapshot copied from the source Inquiry at Order creation.';
comment on function public.find_or_create_customer_identity_c2_1(text, text, text) is
  'C2.1 atomic exact-mobile customer find-or-create RPC for authorized Owner/Admin/Staff capture only.';
