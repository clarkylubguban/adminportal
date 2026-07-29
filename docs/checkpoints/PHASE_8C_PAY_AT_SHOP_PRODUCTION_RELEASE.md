# Phase 8C - Pay at Shop Production Release

## Status

**BLOCKED - RELEASE NOT STARTED**

Date: 2026-07-29

Phase 8C stopped at the credentialed-acceptance gate before any production
write.

## Preflight

- Approved staging head:
  `8d71713111c1f4434af6af3a8c53b00d2e77017e`
- Local staging head:
  `8d71713111c1f4434af6af3a8c53b00d2e77017e`
- `origin/staging`:
  `8d71713111c1f4434af6af3a8c53b00d2e77017e`
- Expected and observed `origin/main`:
  `c31da4a153c9cdeb76e2dff8f053b04ac2d16b63`
- Branch graph: staging is 13 commits ahead and 0 behind
- Worktree before this checkpoint: clean

## Exact Blocker

The required external credential file was absent:

`C:\tmp\trry-admin-production-qa-secrets\qa-accounts.env`

The parent directory exists but is empty. Therefore the release process could
not verify:

- the exact four-key credential-file contract;
- QA Admin and QA Staff production authentication;
- confirmed and unbanned Auth state;
- active `public.admin_users` records;
- Admin and Staff role assignments;
- the ability to complete post-release credentialed acceptance and cleanup.

The task requires stopping before production changes when credentialed
acceptance cannot be completed, so migration and release execution did not
begin.

## No-Write Confirmation

- Migration 008 was not applied.
- Migration 007 was not rerun.
- `main` was not merged or pushed.
- No production deployment was triggered.
- No Vercel environment variable was inspected by value or changed.
- `ENABLE_CUSTOMER_PAYMENT_WORKFLOW` was not enabled.
- No production Supabase row was created, updated, or deleted.
- No production QA inquiry was created.
- The existing live pending Pay-at-Shop inquiry was not accessed or mutated.
- Odoo was not restored.
- Order Drawer development was not started.

## Resume Gate

Before resuming Phase 8C, recreate the external credential file with exactly:

- `QA_ADMIN_EMAIL`
- `QA_ADMIN_PASSWORD`
- `QA_STAFF_EMAIL`
- `QA_STAFF_PASSWORD`

Do not commit the file. The resumed run must restart at Phase 8C Step 1 and
reverify every branch, schema, deployment, environment, pending-count, account,
and runtime gate before applying migration 008.
