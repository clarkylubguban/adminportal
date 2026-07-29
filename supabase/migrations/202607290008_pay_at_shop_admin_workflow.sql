-- Phase 8A: record full Pay at Shop payments atomically without enabling Pay Online.

alter table public.ops_inquiries
  add column if not exists payment_method text,
  add column if not exists payment_type text,
  add column if not exists payment_verified_amount numeric,
  add column if not exists payment_verified_at timestamptz,
  add column if not exists payment_verified_by uuid,
  add column if not exists payment_selected_at timestamptz,
  add column if not exists payment_internal_note text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ops_inquiries'::regclass
      and conname = 'ops_inquiries_payment_verified_by_fkey'
  ) then
    alter table public.ops_inquiries
      add constraint ops_inquiries_payment_verified_by_fkey
      foreign key (payment_verified_by)
      references public.admin_users(user_id)
      on delete set null;
  end if;
end
$$;

alter table public.ops_inquiries
  drop constraint if exists ops_inquiries_payment_status_check,
  drop constraint if exists ops_inquiries_payment_method_check,
  drop constraint if exists ops_inquiries_payment_type_check,
  drop constraint if exists ops_inquiries_payment_internal_note_length_check;

alter table public.ops_inquiries
  add constraint ops_inquiries_payment_status_check
  check (
    payment_status is null
    or payment_status in (
      'not_required',
      'required',
      'pay_at_shop',
      'payment_pending_at_shop',
      'proof_submitted',
      'under_review',
      'correction_required',
      'down_payment_confirmed',
      'partially_paid',
      'full_payment_confirmed',
      'paid',
      'confirmed'
    )
  ),
  add constraint ops_inquiries_payment_method_check
  check (
    payment_method is null
    or payment_method in ('online', 'cash', 'gcash', 'bank_transfer', 'card', 'other')
  ),
  add constraint ops_inquiries_payment_type_check
  check (
    payment_type is null
    or payment_type in ('full', 'down_payment', 'shop')
  ),
  add constraint ops_inquiries_payment_internal_note_length_check
  check (payment_internal_note is null or char_length(payment_internal_note) <= 500);

create table if not exists public.inquiry_payment_events (
  id uuid primary key default gen_random_uuid(),
  inquiry_id text not null references public.ops_inquiries(id),
  event_type text not null,
  previous_status text,
  next_status text not null,
  payment_method text,
  amount numeric,
  internal_note text,
  actor_user_id uuid references public.admin_users(user_id) on delete set null,
  actor_role text,
  source text not null,
  idempotency_key text,
  created_at timestamptz not null default now(),
  constraint inquiry_payment_events_event_type_check
    check (event_type in ('PAY_AT_SHOP_SELECTED', 'SHOP_PAYMENT_CONFIRMED')),
  constraint inquiry_payment_events_source_check
    check (source in ('CUSTOMER', 'ADMIN_PORTAL')),
  constraint inquiry_payment_events_method_check
    check (
      payment_method is null
      or payment_method in ('cash', 'gcash', 'bank_transfer', 'card', 'other')
    ),
  constraint inquiry_payment_events_amount_check
    check (amount is null or amount > 0),
  constraint inquiry_payment_events_note_length_check
    check (internal_note is null or char_length(internal_note) <= 500),
  constraint inquiry_payment_events_actor_role_check
    check (actor_role is null or actor_role in ('owner', 'admin', 'staff')),
  constraint inquiry_payment_events_idempotency_length_check
    check (
      idempotency_key is null
      or char_length(idempotency_key) between 8 and 120
    )
);

create index if not exists inquiry_payment_events_inquiry_id_idx
  on public.inquiry_payment_events (inquiry_id);

create index if not exists inquiry_payment_events_created_at_idx
  on public.inquiry_payment_events (created_at);

create unique index if not exists inquiry_payment_events_idempotency_key_uidx
  on public.inquiry_payment_events (idempotency_key)
  where idempotency_key is not null;

