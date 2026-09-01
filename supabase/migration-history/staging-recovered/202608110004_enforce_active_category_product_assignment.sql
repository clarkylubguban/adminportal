-- Master Catalog M1 taxonomy assignment guard.
-- Product category assignments must target active, non-archived categories.

create or replace function public.prevent_unsafe_category_archive()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.archived_at is null then
    return new;
  end if;

  if old.archived_at is not null
    and old.active = new.active
    and old.archive_reason is not distinct from new.archive_reason then
    return new;
  end if;

  if exists (
    with recursive descendants(id) as (
      select category.id
      from public.product_categories category
      where category.parent_category_id = new.id
      union all
      select child.id
      from public.product_categories child
      join descendants on child.parent_category_id = descendants.id
    )
    select 1
    from public.product_categories category
    where category.id in (select id from descendants)
      and category.active = true
      and category.archived_at is null
  ) then
    raise exception using errcode = '23514', message = 'CATEGORY_HAS_ACTIVE_DESCENDANTS';
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
    and old.category_id is not distinct from new.category_id then
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

  return new;
end;
$$;

drop trigger if exists validate_product_category_assignment
on public.products;

create trigger validate_product_category_assignment
before insert or update of category_id on public.products
for each row execute function public.validate_product_category_assignment();;
