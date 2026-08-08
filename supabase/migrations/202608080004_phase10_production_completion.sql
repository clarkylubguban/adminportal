-- Phase 10B-A: durable Production completion metadata on the existing
-- ops_inquiries compatibility surface. "completed" here means Production
-- responsibility has been handed off, not customer fulfillment completion.

alter table public.ops_inquiries
  add column if not exists production_completed_at timestamptz,
  add column if not exists production_completed_by uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ops_inquiries_production_completed_by_fkey'
      and conrelid = 'public.ops_inquiries'::regclass
  ) then
    alter table public.ops_inquiries
      add constraint ops_inquiries_production_completed_by_fkey
      foreign key (production_completed_by)
      references public.admin_users(user_id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'ops_inquiries_production_completion_after_qc_check'
      and conrelid = 'public.ops_inquiries'::regclass
  ) then
    alter table public.ops_inquiries
      add constraint ops_inquiries_production_completion_after_qc_check
      check (
        production_completed_at is null
        or (qc_completed_at is not null and production_completed_at >= qc_completed_at)
      );
  end if;
end $$;

create index if not exists ops_inquiries_production_completed_at_idx
  on public.ops_inquiries (production_completed_at)
  where production_completed_at is not null;

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
  old_started boolean := old.production_started_at is not null;
  new_started boolean := new.production_started_at is not null;
  old_qc_started boolean := old.qc_started_at is not null;
  new_qc_started boolean := new.qc_started_at is not null;
  old_qc_completed boolean := old.qc_completed_at is not null;
  new_qc_completed boolean := new.qc_completed_at is not null;
  old_production_completed boolean := old.production_completed_at is not null;
  new_production_completed boolean := new.production_completed_at is not null;
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
      if new.production_started_at is not null or new.production_started_by is not null then
        raise exception using errcode = '23514', message = 'Release to production must not mark production started.';
      end if;

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

    if old_stage in ('printing', 'embroidery', 'screen_printing', 'in_production') and new_stage = 'qc' then
      if not new_started then
        raise exception using errcode = '23514', message = 'Production must be started before Quality Check.';
      end if;
      if not new_qc_started then
        raise exception using errcode = '23514', message = 'Quality Check entry metadata is required.';
      end if;
    end if;

    if old_stage = 'qc' and new_stage = 'ready' then
      if nullif(btrim(coalesce(new.blocked_reason, '')), '') is not null then
        raise exception using errcode = '23514', message = 'Blocked production cannot complete Quality Check.';
      end if;
      if not new_qc_started or not new_qc_completed then
        raise exception using errcode = '23514', message = 'Quality Check completion metadata is required.';
      end if;
      if new.qc_completed_at < new.qc_started_at then
        raise exception using errcode = '23514', message = 'Quality Check completion cannot predate start.';
      end if;
    end if;

    if old_stage = 'ready' and new_stage = 'completed' then
      if nullif(btrim(coalesce(new.blocked_reason, '')), '') is not null then
        raise exception using errcode = '23514', message = 'Blocked production cannot be completed.';
      end if;
      if not new_qc_completed then
        raise exception using errcode = '23514', message = 'Quality Check completion is required before Production completion.';
      end if;
      if not new_production_completed then
        raise exception using errcode = '23514', message = 'Production completion metadata is required.';
      end if;
      if new.production_completed_at < new.qc_completed_at then
        raise exception using errcode = '23514', message = 'Production completion cannot predate Quality Check completion.';
      end if;
    end if;
  elsif old_stage in ('ready', 'completed') and (
    new.assigned_staff is distinct from old.assigned_staff
    or new.production_note is distinct from old.production_note
    or new.qc_note is distinct from old.qc_note
    or new.blocked_reason is distinct from old.blocked_reason
    or new.production_started_at is distinct from old.production_started_at
    or new.production_started_by is distinct from old.production_started_by
    or new.qc_started_at is distinct from old.qc_started_at
    or new.qc_started_by is distinct from old.qc_started_by
    or new.qc_completed_at is distinct from old.qc_completed_at
    or new.qc_completed_by is distinct from old.qc_completed_by
    or new.production_completed_at is distinct from old.production_completed_at
    or new.production_completed_by is distinct from old.production_completed_by
  ) then
    raise exception using errcode = '23514', message = 'Ready and completed production details are locked.';
  end if;

  if old_started and (
    new.production_started_at is distinct from old.production_started_at
    or new.production_started_by is distinct from old.production_started_by
  ) then
    raise exception using errcode = '23514', message = 'Production start is immutable.';
  end if;

  if old_qc_started and (
    new.qc_started_at is distinct from old.qc_started_at
    or new.qc_started_by is distinct from old.qc_started_by
  ) then
    raise exception using errcode = '23514', message = 'Quality Check start is immutable.';
  end if;

  if old_qc_completed and (
    new.qc_completed_at is distinct from old.qc_completed_at
    or new.qc_completed_by is distinct from old.qc_completed_by
  ) then
    raise exception using errcode = '23514', message = 'Quality Check completion is immutable.';
  end if;

  if old_production_completed and (
    new.production_completed_at is distinct from old.production_completed_at
    or new.production_completed_by is distinct from old.production_completed_by
  ) then
    raise exception using errcode = '23514', message = 'Production completion is immutable.';
  end if;

  if not old_started and new_started then
    if new_status in ('lost', 'cancelled', 'canceled')
      or new_status <> 'won'
      or lower(coalesce(new.quote_status, '')) <> 'approved'
      or nullif(btrim(coalesce(new.odoo_so, '')), '') is null
      or new_stage not in ('printing', 'embroidery', 'screen_printing')
      or nullif(btrim(coalesce(new.blocked_reason, '')), '') is not null then
      raise exception using errcode = '23514', message = 'Production can only start after release to an active station.';
    end if;

    if new.production_started_by is not null and not exists (
      select 1
      from public.admin_users
      where user_id = new.production_started_by
        and is_active = true
        and role in ('owner', 'admin', 'staff')
    ) then
      raise exception using errcode = '23514', message = 'Production start actor must be an active operational admin user.';
    end if;
  end if;

  if not old_qc_started and new_qc_started then
    if new_status in ('lost', 'cancelled', 'canceled')
      or new_status <> 'won'
      or lower(coalesce(new.quote_status, '')) <> 'approved'
      or nullif(btrim(coalesce(new.odoo_so, '')), '') is null
      or not new_started
      or new_stage not in ('qc', 'ready')
      or nullif(btrim(coalesce(new.blocked_reason, '')), '') is not null then
      raise exception using errcode = '23514', message = 'Quality Check can only start after production has started.';
    end if;

    if new.qc_started_by is not null and not exists (
      select 1
      from public.admin_users
      where user_id = new.qc_started_by
        and is_active = true
        and role in ('owner', 'admin', 'staff')
    ) then
      raise exception using errcode = '23514', message = 'Quality Check start actor must be an active operational admin user.';
    end if;
  end if;

  if not old_qc_completed and new_qc_completed then
    if not new_qc_started
      or new.qc_completed_at < new.qc_started_at
      or new_stage not in ('ready', 'completed')
      or nullif(btrim(coalesce(new.blocked_reason, '')), '') is not null then
      raise exception using errcode = '23514', message = 'Quality Check can only complete into Ready for Fulfillment.';
    end if;

    if new.qc_completed_by is not null and not exists (
      select 1
      from public.admin_users
      where user_id = new.qc_completed_by
        and is_active = true
        and role in ('owner', 'admin', 'staff')
    ) then
      raise exception using errcode = '23514', message = 'Quality Check completion actor must be an active operational admin user.';
    end if;
  end if;

  if not old_production_completed and new_production_completed then
    if new_status in ('lost', 'cancelled', 'canceled')
      or new_status <> 'won'
      or lower(coalesce(new.quote_status, '')) <> 'approved'
      or nullif(btrim(coalesce(new.odoo_so, '')), '') is null
      or new_stage <> 'completed'
      or not new_qc_completed
      or new.production_completed_at < new.qc_completed_at
      or nullif(btrim(coalesce(new.blocked_reason, '')), '') is not null then
      raise exception using errcode = '23514', message = 'Production completion can only close Ready for Fulfillment work.';
    end if;

    if new.production_completed_by is not null and not exists (
      select 1
      from public.admin_users
      where user_id = new.production_completed_by
        and is_active = true
        and role in ('owner', 'admin', 'staff')
    ) then
      raise exception using errcode = '23514', message = 'Production completion actor must be an active operational admin user.';
    end if;
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
