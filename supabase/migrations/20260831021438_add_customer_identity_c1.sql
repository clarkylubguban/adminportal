-- Customer Ecosystem C1 — customer identity foundation only.
-- One person = one normalized Philippine mobile identity across POS, STLO Web, and TRRY Web.
-- Anonymous walk-ins intentionally do not create rows in this table.

create or replace function public.normalize_ph_mobile(p_mobile text)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  with cleaned as (
    select regexp_replace(p_mobile, '[^0-9]+', '', 'g') as digits
  )
  select case
    when digits ~ '^09[0-9]{9}$' then '+63' || substr(digits, 2)
    when digits ~ '^639[0-9]{9}$' then '+' || digits
    when digits ~ '^9[0-9]{9}$' then '+63' || digits
    else null
  end
  from cleaned;
$$;

revoke all on function public.normalize_ph_mobile(text) from public;
revoke all on function public.normalize_ph_mobile(text) from anon;
grant execute on function public.normalize_ph_mobile(text) to authenticated;
grant execute on function public.normalize_ph_mobile(text) to service_role;

create sequence if not exists public.customer_reference_sequence
  as integer
  increment by 1
  minvalue 1
  start with 1
  owned by none;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  customer_reference text unique not null default (
    'CUS-' || lpad(nextval('public.customer_reference_sequence')::text, 6, '0')
  ),
  full_name text not null,
  mobile_raw text not null,
  mobile_normalized text generated always as (
    public.normalize_ph_mobile(mobile_raw)
  ) stored,
  first_source text not null,
  first_seen_at timestamptz not null default now(),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references public.admin_users(user_id) on delete set null,
  updated_by_user_id uuid references public.admin_users(user_id) on delete set null,
  archived_at timestamptz,
  constraint customers_reference_format_check
    check (customer_reference ~ '^CUS-[0-9]{6,}$'),
  constraint customers_full_name_not_blank
    check (length(btrim(full_name)) > 0),
  constraint customers_mobile_raw_not_blank
    check (length(btrim(mobile_raw)) > 0),
  constraint customers_mobile_normalized_valid
    check (mobile_normalized is not null),
  constraint customers_mobile_normalized_unique
    unique (mobile_normalized),
  constraint customers_first_source_canonical
    check (first_source in (
      'POS_WALK_IN',
      'STLO_WEB',
      'TRRY_WEB',
      'ADMIN_MANUAL'
    )),
  constraint customers_archive_state_check
    check (
      (active = true and archived_at is null)
      or
      (active = false)
    )
);

create index if not exists customers_active_idx
  on public.customers (active)
  where archived_at is null;
create index if not exists customers_first_source_idx
  on public.customers (first_source);
create index if not exists customers_created_at_idx
  on public.customers (created_at desc);
create index if not exists customers_created_by_user_id_idx
  on public.customers (created_by_user_id);
create index if not exists customers_updated_by_user_id_idx
  on public.customers (updated_by_user_id);

create or replace function public.set_customer_identity_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.set_customer_identity_audit_users()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor_user_id uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    new.created_by_user_id := coalesce(new.created_by_user_id, v_actor_user_id);
  end if;

  new.updated_by_user_id := coalesce(v_actor_user_id, new.updated_by_user_id);
  return new;
end;
$$;

create or replace function public.protect_customer_origin()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.first_source is distinct from old.first_source then
    raise exception 'customer first_source is immutable after creation'
      using errcode = '23514';
  end if;

  if new.first_seen_at is distinct from old.first_seen_at then
    raise exception 'customer first_seen_at is immutable after creation'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_customers_origin on public.customers;
create trigger protect_customers_origin
before update on public.customers
for each row execute function public.protect_customer_origin();

drop trigger if exists set_customers_updated_at on public.customers;
create trigger set_customers_updated_at
before update on public.customers
for each row execute function public.set_customer_identity_updated_at();

drop trigger if exists set_customers_audit_users on public.customers;
create trigger set_customers_audit_users
before insert or update on public.customers
for each row execute function public.set_customer_identity_audit_users();

alter table public.customers enable row level security;

revoke all privileges on table public.customers from anon;
revoke all privileges on sequence public.customer_reference_sequence from anon;
revoke all privileges on table public.customers from authenticated;
revoke all privileges on sequence public.customer_reference_sequence from authenticated;

grant select, insert, update on table public.customers to authenticated;
grant usage, select on sequence public.customer_reference_sequence to authenticated;
grant all on table public.customers to service_role;
grant all on sequence public.customer_reference_sequence to service_role;

drop policy if exists "Active admins can read customers" on public.customers;
create policy "Active admins can read customers"
on public.customers
for select
to authenticated
using (public.is_active_admin_user(array['owner','admin','staff']));

drop policy if exists "Active operators can capture customers" on public.customers;
create policy "Active operators can capture customers"
on public.customers
for insert
to authenticated
with check (public.is_active_admin_user(array['owner','admin','staff']));

drop policy if exists "Active owners and admins can update customers" on public.customers;
create policy "Active owners and admins can update customers"
on public.customers
for update
to authenticated
using (public.is_active_admin_user(array['owner','admin']))
with check (public.is_active_admin_user(array['owner','admin']));
