-- Customer C2.3.1 repair: Supabase installs pgcrypto in the extensions schema.
-- Keep the external inquiry RPC contract unchanged, but call extensions.digest().

create or replace function public.create_external_inquiry_identity_c2_3_1(
  p_idempotency_key text,
  p_inquiry_id text,
  p_customer_name text,
  p_mobile text,
  p_message text,
  p_product text,
  p_quantity text,
  p_due_date date
)
returns table (
  inquiry_id text,
  customer_id uuid,
  customer_reference text,
  customer_created boolean,
  mobile_normalized text,
  idempotency_key text,
  payload_hash text,
  replay boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_idempotency_key text := btrim(coalesce(p_idempotency_key, ''));
  v_external_source constant text := 'TRRY_WEB';
  v_request_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('role', true), ''),
    current_user
  );
  v_inquiry_id text := upper(btrim(coalesce(p_inquiry_id, '')));
  v_customer_name text := btrim(coalesce(p_customer_name, ''));
  v_mobile_raw text := btrim(coalesce(p_mobile, ''));
  v_mobile_normalized text;
  v_message text := btrim(coalesce(p_message, ''));
  v_product text := nullif(btrim(coalesce(p_product, '')), '');
  v_quantity text := nullif(btrim(coalesce(p_quantity, '')), '');
  v_payload_hash text;
  v_customer public.customers%rowtype;
  v_customer_created boolean := false;
  v_receipt public.external_inquiry_receipts%rowtype;
  v_result jsonb;
  v_attempt integer := 0;
begin
  if v_request_role <> 'service_role' then
    raise exception 'service role required'
      using errcode = '42501';
  end if;

  if length(v_idempotency_key) not between 8 and 240 then
    raise exception 'idempotency key is required'
      using errcode = '23514';
  end if;

  if v_customer_name = '' then
    raise exception 'customer name is required'
      using errcode = '23514';
  end if;

  if v_mobile_raw <> '' then
    v_mobile_normalized := public.normalize_ph_mobile(v_mobile_raw);
    if v_mobile_normalized is null then
      raise exception 'invalid Philippine mobile number'
        using errcode = '23514';
    end if;
  end if;

  if v_message = '' then
    raise exception 'inquiry message is required'
      using errcode = '23514';
  end if;

  if v_inquiry_id <> '' and v_inquiry_id !~ '^[A-Z0-9][A-Z0-9_-]{2,79}$' then
    raise exception 'inquiry id is invalid'
      using errcode = '23514';
  end if;

  v_payload_hash := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'externalSource', v_external_source,
          'inquiryId', v_inquiry_id,
          'customerName', v_customer_name,
          'mobileNormalized', coalesce(v_mobile_normalized, ''),
          'message', v_message,
          'product', coalesce(v_product, ''),
          'quantity', coalesce(v_quantity, ''),
          'dueDate', coalesce(p_due_date::text, '')
        )::text,
        'utf8'
      ),
      'sha256'
    ),
    'hex'
  );

  perform pg_advisory_xact_lock(hashtextextended(v_idempotency_key, 0));

  select *
  into v_receipt
  from public.external_inquiry_receipts
  where external_inquiry_receipts.idempotency_key = v_idempotency_key;

  if found then
    if v_receipt.payload_hash <> v_payload_hash then
      raise exception 'idempotency key conflict'
        using errcode = '23505';
    end if;

    inquiry_id := v_receipt.result_payload->>'inquiryId';
    customer_id := nullif(v_receipt.result_payload->>'customerId', '')::uuid;
    customer_reference := nullif(v_receipt.result_payload->>'customerReference', '');
    customer_created := false;
    mobile_normalized := nullif(v_receipt.result_payload->>'mobileNormalized', '');
    idempotency_key := v_receipt.idempotency_key;
    payload_hash := v_receipt.payload_hash;
    replay := true;
    return next;
    return;
  end if;

  if v_mobile_normalized is not null then
    select *
    into v_customer
    from public.customers
    where customers.mobile_normalized = v_mobile_normalized
    limit 1;

    if found then
      v_customer_created := false;
    else
      begin
        insert into public.customers (full_name, mobile_raw, first_source)
        values (v_customer_name, v_mobile_raw, 'TRRY_WEB')
        returning *
        into v_customer;
        v_customer_created := true;
      exception
        when unique_violation then
          select *
          into v_customer
          from public.customers
          where customers.mobile_normalized = v_mobile_normalized
          limit 1;

          if not found then
            raise;
          end if;

          v_customer_created := false;
      end;
    end if;
  end if;

  if v_inquiry_id = '' then
    loop
      v_inquiry_id := 'TRRY-' || to_char(clock_timestamp() + make_interval(secs => v_attempt), 'YYYYMMDDHH24MISS');
      exit when not exists (select 1 from public.ops_inquiries where id = v_inquiry_id);
      v_attempt := v_attempt + 1;
      if v_attempt > 60 then
        raise exception 'inquiry id generation failed'
          using errcode = '23505';
      end if;
    end loop;
  end if;

  if v_customer.id is not null then
    insert into public.external_inquiry_link_authorizations_c2_3_1 (
      transaction_id,
      inquiry_id,
      customer_id
    )
    values (
      pg_current_xact_id(),
      v_inquiry_id,
      v_customer.id
    )
    on conflict do nothing;

    if not public.has_external_inquiry_link_authorization_c2_3_1(v_inquiry_id, v_customer.id) then
      raise exception 'external inquiry link authorization was not established'
        using errcode = '42501';
    end if;
  end if;

  insert into public.ops_inquiries (
    id,
    customer_id,
    customer_name,
    contact,
    source,
    message,
    product,
    quantity,
    priority,
    status,
    next_action,
    due_date
  )
  values (
    v_inquiry_id,
    v_customer.id,
    v_customer_name,
    coalesce(v_mobile_normalized, v_mobile_raw),
    'Portal',
    v_message,
    v_product,
    v_quantity,
    'normal',
    'new',
    'Review inquiry',
    p_due_date
  );

  if v_customer.id is not null then
    delete from public.external_inquiry_link_authorizations_c2_3_1
    where external_inquiry_link_authorizations_c2_3_1.transaction_id = pg_current_xact_id()
      and external_inquiry_link_authorizations_c2_3_1.inquiry_id = v_inquiry_id
      and external_inquiry_link_authorizations_c2_3_1.customer_id = v_customer.id;
  end if;

  v_result := jsonb_build_object(
    'inquiryId', v_inquiry_id,
    'customerId', coalesce(v_customer.id::text, ''),
    'customerReference', coalesce(v_customer.customer_reference, ''),
    'customerCreated', v_customer_created,
    'mobileNormalized', coalesce(v_mobile_normalized, '')
  );

  insert into public.external_inquiry_receipts (
    idempotency_key,
    external_source,
    payload_hash,
    inquiry_id,
    result_payload
  )
  values (
    v_idempotency_key,
    v_external_source,
    v_payload_hash,
    v_inquiry_id,
    v_result
  )
  returning *
  into v_receipt;

  inquiry_id := v_inquiry_id;
  customer_id := v_customer.id;
  customer_reference := v_customer.customer_reference;
  customer_created := v_customer_created;
  mobile_normalized := v_mobile_normalized;
  idempotency_key := v_idempotency_key;
  payload_hash := v_payload_hash;
  replay := false;
  return next;
