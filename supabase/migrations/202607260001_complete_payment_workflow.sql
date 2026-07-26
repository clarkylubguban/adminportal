-- Complete TRRY customer payment workflow without rewriting existing records.

alter table public.ops_inquiries
  add column if not exists payment_method text,
  add column if not exists payment_type text,
  add column if not exists payment_selected_amount numeric,
  add column if not exists payment_reference text,
  add column if not exists payment_customer_note text,
  add column if not exists payment_receipt_filename text,
  add column if not exists payment_receipt_content_type text,
  add column if not exists payment_receipt_size bigint,
  add column if not exists payment_verified_amount numeric,
  add column if not exists payment_verified_at timestamptz,
  add column if not exists payment_verified_by uuid references public.admin_users(user_id) on delete set null;

alter table public.ops_inquiries
  drop constraint if exists ops_inquiries_payment_status_check,
  drop constraint if exists ops_inquiries_payment_method_check,
  drop constraint if exists ops_inquiries_payment_type_check;

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
  );

insert into storage.buckets (id, name, public, file_size_limit)
values ('inquiry-artworks', 'inquiry-artworks', false, 10485760)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

create or replace function public.trry_payment_gate_satisfied(
  quote_total numeric,
  payment_status text,
  verified_amount numeric
)
returns boolean
language sql
immutable
as $$
  select
    case
      when coalesce(quote_total, 0) <= 0 then false
      when lower(coalesce(payment_status, '')) in ('paid', 'full_payment_confirmed', 'confirmed')
        and coalesce(verified_amount, 0) >= quote_total then true
      when quote_total >= 1000
        and lower(coalesce(payment_status, '')) in ('partially_paid', 'down_payment_confirmed')
        and coalesce(verified_amount, 0) >= round((quote_total * 0.5)::numeric, 2) then true
      else false
    end
$$;

create or replace function public.enforce_ops_inquiry_mvp_workflow()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  old_stage text;
  new_stage text;
  old_status text := lower(coalesce(old.status, ''));
  new_status text := lower(coalesce(new.status, ''));
  quote_total numeric := coalesce(new.quoted_amount, new.amount_due, 0);
  verified_amount numeric := coalesce(new.payment_verified_amount, new.payment_confirmed_amount, 0);
begin
  old_stage := case lower(coalesce(old.production_stage, 'queued'))
    when 'qc_finishing' then 'qc'
    when 'ready_for_fulfillment' then 'ready'
    else lower(coalesce(old.production_stage, 'queued'))
  end;
  new_stage := case lower(coalesce(new.production_stage, 'queued'))
    when 'qc_finishing' then 'qc'
    when 'ready_for_fulfillment' then 'ready'
    else lower(coalesce(new.production_stage, 'queued'))
  end;

  if new_status = 'won' and old_status is distinct from 'won' then
    if old_status in ('lost', 'cancelled', 'canceled')
      or lower(coalesce(new.quote_status, '')) <> 'approved'
      or coalesce(new.quoted_amount, 0) <= 0
      or nullif(btrim(coalesce(new.odoo_so, '')), '') is null then
      raise exception using errcode = '23514', message = 'Order conversion requires quote approval, a positive quote, and a confirmed Odoo SO.';
    end if;
  end if;

  if new.production_stage is distinct from old.production_stage then
    if new_status in ('lost', 'cancelled', 'canceled')
      or new_status <> 'won'
      or lower(coalesce(new.quote_status, '')) <> 'approved'
      or nullif(btrim(coalesce(new.odoo_so, '')), '') is null then
      raise exception using errcode = '23514', message = 'Production requires a confirmed, non-cancelled order with an Odoo SO.';
    end if;

    if not (
      (old_stage = 'queued' and new_stage in ('queued', 'printing', 'embroidery', 'screen_printing'))
      or (old_stage in ('printing', 'embroidery', 'screen_printing', 'in_production') and new_stage = 'qc')
      or (old_stage = 'qc' and new_stage = 'ready')
      or (old_stage = 'ready' and new_stage = 'completed')
    ) then
      raise exception using errcode = '23514', message = 'Invalid production stage transition.';
    end if;

    if old_stage = 'queued' and new_stage in ('printing', 'embroidery', 'screen_printing') then
      if nullif(btrim(coalesce(new.product_desc, new.product, '')), '') is null
        or nullif(btrim(coalesce(new.quantity::text, '')), '') is null
        or new.due_date is null
        or lower(coalesce(new.artwork_status, '')) <> 'approved'
        or nullif(btrim(coalesce(new.assigned_staff, '')), '') is null
        or nullif(btrim(coalesce(new.blocked_reason, '')), '') is not null
        or (quote_total > 0 and not public.trry_payment_gate_satisfied(quote_total, new.payment_status, verified_amount)) then
        raise exception using errcode = '23514', message = 'Production requirements are incomplete.';
      end if;
    end if;
  elsif old_stage in ('ready', 'completed') and (
    new.assigned_staff is distinct from old.assigned_staff
    or new.production_note is distinct from old.production_note
    or new.blocked_reason is distinct from old.blocked_reason
  ) then
    raise exception using errcode = '23514', message = 'Ready and completed production details are locked.';
  end if;

  if lower(coalesce(new.payment_status, '')) in ('down_payment_confirmed', 'partially_paid', 'full_payment_confirmed', 'paid', 'confirmed')
    and lower(coalesce(old.payment_status, '')) not in ('down_payment_confirmed', 'partially_paid', 'full_payment_confirmed', 'paid', 'confirmed') then
    if lower(coalesce(new.quote_status, '')) <> 'approved'
      or lower(coalesce(new.artwork_status, '')) <> 'approved'
      or coalesce(new.payment_confirmed_amount, new.payment_verified_amount, 0) <= 0
      or coalesce(new.payment_confirmed_at, new.payment_verified_at) is null then
      raise exception using errcode = '23514', message = 'Payment confirmation requires an approved quote, approved artwork, amount, and confirmation timestamp.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists ops_inquiries_mvp_workflow_guard on public.ops_inquiries;
create trigger ops_inquiries_mvp_workflow_guard
before update on public.ops_inquiries
for each row execute function public.enforce_ops_inquiry_mvp_workflow();

comment on column public.ops_inquiries.payment_method is 'Customer selected payment method: online, cash, gcash, bank_transfer, card, or other.';
comment on column public.ops_inquiries.payment_type is 'Customer selected payment type: full, down_payment, or shop.';
comment on column public.ops_inquiries.payment_selected_amount is 'Customer selected payment amount validated against the approved quote total.';
comment on column public.ops_inquiries.payment_verified_by is 'Admin auth user id that verified the payment.';
