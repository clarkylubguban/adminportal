-- Fix Admin Portal operational assignment sources.
-- Keep legacy text fields, add stable nullable user-id fields, and mark test accounts.

alter table public.admin_users
  add column if not exists is_test boolean not null default false;

update public.admin_users
set is_test = true,
    updated_at = now()
where is_test = false
  and (
    lower(coalesce(email, '')) like '%@trry.test'
    or lower(coalesce(email, '')) like 'codex-admin-test%'
    or lower(coalesce(email, '')) like 'codex-admin-manager%'
    or lower(coalesce(email, '')) like 'codex-staff-permission%'
    or lower(coalesce(display_name, '')) like 'test%'
    or lower(coalesce(display_name, '')) like '% qa%'
  );

alter table public.ops_inquiries
  add column if not exists owner_user_id uuid,
  add column if not exists assigned_user_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ops_inquiries_owner_user_id_fkey'
      and conrelid = 'public.ops_inquiries'::regclass
  ) then
    alter table public.ops_inquiries
      add constraint ops_inquiries_owner_user_id_fkey
      foreign key (owner_user_id)
      references public.admin_users(user_id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'ops_inquiries_assigned_user_id_fkey'
      and conrelid = 'public.ops_inquiries'::regclass
  ) then
    alter table public.ops_inquiries
      add constraint ops_inquiries_assigned_user_id_fkey
      foreign key (assigned_user_id)
      references public.admin_users(user_id)
      on delete set null;
  end if;
end $$;

with active_assignable as (
  select user_id, lower(trim(display_name)) as label
  from public.admin_users
  where is_active = true
    and is_test = false
    and role in ('owner', 'admin', 'staff')
    and nullif(trim(display_name), '') is not null
),
unique_labels as (
  select label, (array_agg(user_id))[1] as user_id
  from active_assignable
  group by label
  having count(*) = 1
)
update public.ops_inquiries inquiry
set owner_user_id = unique_labels.user_id
from unique_labels
where inquiry.owner_user_id is null
  and nullif(trim(inquiry.owner_id), '') is not null
  and lower(trim(inquiry.owner_id)) = unique_labels.label;

with active_assignable as (
  select user_id, lower(trim(display_name)) as label
  from public.admin_users
  where is_active = true
    and is_test = false
    and role in ('owner', 'admin', 'staff')
    and nullif(trim(display_name), '') is not null
),
unique_labels as (
  select label, (array_agg(user_id))[1] as user_id
  from active_assignable
  group by label
  having count(*) = 1
)
update public.ops_inquiries inquiry
set assigned_user_id = unique_labels.user_id
from unique_labels
where inquiry.assigned_user_id is null
  and nullif(trim(inquiry.assigned_staff), '') is not null
  and lower(trim(inquiry.assigned_staff)) = unique_labels.label;

create index if not exists admin_users_assignment_choices_idx
  on public.admin_users (role, display_name)
  where is_active = true and is_test = false and role in ('owner', 'admin', 'staff');

create index if not exists ops_inquiries_owner_user_id_idx
  on public.ops_inquiries (owner_user_id);

create index if not exists ops_inquiries_assigned_user_id_idx
  on public.ops_inquiries (assigned_user_id);