exception
  when unique_violation then
    select *
    into v_receipt
    from public.external_inquiry_receipts
    where external_inquiry_receipts.idempotency_key = v_idempotency_key;

    if found and v_receipt.payload_hash = v_payload_hash then
      inquiry_id := v_receipt.result_payload->>'inquiryId';
      customer_id := nullif(v_receipt.result_payload->>'customerId', '')::uuid;
      customer_reference := nullif(v_receipt.result_payload->>'customerReference', '');
      customer_created := false;
      mobile_normalized := nullif(v_receipt.result_payload->>'mobileNormalized', '');
      idempotency_key := v_receipt.idempotency_key;
      payload_hash := v_receipt.payload_hash;
      replay := true;
      return next;
      return;
    end if;

    raise;
end;
$$;

revoke all on function public.create_external_inquiry_identity_c2_3_1(text, text, text, text, text, text, text, date) from public;
revoke all on function public.create_external_inquiry_identity_c2_3_1(text, text, text, text, text, text, text, date) from anon;
revoke all on function public.create_external_inquiry_identity_c2_3_1(text, text, text, text, text, text, text, date) from authenticated;
grant execute on function public.create_external_inquiry_identity_c2_3_1(text, text, text, text, text, text, text, date) to service_role;

comment on function public.create_external_inquiry_identity_c2_3_1(text, text, text, text, text, text, text, date) is
  'C2.3.1 service-role-only atomic TRRY_WEB inquiry capture with exact-mobile customer identity linking and idempotent replay. Uses Supabase pgcrypto from extensions schema.';
