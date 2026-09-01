-- Supplier Master M1. Additive supplier identity and purchasing terms only.

create sequence if not exists public.supplier_reference_sequence
  as integer
  increment by 1
  minvalue 1
  start with 1
  owned by none;

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  supplier_reference text unique not null default (
    'SUP-' || lpad(nextval('public.supplier_reference_sequence')::text, 4, '0')
  ),
  name text not null,
  supply_type text,
  country_region text,
  contact_person text,
  phone text,
  email text,
  address_location text,
  currency text not null default 'PHP',
  payment_terms text,
  lead_time_days integer,
  internal_notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references public.admin_users(user_id) on delete set null,
  updated_by_user_id uuid references public.admin_users(user_id) on delete set null,
  archived_at timestamptz,
  constraint suppliers_reference_format_check
    check (supplier_reference ~ '^SUP-[0-9]{4,}$'),
  constraint suppliers_name_not_blank
    check (length(btrim(name)) > 0),
  constraint suppliers_currency_not_blank
    check (length(btrim(currency)) > 0),
  constraint suppliers_lead_time_nonnegative
    check (lead_time_days is null or lead_time_days >= 0),
  constraint suppliers_archive_state_check
    check (
      (active = true and archived_at is null)
      or
      (active = false)
    )
);

create index if not exists suppliers_active_idx
  on public.suppliers (active)
  where archived_at is null;
create index if not exists suppliers_supply_type_idx
  on public.suppliers (supply_type)
  where archived_at is null;
create index if not exists suppliers_country_region_idx
  on public.suppliers (country_region)
  where archived_at is null;
create index if not exists suppliers_created_by_user_id_idx
  on public.suppliers (created_by_user_id);
create index if not exists suppliers_updated_by_user_id_idx
  on public.suppliers (updated_by_user_id);

create or replace function public.set_supplier_master_updated_at()
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

create or replace function public.set_supplier_master_audit_users()
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

drop trigger if exists set_suppliers_updated_at on public.suppliers;
create trigger set_suppliers_updated_at
before update on public.suppliers
for each row execute function public.set_supplier_master_updated_at();

drop trigger if exists set_suppliers_audit_users on public.suppliers;
create trigger set_suppliers_audit_users
before insert or update on public.suppliers
for each row execute function public.set_supplier_master_audit_users();

alter table public.suppliers enable row level security;

revoke all privileges on table public.suppliers from anon;
revoke all privileges on sequence public.supplier_reference_sequence from anon;
revoke all privileges on table public.suppliers from authenticated;
revoke all privileges on sequence public.supplier_reference_sequence from authenticated;

grant select, insert, update on table public.suppliers to authenticated;
grant usage, select on sequence public.supplier_reference_sequence to authenticated;
grant all on table public.suppliers to service_role;
grant all on sequence public.supplier_reference_sequence to service_role;

drop policy if exists "Active admins can read suppliers" on public.suppliers;
create policy "Active admins can read suppliers"
on public.suppliers
for select
to authenticated
using (public.is_active_admin_user(array['owner','admin','staff']));

drop policy if exists "Active owners and admins can insert suppliers" on public.suppliers;
create policy "Active owners and admins can insert suppliers"
on public.suppliers
for insert
to authenticated
with check (public.is_active_admin_user(array['owner','admin']));

drop policy if exists "Active owners and admins can update suppliers" on public.suppliers;
create policy "Active owners and admins can update suppliers"
on public.suppliers
for update
to authenticated
using (public.is_active_admin_user(array['owner','admin']))
with check (public.is_active_admin_user(array['owner','admin']));
