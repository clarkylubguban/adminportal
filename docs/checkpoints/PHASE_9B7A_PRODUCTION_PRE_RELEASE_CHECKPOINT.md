# Phase 9B7A Production Pre-Release Checkpoint

Date: 2026-07-31
Workspace: `C:\tmp\trry-admin-staging`
Branch: `release/admin-payment-rehearsal`
Production baseline: `a7da022fbc1a9d9e92c571f49462dcefd16dff95`
Release branch HEAD: `1512f4aeae58ea8bc0ae629782f33dbfabd4d803`

This phase was read-only for production. No production migrations, database writes, deployments, environment changes, domain changes, or synthetic payments were executed.

## Final Status

READY for the next authorized production execution phase, with one release-day manual check retained: exact production Supabase environment variable values must be verified without printing secrets.

The user confirmed all five payment flags are visible in Vercel Production. CLI read-only checks reached the production project and reported environment variables found, but did not render variable rows/names/targets in this shell. Do not guess or print values.

## Local Release Package

Confirmed:
- Current branch is `release/admin-payment-rehearsal`.
- All eight rehearsed release commits are present:
  - `c61024c` - Build online payment review workflow
  - `406ed28` - Fix payment review stale version handling
  - `00121d9` - Support admin down payment confirmations
  - `1f7f5c6` - Finalize inquiry drawer payment UI
  - `d5f7161` - Fix inquiry drawer payment states and refresh
  - `22bd31b` - Deduplicate full payment drawer summary
  - `b478254` - Fix final inquiry drawer payment UI bugs
  - `1512f4a` - Finalize Admin payment and inquiry table polish
- Runtime search found no staging Supabase ref/domain in `src`, `api`, `dist`, `vercel.json`, `package.json`, or `scripts`.
- `npm.cmd run build` passed.
- Payment, online review, migration, Pay at Shop, task API, browser-view, and Inquiry Drawer regression tests passed.
- `git diff --check` passed.

Untracked/uncommitted files at checkpoint time:
- `docs/checkpoints/PHASE_9B6_PRODUCTION_MIGRATION_PLAN.md`
- `scripts/run-production-migration-rehearsal.ps1`

## Current Production Deployment

Production project:
- Vercel project: `adminportal`
- Project ID: `prj_ObjP9WVxYHHvfYgsLgZYd3PrXQ0g`
- Team ID: `team_lLNAY28RJHud9QjW9vcIh7WO`

Current production deployment:
- Deployment ID: `dpl_ErTbEwTWnhnP6TdPK22RGSDC969a`
- Deployment URL: `https://adminportal-49zfxyej2-clarkylubguban1.vercel.app`
- Commit SHA: `a7da022fbc1a9d9e92c571f49462dcefd16dff95`
- Commit message: `Fix Order Drawer production schema compatibility`
- Target: `production`
- Status: `READY`
- Created: Vercel timestamp `1785405050547`
- Production alias: `https://admin.trryapparel.com`

Best rollback deployment candidate:
- `dpl_ErTbEwTWnhnP6TdPK22RGSDC969a`, the current READY production deployment.

## Production Environment Verification

Required Vercel Production payment flags:
- `ENABLE_CUSTOMER_PAYMENT_WORKFLOW`
- `ENABLE_ADMIN_ONLINE_PAYMENT_REVIEW`
- `ENABLE_ADMIN_PAY_AT_SHOP_WORKFLOW`
- `VITE_ENABLE_ADMIN_ONLINE_PAYMENT_REVIEW`
- `VITE_ENABLE_ADMIN_PAY_AT_SHOP_WORKFLOW`

Status:
- User confirmed all five names are visible in Vercel Production.
- Read-only CLI reached `clarkylubguban1/adminportal` and reported environment variables found.
- CLI/API output in this shell did not safely render names/targets.
- Exact values were not printed, pulled, stored, or exposed.

Release-day manual check:
- Confirm all five names target Vercel Production.
- Confirm server flags are true before exercising payment APIs.
- Confirm VITE flags are true before the production build/deploy that should expose the UI.
- Confirm Supabase env vars point only to production ref `wcgtwfctpnwgpglywvvx`.
- Confirm Supabase env vars do not point to staging ref `fszkypwovpdthqfobxrk`.

