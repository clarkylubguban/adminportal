-- Allow Admin staging to confirm approved exact 50% down payments without
-- permitting arbitrary partial payments.

create or replace function public.confirm_inquiry_shop_payment(
  p_inquiry_id text,
  p_amount numeric,
  p_payment_method text,
  p_internal_note text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := (select auth.uid());
  v_actor_role text;
  v_actor_display_name text;
  v_inquiry public.ops_inquiries%rowtype;
  v_existing_event public.inquiry_payment_events%rowtype;
  v_previous_status text;
  v_method text := lower(btrim(coalesce(p_payment_method, '')));
  v_note text := nullif(btrim(coalesce(p_internal_note, '')), '');
  v_idempotency_key text := btrim(coalesce(p_idempotency_key, ''));
  v_confirmed_at timestamptz := now();
  v_quote_total numeric;
  v_required_down_payment numeric;
  v_received_amount numeric;
  v_next_status text;
  v_payment_type text;
  v_remaining_balance numeric;
begin
  if v_actor_user_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select admin_user.role, admin_user.display_name
  into v_actor_role, v_actor_display_name
  from public.admin_users as admin_user
  where admin_user.user_id = v_actor_user_id
    and admin_user.is_active = true
    and admin_user.role in ('owner', 'admin');

  if not found then
    raise exception using errcode = '42501', message = 'SHOP_PAYMENT_FORBIDDEN';
  end if;

  if v_method not in ('cash', 'gcash', 'bank_transfer', 'card', 'other') then
    raise exception using errcode = '22023', message = 'INVALID_PAYMENT_METHOD';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception using errcode = '22023', message = 'INVALID_PAYMENT_AMOUNT';
  end if;

  if v_note is not null and char_length(v_note) > 500 then
    raise exception using errcode = '22023', message = 'PAYMENT_NOTE_TOO_LONG';
  end if;

  if char_length(v_idempotency_key) not between 8 and 120
    or v_idempotency_key !~ '^[A-Za-z0-9._:-]+$' then
    raise exception using errcode = '22023', message = 'INVALID_IDEMPOTENCY_KEY';
  end if;

  select inquiry.*
  into v_inquiry
  from public.ops_inquiries as inquiry
  where inquiry.id = p_inquiry_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'INQUIRY_NOT_FOUND';
  end if;

  select event.*
  into v_existing_event
  from public.inquiry_payment_events as event
  where event.idempotency_key = v_idempotency_key;

  if found then
    if v_existing_event.inquiry_id = v_inquiry.id
      and v_existing_event.event_type = 'SHOP_PAYMENT_CONFIRMED' then
      return jsonb_build_object(
        'inquiryId', v_inquiry.id,
        'paymentStatus', v_inquiry.payment_status,
        'paymentMethod', v_inquiry.payment_method,
        'paymentType', v_inquiry.payment_type,
        'paymentConfirmedAmount', v_inquiry.payment_confirmed_amount,
        'paymentConfirmedAt', v_inquiry.payment_confirmed_at,
        'paymentVerifiedAmount', v_inquiry.payment_verified_amount,
        'paymentVerifiedAt', v_inquiry.payment_verified_at,
        'paymentVerifiedBy', v_inquiry.payment_verified_by,
        'paymentInternalNote', v_inquiry.payment_internal_note,
        'actorDisplayName', v_actor_display_name,
        'actorRole', v_actor_role,
        'idempotent', true
      );
    end if;

    raise exception using errcode = '23505', message = 'IDEMPOTENCY_KEY_CONFLICT';
  end if;

  if v_inquiry.payment_status not in ('pay_at_shop', 'payment_pending_at_shop') then
    if v_inquiry.payment_status in ('down_payment_confirmed', 'partially_paid', 'full_payment_confirmed', 'paid', 'confirmed') then
      raise exception using errcode = '23505', message = 'SHOP_PAYMENT_ALREADY_CONFIRMED';
    end if;
    raise exception using errcode = '22023', message = 'PAY_AT_SHOP_STATUS_REQUIRED';
  end if;

  if lower(coalesce(v_inquiry.production_stage, 'queued')) in (
    'printing',
    'embroidery',
    'screen_printing',
    'qc',
    'ready',
    'in_production',
    'qc_finishing',
    'ready_for_fulfillment',
    'completed'
  ) then
    raise exception using errcode = '22023', message = 'PRODUCTION_ACTIVE_PAYMENT_LOCKED';
  end if;

  if lower(coalesce(v_inquiry.quote_status, '')) <> 'approved' then
    raise exception using errcode = '22023', message = 'APPROVED_QUOTE_REQUIRED';
  end if;

  if lower(coalesce(v_inquiry.artwork_status, '')) <> 'approved' then
    raise exception using errcode = '22023', message = 'APPROVED_ARTWORK_REQUIRED';
  end if;

  if coalesce(v_inquiry.quoted_amount, 0) <= 0 then
    raise exception using errcode = '22023', message = 'POSITIVE_QUOTE_REQUIRED';
  end if;

  v_quote_total := round(v_inquiry.quoted_amount, 2);
  v_required_down_payment := round(v_quote_total * 0.5, 2);
  v_received_amount := round(p_amount, 2);

  if v_received_amount = v_quote_total then
    v_next_status := 'full_payment_confirmed';
    v_payment_type := 'shop';
    v_remaining_balance := 0;
  elsif v_quote_total >= 1000 and v_received_amount = v_required_down_payment then
    v_next_status := 'down_payment_confirmed';
    v_payment_type := 'down_payment';
    v_remaining_balance := round(v_quote_total - v_required_down_payment, 2);
  else
    raise exception using
      errcode = '22023',
      message = case
        when v_quote_total >= 1000 then 'APPROVED_PAYMENT_AMOUNT_REQUIRED'
        else 'FULL_QUOTE_AMOUNT_REQUIRED'
      end;
  end if;

  v_previous_status := v_inquiry.payment_status;

  update public.ops_inquiries
  set
    payment_status = v_next_status,
    payment_method = v_method,
    payment_type = v_payment_type,
    payment_selected_amount = v_received_amount,
    amount_due = v_remaining_balance,
    payment_confirmed_amount = v_received_amount,
    payment_confirmed_at = v_confirmed_at,
    payment_verified_amount = v_received_amount,
    payment_verified_at = v_confirmed_at,
    payment_verified_by = v_actor_user_id,
    payment_internal_note = v_note,
    payment_review_note = null,
    payment_rejected_at = null,
    updated_at = v_confirmed_at
  where id = v_inquiry.id
  returning * into v_inquiry;

  insert into public.inquiry_payment_events (
    inquiry_id,
    event_type,
    previous_status,
    next_status,
    payment_method,
    amount,
    internal_note,
    actor_user_id,
    actor_role,
    source,
    idempotency_key,
    created_at
  )
  values (
    v_inquiry.id,
    'SHOP_PAYMENT_CONFIRMED',
    v_previous_status,
    v_inquiry.payment_status,
    v_method,
    v_received_amount,
    v_note,
    v_actor_user_id,
    v_actor_role,
    'ADMIN_PORTAL',
    v_idempotency_key,
    v_confirmed_at
  );

  return jsonb_build_object(
    'inquiryId', v_inquiry.id,
    'paymentStatus', v_inquiry.payment_status,
    'paymentMethod', v_inquiry.payment_method,
    'paymentType', v_inquiry.payment_type,
    'paymentConfirmedAmount', v_inquiry.payment_confirmed_amount,
    'paymentConfirmedAt', v_inquiry.payment_confirmed_at,
    'paymentVerifiedAmount', v_inquiry.payment_verified_amount,
    'paymentVerifiedAt', v_inquiry.payment_verified_at,
    'paymentVerifiedBy', v_inquiry.payment_verified_by,
    'paymentInternalNote', v_inquiry.payment_internal_note,
    'actorDisplayName', v_actor_display_name,
    'actorRole', v_actor_role,
    'idempotent', false
  );
end;
$$;

create or replace function public.review_online_payment(
  p_inquiry_id text,
  p_action text,
  p_verified_amount numeric,
  p_review_note text,
  p_internal_note text,
  p_expected_updated_at timestamptz,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := (select auth.uid());
  v_actor_role text;
  v_actor_display_name text;
  v_inquiry public.ops_inquiries%rowtype;
  v_existing_event public.inquiry_payment_events%rowtype;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_event_type text;
  v_next_status text;
  v_review_note text := nullif(btrim(coalesce(p_review_note, '')), '');
  v_internal_note text := nullif(btrim(coalesce(p_internal_note, '')), '');
  v_idempotency_key text := btrim(coalesce(p_idempotency_key, ''));
  v_previous_status text;
  v_reviewed_at timestamptz := now();
  v_quote_total numeric;
  v_expected_amount numeric;
  v_remaining_balance numeric;
begin
  if v_actor_user_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select admin_user.role, admin_user.display_name
  into v_actor_role, v_actor_display_name
  from public.admin_users as admin_user
  where admin_user.user_id = v_actor_user_id
    and admin_user.is_active = true
    and admin_user.role in ('owner', 'admin');

  if not found then
    raise exception using errcode = '42501', message = 'ONLINE_PAYMENT_REVIEW_FORBIDDEN';
  end if;

  case v_action
    when 'start_online_payment_review' then
      v_event_type := 'ONLINE_PAYMENT_REVIEW_STARTED';
      v_next_status := 'under_review';
    when 'confirm_online_payment' then
      v_event_type := 'ONLINE_PAYMENT_CONFIRMED';
    when 'request_online_payment_correction' then
      v_event_type := 'ONLINE_PAYMENT_CORRECTION_REQUESTED';
      v_next_status := 'correction_required';
    else
      raise exception using errcode = '22023', message = 'INVALID_ONLINE_PAYMENT_ACTION';
  end case;

  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'PAYMENT_VERSION_REQUIRED';
  end if;

  if char_length(v_idempotency_key) not between 8 and 120
    or v_idempotency_key !~ '^[A-Za-z0-9._:-]+$' then
    raise exception using errcode = '22023', message = 'INVALID_IDEMPOTENCY_KEY';
  end if;

  if v_review_note is not null and char_length(v_review_note) > 1000 then
    raise exception using errcode = '22023', message = 'PAYMENT_REVIEW_NOTE_TOO_LONG';
  end if;

  if v_internal_note is not null and char_length(v_internal_note) > 500 then
    raise exception using errcode = '22023', message = 'PAYMENT_INTERNAL_NOTE_TOO_LONG';
  end if;

  if v_action = 'request_online_payment_correction'
    and (v_review_note is null or char_length(v_review_note) < 5) then
    raise exception using errcode = '22023', message = 'PAYMENT_CORRECTION_REASON_REQUIRED';
  end if;

  if v_action = 'confirm_online_payment'
    and (
      p_verified_amount is null
      or p_verified_amount <= 0
      or p_verified_amount <> round(p_verified_amount, 2)
    ) then
    raise exception using errcode = '22023', message = 'INVALID_VERIFIED_AMOUNT';
  end if;

  select inquiry.*
  into v_inquiry
  from public.ops_inquiries as inquiry
  where inquiry.id = p_inquiry_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'INQUIRY_NOT_FOUND';
  end if;

  select event.*
  into v_existing_event
  from public.inquiry_payment_events as event
  where event.idempotency_key = v_idempotency_key;

  if found then
    if v_existing_event.inquiry_id = v_inquiry.id
      and v_existing_event.event_type = v_event_type
      and v_existing_event.expected_version is not distinct from p_expected_updated_at
      and (
        v_action <> 'confirm_online_payment'
        or v_existing_event.amount is not distinct from round(p_verified_amount, 2)
      )
      and v_existing_event.review_note is not distinct from v_review_note
      and v_existing_event.internal_note is not distinct from v_internal_note then
      return jsonb_build_object(
        'inquiryId', v_existing_event.inquiry_id,
        'paymentStatus', v_existing_event.next_status,
        'eventType', v_existing_event.event_type,
        'idempotent', true
      );
    end if;

    raise exception using errcode = '23505', message = 'IDEMPOTENCY_KEY_CONFLICT';
  end if;

  if v_inquiry.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'PAYMENT_STALE_VERSION';
  end if;

  if v_inquiry.payment_type = 'shop'
    or v_inquiry.payment_status in ('pay_at_shop', 'payment_pending_at_shop') then
    raise exception using errcode = '22023', message = 'PAY_AT_SHOP_REVIEW_FORBIDDEN';
  end if;

  if coalesce(v_inquiry.payment_method, '') not in ('gcash', 'bank_transfer') then
    raise exception using errcode = '22023', message = 'ONLINE_PAYMENT_METHOD_REQUIRED';
  end if;

  if lower(coalesce(v_inquiry.quote_status, '')) <> 'approved' then
    raise exception using errcode = '22023', message = 'APPROVED_QUOTE_REQUIRED';
  end if;

  if lower(coalesce(v_inquiry.artwork_status, '')) <> 'approved' then
    raise exception using errcode = '22023', message = 'APPROVED_ARTWORK_REQUIRED';
  end if;

  if coalesce(v_inquiry.quoted_amount, 0) <= 0 then
    raise exception using errcode = '22023', message = 'POSITIVE_QUOTE_REQUIRED';
  end if;

  v_quote_total := round(v_inquiry.quoted_amount, 2);

  if coalesce(v_inquiry.payment_type, '') = 'full' then
    v_expected_amount := v_quote_total;
    v_next_status := 'full_payment_confirmed';
    v_remaining_balance := 0;
  elsif coalesce(v_inquiry.payment_type, '') = 'down_payment' and v_quote_total >= 1000 then
    v_expected_amount := round(v_quote_total * 0.5, 2);
    v_next_status := 'down_payment_confirmed';
    v_remaining_balance := round(v_quote_total - v_expected_amount, 2);
  else
    raise exception using errcode = '22023', message = 'INVALID_PAYMENT_TYPE';
  end if;

  if v_inquiry.payment_selected_amount is null
    or round(v_inquiry.payment_selected_amount, 2) <> v_expected_amount then
    raise exception using errcode = '22023', message = 'SUBMITTED_AMOUNT_MISMATCH';
  end if;

  if nullif(btrim(coalesce(v_inquiry.payment_proof_path, '')), '') is null
    or v_inquiry.payment_proof_path not like v_inquiry.id || '/payments/%'
    or substring(
      v_inquiry.payment_proof_path
      from char_length(v_inquiry.id) + char_length('/payments/') + 1
    ) like '%/%'
    or position(chr(92) in v_inquiry.payment_proof_path) > 0
    or v_inquiry.payment_proof_path like '%..%'
    or lower(v_inquiry.payment_proof_path) !~ '\.(png|jpe?g|pdf)$' then
    raise exception using errcode = '22023', message = 'PAYMENT_PROOF_REQUIRED';
  end if;

  if nullif(btrim(coalesce(v_inquiry.payment_receipt_filename, '')), '') is null
    or v_inquiry.payment_receipt_filename like '%/%'
    or position(chr(92) in v_inquiry.payment_receipt_filename) > 0
    or v_inquiry.payment_receipt_filename like '%..%' then
    raise exception using errcode = '22023', message = 'PAYMENT_PROOF_FILENAME_REQUIRED';
  end if;

  if coalesce(v_inquiry.payment_receipt_content_type, '') not in (
    'image/png',
    'image/jpeg',
    'application/pdf'
  ) then
    raise exception using errcode = '22023', message = 'UNSAFE_PAYMENT_PROOF_TYPE';
  end if;

  if not (
    (
      v_inquiry.payment_receipt_content_type = 'application/pdf'
      and lower(v_inquiry.payment_proof_path) ~ '\.pdf$'
      and lower(v_inquiry.payment_receipt_filename) ~ '\.pdf$'
    )
    or (
      v_inquiry.payment_receipt_content_type = 'image/png'
      and lower(v_inquiry.payment_proof_path) ~ '\.png$'
      and lower(v_inquiry.payment_receipt_filename) ~ '\.png$'
    )
    or (
      v_inquiry.payment_receipt_content_type = 'image/jpeg'
      and lower(v_inquiry.payment_proof_path) ~ '\.jpe?g$'
      and lower(v_inquiry.payment_receipt_filename) ~ '\.jpe?g$'
    )
  ) then
    raise exception using errcode = '22023', message = 'PAYMENT_PROOF_METADATA_MISMATCH';
  end if;

  if v_inquiry.payment_receipt_size is null
    or v_inquiry.payment_receipt_size <= 0
    or v_inquiry.payment_receipt_size > 10485760 then
    raise exception using errcode = '22023', message = 'INVALID_PAYMENT_PROOF_SIZE';
  end if;

  if v_action = 'start_online_payment_review'
    and coalesce(v_inquiry.payment_status, '') <> 'proof_submitted' then
    raise exception using errcode = '22023', message = 'PAYMENT_STATUS_NOT_REVIEWABLE';
  end if;

  if v_action in ('confirm_online_payment', 'request_online_payment_correction')
    and coalesce(v_inquiry.payment_status, '') not in ('proof_submitted', 'under_review') then
    if v_inquiry.payment_status in ('down_payment_confirmed', 'partially_paid', 'full_payment_confirmed', 'paid', 'confirmed') then
      raise exception using errcode = '23505', message = 'ONLINE_PAYMENT_ALREADY_CONFIRMED';
    end if;
    raise exception using errcode = '22023', message = 'PAYMENT_STATUS_NOT_REVIEWABLE';
  end if;

  if v_action = 'confirm_online_payment'
    and round(p_verified_amount, 2) <> v_expected_amount then
    raise exception using errcode = '22023', message = 'VERIFIED_AMOUNT_MISMATCH';
  end if;

  v_previous_status := v_inquiry.payment_status;

  update public.ops_inquiries
  set
    payment_status = v_next_status,
    payment_confirmed_amount = case
      when v_action = 'confirm_online_payment' then round(p_verified_amount, 2)
      else payment_confirmed_amount
    end,
    payment_confirmed_at = case
      when v_action = 'confirm_online_payment' then v_reviewed_at
      else payment_confirmed_at
    end,
    payment_verified_amount = case
      when v_action = 'confirm_online_payment' then round(p_verified_amount, 2)
      else payment_verified_amount
    end,
    payment_verified_at = case
      when v_action = 'confirm_online_payment' then v_reviewed_at
      else payment_verified_at
    end,
    payment_verified_by = case
      when v_action = 'confirm_online_payment' then v_actor_user_id
      else payment_verified_by
    end,
    amount_due = case
      when v_action = 'confirm_online_payment' then v_remaining_balance
      else amount_due
    end,
    payment_review_note = case
      when v_action = 'request_online_payment_correction' then v_review_note
      when v_action = 'confirm_online_payment' then null
      else payment_review_note
    end,
    payment_rejected_at = case
      when v_action = 'request_online_payment_correction' then v_reviewed_at
      when v_action = 'confirm_online_payment' then null
      else payment_rejected_at
    end,
    payment_internal_note = coalesce(v_internal_note, payment_internal_note),
    updated_at = v_reviewed_at
  where id = v_inquiry.id
  returning * into v_inquiry;

  insert into public.inquiry_payment_events (
    inquiry_id,
    event_type,
    previous_status,
    next_status,
    payment_method,
    amount,
    review_note,
    internal_note,
    actor_user_id,
    actor_role,
    source,
    idempotency_key,
    expected_version,
    created_at
  )
  values (
    v_inquiry.id,
    v_event_type,
    v_previous_status,
    v_next_status,
    v_inquiry.payment_method,
    case
      when v_action = 'confirm_online_payment' then round(p_verified_amount, 2)
      else v_inquiry.payment_selected_amount
    end,
    v_review_note,
    v_internal_note,
    v_actor_user_id,
    v_actor_role,
    'ADMIN_PORTAL',
    v_idempotency_key,
    p_expected_updated_at,
    v_reviewed_at
  );

  return jsonb_build_object(
    'inquiryId', v_inquiry.id,
    'paymentStatus', v_inquiry.payment_status,
    'eventType', v_event_type,
    'actorDisplayName', v_actor_display_name,
    'actorRole', v_actor_role,
    'updatedAt', v_inquiry.updated_at,
    'idempotent', false
  );
end;
$$;

revoke execute on function public.confirm_inquiry_shop_payment(text, numeric, text, text, text)
  from public, anon;
grant execute on function public.confirm_inquiry_shop_payment(text, numeric, text, text, text)
  to authenticated;

revoke execute on function public.review_online_payment(
  text, text, numeric, text, text, timestamptz, text
) from public, anon;
grant execute on function public.review_online_payment(
  text, text, numeric, text, text, timestamptz, text
) to authenticated;
