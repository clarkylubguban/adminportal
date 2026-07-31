# Phase 9B6 Production Migration Plan

Date: 2026-07-31
Workspace: `C:\tmp\trry-admin-staging`
Local rehearsal branch: `release/admin-payment-rehearsal`
Production Admin project: `adminportal` / `prj_ObjP9WVxYHHvfYgsLgZYd3PrXQ0g`
Production Supabase: `wcgtwfctpnwgpglywvvx`

## Rehearsal Summary

This is a rehearsal document only. No production migrations, production database writes, production deployments, production environment changes, production domain changes, or synthetic production payments were performed.

Readiness checkpoint committed on `staging`:
- `d70d002` - `Document Admin payment production readiness`

Local rehearsal branch:
- Branch: `release/admin-payment-rehearsal`
- Base: `a7da022fbc1a9d9e92c571f49462dcefd16dff95`
- Base production deployment: `dpl_ErTbEwTWnhnP6TdPK22RGSDC969a`
- Base production commit message: `Fix Order Drawer production schema compatibility`

Cherry-pick result:
- `f2af2e9` applied as `c61024c` with no conflicts.
- `1449e3c` applied as `406ed28` with no conflicts.
- `6ed5678` applied as `00121d9` with no conflicts.
- `81dbd2f` applied as `1f7f5c6` with no conflicts.
- `86ff1dd` applied as `d5f7161` with no conflicts.
- `dad8735` applied as `22bd31b` with no conflicts.
- `bbd763b` applied as `b478254` with no conflicts.
- `3dfc498` applied as `1512f4a` with no conflicts.

Compatibility result:
- The exact release sequence applies cleanly from the current production code baseline.
- Files affected are limited to Admin API, Admin UI, generated `dist`, tests, migration SQL, and `vercel.json`.
- The code sequence is releasable as-is only after the production migration bundle and production environment flag confirmation are completed.

## Migration Bundle Order

Apply these existing staging migrations to production in this exact order:

1. `supabase/migrations/202607300009_online_payment_review.sql`
   - Adds online receipt metadata columns on `public.ops_inquiries`.
   - Adds `public.inquiry_payment_events.review_note`.
   - Adds `public.inquiry_payment_events.expected_version`.
   - Updates the payment event type check constraint.
   - Creates `public.review_online_payment(text,text,numeric,text,text,timestamptz,text)`.
   - Grants table select and function execute to `authenticated`.

2. `supabase/migrations/202607300010_online_payment_review_stale_version_fix.sql`
   - Depends on `review_online_payment(...)` from the previous migration.
   - Replaces only the stale-version SQLSTATE inside `review_online_payment(...)` from retryable `40001` to business error `P0001`.

3. `supabase/migrations/202607310001_allow_admin_down_payment_confirmations.sql`
   - Replaces `public.confirm_inquiry_shop_payment(text,numeric,text,text,text)`.
   - Replaces `public.review_online_payment(text,text,numeric,text,text,timestamptz,text)`.
   - Enables exact 50% down payment only when quote total is at least PHP 1,000.
   - Keeps below-PHP 1,000 inquiries full-payment-only.
   - Preserves idempotency checks, stale-version checks, verifier/receiver audit behavior, and one payment audit event per accepted confirmation.

Expected final production columns:

```sql
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'inquiry_payment_events'
  and column_name in ('expected_version', 'review_note')
order by column_name;
```

Expected rows:
- `expected_version | timestamp with time zone`
- `review_note | text`

Expected final production function signatures:

```sql
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args,
  pg_get_function_result(p.oid) as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('confirm_inquiry_shop_payment', 'review_online_payment')
order by p.proname;
```

Expected rows:
- `confirm_inquiry_shop_payment | p_inquiry_id text, p_amount numeric, p_payment_method text, p_internal_note text, p_idempotency_key text | jsonb`
- `review_online_payment | p_inquiry_id text, p_action text, p_verified_amount numeric, p_review_note text, p_internal_note text, p_expected_updated_at timestamp with time zone, p_idempotency_key text | jsonb`

## Production Preflight Queries

Run read-only before any migration:

