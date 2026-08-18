-- Product Images: keep PRIMARY selection independent from display order.

create or replace function public.validate_product_images_canonical_contract()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_active_count integer;
  v_distinct_positions integer;
  v_primary_count integer;
  v_min_position integer;
begin
  v_product_id := coalesce(new.product_id, old.product_id);

  select
    count(*) filter (where image.active = true and image.archived_at is null),
    count(distinct image.position) filter (where image.active = true and image.archived_at is null),
    count(*) filter (where image.active = true and image.archived_at is null and image.is_primary = true),
    min(image.position) filter (where image.active = true and image.archived_at is null)
  into v_active_count, v_distinct_positions, v_primary_count, v_min_position
  from public.product_images image
  where image.product_id = v_product_id;

  if v_active_count = 0 then
    return null;
  end if;

  if v_active_count > 6 then
    raise exception using errcode = '23514', message = 'PRODUCT_IMAGE_LIMIT_EXCEEDED';
  end if;

  if v_distinct_positions <> v_active_count then
    raise exception using errcode = '23514', message = 'PRODUCT_IMAGE_DUPLICATE_POSITION';
  end if;

  if v_min_position <> 0 then
    raise exception using errcode = '23514', message = 'PRODUCT_IMAGE_FIRST_POSITION_REQUIRED';
  end if;

  if v_primary_count <> 1 then
    raise exception using errcode = '23514', message = 'PRODUCT_IMAGE_ONE_PRIMARY_REQUIRED';
  end if;

  return null;
end;
$$;

revoke all on function public.validate_product_images_canonical_contract() from public;
revoke all on function public.validate_product_images_canonical_contract() from anon;
revoke all on function public.validate_product_images_canonical_contract() from authenticated;

create or replace function public.set_product_images_for_product(
  p_product_id uuid,
  p_images jsonb
)
returns setof public.product_images
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor_user_id uuid := (select auth.uid());
  v_image jsonb;
  v_image_count integer;
  v_index integer := 0;
  v_ids uuid[] := array[]::uuid[];
  v_existing_id uuid;
  v_storage_path text;
  v_public_url text;
  v_alt_text text;
  v_primary_input_count integer;
  v_is_primary boolean;
begin
  if v_actor_user_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1 from public.admin_users admin_user
    where admin_user.user_id = v_actor_user_id
      and admin_user.is_active = true
      and admin_user.role in ('owner', 'admin')
  ) then
    raise exception using errcode = '42501', message = 'PRODUCT_IMAGE_MUTATION_FORBIDDEN';
  end if;

  if not exists (select 1 from public.products product where product.id = p_product_id for update) then
    raise exception using errcode = 'P0002', message = 'PRODUCT_NOT_FOUND';
  end if;

  v_image_count := jsonb_array_length(coalesce(p_images, '[]'::jsonb));
  if v_image_count > 6 then
    raise exception using errcode = '23514', message = 'PRODUCT_IMAGE_LIMIT_EXCEEDED';
  end if;

  select count(*)
  into v_primary_input_count
  from jsonb_array_elements(coalesce(p_images, '[]'::jsonb)) image
  where lower(coalesce(image->>'isPrimary', image->>'is_primary', 'false')) in ('true', 't', '1', 'yes');

  if v_primary_input_count > 1 then
    raise exception using errcode = '23514', message = 'PRODUCT_IMAGE_ONE_PRIMARY_REQUIRED';
  end if;

  update public.product_images
  set active = false,
      is_primary = false,
      position = position + 10000,
      updated_by_user_id = v_actor_user_id,
      archived_at = coalesce(archived_at, now()),
      archived_by_user_id = coalesce(archived_by_user_id, v_actor_user_id)
  where product_id = p_product_id
    and active = true
    and archived_at is null;

  for v_image in select * from jsonb_array_elements(coalesce(p_images, '[]'::jsonb)) loop
    v_existing_id := nullif(v_image->>'id', '')::uuid;
    v_storage_path := btrim(coalesce(v_image->>'storagePath', v_image->>'storage_path', ''));
    v_public_url := nullif(btrim(coalesce(v_image->>'publicUrl', v_image->>'public_url', '')), '');
    v_alt_text := nullif(btrim(coalesce(v_image->>'altText', v_image->>'alt_text', '')), '');
    v_is_primary := case
      when v_primary_input_count = 0 then v_index = 0
      else lower(coalesce(v_image->>'isPrimary', v_image->>'is_primary', 'false')) in ('true', 't', '1', 'yes')
    end;

    if length(v_storage_path) = 0 then
      raise exception using errcode = '23514', message = 'PRODUCT_IMAGE_STORAGE_PATH_REQUIRED';
    end if;

    if v_existing_id is not null and exists (
      select 1 from public.product_images image where image.id = v_existing_id and image.product_id = p_product_id
    ) then
      update public.product_images
      set storage_path = v_storage_path,
          public_url = v_public_url,
          alt_text = v_alt_text,
          position = v_index,
          is_primary = v_is_primary,
          active = true,
          archived_at = null,
          archived_by_user_id = null,
          updated_by_user_id = v_actor_user_id
      where id = v_existing_id;
      v_ids := array_append(v_ids, v_existing_id);
    else
      insert into public.product_images(
        product_id,
        storage_path,
        public_url,
        alt_text,
        position,
        is_primary,
        active,
        created_by_user_id,
        updated_by_user_id
      ) values (
        p_product_id,
        v_storage_path,
        v_public_url,
        v_alt_text,
        v_index,
        v_is_primary,
        true,
        v_actor_user_id,
        v_actor_user_id
      ) returning id into v_existing_id;
      v_ids := array_append(v_ids, v_existing_id);
    end if;

    v_index := v_index + 1;
  end loop;

  return query
  select *
  from public.product_images image
  where image.product_id = p_product_id
    and image.active = true
    and image.archived_at is null
  order by image.position asc, image.created_at asc;
end;
$$;

revoke all on function public.set_product_images_for_product(uuid, jsonb) from public;
revoke all on function public.set_product_images_for_product(uuid, jsonb) from anon;
revoke all on function public.set_product_images_for_product(uuid, jsonb) from authenticated;
grant execute on function public.set_product_images_for_product(uuid, jsonb) to authenticated;
