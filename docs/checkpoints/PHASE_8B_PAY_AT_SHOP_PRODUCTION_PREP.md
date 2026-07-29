# Phase 8B - Pay at Shop Production Preparation

## Decision

**GO FOR PHASE 8C CONTROLLED PRODUCTION RELEASE**

Phase 8B completed the release, schema, environment, rollback, and production
acceptance preflight without a production write. Phase 8C must preserve the
ordered gates in this document and stop immediately if any branch, schema,
deployment, or flag check has changed.

## No-Write Boundary

No production migration was applied. No branch was merged into `main`. No
production deployment, environment variable, Vercel setting, Supabase row, or
existing Pay-at-Shop inquiry was modified. Pay Online was not enabled and Odoo
was not restored. The production inquiry audit used schema state and aggregate
counts only.

## Branch Audit

- Pre-documentation staging head:
  `d9047658f8b04bd406e020f04a82fb4b43031115`
- Production main:
  `c31da4a153c9cdeb76e2dff8f053b04ac2d16b63`
- `origin/main...origin/staging`: 0 behind, 12 ahead
- Merge base: `c31da4a153c9cdeb76e2dff8f053b04ac2d16b63`
- Worktree: clean before this documentation change

Commits in chronological order:

1. `b5d10ec85a691052032e22abedcba805bd402d1b` - Document Phase 7D.1 hotfix smoke
2. `1ef7c174f008bb56f577fef522473e9d5d070df9` - Document Phase 7E production acceptance blocker
3. `8378be49a2307b136e96966aba5039ccc9708fc4` - Document Phase 7E credential blocker
4. `c2ade33d4fad7e070cf8988fda4d34fa41734689` - Document Phase 7E production acceptance blockers
5. `52099c1b1891219b842b154512eae766762ad3a3` - Prepare production task domain enablement
6. `83c1b29f9f0c8b1612312129bfda259abde3e454` - Complete Phase 7 production acceptance
7. `993e3013c685d2f9f4854c3f9bb9517437a9b24b` - Build Pay at Shop admin workflow
8. `1ea8f1651ab93293f80fabab380c9ad3fb37f9db` - Load Pay at Shop history in inquiry drawers
9. `cbe87ac7cc971264d8317498eafd9ce441a1bd42` - Separate shop and online payment schema readiness
10. `5212a5e893565ef553c6c89c60c910c85196d929` - Show Pay at Shop in inquiry details
11. `48f18050a43156bf0ac7276381c091929f97b58f` - Center shop payment confirmation overlay
12. `d9047658f8b04bd406e020f04a82fb4b43031115` - Document Phase 8A staging QA

Change classification:

- Pay at Shop implementation:
  `api/_lib/supabaseServer.js`,
  `api/inquiries/[id]/customer-actions.js`, `src/env.js`, `src/main.js`,
  `src/mvpDashboard.js`, `src/services/opsBoard.js`, `src/styles.css`,
  `scripts/build.mjs`, and `scripts/local-dev.mjs`
- Migration 008:
  `supabase/migrations/202607290008_pay_at_shop_admin_workflow.sql`
- Generated assets:
  `dist/src/main.js`, `dist/src/mvpDashboard.js`,
  `dist/src/services/opsBoard.js`, and `dist/src/styles.css`
- Automated test:
  `scripts/test-pay-at-shop-admin.mjs`
- Phase 8A documentation:
  `docs/checkpoints/PHASE_8A_PAY_AT_SHOP_STAGING.md`
- Unrelated Phase 7 documentation:
  `docs/checkpoints/PHASE_7_PRODUCTION_RELEASE.md`
- Prior task-domain production record:
  `supabase/migrations/202607290007_enable_task_domain_production.sql`

Production already records `create_task_domain_schema`,
`create_task_domain_functions`, and `enable_task_domain_production` as applied
under generated migration-history versions. Migration 007 must not be rerun.
There is no repository workflow or package script that automatically applies
Supabase migrations during a Git/Vercel deployment.

Because staging is not behind, a clean fast-forward is available. The extra
Phase 7 file changes are documentation plus the already-applied migration 007;
they do not add an unreviewed application behavior.

## Pay Online Separation

No unintended Pay Online enablement was found.

- `ENABLE_CUSTOMER_PAYMENT_WORKFLOW` remains the sole server gate for online
  receipt and verification actions.
- The customer online payment endpoint returned HTTP 404 in production.
- Online Admin actions return unavailable/404 while that flag is not true.
- Pay-at-Shop uses the separate
  `ENABLE_ADMIN_PAY_AT_SHOP_WORKFLOW` server gate.
- Its client UI uses the separate
  `VITE_ENABLE_ADMIN_PAY_AT_SHOP_WORKFLOW` gate.
- Both new defaults are false when absent.
- Production's public environment script does not contain the client
  Pay-at-Shop flag.
- Production Vercel project metadata has not been updated since before Phase 8A,
  whose new server flag was never added to production. Phase 8C must still
  perform a key-only final environment check immediately before changing flags.