create unique index if not exists inquiry_payment_events_selection_once_uidx
  on public.inquiry_payment_events (inquiry_id, event_type)
  where event_type = 'PAY_AT_SHOP_SELECTED';

alter table public.inquiry_payment_events enable row level security;

revoke all on table public.inquiry_payment_events from public, anon, authenticated;
grant select on table public.inquiry_payment_events to authenticated;

drop policy if exists inquiry_payment_events_active_portal_read
  on public.inquiry_payment_events;

create policy inquiry_payment_events_active_portal_read
  on public.inquiry_payment_events
  for select
  to authenticated
  using (
    public.is_active_admin_user(array['owner', 'admin', 'staff'])
  );

create or replace function public.prevent_inquiry_payment_event_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'PAYMENT_EVENTS_APPEND_ONLY';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists inquiry_payment_events_append_only
  on public.inquiry_payment_events;

create trigger inquiry_payment_events_append_only
before update or delete on public.inquiry_payment_events
for each row execute function public.prevent_inquiry_payment_event_changes();

create or replace function public.mark_pay_at_shop_selection()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  entered_pay_at_shop boolean := false;
begin
  if new.payment_status in ('pay_at_shop', 'payment_pending_at_shop') then
    entered_pay_at_shop := tg_op = 'INSERT'
      or old.payment_status is null
      or old.payment_status not in ('pay_at_shop', 'payment_pending_at_shop');
  end if;

  if entered_pay_at_shop and new.payment_selected_at is null then
    new.payment_selected_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists ops_inquiries_mark_pay_at_shop_selection
  on public.ops_inquiries;

create trigger ops_inquiries_mark_pay_at_shop_selection
before insert or update of payment_status on public.ops_inquiries
for each row execute function public.mark_pay_at_shop_selection();

create or replace function public.record_pay_at_shop_selection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  entered_pay_at_shop boolean := false;
begin
  if new.payment_status in ('pay_at_shop', 'payment_pending_at_shop') then
    entered_pay_at_shop := tg_op = 'INSERT'
      or old.payment_status is null
      or old.payment_status not in ('pay_at_shop', 'payment_pending_at_shop');
  end if;

  if entered_pay_at_shop then
    insert into public.inquiry_payment_events (
      inquiry_id,
      event_type,
      previous_status,
      next_status,
      payment_method,
      amount,
      actor_user_id,
      actor_role,
      source
    )
    values (
      new.id,
      'PAY_AT_SHOP_SELECTED',
      case when tg_op = 'INSERT' then null else old.payment_status end,
      new.payment_status,
      new.payment_method,
      new.quoted_amount,
      null,
      null,
      'CUSTOMER'
    )
    on conflict (inquiry_id, event_type)
      where event_type = 'PAY_AT_SHOP_SELECTED'
      do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists ops_inquiries_record_pay_at_shop_selection
  on public.ops_inquiries;

create trigger ops_inquiries_record_pay_at_shop_selection
after insert or update of payment_status on public.ops_inquiries
for each row execute function public.record_pay_at_shop_selection();

create or replace function public.enforce_shop_payment_confirmation_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.payment_status in ('pay_at_shop', 'payment_pending_at_shop')
    and new.payment_status in ('full_payment_confirmed', 'paid', 'confirmed')
    and new.payment_type = 'shop'
    and not public.is_active_admin_user(array['owner', 'admin']) then
    raise exception using
      errcode = '42501',
      message = 'SHOP_PAYMENT_FORBIDDEN';
  end if;

  return new;
end;
$$;

drop trigger if exists ops_inquiries_shop_payment_actor_guard
  on public.ops_inquiries;

