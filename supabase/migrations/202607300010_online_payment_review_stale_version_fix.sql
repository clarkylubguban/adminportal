-- Preserve exact-once stale protection without using a retryable serialization SQLSTATE.
-- The original function remains structurally unchanged; only its business-error code changes.

do $migration$
declare
  v_signature regprocedure :=
    'public.review_online_payment(text,text,numeric,text,text,timestamptz,text)'::regprocedure;
  v_definition text;
  v_retryable_clause constant text :=
    'errcode = ''40001'', message = ''PAYMENT_STALE_VERSION''';
  v_business_clause constant text :=
    'errcode = ''P0001'', message = ''PAYMENT_STALE_VERSION''';
begin
  select pg_get_functiondef(v_signature)
  into v_definition;

  if v_definition is null
    or position(v_retryable_clause in v_definition) = 0
    or position(v_business_clause in v_definition) > 0
    or (
      length(v_definition) - length(replace(v_definition, v_retryable_clause, ''))
    ) / length(v_retryable_clause) <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'ONLINE_PAYMENT_REVIEW_STALE_FIX_SOURCE_MISMATCH';
  end if;

  execute replace(v_definition, v_retryable_clause, v_business_clause);
end
$migration$;

revoke execute on function public.review_online_payment(
  text, text, numeric, text, text, timestamptz, text
) from public, anon;

grant execute on function public.review_online_payment(
  text, text, numeric, text, text, timestamptz, text
) to authenticated;

comment on function public.review_online_payment(
  text, text, numeric, text, text, timestamptz, text
) is
  'Atomically reviews one full GCash or bank-transfer receipt with non-retryable stale-version conflicts.';