## Migration 008 Preflight

Result: **PASS**

The migration is additive to production data and business behavior, with one
DDL qualification: it drops and recreates the existing payment status, method,
and type check constraints to normalize the accepted canonical values. It does
not drop a column, table, row, or payment history.

The migration:

- adds missing nullable canonical fields only when absent;
- adds nullable `payment_selected_at` and `payment_internal_note`;
- adds the note length check;
- creates `inquiry_payment_events`, its constraints, indexes, RLS policy, and
  append-only protection;
- creates the selection timestamp/event triggers and Owner/Admin actor guard;
- creates transactional `confirm_inquiry_shop_payment`;
- revokes public/anonymous RPC execution and grants it to authenticated users;
- contains no top-level inquiry update, backfill, synthetic insert, or QA data;
- does not modify order conversion or production transition logic;
- does not enable Pay Online or any feature flag.

The existing production payment values are compatible with the replacement
constraints:

- Invalid payment status count: 0
- Invalid payment method count: 0
- Invalid payment type count: 0

The one existing pending Pay-at-Shop inquiry is preserved because all new
columns are nullable, DDL does not fire the selection triggers, and there is no
backfill. Its selection timestamp may remain unavailable by design.

Rerun behavior:

- column additions, indexes, and the event table use existence guards;
- the canonical foreign key has a named existence guard;
- policies, triggers, and functions are recreated deterministically;
- rerunning against the exact successfully applied schema is safe;
- `CREATE TABLE IF NOT EXISTS` is not a repair path for an unexpectedly partial
  pre-existing event table.

Therefore Phase 8C must confirm that the production event table and RPC are
still absent before the first application, and must stop on any partial state.

## Staging Schema Comparison

The exact staging result matches migration 008:

- all ten required inquiry payment columns are present;
- payment status, method, type, note-length, and verifier foreign-key
  constraints match;
- `inquiry_payment_events` has 12 required columns and 10 required
  primary/foreign/check constraints;
- primary, inquiry, creation-time, idempotency, and one-selection indexes are
  present;
- RLS is enabled;
- anonymous table privileges are absent;
- authenticated table privilege is SELECT only;
- the active Owner/Admin/Staff read policy is present;
- the append-only trigger and three inquiry triggers are present;
- the confirmation RPC is security-definer, checks `auth.uid()`, and is
  executable by authenticated users but not public/anonymous users.

Staging migration history records `pay_at_shop_admin_workflow` as applied under
generated version `20260729050754`. Phase 8A QA records and events remain
cleaned to zero.

## Production Read-Only Audit

Result: **MIGRATION 008 REQUIRED**

- Existing canonical payment status, method, type, confirmed, and verified
  fields are present.
- `payment_selected_at` is absent.
- `payment_internal_note` is absent.
- Existing payment constraints and verifier foreign key are valid.
- Existing trigger `ops_inquiries_mvp_workflow_guard` requires quote/artwork,
  amount, and timestamp when payment becomes confirmed.
- The trigger does not require payment for order conversion or production.
- Current pending Pay-at-Shop inquiry count: 1.
- `inquiry_payment_events`: absent.
- `confirm_inquiry_shop_payment`: absent.
- Migration 008 history: absent.
- A dedicated test/archive marker column is not available on `ops_inquiries`.
- Production online payment endpoint: HTTP 404.

Production Vercel:

- Project: `adminportal` / `prj_ObjP9WVxYHHvfYgsLgZYd3PrXQ0g`
- Production deployment:
  `dpl_349VPfKCxW3NHyg5xvJHzWgrfWHC`
- Deployment state: READY
- Production commit/ref:
  `c31da4a153c9cdeb76e2dff8f053b04ac2d16b63` / `main`
- Production alias: `admin.trryapparel.com`
- Staging commits on this project remain non-production preview deployments.
- No production 5xx responses were present in the last two-hour runtime window.
- Historical error clusters remain visible from earlier Task/Work Chat QA, but
  no sustained current 5xx condition was found.

## Feature Flag Plan

Do not apply these changes until steps 1-5 of the release sequence pass.

On the production `adminportal` project, Production scope only:

1. Reconfirm `ENABLE_CUSTOMER_PAYMENT_WORKFLOW` is absent or not true.
2. Reconfirm both Pay-at-Shop flags are absent or not true.
3. Set `ENABLE_ADMIN_PAY_AT_SHOP_WORKFLOW=true`.
4. Set `VITE_ENABLE_ADMIN_PAY_AT_SHOP_WORKFLOW=true`.
5. Do not add either flag to Preview or Development.
6. Do not modify any Supabase, payment, Odoo, domain, or branch setting.
7. Trigger a clean deployment of the exact approved `main` SHA because the
   client flag is embedded in the generated public environment script.

Enabling these flags cannot activate online receipt upload or online Admin
verification because those paths separately require
`ENABLE_CUSTOMER_PAYMENT_WORKFLOW=true`.

## Exact Release Sequence

