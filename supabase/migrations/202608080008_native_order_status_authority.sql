-- Phase 13-R6: align public.orders.status with native Order coarse lifecycle authority.
-- Production execution details remain owned by public.ops_inquiries production fields.

alter table public.orders
  drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check
  check (status in ('awaiting_payment', 'paid', 'ready_to_release', 'released', 'completed'));

alter table public.orders
  alter column status set default 'awaiting_payment';

update public.orders orders
set
  status = case
    when lower(coalesce(inquiries.tracking_substatus, '')) = 'completed'
      then 'completed'
    when lower(coalesce(inquiries.production_stage, '')) in ('printing', 'embroidery', 'screen_printing', 'qc', 'ready', 'completed')
      then 'released'
    when
      nullif(btrim(coalesce(inquiries.product_desc, inquiries.product, '')), '') is not null
      and nullif(btrim(coalesce(inquiries.quantity, '')), '') is not null
      and inquiries.due_date is not null
      and lower(coalesce(inquiries.artwork_status, '')) = 'approved'
      and nullif(btrim(coalesce(inquiries.assigned_staff, '')), '') is not null
      and nullif(btrim(coalesce(inquiries.blocked_reason, '')), '') is null
      and coalesce(inquiries.quoted_amount, inquiries.amount_due, 0) > 0
      and lower(coalesce(inquiries.payment_status, '')) in ('paid', 'full_payment_confirmed', 'confirmed')
      and greatest(coalesce(inquiries.payment_verified_amount, 0), coalesce(inquiries.payment_confirmed_amount, 0)) >= coalesce(inquiries.quoted_amount, inquiries.amount_due, 0)
      then 'ready_to_release'
    when
      coalesce(inquiries.quoted_amount, inquiries.amount_due, 0) > 0
      and lower(coalesce(inquiries.payment_status, '')) in ('paid', 'full_payment_confirmed', 'confirmed')
      and greatest(coalesce(inquiries.payment_verified_amount, 0), coalesce(inquiries.payment_confirmed_amount, 0)) >= coalesce(inquiries.quoted_amount, inquiries.amount_due, 0)
      then 'paid'
    else 'awaiting_payment'
  end,
  updated_at = now()
from public.ops_inquiries inquiries
where inquiries.id = orders.source_inquiry_id
  and orders.status is distinct from case
    when lower(coalesce(inquiries.tracking_substatus, '')) = 'completed'
      then 'completed'
    when lower(coalesce(inquiries.production_stage, '')) in ('printing', 'embroidery', 'screen_printing', 'qc', 'ready', 'completed')
      then 'released'
    when
      nullif(btrim(coalesce(inquiries.product_desc, inquiries.product, '')), '') is not null
      and nullif(btrim(coalesce(inquiries.quantity, '')), '') is not null
      and inquiries.due_date is not null
      and lower(coalesce(inquiries.artwork_status, '')) = 'approved'
      and nullif(btrim(coalesce(inquiries.assigned_staff, '')), '') is not null
      and nullif(btrim(coalesce(inquiries.blocked_reason, '')), '') is null
      and coalesce(inquiries.quoted_amount, inquiries.amount_due, 0) > 0
      and lower(coalesce(inquiries.payment_status, '')) in ('paid', 'full_payment_confirmed', 'confirmed')
      and greatest(coalesce(inquiries.payment_verified_amount, 0), coalesce(inquiries.payment_confirmed_amount, 0)) >= coalesce(inquiries.quoted_amount, inquiries.amount_due, 0)
      then 'ready_to_release'
    when
      coalesce(inquiries.quoted_amount, inquiries.amount_due, 0) > 0
      and lower(coalesce(inquiries.payment_status, '')) in ('paid', 'full_payment_confirmed', 'confirmed')
      and greatest(coalesce(inquiries.payment_verified_amount, 0), coalesce(inquiries.payment_confirmed_amount, 0)) >= coalesce(inquiries.quoted_amount, inquiries.amount_due, 0)
      then 'paid'
    else 'awaiting_payment'
  end;
