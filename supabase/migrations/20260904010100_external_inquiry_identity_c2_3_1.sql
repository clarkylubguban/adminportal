-- Customer C2.3.1 external inquiry identity contract.
-- Service-role-only RPC for idempotent TRRY Web inquiry capture.

do $$
begin
  if not exists (
    select 1
    from pg_roles
    where rolname = 'trry_c2_3_1_external_inquiry_writer'
  ) then
    create role trry_c2_3_1_external_inquiry_writer nologin bypassrls;
  end if;
end
$$;

alter role trry_c2_3_1_external_inquiry_writer nologin bypassrls;

create table if not exists public.external_inquiry_receipts (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  external_source text not null,
  payload_hash text not null,
  inquiry_id text not null references public.ops_inquiries(id) on delete restrict,
  result_payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint external_inquiry_receipts_idempotency_key_unique unique (idempotency_key),
  constraint external_inquiry_receipts_inquiry_id_unique unique (inquiry_id),
  constraint external_inquiry_receipts_idempotency_key_check
    check (length(btrim(idempotency_key)) between 8 and 240),
  constraint external_inquiry_receipts_external_source_check
    check (external_source in ('TRRY_WEB')),
  constraint external_inquiry_receipts_payload_hash_check
    check (payload_hash ~ '^[a-f0-9]{64}$'),
  constraint external_inquiry_receipts_result_payload_check
    check (jsonb_typeof(result_payload) = 'object')
);

create table if not exists public.external_inquiry_link_authorizations_c2_3_1 (
  transaction_id xid8 not null,
  inquiry_id text not null,
  customer_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (transaction_id, inquiry_id, customer_id)
);

alter table public.external_inquiry_receipts enable row level security;
alter table public.external_inquiry_link_authorizations_c2_3_1 enable row level security;

revoke all privileges on table public.external_inquiry_receipts from public;
revoke all privileges on table public.external_inquiry_receipts from anon;
revoke all privileges on table public.external_inquiry_receipts from authenticated;
revoke all privileges on table public.external_inquiry_receipts from service_role;
revoke all privileges on table public.external_inquiry_link_authorizations_c2_3_1 from public;
revoke all privileges on table public.external_inquiry_link_authorizations_c2_3_1 from anon;
revoke all privileges on table public.external_inquiry_link_authorizations_c2_3_1 from authenticated;
revoke all privileges on table public.external_inquiry_link_authorizations_c2_3_1 from service_role;

grant usage on schema public to trry_c2_3_1_external_inquiry_writer;
grant usage on schema auth to trry_c2_3_1_external_inquiry_writer;
grant select, insert on table public.external_inquiry_receipts to trry_c2_3_1_external_inquiry_writer;
grant select, insert, delete on table public.external_inquiry_link_authorizations_c2_3_1 to trry_c2_3_1_external_inquiry_writer;
grant select, insert on table public.customers to trry_c2_3_1_external_inquiry_writer;
grant usage, select on sequence public.customer_reference_sequence to trry_c2_3_1_external_inquiry_writer;
grant select, insert on table public.ops_inquiries to trry_c2_3_1_external_inquiry_writer;
grant execute on function auth.uid() to trry_c2_3_1_external_inquiry_writer;
grant execute on function public.normalize_ph_mobile(text) to trry_c2_3_1_external_inquiry_writer;

create index if not exists external_inquiry_receipts_source_created_idx
  on public.external_inquiry_receipts (external_source, created_at desc);

create index if not exists external_inquiry_link_authorizations_created_idx
  on public.external_inquiry_link_authorizations_c2_3_1 (created_at);

create or replace function public.has_external_inquiry_link_authorization_c2_3_1(
  p_inquiry_id text,
  p_customer_id uuid
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.external_inquiry_link_authorizations_c2_3_1
    where inquiry_id = p_inquiry_id
      and customer_id = p_customer_id
  );
$$;

alter function public.has_external_inquiry_link_authorization_c2_3_1(text, uuid)
  owner to trry_c2_3_1_external_inquiry_writer;

revoke all on function public.has_external_inquiry_link_authorization_c2_3_1(text, uuid) from public;
grant execute on function public.has_external_inquiry_link_authorization_c2_3_1(text, uuid) to anon;
grant execute on function public.has_external_inquiry_link_authorization_c2_3_1(text, uuid) to authenticated;
grant execute on function public.has_external_inquiry_link_authorization_c2_3_1(text, uuid) to service_role;

create or replace function public.protect_ops_inquiry_customer_link_c2_1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.customer_id is not null then
      if public.has_external_inquiry_link_authorization_c2_3_1(new.id, new.customer_id) then
        return new;
      end if;

      if not public.is_active_admin_user(array['owner','admin','staff']) then
        raise exception 'active Owner/Admin/Staff access required to link inquiry customer'
          using errcode = '42501';
      end if;
    end if;

    return new;
  end if;

  if new.customer_id is not distinct from old.customer_id then
    return new;
  end if;

  if old.customer_id is null and new.customer_id is not null then
    if not public.is_active_admin_user(array['owner','admin','staff']) then
      raise exception 'active Owner/Admin/Staff access required to link inquiry customer'
        using errcode = '42501';
    end if;

    return new;
  end if;

  if not public.is_active_admin_user(array['owner','admin']) then
    raise exception 'only Owner/Admin can correct an inquiry customer link'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.orders
    where orders.source_inquiry_id = old.id
  ) then
    raise exception 'Inquiry customer link is immutable after order conversion'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.protect_ops_inquiry_customer_link_c2_1() is
  'C2.1 inquiry customer link protection with a narrow C2.3.1 external RPC insert capability.';

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
    public.digest(
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

alter function public.create_external_inquiry_identity_c2_3_1(text, text, text, text, text, text, text, date)
  owner to trry_c2_3_1_external_inquiry_writer;

revoke all on function public.create_external_inquiry_identity_c2_3_1(text, text, text, text, text, text, text, date) from public;
revoke all on function public.create_external_inquiry_identity_c2_3_1(text, text, text, text, text, text, text, date) from anon;
revoke all on function public.create_external_inquiry_identity_c2_3_1(text, text, text, text, text, text, text, date) from authenticated;
grant execute on function public.create_external_inquiry_identity_c2_3_1(text, text, text, text, text, text, text, date) to service_role;

comment on table public.external_inquiry_receipts is
  'C2.3.1 service-only idempotency receipts for external inquiry capture.';
comment on table public.external_inquiry_link_authorizations_c2_3_1 is
  'Private C2.3.1 per-transaction capability table allowing only the external RPC to insert linked inquiries.';
comment on function public.has_external_inquiry_link_authorization_c2_3_1(text, uuid) is
  'Checks the private C2.3.1 per-transaction linked inquiry capability without granting direct table access.';
comment on function public.create_external_inquiry_identity_c2_3_1(text, text, text, text, text, text, text, date) is
  'C2.3.1 service-role-only atomic TRRY_WEB inquiry capture with exact-mobile customer identity linking and idempotent replay.';
