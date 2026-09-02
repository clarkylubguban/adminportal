create table if not exists public.employee_temporary_access_grants (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.admin_users(id) on delete restrict,
  module_code text not null,
  granted_by uuid not null references public.admin_users(id) on delete restrict,
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  reason text,
  revoked_at timestamptz,
  revoked_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint employee_temporary_access_module_code_check check (
    module_code in (
      'production',
      'design_artwork',
      'inventory',
      'purchasing_suppliers',
      'pos_sales',
      'orders',
      'inquiries',
      'master_catalog',
      'workboard',
      'calendar',
      'pricing_discounts',
      'people_access'
    )
  ),
  constraint employee_temporary_access_window_check check (starts_at < expires_at)
);

create unique index if not exists employee_temp_access_active_day_unique
  on public.employee_temporary_access_grants (employee_id, module_code, expires_at)
  where revoked_at is null;

create index if not exists employee_temp_access_employee_idx
  on public.employee_temporary_access_grants (employee_id);

create index if not exists employee_temp_access_expires_idx
  on public.employee_temporary_access_grants (expires_at);

create index if not exists employee_temp_access_revoked_idx
  on public.employee_temporary_access_grants (revoked_at);

create index if not exists employee_temp_access_module_idx
  on public.employee_temporary_access_grants (module_code);

alter table public.employee_temporary_access_grants enable row level security;

revoke all on public.employee_temporary_access_grants from anon, authenticated;
grant all on public.employee_temporary_access_grants to service_role;
