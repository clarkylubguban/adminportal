-- M9G.1 canonical Sales Channel governance.
-- Existing legacy invalid rows are intentionally not guessed or remapped here.
-- NOT VALID lets staging identify legacy rows first while enforcing all new/updated rows.

create or replace function public.text_array_has_no_duplicates(p_values text[])
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(cardinality(p_values), 0) = (
    select count(distinct item)::integer
    from unnest(p_values) as item
  );
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_eligible_channels_canonical_values'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_eligible_channels_canonical_values
      check (
        coalesce(eligible_channels, '{}'::text[]) <@ array[
          'STLOLAB',
          'TRRY_WEBAPP',
          'POS',
          'TRRY_APPAREL'
        ]::text[]
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_ready_sellable_requires_sales_channel'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_ready_sellable_requires_sales_channel
      check (
        not (readiness_status = 'READY_FOR_SALE' and sellable is true)
        or cardinality(coalesce(eligible_channels, '{}'::text[])) > 0
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_eligible_channels_no_duplicates'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_eligible_channels_no_duplicates
      check (public.text_array_has_no_duplicates(coalesce(eligible_channels, '{}'::text[]))) not valid;
  end if;
end $$;
