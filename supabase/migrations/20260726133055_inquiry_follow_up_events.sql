create table if not exists public.inquiry_follow_up_events (
  id uuid primary key default gen_random_uuid(),
  inquiry_id text not null references public.ops_inquiries(id) on delete cascade,
  outcome text not null,
  note text not null,
  next_follow_up_date date null,
  created_by_user_id uuid not null references public.admin_users(user_id),
  created_at timestamptz not null default now(),
  constraint inquiry_follow_up_events_outcome_check check (
    outcome in ('no_response', 'customer_considering', 'customer_replied_action_needed')
  ),
  constraint inquiry_follow_up_events_note_not_blank check (length(btrim(note)) > 0)
);

create index if not exists inquiry_follow_up_events_inquiry_created_idx
  on public.inquiry_follow_up_events (inquiry_id, created_at desc);

create index if not exists inquiry_follow_up_events_created_by_idx
  on public.inquiry_follow_up_events (created_by_user_id);

alter table public.inquiry_follow_up_events enable row level security;

revoke all on table public.inquiry_follow_up_events from anon;
grant select, insert on table public.inquiry_follow_up_events to authenticated;

drop policy if exists "active staff can read follow-up events" on public.inquiry_follow_up_events;
create policy "active staff can read follow-up events"
  on public.inquiry_follow_up_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.admin_users admin_user
      where admin_user.user_id = (select auth.uid())
        and admin_user.is_active = true
        and admin_user.role in ('owner', 'admin', 'staff')
    )
  );

drop policy if exists "active staff can insert follow-up events" on public.inquiry_follow_up_events;
create policy "active staff can insert follow-up events"
  on public.inquiry_follow_up_events
  for insert
  to authenticated
  with check (
    created_by_user_id = (select auth.uid())
    and exists (
      select 1
      from public.admin_users admin_user
      where admin_user.user_id = (select auth.uid())
        and admin_user.is_active = true
        and admin_user.role in ('owner', 'admin', 'staff')
    )
  );;
