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
      or coalesce(new.quoted_amount, 0) <= 0 then
      raise exception using errcode = '23514', message = 'Order conversion requires a non-cancelled inquiry, quote approval, and a positive quote.';
    end if;
  end if;

  if new.production_stage is distinct from old.production_stage then
    if new_status in ('lost', 'cancelled', 'canceled')
      or new_status <> 'won'
      or lower(coalesce(new.quote_status, '')) <> 'approved' then
      raise exception using errcode = '23514', message = 'Production requires a confirmed, non-cancelled TRRY order with an approved quote.';
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
        or nullif(btrim(coalesce(new.blocked_reason, '')), '') is not null then
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
$$;;