## Production Database Checkpoint

Production Supabase ref checked read-only:
- `wcgtwfctpnwgpglywvvx`

Current migration history for relevant payment migrations:
- Present: `pay_at_shop_admin_workflow`
- Absent: `online_payment_review`
- Absent: `online_payment_review_stale_version_fix`
- Absent: `allow_admin_down_payment_confirmations`

Current pre-migration status:
- `public.inquiry_payment_events` exists.
- `public.inquiry_payment_events.expected_version` is absent.
- `public.inquiry_payment_events.review_note` is absent.
- `public.review_online_payment(...)` is absent.
- `public.confirm_inquiry_shop_payment(...)` exists.
- Duplicate idempotency event groups: `0`.

Current `confirm_inquiry_shop_payment`:
- Signature: `p_inquiry_id text, p_amount numeric, p_payment_method text, p_internal_note text, p_idempotency_key text`
- Result: `jsonb`
- Body hash: `1fa73214f7eb5f939b696ca4b8ff3c82`
- Behavior: authenticated owner/admin only, Pay at Shop status required, active production stages blocked, approved quote/artwork required, exact full quote amount required, updates to `full_payment_confirmed`, `payment_type = shop`, inserts one `SHOP_PAYMENT_CONFIRMED` event.

Current `inquiry_payment_events` columns:
- `id uuid not null default gen_random_uuid()`
- `inquiry_id text not null`
- `event_type text not null`
- `previous_status text`
- `next_status text not null`
- `payment_method text`
- `amount numeric`
- `internal_note text`
- `actor_user_id uuid`
- `actor_role text`
- `source text not null`
- `idempotency_key text`
- `created_at timestamptz not null default now()`

Current constraints:
- Primary key on `id`.
- Foreign key `inquiry_id` to `ops_inquiries(id)`.
- Foreign key `actor_user_id` to `admin_users(user_id)` on delete set null.
- Event types currently limited to `PAY_AT_SHOP_SELECTED` and `SHOP_PAYMENT_CONFIRMED`.
- Source limited to `CUSTOMER` and `ADMIN_PORTAL`.
- Method limited to `cash`, `gcash`, `bank_transfer`, `card`, `other`.
- Amount must be null or positive.
- Internal note max length 500.
- Actor role limited to `owner`, `admin`, `staff`.
- Idempotency key length 8 to 120 when present.

Current indexes:
- `inquiry_payment_events_pkey`
- `inquiry_payment_events_inquiry_id_idx`
- `inquiry_payment_events_created_at_idx`
- `inquiry_payment_events_idempotency_key_uidx`
- `inquiry_payment_events_selection_once_uidx`

Current grants:
- `authenticated` has `SELECT` on `public.inquiry_payment_events`.
- No table grant rows were returned for `public` or `anon`.

Current RLS policy:
- `inquiry_payment_events_active_portal_read`
- Role: `authenticated`
- Command: `SELECT`
- Predicate: active Admin user with `owner`, `admin`, or `staff`.

Current triggers:
- `inquiry_payment_events_append_only`
- Fires before `UPDATE` and `DELETE`.
- Executes `prevent_inquiry_payment_event_changes()`.

Rollback definition:
- The current production behavior can be restored from the current function body captured above or from `supabase/migrations/202607290008_pay_at_shop_admin_workflow.sql`, starting at `create or replace function public.confirm_inquiry_shop_payment(...)` through its grant/comment statements.
- The disposable rehearsal script `scripts/run-production-migration-rehearsal.ps1` validates this rollback path and preserves inquiry/payment/event records.

## Pre-Migration Read-Only Queries

Confirm the target project:

```sql
select current_database(), current_user;
```

Confirm migration state:

```sql
select version, name
from supabase_migrations.schema_migrations
where name in (
  'pay_at_shop_admin_workflow',
  'online_payment_review',
  'online_payment_review_stale_version_fix',
  'allow_admin_down_payment_confirmations'
)
order by version;
```

Confirm event table and expected absent columns/function:

```sql
select
  to_regclass('public.inquiry_payment_events') is not null as inquiry_payment_events_exists,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inquiry_payment_events'
      and column_name = 'expected_version'
  ) as has_expected_version,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inquiry_payment_events'
      and column_name = 'review_note'
  ) as has_review_note,
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'review_online_payment'
  ) as has_review_online_payment;
```