1. Fetch origin and verify the approved Phase 8C staging SHA, expected `main`
   SHA, clean worktree, 0-behind graph, production deployment, and all three
   payment flags.
2. Re-run the production compatibility-count query and confirm the event table,
   RPC, and migration history remain absent.
3. Apply only the exact SQL in
   `202607290008_pay_at_shop_admin_workflow.sql` to production using one
   controlled migration operation named `pay_at_shop_admin_workflow`.
   Do not run `supabase db push` and do not run migration 007.
4. Verify all columns, constraints, event-table constraints/indexes, RLS,
   privileges, policy, triggers, RPC ACL, and migration-history entry. Confirm
   the pending Pay-at-Shop count remains 1 without reading that row.
5. Fast-forward `main` from its expected SHA to the exact approved staging SHA:

   ```powershell
   git switch main
   git pull --ff-only origin main
   git merge --ff-only origin/staging
   git push origin main
   ```

6. Verify the automatic Vercel production deployment is READY at the new
   `main` SHA while both Pay-at-Shop flags remain false/absent.
7. Apply only the two Production-scoped Pay-at-Shop flags in the Vercel plan.
8. Trigger and verify one clean production deployment of that same `main` SHA.
9. Run anonymous/read-only smoke checks: app shell, public env flags, online
   endpoint 404, anonymous shop confirmation 401, no sustained 5xx, and no
   migration/schema errors.
10. Create and use only the disposable production QA inquiry described below.
    Never open or mutate the existing live pending Pay-at-Shop inquiry.

## Rollback Plan

- Code reference:
  `c31da4a153c9cdeb76e2dff8f053b04ac2d16b63`
- Vercel rollback candidate:
  `dpl_349VPfKCxW3NHyg5xvJHzWgrfWHC`
- First response to a Pay-at-Shop defect: remove or set both Pay-at-Shop flags
  to false and redeploy. Leave `ENABLE_CUSTOMER_PAYMENT_WORKFLOW` false.
- If code rollback is required, promote the Vercel rollback candidate for
  immediate traffic recovery, then create a normal Git revert commit for the
  Phase 8C release range and push that revert through `main`. Do not force-push
  or reset shared history.
- Migration 008 remains forward-only. Its new nullable fields and dormant
  objects can remain after flags are disabled.
- A verified migration defect requires a separately reviewed corrective
  migration.
- Never drop or delete payment events, clear confirmation fields, or rewrite
  payment history to simulate rollback.

## Production QA Inquiry Plan

Create exactly one synthetic record named:

`QA PAY AT SHOP PRODUCTION ACCEPTANCE`

Use a unique QA inquiry reference, synthetic contact fields only, approved
quotation, approved artwork, a positive full quote, and Pay at Shop pending.
`ops_inquiries` has no `is_test`, archive, or equivalent marker column, so the
name/reference must carry the QA marker.

Acceptance:

1. Owner/Admin sees `PAY AT SHOP` and `SHOP PAYMENT PENDING`.
2. Staff sees the same state/history without confirmation controls.
3. Staff API and direct RPC confirmation are denied; API returns 403.
4. Owner/Admin confirms the full quoted amount using a valid method and a
   clearly synthetic internal note.
5. Two same-key concurrent/retry requests retain one confirmer, timestamp, and
   `SHOP_PAYMENT_CONFIRMED` event.
6. A different second key returns 409.
7. Inquiry status becomes `full_payment_confirmed`.
8. Orders displays `PAID AT SHOP`.
9. History displays one selection and one confirmation event with safe actor,
   amount, method, timestamp, and note fields.
10. Direct TRRY order conversion remains non-blocking and Odoo-free.
11. Pay Online remains unavailable.

After acceptance, retain only this synthetic, audit-safe inquiry and its
append-only events unless an existing supported archive action is available.
Do not delete payment history, do not place real customer data in the record,
and do not alter the pre-existing pending customer inquiry.

## Regression And Runtime Plan

After flag-enabled deployment, run authenticated Owner/Admin/Staff checks for:

- Inquiry Details and follow-ups;
- quotation and artwork approval;
- direct TRRY order conversion;
- Orders and Production;
- Work Chat;
- Workboard and My Tasks;
- desktop, 820px tablet, and 390px mobile;
- Staff permission enforcement;
- Pay Online parked behavior;
- Odoo-free behavior;
- anonymous isolation;
- runtime error clusters and grouped 5xx counts.

Stop and roll flags back if there is a sustained 5xx condition, schema/RPC
error, duplicate confirmation/event, authorization bypass, payment-history
exposure, Pay Online activation, or impact to the existing live pending record.

## Local Verification

- `npm run build`: PASS
- All 15 `scripts/test-*.mjs` suites: PASS
- Pay-at-Shop focused test: PASS
- Direct order conversion/payment/Odoo regression: PASS
- Work Chat, Workboard, My Tasks, Tasks, Overview regressions: PASS
- `git diff --check`: PASS (line-ending warnings only)
- Tracked QA/session artifact scan: PASS
- Tracked non-example environment file scan: PASS
