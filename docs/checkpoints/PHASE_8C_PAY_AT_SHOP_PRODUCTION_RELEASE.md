# Phase 8C - Pay at Shop Production Release

## Status

**BLOCKED - RELEASE NOT STARTED**

Date: 2026-07-29

Phase 8C resumed from Step 1 after the credential file was recreated, then
stopped again at the credentialed-acceptance gate before any production write.

## Preflight

- Approved staging head:
  `8d71713111c1f4434af6af3a8c53b00d2e77017e`
- Approved release code is an ancestor of the current documentation head.
- Local documentation head:
  `a3f474ff80340127a669641195fa0b15674bcb94`
- `origin/staging`:
  `a3f474ff80340127a669641195fa0b15674bcb94`
- Expected and observed `origin/main`:
  `c31da4a153c9cdeb76e2dff8f053b04ac2d16b63`
- Approved release code is 13 commits ahead and 0 behind production `main`.
- The documentation-only staging commit is excluded from the production
  release.
- Worktree before this checkpoint: clean
- Production deployment `dpl_349VPfKCxW3NHyg5xvJHzWgrfWHC` is `READY`,
  targets production from `main`, and serves `admin.trryapparel.com`.
- Migration 008 remains absent.
- Migration 007 remains applied and was not rerun.
- `inquiry_payment_events`,
  `confirm_inquiry_shop_payment(text,numeric,text,text,text)`, and the migration
  008 selection trigger remain absent.
- The existing pending Pay-at-Shop count remains `1`.
- Invalid canonical payment status, method, and type counts remain `0`.
- The customer Pay Online endpoint returns `404`.
- The public Pay-at-Shop client flag remains absent.

## Exact Blocker

The required external credential file now exists:

`C:\tmp\trry-admin-production-qa-secrets\qa-accounts.env`

Its values were never printed, logged, stored, or committed. A key-only check
confirmed that it contains exactly:

- `QA_ADMIN_EMAIL`
- `QA_ADMIN_PASSWORD`
- `QA_STAFF_EMAIL`
- `QA_STAFF_PASSWORD`

Both expected synthetic Auth users exist and are confirmed, and their
`public.admin_users` roles are Admin and Staff respectively. However, both
public profiles remain inactive and both Auth users retain the prior infinite
ban. A memory-only password-authentication probe therefore fails inside
production Auth before credential evaluation with an internal `banned_until`
type error.

This fails the explicit requirement that both temporary QA accounts be active
and temporarily unbanned. The task requires stopping before production changes
when credentialed acceptance cannot be completed, so migration and release
execution did not begin.

## No-Write Confirmation

- Migration 008 was not applied.
- Migration 007 was not rerun.
- `main` was not merged or pushed.
- No production deployment was triggered.
- No Vercel environment variable was inspected by value or changed.
- `ENABLE_CUSTOMER_PAYMENT_WORKFLOW` was not enabled.
- No production Supabase row was created, updated, or deleted.
- No production QA inquiry was created.
- The existing live pending Pay-at-Shop inquiry was not opened, accessed by
  identifier, or mutated; only its aggregate count was checked.
- Odoo was not restored.
- Order Drawer development was not started.

## Resume Gate

Before resuming Phase 8C:

- temporarily unban both synthetic production Auth users using an Auth-safe
  finite/null ban state;
- set both matching `public.admin_users.is_active` values to `true`;
- manually verify fresh password login for QA Admin and QA Staff;
- keep the credential file external and unchanged.

The resumed run must restart at Phase 8C Step 1 and reverify every branch,
schema, deployment, environment, pending-count, account, and runtime gate
before applying migration 008.