```sql
select version();
```

```sql
select version, name
from supabase_migrations.schema_migrations
where name in (
  'online_payment_review',
  'online_payment_review_stale_version_fix',
  'allow_admin_down_payment_confirmations',
  'pay_at_shop_admin_workflow'
)
order by version;
```

```sql
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'inquiry_payment_events'
  and column_name in ('expected_version', 'review_note')
order by column_name;
```

```sql
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args,
  pg_get_function_result(p.oid) as result,
  md5(pg_get_functiondef(p.oid)) as body_md5
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('confirm_inquiry_shop_payment', 'review_online_payment')
order by p.proname;
```

```sql
select coalesce(payment_status, '(null)') as payment_status,
       coalesce(payment_type, '(null)') as payment_type,
       count(*)::int as count
from public.ops_inquiries
group by 1, 2
order by count desc, payment_status, payment_type;
```

```sql
select event_type, count(*)::int as count
from public.inquiry_payment_events
group by event_type
order by count desc, event_type;
```

Preflight stop conditions:
- Production Supabase ref is not `wcgtwfctpnwgpglywvvx`.
- Any of the three target migrations are already partially applied with unexpected function or column drift.
- `pay_at_shop_admin_workflow` is missing.
- `confirm_inquiry_shop_payment(...)` signature differs from the expected current production signature.
- Payment event table has unexpected constraints that would reject the new event types.
- Current production backup/checkpoint is unavailable.

## Post-Migration Verification Queries

Run read-only immediately after applying migrations:

```sql
select version, name
from supabase_migrations.schema_migrations
where name in (
  'online_payment_review',
  'online_payment_review_stale_version_fix',
  'allow_admin_down_payment_confirmations'
)
order by version;
```

```sql
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'inquiry_payment_events'
  and column_name in ('expected_version', 'review_note')
order by column_name;
```

```sql
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args,
  pg_get_function_result(p.oid) as result,
  md5(pg_get_functiondef(p.oid)) as body_md5
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('confirm_inquiry_shop_payment', 'review_online_payment')
order by p.proname;
```

```sql
select has_function_privilege(
  'authenticated',
  'public.review_online_payment(text,text,numeric,text,text,timestamptz,text)',
  'execute'
) as authenticated_can_review_online_payment;
```

```sql
select has_function_privilege(
  'anon',
  'public.review_online_payment(text,text,numeric,text,text,timestamptz,text)',
  'execute'
) as anon_can_review_online_payment;
```

Expected:
- The three migrations are present in production migration history.
- `expected_version` and `review_note` exist on `public.inquiry_payment_events`.
- Both RPC signatures exist and return `jsonb`.
- `authenticated_can_review_online_payment = true`.
- `anon_can_review_online_payment = false`.

Post-migration stop conditions:
- Any migration missing from history.
- Any expected column missing.
- `review_online_payment(...)` absent.
- `confirm_inquiry_shop_payment(...)` not replaced.
- `anon` can execute the payment review RPC.
- Function hashes do not match the reviewed staging function definitions.

## Rollback SQL Plan

Rollback should preserve all customer data, payment records, receipt storage objects, and audit events. Column additions should remain in place during rollback because dropping them risks deleting valid payment audit metadata.

Rollback strategy:

1. Disable feature flags or keep them disabled.
2. Restore the previous production `confirm_inquiry_shop_payment(...)` behavior.
3. Remove executable exposure for `review_online_payment(...)`.
4. Optionally leave `review_online_payment(...)` in place but revoked from `public`, `anon`, and `authenticated`; this is safer than dropping during incident response.
5. Preserve `inquiry_payment_events.expected_version` and `inquiry_payment_events.review_note`.

Rollback SQL skeleton, not executed:

```sql
begin;

revoke execute on function public.review_online_payment(
  text, text, numeric, text, text, timestamptz, text
) from public, anon, authenticated;

-- Restore the current production Pay at Shop RPC body from:
-- supabase/migrations/202607290008_pay_at_shop_admin_workflow.sql
-- starting at create or replace function public.confirm_inquiry_shop_payment(...)
-- through the matching grant/comment statements.
--
-- This restores full-payment-only shop confirmation behavior:
-- - exact full quote amount required
-- - payment_status becomes full_payment_confirmed
-- - payment_type becomes shop
-- - no arbitrary partial payments
-- - no deletion of payment records or audit events

commit;
```

