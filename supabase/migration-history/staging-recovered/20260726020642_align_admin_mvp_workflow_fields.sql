alter table public.ops_inquiries
  add column if not exists company text,
  add column if not exists channel text,
  add column if not exists product_desc text,
  add column if not exists size_breakdown text,
  add column if not exists owner_id text,
  add column if not exists blocked_reason text,
  add column if not exists lost_reason text,
  add column if not exists quote_sent_at timestamptz,
  add column if not exists customer_response text;

alter table public.ops_inquiries
  drop constraint if exists ops_inquiries_production_stage_check;

alter table public.ops_inquiries
  add constraint ops_inquiries_production_stage_check
  check (
    production_stage is null
    or production_stage in (
      'queued',
      'printing',
      'embroidery',
      'screen_printing',
      'qc',
      'ready',
      'completed',
      'in_production',
      'qc_finishing',
      'ready_for_fulfillment'
    )
  );

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
        or (coalesce(new.amount_due, 0) > 0 and lower(coalesce(new.payment_status, '')) not in ('confirmed', 'paid')) then
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

  if lower(coalesce(new.payment_status, '')) in ('confirmed', 'paid')
    and lower(coalesce(old.payment_status, '')) not in ('confirmed', 'paid') then
    if lower(coalesce(new.quote_status, '')) <> 'approved'
      or lower(coalesce(new.artwork_status, '')) <> 'approved'
      or nullif(btrim(coalesce(new.payment_proof_path, '')), '') is null
      or coalesce(new.payment_confirmed_amount, 0) <= 0
      or new.payment_confirmed_at is null then
      raise exception using errcode = '23514', message = 'Payment confirmation requires an approved quote, approved artwork, receipt, amount, and confirmation timestamp.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists ops_inquiries_mvp_workflow_guard on public.ops_inquiries;

create trigger ops_inquiries_mvp_workflow_guard
before update on public.ops_inquiries
for each row execute function public.enforce_ops_inquiry_mvp_workflow();;
