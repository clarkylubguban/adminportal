-- Customer C2.4B: POS walk-in shared identity bridge.
-- POS callers retain their authenticated Admin session. This wrapper derives POS
-- access server-side and fixes the customer source before delegating to C2.1.

create or replace function public.resolve_pos_walk_in_customer_identity_c2_4b(
  p_full_name text,
  p_mobile text
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
  v_pos_access jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'authenticated POS session required'
      using errcode = '42501';
  end if;

  v_pos_access := public.get_pos_sales_effective_access();
  if coalesce((v_pos_access ->> 'allowed')::boolean, false) is not true then
    raise exception 'active POS/Sales access required'
      using errcode = '42501';
  end if;

  return query
  select *
  from public.find_or_create_customer_identity_c2_1(
    p_full_name,
    p_mobile,
    'POS_WALK_IN'
  );
end;
$$;

revoke all on function public.resolve_pos_walk_in_customer_identity_c2_4b(text, text) from public;
revoke all on function public.resolve_pos_walk_in_customer_identity_c2_4b(text, text) from anon;
revoke all on function public.resolve_pos_walk_in_customer_identity_c2_4b(text, text) from service_role;
grant execute on function public.resolve_pos_walk_in_customer_identity_c2_4b(text, text) to authenticated;

comment on function public.resolve_pos_walk_in_customer_identity_c2_4b(text, text) is
  'Authenticated POS/Sales-only C2.4B wrapper for C2.1 exact-mobile customer identity resolution. The source is fixed internally to POS_WALK_IN.';