If a severe issue requires removing `review_online_payment(...)`, do it only after flags are disabled and after confirming no live code path calls it:

```sql
begin;

revoke execute on function public.review_online_payment(
  text, text, numeric, text, text, timestamptz, text
) from public, anon, authenticated;

-- Optional only after code rollback:
-- drop function if exists public.review_online_payment(
--   text, text, numeric, text, text, timestamptz, text
-- );

commit;
```

Do not roll back by:
- Deleting rows from `public.ops_inquiries`.
- Deleting rows from `public.inquiry_payment_events`.
- Dropping `expected_version` or `review_note` while any production payment events may use them.
- Deleting receipt objects from storage.

## Local Database Rehearsal

Requested local disposable Postgres/Docker rehearsal could not be completed in this environment:
- `docker --version` succeeded.
- Docker daemon connection failed: `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`.
- `psql` is not installed on the Windows host.
- Supabase CLI is not installed on the Windows host.

Result:
- Local database rehearsal is BLOCKED by local tooling availability.
- No production data was copied.
- No production database was used for rehearsal.

Recommended follow-up rehearsal before production release:
- Start Docker Desktop or provide a reachable disposable Postgres.
- Create a minimal schema-only baseline matching current production tables/functions.
- Apply the three migration files in order.
- Run the post-migration verification queries above.
- Execute synthetic RPC tests for:
  - PHP 850 full payment only.
  - PHP 1,050 exact PHP 525 DP.
  - PHP 1,050 exact full payment.
  - arbitrary partial amount rejected.
  - stale version rejected.
  - duplicate confirmation rejected.
  - online verifier recorded.
  - shop receiver recorded.
  - one audit event only.
- Parse rollback SQL and restore the old shop RPC in the disposable database.

## Environment Flag Checklist

All variables target Vercel Production. Do not print values. Do not copy staging Supabase ref `fszkypwovpdthqfobxrk`.

Production Supabase variables must point only to `wcgtwfctpnwgpglywvvx`.

| Variable | Scope | Required timing | Redeploy required |
| --- | --- | --- | --- |
| `ENABLE_CUSTOMER_PAYMENT_WORKFLOW=true` | Server/API | Before customer payment route is used; safest before deploy with DB already migrated | No for runtime env on serverless cold starts, but redeploy is safest |
| `ENABLE_ADMIN_ONLINE_PAYMENT_REVIEW=true` | Server/API | After migration and before Admin online review smoke | No for runtime env on serverless cold starts, but redeploy is safest |
| `ENABLE_ADMIN_PAY_AT_SHOP_WORKFLOW=true` | Server/API | Before Pay at Shop receive action smoke | No for runtime env on serverless cold starts, but redeploy is safest |
| `VITE_ENABLE_ADMIN_ONLINE_PAYMENT_REVIEW=true` | Frontend/build-time | Before production build/deploy that should show online review UI | Yes |
| `VITE_ENABLE_ADMIN_PAY_AT_SHOP_WORKFLOW=true` | Frontend/build-time | Before production build/deploy that should show Pay at Shop UI | Yes |

Env stop conditions:
- Any required flag missing, false, or scoped outside Production.
- Any production Supabase variable points to staging ref `fszkypwovpdthqfobxrk`.
- Any secret value is exposed in logs, docs, screenshots, or chat.

## Release-Day Runbook

1. Confirm production backup/checkpoint.
   - Action: create and verify a production Supabase backup/checkpoint.
   - Expected: backup is restorable.
   - Stop condition: backup unavailable.
   - Rollback trigger: any migration or payment incident.

2. Confirm current production deployment ID.
   - Action: inspect `https://admin.trryapparel.com`.
   - Expected: current deployment is recorded before release.
   - Current rehearsal observation: `dpl_ErTbEwTWnhnP6TdPK22RGSDC969a`, commit `a7da022fbc1a9d9e92c571f49462dcefd16dff95`.
   - Stop condition: current deployment cannot be identified.
   - Rollback trigger: alias restore to the pre-release deployment.

