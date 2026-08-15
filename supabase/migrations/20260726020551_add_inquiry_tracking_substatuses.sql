alter table public.ops_inquiries
  add column if not exists tracking_substatus text,
  add column if not exists tracking_note text,
  add column if not exists tracking_updated_at timestamptz;

alter table public.ops_inquiries
  drop constraint if exists ops_inquiries_tracking_substatus_check;

alter table public.ops_inquiries
  add constraint ops_inquiries_tracking_substatus_check
  check (
    tracking_substatus is null
    or tracking_substatus in (
      'ready_for_pickup',
      'out_for_delivery',
      'delivered',
      'completed'
    )
  );;
