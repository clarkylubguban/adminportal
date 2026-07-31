# Admin Production Source Reconciliation

Date: 2026-08-01

## Status

RECONCILIATION COMPLETE.

GitHub main was fast-forwarded exactly to the code already running in production. No manual deployment, Vercel setting change, Supabase migration, database write, or environment-variable change was performed.

## Live Commits And Deployments

- Current live commit: `ca170a1c74615f9c1683bccfd26bded24f08c41d`
- Current live deployment: `dpl_6SXaXtw35bTFSChaVNdij58suChH`
- Previous live commit: `918f2180419efe596e997bb052234eabacc4ada1`
- Previous live deployment / rollback candidate: `dpl_FB1JVrtg7kJwgUzfvRBKT3ffNZki`
- Current GitHub main at preflight: `a7da022fbc1a9d9e92c571f49462dcefd16dff95`

## Lineage

PASS.

- Local worktree: `C:\tmp\trry-admin-production-release`
- Branch: `release/admin-payment-production`
- HEAD: `ca170a1c74615f9c1683bccfd26bded24f08c41d`
- Parent: `918f2180419efe596e997bb052234eabacc4ada1`
- `a7da022fbc1a9d9e92c571f49462dcefd16dff95` is an ancestor of `ca170a1c74615f9c1683bccfd26bded24f08c41d`.
- Worktree was clean before this checkpoint was added.
- Current deployment metadata matched `ca170a1c74615f9c1683bccfd26bded24f08c41d` and was READY.
- Previous deployment metadata matched `918f2180419efe596e997bb052234eabacc4ada1` and was READY.

## Payment Foundation Audit

PASS.

Range audited: `a7da022fbc1a9d9e92c571f49462dcefd16dff95..918f2180419efe596e997bb052234eabacc4ada1`

Change classes found:

- Online payment review API: `api/_lib/paymentReview.js`, `api/inquiries/[id]/payments.js`
- Payment proof validation/access: `api/_lib/receiptValidation.js`, payment-proof API compatibility
- Customer payment actions: `api/inquiries/[id]/customer-actions.js`
- Inquiry workflow compatibility: `api/inquiries/[id]/workflow.js`, `api/_lib/orderDetails.js`
- Supabase migrations: online payment review, stale version fix, admin down-payment confirmations
- Payment tests: API, browser, migration, upload policy, Pay-at-Shop regression
- Vercel routing/build: `vercel.json`, local/build routing updates
- Documentation: Phase 9B production preparation and migration result checkpoints

No active change in this already-live range was identified as restoring Odoo requirements, payment-gated production readiness, or obsolete `complete_payment_workflow` behavior.

## UI Cleanup Audit

PASS.

Range audited: `918f2180419efe596e997bb052234eabacc4ada1..ca170a1c74615f9c1683bccfd26bded24f08c41d`

Files changed by `ca170a1c74615f9c1683bccfd26bded24f08c41d`:

- `scripts/test-inquiry-drawer-payment-regression.mjs`
- `scripts/test-online-payment-review-browser.mjs`
- `scripts/test-pay-at-shop-admin.mjs`
- `src/main.js`
- `src/mvpDashboard.js`
- `src/paymentReviewView.js`
- `src/styles.css`

Scope is limited to Inquiry Payment UI cleanup, payment summary rendering, receipt read-only UI, customer/internal note separation, related CSS, and UI regression tests. No API route, Supabase migration, RPC, auth, permission, backend payment-rule, or production workflow change was introduced by `ca170a1c` itself.

## Production Schema Provenance

PASS.

Read-only production metadata confirmed applied migration records:

- `20260731072322` / `online_payment_review`
- `20260731072334` / `online_payment_review_stale_version_fix`
- `20260731072520` / `allow_admin_down_payment_confirmations`

Read-only schema checks confirmed:

- `review_online_payment` RPC exists.
- Receipt filename/content-type/size fields exist on `public.ops_inquiries`.
- Payment status constraints include online review and Pay-at-Shop statuses.
- Stale-version and admin down-payment confirmation support are represented in the applied migration set.
- Task Domain feature flag is enabled.

No schema change is required for the currently live code.

## Feature And Workflow Safety

PASS based on static and read-only checks.

- Pay at Shop remains represented in code and production schema.
- Pay Online customer actions remain backend-gated by `ENABLE_CUSTOMER_PAYMENT_WORKFLOW`.
- Payment proof/review visibility does not automatically enable the customer gateway.
- Production readiness remains payment-parked in dashboard copy.
- Direct order creation remains available without restoring Odoo entry requirements.
- Task Domain is enabled in production metadata.
- Order Drawer and Production Drawer code paths are present.
- `ca170a1c` UI cleanup does not change backend payment rules.

## Tests

PASS:

- `node scripts/test-inquiry-drawer-payment-regression.mjs`
- `node scripts/test-online-payment-review-api.mjs`
- `node scripts/test-online-payment-review-browser.mjs`
- `node scripts/test-pay-at-shop-admin.mjs`
- `node scripts/test-customer-payment-upload-policy.mjs`
- `node scripts/test-online-payment-review-migration.mjs`
- `node scripts/test-production-job-browser.mjs`
- `node scripts/test-task-api.mjs`
- `node scripts/test-task-service.mjs`
- `node scripts/test-workboard-http.mjs`
- `node scripts/test-my-tasks-ui.mjs`
- `npm.cmd run build`
- `git diff --check`

BLOCKED:

- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-production-migration-rehearsal.ps1`
  - Docker Desktop Linux engine was not available, so the local rehearsal could not start.
- `node scripts/test-order-details-browser.mjs`
  - Timed out waiting for pending Pay-at-Shop drawer text `SHOP PAYMENT PENDING`.
  - Current live UI renders the pending state as `PAY AT SHOP SELECTED`, so the test appears stale relative to `ca170a1c`.

UNAVAILABLE:

- `npm run lint`; no lint script exists in `package.json`.

## Secret And Artifact Scan

PASS with noted existing assets.

No tracked service-role key, token, password, cookie store, signed URL, local Vercel metadata directory, runtime log, or browser storage artifact was identified.

Tracked non-secret artifacts include `.env.example` and existing design reference screenshots under `Design/`.

## Recovery Tags And Bundles

NOT CREATED.

Required test gates did not fully pass, so no recovery tags or bundles were created or pushed.

Planned names remain:

- `C:\tmp\admin-production-918f218.bundle`
- `C:\tmp\admin-production-ca170a1c.bundle`
- `recovery/admin-payment-foundation-918f218`
- `recovery/admin-payment-ui-ca170a1c`

## Origin Main

PASS.

`origin/main` was rechecked at `a7da022fbc1a9d9e92c571f49462dcefd16dff95`, then fast-forwarded without force to `ca170a1c74615f9c1683bccfd26bded24f08c41d`.

## Deployment Watch

PASS.

No manual deployment was performed. Vercel automatically created production deployment `dpl_GM5dwikc7DkWv3edeVCM4ZJ8xQMJ` from `main` at `ca170a1c74615f9c1683bccfd26bded24f08c41d`.

Deployment verification:

- State: READY
- Target: production
- Commit: `ca170a1c74615f9c1683bccfd26bded24f08c41d`
- Branch: `main`
- Alias includes `admin.trryapparel.com`
- No Vercel environment change was made by this reconciliation
- Runtime error/fatal log check for the deployment returned no matching logs in the checked window

Rollback retained:

- `dpl_FB1JVrtg7kJwgUzfvRBKT3ffNZki`

## Staging Divergence

NOT AUDITED AFTER MAIN SYNC.

Main synchronization did not occur. Preflight ref observed:

- `origin/staging`: `72838693cd4434c28cc17af9b7d2b29905ce1e90`

The post-sync staging divergence audit should be rerun only after the blocking tests are resolved and main is successfully synchronized.

## Completed Reconciliation

The earlier blockers were reclassified and resolved for source reconciliation:

- Docker migration rehearsal remains NOT RUN because Docker Desktop Linux engine is unavailable. This is non-blocking for source reconciliation because no migration was applied, production schema provenance already passed read-only, and no schema modification is required.
- `scripts/test-order-details-browser.mjs` contains stale expectations from before the intentional read-only Inquiry payment cleanup.
- Temporary current-UI alignment changed `SHOP PAYMENT PENDING` to `PAY AT SHOP SELECTED` and changed the Inquiry drawer Owner/Admin `confirm_shop_payment` control expectation from one to zero.
- The temporarily aligned suite passed.
- The temporary test edit was reverted. The live tree remained exactly `ca170a1c74615f9c1683bccfd26bded24f08c41d`.
- Dedicated Pay-at-Shop and payment review safety suites passed after restoring the exact live tree.

Recovery bundles created and verified:

- `C:\tmp\admin-production-918f218.bundle`
- `C:\tmp\admin-production-ca170a1c.bundle`

Recovery tags created, pushed, and verified from a fresh clone:

- `recovery/admin-payment-foundation-918f218` -> `918f2180419efe596e997bb052234eabacc4ada1`
- `recovery/admin-payment-ui-ca170a1c` -> `ca170a1c74615f9c1683bccfd26bded24f08c41d`

## 2026-08-01 Resume Attempt

RECONCILIATION REMAINS BLOCKED.

Reconfirmed before testing:

- Branch: `release/admin-payment-production`
- HEAD: `ca170a1c74615f9c1683bccfd26bded24f08c41d`
- Tracked worktree: clean
- Only untracked file: `docs/checkpoints/ADMIN_PRODUCTION_SOURCE_RECONCILIATION.md`

Temporary test-only edit:

- Replaced the five `SHOP PAYMENT PENDING` drawer waits in `scripts/test-order-details-browser.mjs` with `PAY AT SHOP SELECTED`.
- Ran `node scripts/test-order-details-browser.mjs`.
- Result: FAIL at line 96, `0 !== 1`, because the Owner drawer did not render `[data-ops-customer-action="confirm_shop_payment"]`.
- Reverted only the temporary test edit.
- HEAD remained `ca170a1c74615f9c1683bccfd26bded24f08c41d`; tracked worktree returned clean.

Observed renderer context:

- `src/main.js` intentionally maps `pay_at_shop` and `payment_pending_at_shop` to `PAY AT SHOP SELECTED`.
- `src/main.js` `renderOpsPaymentStage` currently renders summary, read-only Pay-at-Shop text, receipt, notes, and history, but no Owner/Admin shop-payment confirmation action.
- `scripts/test-order-details-browser.mjs` sets `VITE_ENABLE_ADMIN_PAY_AT_SHOP_WORKFLOW` to `true`, so the missing control is not explained by the local test feature flag being absent.

Actions not performed:

- No Vercel setting, Supabase schema, migration, environment variable, or production deployment was modified.
- No stale test correction was committed into the reconciled production commit.

## Staging-Only Test Maintenance

Perform later on staging, not in the reconciled live commit:

- Update `scripts/test-order-details-browser.mjs`: `SHOP PAYMENT PENDING` -> `PAY AT SHOP SELECTED`
- Update the Inquiry drawer Owner/Admin `confirm_shop_payment` expected count: `1` -> `0`
- Remove or replace action-dialog assertions that directly depend on the removed read-only Inquiry drawer action

Final result: RECONCILIATION COMPLETE.