3. Confirm production environment variables.
   - Action: verify the five payment flags and production Supabase variables in Vercel Production.
   - Expected: flags are true or scheduled to be set in the safe order; Supabase ref is `wcgtwfctpnwgpglywvvx`.
   - Stop condition: env mismatch or staging ref present.
   - Rollback trigger: set flags false without deleting variables.

4. Apply migration sequence.
   - Action: apply `202607300009`, then `202607300010`, then `202607310001`.
   - Expected: all migrations complete without drift.
   - Stop condition: any migration error.
   - Rollback trigger: restore old function definitions, keep data.

5. Verify columns and RPC signatures.
   - Action: run post-migration verification queries.
   - Expected: event columns and both RPCs are present with correct privileges.
   - Stop condition: mismatch.
   - Rollback trigger: stop before deploy; restore functions if needed.

6. Deploy Admin production code.
   - Action: deploy the release branch/commit to production Admin only.
   - Expected: Vercel deployment becomes READY and aliases are correct.
   - Stop condition: wrong project, wrong branch, build failure, non-READY deployment.
   - Rollback trigger: restore aliases to the prior production deployment.

7. Run read-only smoke tests.
   - Action: login manually, load Inquiries, Orders, Production, open an existing drawer, switch Details/Request/Notes/History, inspect console.
   - Expected: no runtime errors, no drawer refresh/flicker, payment UI only where expected.
   - Stop condition: drawer unusable or broad route failure.
   - Rollback trigger: Vercel rollback and/or disable flags.

8. Enable payment flags in safest order if not already enabled.
   - Action: DB first, server flags second, frontend flags before build/deploy.
   - Expected: no UI path points to missing RPCs.
   - Stop condition: flag cannot be verified.
   - Rollback trigger: set flags false.

9. Redeploy if build-time VITE flags changed.
   - Action: redeploy production Admin after VITE flag changes.
   - Expected: frontend bundle contains intended Production flags.
   - Stop condition: build uses staging env or wrong project.
   - Rollback trigger: redeploy prior build or disable server flags.

10. Run one explicitly authorized disposable payment test.
    - Action: use only an approved disposable production QA record.
    - Expected: exact amount, correct remaining balance, authenticated verifier/receiver, one audit event.
    - Stop condition: no explicit authorization or no disposable QA record.
    - Rollback trigger: stop testing; preserve records and audit events.

11. Monitor logs.
    - Action: watch Vercel logs and Supabase errors.
    - Expected: no broad API failures, duplicate events, unauthorized access, or incorrect balances.
    - Stop condition: repeated payment/drawer/runtime errors.
    - Rollback trigger: disable flags, restore prior deployment, restore functions if needed.

12. Cleanup or rollback if required.
    - Action: clean staging fixtures only after release and rollback window, or execute rollback plan if triggered.
    - Expected: no production fixture cleanup without explicit authorization.
    - Stop condition: uncertainty about record ownership.
    - Rollback trigger: incident criteria above.

## Validation

Run on the local rehearsal branch:

```powershell
node scripts/test-payment-confirmation.mjs
node scripts/test-online-payment-review-api.mjs
node scripts/test-online-payment-review-migration.mjs
node scripts/test-pay-at-shop-admin.mjs
node scripts/test-task-api.mjs
node scripts/test-online-payment-review-browser.mjs
node scripts/test-inquiry-drawer-payment-regression.mjs
npm.cmd run build
git diff --check
```

The repository has no lint script. Do not add lint configuration.

## Final Production Execution Decision

BLOCKED until:
- Production env flags are confirmed in Vercel Production.
- A disposable local/staging database rehearsal is completed with Docker/Postgres available, or the release owner explicitly accepts the existing migration/static test coverage.
- Production release window explicitly authorizes migration and deploy execution.

GO for code sequencing:
- The eight release commits apply cleanly from the production baseline with zero cherry-pick conflicts.
