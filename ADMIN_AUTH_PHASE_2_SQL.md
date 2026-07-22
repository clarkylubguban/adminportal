# TRRY Admin Auth Phase 2 SQL Handoff

Do not run this from the frontend. Run manually in the Supabase SQL editor for the existing `trryportalsystem` project.

## RUN FIRST: create admin_users table and policy

```sql
create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'staff', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

drop policy if exists "Admin users can read own row" on public.admin_users;
create policy "Admin users can read own row"
on public.admin_users
for select
to authenticated
using (auth.uid() = user_id);
```

## RUN AFTER CREATING FIRST AUTH USER: insert first admin user

1. Create the first admin in Supabase Auth using email/password.
2. Replace `admin@trryapparel.com` below with that Auth user's email.
3. Run this insert.

```sql
insert into public.admin_users (user_id, email, role)
select id, email, 'admin'
from auth.users
where email = 'admin@trryapparel.com'
on conflict (user_id) do update
set email = excluded.email,
    role = excluded.role,
    updated_at = now();
```

## Notes

- This does not change `ops_inquiries` RLS.
- This does not change `reorder_requests`, `request_items`, or `clients` policies.
- This only lets an authenticated user read their own admin role row.
- Phase 3 should replace demo anon policies with authenticated admin/staff policies.

## Release-freeze status - 2026-07-22

### CURRENT

- Production Admin Portal URL: `https://admin.trryapparel.com`.
- Production app is served from the built `dist` output, not live `src`.
- Login route currently renders from `src/main.js` via `renderAdminLogin()`, with the built copy in `dist/src/main.js`.
- Clark's Supabase Auth UUID matches `public.admin_users.user_id` for `clarkylubguban@gmail.com`.
- Clark profile is active with role `admin` and display name `Clark`.
- Safe auth smoke record is `TEST-AUTH-SMOKE-20260722`, labeled `TEST RECORD - DO NOT PROCESS`.
- Safe test contact is `TEST RECORD - DO NOT CONTACT`.
- Safe test SO reference `TEST-SO-20260722` is retained for audit history.
- Safe test record has no follow-up date, due date, owner, assigned staff, blocker, production stage, payment confirmation, or delivery/tracking assignment.
- Current production release gate requires a confirmed SO plus product/service/quantity, due date, approved artwork, assigned staff, confirmed/paid payment when an amount is due, and no blocker.
- The safe test record does not satisfy the production release gate and is not released to Production.

### KNOWN LIMITATION

- Clark credential-based smoke testing cannot be completed by automation unless Clark logs in interactively or provides credentials through a secure channel.
- Do not reset Clark's password for testing.
- Do not fabricate a Production job for this test record.

### PARKED

- Supabase advisor still flags public storage listing on `catalog-images`; this is a public catalog surface review item, not a blocker for Admin Portal auth.
- Supabase advisor still flags public/client portal security-definer functions: `add_client_employee`, `delete_client_employee`, and `get_client_portal_data`.
- Older admin-read policies remain on `approved_products` and `employees`; review before changing because they may affect client/customer portal reads.

### FUTURE

- Run Clark authenticated smoke manually after Clark signs in: overview, inquiries, orders, production, clients, catalog, mobile 390px, refresh session, logout, and direct-route protection.
- Replace broad legacy read policies only after confirming the dependent client portal flows.
- Add automated authenticated UI smoke with a safe test-only Auth user and short-lived credentials managed outside source control.
