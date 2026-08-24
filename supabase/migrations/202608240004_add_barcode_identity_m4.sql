-- M4 — Barcode identity aliases, scanner lookup, and label-printing foundation.
-- Barcode is a machine-readable alias only; product_variants remains canonical.

create schema if not exists trry_api;

revoke all on schema trry_api from public;
revoke all on schema trry_api from anon;
grant usage on schema trry_api to authenticated;
grant usage on schema trry_api to service_role;

create sequence if not exists public.product_variant_barcode_sequence
  start with 1
  increment by 1;

create table if not exists public.product_variant_barcodes (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  code text not null,
  symbology text not null default 'CODE128',
  source text not null default 'INTERNAL',
  is_primary boolean not null default false,
  active boolean not null default true,
  created_by_user_id uuid references public.admin_users(user_id) on delete set null,
  updated_by_user_id uuid references public.admin_users(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_variant_barcodes_code_not_blank check (btrim(code) <> ''),
  constraint product_variant_barcodes_symbology_not_blank check (btrim(symbology) <> ''),
  constraint product_variant_barcodes_source_not_blank check (btrim(source) <> '')
);

create unique index if not exists product_variant_barcodes_code_unique
  on public.product_variant_barcodes (code);

create unique index if not exists product_variant_barcodes_one_active_primary_idx
  on public.product_variant_barcodes (variant_id)
  where active = true and is_primary = true;

create index if not exists product_variant_barcodes_variant_id_idx
  on public.product_variant_barcodes (variant_id);

create index if not exists product_variant_barcodes_active_primary_idx
  on public.product_variant_barcodes (active, is_primary);

create or replace function public.assign_variant_barcode(
  p_variant_id uuid,
  p_code text,
  p_source text default 'INTERNAL'
)
returns public.product_variant_barcodes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_source text := upper(btrim(coalesce(p_source, 'INTERNAL')));
  v_variant public.product_variants%rowtype;
  v_product public.products%rowtype;
  v_existing public.product_variant_barcodes%rowtype;
  v_saved public.product_variant_barcodes%rowtype;
begin
  if v_actor is null then
    raise exception 'Authentication is required.';
  end if;

  if not public.is_active_admin_user(array['owner','admin']) then
    raise exception 'Only Owner and Admin roles can assign barcodes.';
  end if;

  if p_variant_id is null then
    raise exception 'Product variant is required.';
  end if;

  if v_code = '' then
    raise exception 'Barcode is required.';
  end if;

  select * into v_variant
  from public.product_variants
  where id = p_variant_id
  for update;

  if not found or v_variant.active = false or v_variant.archived_at is not null then
    raise exception 'Active product variant is required.';
  end if;

  if btrim(coalesce(v_variant.sku, '')) = '' then
    raise exception 'SKU is required before assigning a barcode.';
  end if;

  select * into v_product
  from public.products
  where id = v_variant.product_id
  for update;

  if not found or v_product.active = false or v_product.archived_at is not null then
    raise exception 'Active physical product is required.';
  end if;

  if upper(coalesce(v_product.product_type, '')) <> 'PHYSICAL' then
    raise exception 'Barcodes are only assigned to physical products.';
  end if;

  select * into v_existing
  from public.product_variant_barcodes
  where code = v_code
  for update;

  if found and v_existing.variant_id <> p_variant_id then
    raise exception 'Barcode already assigned to another product variant.';
  end if;

  update public.product_variant_barcodes
  set is_primary = false,
      updated_by_user_id = v_actor,
      updated_at = now()
  where variant_id = p_variant_id
    and active = true
    and is_primary = true
    and id <> coalesce(v_existing.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if found then
    update public.product_variant_barcodes
    set active = true,
        is_primary = true,
        source = v_source,
        symbology = 'CODE128',
        updated_by_user_id = v_actor,
        updated_at = now()
    where id = v_existing.id
    returning * into v_saved;
  else
    insert into public.product_variant_barcodes (
      variant_id,
      code,
      symbology,
      source,
      is_primary,
      active,
      created_by_user_id,
      updated_by_user_id
    ) values (
      p_variant_id,
      v_code,
      'CODE128',
      v_source,
      true,
      true,
      v_actor,
      v_actor
    )
    returning * into v_saved;
  end if;

  return v_saved;
end;
$$;

create or replace function public.generate_variant_barcode(p_variant_id uuid)
returns public.product_variant_barcodes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_existing public.product_variant_barcodes%rowtype;
  v_code text;
begin
  if v_actor is null then
    raise exception 'Authentication is required.';
  end if;

  if not public.is_active_admin_user(array['owner','admin']) then
    raise exception 'Only Owner and Admin roles can generate barcodes.';
  end if;

  select * into v_existing
  from public.product_variant_barcodes
  where variant_id = p_variant_id
    and active = true
    and is_primary = true
  order by created_at asc
  limit 1;

  if found then
    return v_existing;
  end if;

  v_code := 'TRRY' || lpad(nextval('public.product_variant_barcode_sequence')::text, 10, '0');
  return public.assign_variant_barcode(p_variant_id, v_code, 'INTERNAL');
end;
$$;

create or replace function trry_api.lookup_variant_by_barcode(p_code text)
returns table (
  barcode_id uuid,
  barcode text,
  symbology text,
  source text,
  variant_id uuid,
  product_id uuid,
  product_name text,
  sku text,
  color text,
  size text,
  selling_price numeric,
  product_active boolean,
  variant_active boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if v_actor is null then
    raise exception 'Authentication is required.';
  end if;

  if not public.is_active_admin_user(array['owner','admin','staff']) then
    raise exception 'Active Admin OS user is required.';
  end if;

  if v_code = '' then
    return;
  end if;

  return query
  select
    barcode.id as barcode_id,
    barcode.code as barcode,
    barcode.symbology,
    barcode.source,
    variant.id as variant_id,
    product.id as product_id,
    product.name as product_name,
    variant.sku,
    variant.color,
    variant.size,
    variant.selling_price,
    (product.active <> false and product.archived_at is null) as product_active,
    (variant.active <> false and variant.archived_at is null) as variant_active
  from public.product_variant_barcodes barcode
  join public.product_variants variant on variant.id = barcode.variant_id
  join public.products product on product.id = variant.product_id
  where barcode.code = v_code
    and barcode.active = true
  limit 1;
end;
$$;

alter table public.product_variant_barcodes enable row level security;

revoke all on table public.product_variant_barcodes from anon;
revoke all on table public.product_variant_barcodes from authenticated;
grant select on table public.product_variant_barcodes to authenticated;
grant all on table public.product_variant_barcodes to service_role;
grant usage, select on sequence public.product_variant_barcode_sequence to service_role;

revoke execute on function public.generate_variant_barcode(uuid) from public;
revoke execute on function public.generate_variant_barcode(uuid) from anon;
revoke execute on function public.assign_variant_barcode(uuid,text,text) from public;
revoke execute on function public.assign_variant_barcode(uuid,text,text) from anon;
revoke execute on function trry_api.lookup_variant_by_barcode(text) from public;
revoke execute on function trry_api.lookup_variant_by_barcode(text) from anon;

grant execute on function public.generate_variant_barcode(uuid) to authenticated;
grant execute on function public.assign_variant_barcode(uuid,text,text) to authenticated;
grant execute on function trry_api.lookup_variant_by_barcode(text) to authenticated;

drop policy if exists "product variant barcodes read active admin" on public.product_variant_barcodes;
create policy "product variant barcodes read active admin"
on public.product_variant_barcodes
for select
to authenticated
using (public.is_active_admin_user(array['owner','admin','staff']));