create trigger ops_inquiries_shop_payment_actor_guard
before update of payment_status on public.ops_inquiries
for each row execute function public.enforce_shop_payment_confirmation_actor();

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
begin
  if v_actor_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'AUTH_REQUIRED';
  end if;

  select admin_user.role, admin_user.display_name
  into v_actor_role, v_actor_display_name
  from public.admin_users as admin_user
  where admin_user.user_id = v_actor_user_id
    and admin_user.is_active = true
    and admin_user.role in ('owner', 'admin');

  if not found then
    raise exception using
      errcode = '42501',
      message = 'SHOP_PAYMENT_FORBIDDEN';
  end if;

  if v_method not in ('cash', 'gcash', 'bank_transfer', 'card', 'other') then
    raise exception using
      errcode = '22023',
      message = 'INVALID_PAYMENT_METHOD';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception using
      errcode = '22023',
      message = 'INVALID_PAYMENT_AMOUNT';
  end if;

  if v_note is not null and char_length(v_note) > 500 then
    raise exception using
      errcode = '22023',
      message = 'PAYMENT_NOTE_TOO_LONG';
  end if;

  if char_length(v_idempotency_key) not between 8 and 120
    or v_idempotency_key !~ '^[A-Za-z0-9._:-]+$' then
    raise exception using
      errcode = '22023',
      message = 'INVALID_IDEMPOTENCY_KEY';
  end if;

  select inquiry.*
  into v_inquiry
  from public.ops_inquiries as inquiry
  where inquiry.id = p_inquiry_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'INQUIRY_NOT_FOUND';
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

    raise exception using
      errcode = '23505',
      message = 'IDEMPOTENCY_KEY_CONFLICT';
  end if;

  if v_inquiry.payment_status not in ('pay_at_shop', 'payment_pending_at_shop') then
    if v_inquiry.payment_status in ('full_payment_confirmed', 'paid', 'confirmed') then
      raise exception using
        errcode = '23505',
        message = 'SHOP_PAYMENT_ALREADY_CONFIRMED';
    end if;

    raise exception using
      errcode = '22023',
      message = 'PAY_AT_SHOP_STATUS_REQUIRED';
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
    raise exception using
      errcode = '22023',
      message = 'PRODUCTION_ACTIVE_PAYMENT_LOCKED';
  end if;

  if lower(coalesce(v_inquiry.quote_status, '')) <> 'approved' then
    raise exception using
      errcode = '22023',
      message = 'APPROVED_QUOTE_REQUIRED';
  end if;

  if lower(coalesce(v_inquiry.artwork_status, '')) <> 'approved' then
    raise exception using
      errcode = '22023',
      message = 'APPROVED_ARTWORK_REQUIRED';
  end if;

  if coalesce(v_inquiry.quoted_amount, 0) <= 0 then
    raise exception using
      errcode = '22023',
      message = 'POSITIVE_QUOTE_REQUIRED';
  end if;

  if round(p_amount, 2) <> round(v_inquiry.quoted_amount, 2) then
    raise exception using
      errcode = '22023',
      message = 'FULL_QUOTE_AMOUNT_REQUIRED';
  end if;

  v_previous_status := v_inquiry.payment_status;

  update public.ops_inquiries
  set
    payment_status = 'full_payment_confirmed',
    payment_method = v_method,
    payment_type = 'shop',
    payment_confirmed_amount = round(p_amount, 2),
    payment_confirmed_at = v_confirmed_at,
    payment_verified_amount = round(p_amount, 2),
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
    round(p_amount, 2),
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

revoke execute on function public.confirm_inquiry_shop_payment(text, numeric, text, text, text)
  from public, anon;
grant execute on function public.confirm_inquiry_shop_payment(text, numeric, text, text, text)
  to authenticated;

comment on column public.ops_inquiries.payment_selected_at is
  'First timestamp when the customer selected Pay at Shop. Legacy records may be null.';
comment on column public.ops_inquiries.payment_internal_note is
  'Private Admin Portal note retained with a confirmed shop payment.';
comment on table public.inquiry_payment_events is
  'Append-only Pay at Shop selection and confirmation history.';
comment on function public.confirm_inquiry_shop_payment(text, numeric, text, text, text) is
  'Atomically confirms one full Pay at Shop payment for an active Owner or Admin.';
