-- B8-1 - Clean EAN-8 / RCN-8 barcode cutover.
-- Barcode remains an alias of the canonical product variant; this migration does not touch catalog or inventory rows.

create or replace function public.calculate_ean8_check_digit(p_payload text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_payload text := btrim(coalesce(p_payload, ''));
  v_sum integer := 0;
  v_index integer;
begin
  if v_payload !~ '^[0-9]{7}$' then
    raise exception 'EAN-8 payload must contain exactly 7 digits.';
  end if;

  for v_index in 1..7 loop
    v_sum := v_sum + substring(v_payload from v_index for 1)::integer * case when v_index in (1, 3, 5, 7) then 3 else 1 end;
  end loop;

  return ((10 - (v_sum % 10)) % 10)::text;
end;
$$;

create or replace function public.make_internal_rcn8(p_reference bigint)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_reference bigint := p_reference;
  v_payload text;
begin
  if v_reference is null or v_reference < 0 or v_reference > 999999 then
    raise exception 'Internal RCN-8 reference is outside the supported six-digit range.';
  end if;

  v_payload := '2' || lpad(v_reference::text, 6, '0');
  return v_payload || public.calculate_ean8_check_digit(v_payload);
end;
$$;

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
  v_symbology text := case when v_source = 'INTERNAL' then 'EAN8' else 'CODE128' end;
  v_variant public.product_variants%rowtype;
  v_product public.products%rowtype;
  v_existing public.product_variant_barcodes%rowtype;
  v_existing_found boolean := false;
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

  if v_source = 'INTERNAL' and v_code !~ '^[0-9]{8}$' then
    raise exception 'Internal barcodes must be EAN-8 / RCN-8 numeric values.';
  end if;

  if v_source = 'INTERNAL' and public.calculate_ean8_check_digit(substring(v_code from 1 for 7)) <> substring(v_code from 8 for 1) then
    raise exception 'Internal EAN-8 checksum is invalid.';
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
  v_existing_found := found;

  if v_existing_found and v_existing.variant_id <> p_variant_id then
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

  if v_existing_found then
    update public.product_variant_barcodes
    set active = true,
        is_primary = true,
        source = v_source,
        symbology = v_symbology,
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
      v_symbology,
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
  v_reference bigint;
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

  loop
    v_reference := nextval('public.product_variant_barcode_sequence');
    if v_reference > 999999 then
      raise exception 'Internal RCN-8 barcode sequence exhausted.';
    end if;

    v_code := public.make_internal_rcn8(v_reference);
    exit when not exists (
      select 1
      from public.product_variant_barcodes
      where code = v_code
    );
  end loop;

  return public.assign_variant_barcode(p_variant_id, v_code, 'INTERNAL');
end;
$$;

update public.product_variant_barcodes
set code = public.make_internal_rcn8((right(substring(code from '^TRRY([0-9]+)$'), 6))::bigint),
    symbology = 'EAN8',
    source = 'INTERNAL',
    updated_at = now()
where code ~ '^TRRY[0-9]+$'
  and symbology = 'CODE128'
  and not exists (
    select 1
    from public.product_variant_barcodes other
    where other.id <> product_variant_barcodes.id
      and other.code = public.make_internal_rcn8((right(substring(product_variant_barcodes.code from '^TRRY([0-9]+)$'), 6))::bigint)
  );

revoke execute on function public.calculate_ean8_check_digit(text) from public;
revoke execute on function public.calculate_ean8_check_digit(text) from anon;
revoke execute on function public.make_internal_rcn8(bigint) from public;
revoke execute on function public.make_internal_rcn8(bigint) from anon;
grant execute on function public.calculate_ean8_check_digit(text) to authenticated;
grant execute on function public.make_internal_rcn8(bigint) to authenticated;
