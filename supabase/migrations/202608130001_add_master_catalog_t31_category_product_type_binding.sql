-- Master Catalog T3.1 category product-type binding.
-- Binding only. This migration intentionally does not seed taxonomy categories.

alter table public.product_categories
  add column if not exists product_type text;

update public.product_categories
set product_type = 'PHYSICAL'
where code in (
  'M1-QA-ROOT-20260812011129542',
  'M1-QA-CHILD-20260812011129542',
  'M1-QA-SIBLING-20260812011129542',
  'M1-QA-INACTIVE-20260812011129542',
  'T-SHIRT-OVERSIZE'
)
  and product_type is null;

do $$
begin
  if exists (
    select 1
    from public.products product
    join public.product_categories category on category.id = product.category_id
    group by category.id
    having count(distinct product.product_type) > 1
  ) then
    raise exception using
      errcode = '23514',
      message = 'CATEGORY_PRODUCT_TYPE_CONFLICT';
  end if;
end
$$;

with category_product_type as (
  select product.category_id, min(product.product_type) as product_type
  from public.products product
  group by product.category_id
)
update public.product_categories category
set product_type = category_product_type.product_type
from category_product_type
where category.id = category_product_type.category_id
  and category.product_type is null;

do $$
begin
  if exists (
    select 1
    from public.product_categories
    where product_type is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'CATEGORY_PRODUCT_TYPE_MAPPING_REQUIRED';
  end if;

  if exists (
    select 1
    from public.product_categories
    where product_type not in ('PHYSICAL', 'SERVICE', 'MATERIAL_SUPPLY')
  ) then
    raise exception using
      errcode = '23514',
      message = 'INVALID_CATEGORY_PRODUCT_TYPE';
  end if;

  if exists (
    select 1
    from public.product_categories child
    join public.product_categories parent on parent.id = child.parent_category_id
    where child.product_type <> parent.product_type
  ) then
    raise exception using
      errcode = '23514',
      message = 'CATEGORY_PARENT_PRODUCT_TYPE_MISMATCH';
  end if;

  if exists (
    select 1
    from public.product_categories child
    join public.product_categories parent on parent.id = child.parent_category_id
    where parent.parent_category_id is not null
  ) then
    raise exception using
      errcode = '23514',
      message = 'CATEGORY_MAX_DEPTH_EXCEEDED';
  end if;
end
$$;

alter table public.product_categories
  alter column product_type set not null,
  drop constraint if exists product_categories_name_key;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'product_categories_product_type_check') then
    alter table public.product_categories
      add constraint product_categories_product_type_check
      check (product_type in ('PHYSICAL', 'SERVICE', 'MATERIAL_SUPPLY'));
  end if;
end
$$;

create unique index if not exists product_categories_root_name_type_uidx
  on public.product_categories (product_type, lower(name))
  where parent_category_id is null;

create unique index if not exists product_categories_child_name_parent_uidx
  on public.product_categories (parent_category_id, lower(name))
  where parent_category_id is not null;

create index if not exists product_categories_product_type_idx
  on public.product_categories (product_type);

create or replace function public.validate_product_category_contract()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_parent public.product_categories%rowtype;
begin
  if new.product_type not in ('PHYSICAL', 'SERVICE', 'MATERIAL_SUPPLY') then
    raise exception using errcode = '23514', message = 'INVALID_CATEGORY_PRODUCT_TYPE';
  end if;

  if new.parent_category_id is not null then
    select *
    into v_parent
    from public.product_categories
    where id = new.parent_category_id
    for share;

    if not found then
      return new;
    end if;

    if v_parent.product_type <> new.product_type then
      raise exception using errcode = '23514', message = 'CATEGORY_PARENT_PRODUCT_TYPE_MISMATCH';
    end if;

    if v_parent.parent_category_id is not null then
      raise exception using errcode = '23514', message = 'CATEGORY_MAX_DEPTH_EXCEEDED';
    end if;
  end if;

  if exists (
    select 1
    from public.product_categories child
    where child.parent_category_id = new.id
      and child.product_type <> new.product_type
  ) then
    raise exception using errcode = '23514', message = 'CATEGORY_CHILD_PRODUCT_TYPE_MISMATCH';
  end if;

  if exists (
    select 1
    from public.products product
    where product.category_id = new.id
      and product.product_type <> new.product_type
  ) then
    raise exception using errcode = '23514', message = 'CATEGORY_LINKED_PRODUCT_TYPE_MISMATCH';
  end if;

  return new;
end;
$$;

create or replace function public.validate_product_category_assignment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_category public.product_categories%rowtype;
begin
  if tg_op = 'UPDATE'
    and old.category_id is not distinct from new.category_id
    and old.product_type is not distinct from new.product_type then
    return new;
  end if;

  select *
  into v_category
  from public.product_categories
  where id = new.category_id
  for share;

  if not found then
    return new;
  end if;

  if v_category.active is distinct from true
    or v_category.archived_at is not null
    or v_category.archived_by_user_id is not null
    or v_category.archive_reason is not null then
    raise exception using
      errcode = '23514',
      message = 'PRODUCT_CATEGORY_NOT_ASSIGNABLE';
  end if;

  if v_category.product_type <> new.product_type then
    raise exception using
      errcode = '23514',
      message = 'PRODUCT_CATEGORY_TYPE_MISMATCH';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_product_category_contract
on public.product_categories;

create trigger validate_product_category_contract
before insert or update of product_type, parent_category_id
on public.product_categories
for each row execute function public.validate_product_category_contract();

drop trigger if exists validate_product_category_assignment
on public.products;

create trigger validate_product_category_assignment
before insert or update of category_id, product_type
on public.products
for each row execute function public.validate_product_category_assignment();