Confirm current shop RPC:

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

Confirm no duplicate payment-event records:

```sql
select count(*)::int as duplicate_event_groups
from (
  select inquiry_id, event_type, idempotency_key, count(*)
  from public.inquiry_payment_events
  where idempotency_key is not null
  group by inquiry_id, event_type, idempotency_key
  having count(*) > 1
) duplicates;
```

## Migration And Rollback Package

Production execution order is fixed:

1. `supabase/migrations/202607300009_online_payment_review.sql`
2. `supabase/migrations/202607300010_online_payment_review_stale_version_fix.sql`
3. `supabase/migrations/202607310001_allow_admin_down_payment_confirmations.sql`

Rollback must preserve:
- inquiries
- payment selections
- payment confirmations
- payment receipt references
- payment audit events

Rollback rules:
- Restore function behavior only.
- Revoke or disable `review_online_payment(...)` exposure if rolling back online review.
- Do not delete valid rows.
- Do not drop payment-event metadata columns once production may contain data in them.
- Restore production alias to `dpl_ErTbEwTWnhnP6TdPK22RGSDC969a` if code deployment rollback is required.

Disposable rehearsal result:
- `scripts/run-production-migration-rehearsal.ps1` passed from a fresh disposable PostgreSQL container.
- Migrations applied in order.
- Schema/function verification passed.
- PHP 850 full-only rule passed.
- PHP 1,050 exact DP/full passed.
- Arbitrary partial rejection passed.
- Stale and duplicate protections passed.
- Verifier/receiver and audit checks passed.
- Rollback SQL parsed/applied.
- Restored old shop RPC rejected DP with `FULL_QUOTE_AMOUNT_REQUIRED`.
- Restored old shop RPC accepted exact full quote.
- Payment and audit records were preserved.
- Disposable container cleanup was confirmed.

## Next Authorized Phase Command Plan

Do not execute in Phase 9B7A.

A. Apply production migrations:
- Action: apply the three migrations in the fixed order to production Supabase `wcgtwfctpnwgpglywvvx`.
- Expected: all migrations complete.
- Stop: any migration error, wrong project, partial drift.

B. Verify columns/functions/grants:
- Action: run the post-migration queries from `PHASE_9B6_PRODUCTION_MIGRATION_PLAN.md`.
- Expected: `expected_version`, `review_note`, `review_online_payment(...)`, updated `confirm_inquiry_shop_payment(...)`, and authenticated grants are present; anon cannot execute review RPC.
- Stop: any mismatch.

C. Deploy release branch to Admin production:
- Action: deploy Admin project `adminportal` from release branch/commit after migrations pass.
- Expected: deployment READY.
- Stop: wrong Vercel project, wrong branch, build failure, non-READY deployment.

D. Confirm production alias:
- Action: inspect `https://admin.trryapparel.com`.
- Expected: alias points to the new READY production deployment.
- Stop: alias mismatch.

E. Run read-only smoke tests:
- Action: manual Admin login, load Inquiries/Orders/Production, open drawer, switch tabs, inspect console.
- Expected: no runtime errors and no drawer refresh/flicker.
- Stop: broad runtime or drawer failure.

F. Inspect production runtime errors:
- Action: check Vercel logs and Supabase errors.
- Expected: no broad payment/API errors.
- Stop: unauthorized access, duplicate events, incorrect balances, broad receipt route failures.

G. Stop before controlled real payment test:
- Action: do not perform a payment mutation without explicit separate authorization and an approved disposable production QA record.
- Expected: release pauses before any production payment write.

## Stop Conditions

Block production execution if:
- Production Supabase project is not `wcgtwfctpnwgpglywvvx`.
- Any required production payment flag is missing.
- Staging URL/ref is found in release runtime.
- Migration order changes.
- Rollback definitions are incomplete.
- Local test/build fails.
- Current production deployment cannot be identified.
- Production DB appears partially migrated.
- Any unreviewed release commit or file change is introduced.

## Confirmation

Phase 9B7A made zero production writes, zero production migrations, zero production deployments, zero production environment changes, and zero production domain changes.
