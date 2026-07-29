# Phase 8A - Pay at Shop Admin Staging

## Decision

**GO FOR PHASE 8B / PRODUCTION PREPARATION**

Phase 8A is complete on staging. The staging migration, role boundaries,
transactional confirmation path, responsive Admin UI, and regression suite all
passed. Pay Online remains parked. No production code, data, migration, Vercel
setting, or pending Pay-at-Shop record was accessed or changed.

## Release References

- Starting staging head: `83c1b29f9f0c8b1612312129bfda259abde3e454`
- Implementation head: `48f18050a43156bf0ac7276381c091929f97b58f`
- Production main remained: `c31da4a153c9cdeb76e2dff8f053b04ac2d16b63`
- Staging Supabase only: `fszkypwovpdthqfobxrk`
- Migration: `202607290008_pay_at_shop_admin_workflow.sql`
- Verified staging deployment: `dpl_YZi5amSLALSExUmWuohqQS8SaDvu`

Implementation commits:

- `993e3013c685d2f9f4854c3f9bb9517437a9b24b` - Build Pay at Shop admin workflow
- `1ea8f1651ab93293f80fabab380c9ad3fb37f9db` - Load Pay at Shop history in inquiry drawers
- `cbe87ac7cc971264d8317498eafd9ce441a1bd42` - Separate shop and online payment schema readiness
- `5212a5e893565ef553c6c89c60c910c85196d929` - Show Pay at Shop in inquiry details
- `48f18050a43156bf0ac7276381c091929f97b58f` - Center shop payment confirmation overlay

## Files Changed

- Server and API: `api/_lib/supabaseServer.js`,
  `api/inquiries/[id]/customer-actions.js`
- Client and UI: `src/env.js`, `src/main.js`, `src/mvpDashboard.js`,
  `src/services/opsBoard.js`, `src/styles.css`
- Build and local environment: `scripts/build.mjs`, `scripts/local-dev.mjs`
- Tests: `scripts/test-pay-at-shop-admin.mjs`
- Migration: `supabase/migrations/202607290008_pay_at_shop_admin_workflow.sql`
- Generated build output: matching files under `dist/src`

## Migration And Data

The existing staging and production payment columns were audited before
implementation. Staging was missing some canonical fields that already existed
in production; the migration adds those fields idempotently and adds only the
new Phase 8A fields `payment_selected_at` and `payment_internal_note`.

The staging migration:

- adds a 500-character internal-note constraint;
- creates append-only `public.inquiry_payment_events`;
- indexes inquiry and creation time and enforces unique non-null idempotency keys;
- permits authenticated active portal users to read history while denying
  anonymous and direct client insert/update/delete access;
- records one `PAY_AT_SHOP_SELECTED` event when an inquiry first enters a shop
  payment pending state, without backfill or duplicate events;
- creates transactional `public.confirm_inquiry_shop_payment`;
- locks the inquiry row, derives the authenticated actor, requires an active
  Owner/Admin, validates status/quote/artwork/full amount/method, and writes the
  inquiry plus one confirmation event atomically.

Staging schema audit passed: RLS is enabled, authenticated table privileges are
read-only, anonymous table privileges are absent, the append-only trigger is
active, and the selection and confirmation functions/triggers are present.
Selection QA retained one timestamp and one event after an unrelated update.

All ten disposable `QA-PAY-8A-*` inquiries and their payment events were removed
after QA. Final staging cleanup counts were zero inquiries and zero events.

## Feature Separation

- Server flag: `ENABLE_ADMIN_PAY_AT_SHOP_WORKFLOW`
- Client flag: `VITE_ENABLE_ADMIN_PAY_AT_SHOP_WORKFLOW`
- Both default to false and are enabled only on the separate staging Vercel
  project.
- `ENABLE_CUSTOMER_PAYMENT_WORKFLOW` remains false.
- Online receipt submission and the online Admin actions remain unavailable/404.
- `confirm_shop_payment` is canonical; `confirm_cash_payment` is an alias that
  routes through the same transactional RPC.

## Permissions And Business Rules

- Owner confirmation: **PASS**
- Admin confirmation: **PASS**
- Staff confirmation through API: **PASS - HTTP 403**
- Staff direct RPC confirmation: **PASS - denied**
- Anonymous confirmation/history: **PASS - HTTP 401**
- Staff status and history read: **PASS**
- Full quoted amount only: **PASS**
- Zero, negative, partial, mismatched, and invalid-method confirmation: **PASS - rejected**
- Non-shop, unapproved quote, unapproved artwork, and production-active safety
  cases: **PASS - rejected**
- Editing, reversal, refunds, down payments, and POS settlement remain outside
  Phase 8A.
- Payment does not automatically advance production or block direct TRRY order
  conversion. No Odoo Sales Order dependency was restored.

## Atomicity And Audit

- First Owner confirmation: **PASS**
- Same idempotency key retry: **PASS - same confirmer and timestamp**
- Different key after confirmation: **PASS - HTTP 409**
- Two concurrent same-key requests: **PASS - two safe responses, one state
  transition, one confirmer, one timestamp, one confirmation event**
- Owner/Admin display details and internal note hydration: **PASS**
- Safe history projection: **PASS - no email, auth ID, token, or technical event
  ID**
- Direct event update/delete by a normal role: **PASS - denied**

## UI QA

The Inquiry Details payment section passed authenticated Admin and Staff checks
at 1440px desktop, 820px tablet, and 390px mobile.

- Pending badge, amount, selected method/time, warning, and history: **PASS**
- Owner/Admin amount, method, note, and confirmation controls: **PASS**
- Staff read-only state with no confirmation control: **PASS**
- Custom confirmation dialog, cancel path, and draft-note preservation: **PASS**
- Confirmed badge, method, confirmer, timestamp, note, and history: **PASS**
- No clipped controls or horizontal overflow: **PASS**
- Orders labels, including `PAY AT SHOP` and `PAID AT SHOP`: **PASS**
- Authenticated Inquiry, Orders, Production, Workboard, My Tasks, Overview, and
  Settings route smoke: **PASS**

## Automated Regression

- `npm run build`: **PASS**
- `scripts/test-pay-at-shop-admin.mjs`: **PASS**
- All 15 tracked `scripts/test-*.mjs` suites: **PASS**
- Inquiry/order workflow and parked Odoo/payment regression: **PASS**
- Work Chat MVP and launcher browser regression: **PASS**
- Workboard UI/HTTP/browser regression: **PASS**
- My Tasks UI/HTTP/browser regression: **PASS**
- Task service/gateway/dispatch/API regression: **PASS**
- Overview dashboard regression: **PASS**
- `git diff --check`: **PASS** (line-ending warnings only)
- Tracked secret and artifact scan: **PASS**

The exact staging deployment recorded no 5xx runtime responses during QA.
Vercel reported only the existing Node `url.parse()` deprecation warning; no
Phase 8A runtime failure cluster was present.

## Production Boundary

Production main and production Supabase were not modified. No production
migration was applied, no production Vercel environment was changed, Pay Online
was not enabled, Odoo was not restored, and the live pending Pay-at-Shop record
was not read or used for QA. Phase 8B must remain a separately controlled
production-preparation step.
