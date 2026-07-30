# Phase 8D.1 Order Details Drawer - Staging

## Decision

**GO FOR PHASE 8D.2 PRODUCTION DRAWER**

The Order Details Drawer is complete on `staging`. All Phase 8D.1 API,
interaction, role, payment, accessibility, and responsive acceptance gates
passed. No production action was performed.

## Release References

- Starting `origin/staging`: `3c70215d0a8281ed45bb7b75ef3ce8fa8e174dad`
- Production reference `origin/main`: `8d71713111c1f4434af6af3a8c53b00d2e77017e`
- Staging implementation: `d81f19475a1ce0dc07c6341e1ea7b1ba2c5add45`
- Starting relationship: staging was 3 commits ahead and 0 behind main.
- Scope: Admin Portal Order Drawer only.

## Schema And Migration

Read-only staging schema inspection confirmed that `ops_inquiries`,
`inquiry_payment_events`, `inquiry_follow_up_events`, and `admin_users`
already contain the required fields.

**Migration status: none required and none applied.**

No production Supabase, production Vercel, `main`, TRRY POS, or Client Portal
state was read or modified by this implementation.

## Files Changed

- `api/_lib/orderDetails.js`
- `api/inquiries/[id]/workflow.js`
- `src/services/orderDetails.js`
- `src/main.js`
- `src/mvpDashboard.js`
- `src/styles.css`
- matching generated files under `dist/src`
- `scripts/local-dev.mjs`
- `scripts/test-order-details-api.mjs`
- `scripts/test-order-details-browser.mjs`
- `scripts/verify-vercel-functions.mjs`
- `vercel.json`

## API Contract

Public contract:

`GET /api/orders/:id`

The public route is rewritten to the existing inquiry workflow Lambda with a
read-only action. The deployment remains at 12 Vercel function entrypoints.

- Bearer authentication is required.
- Active Owner, Admin, and Staff portal accounts may read.
- Anonymous or invalid sessions return `401`.
- Inactive or unauthorized portal accounts return `403`.
- Missing records return `404`.
- Records whose canonical `ops_inquiries.status` is not `won` return `404`.
- The response is a normalized projection of the canonical inquiry/order.
- User references are hydrated to approved display names.
- UUIDs, auth data, tokens, signed URLs, and Odoo data are not projected.
- Activity contains only stored timestamps and event records.
- A confirmation timestamp or event is not invented when the schema has none.

## Drawer Behavior And Layout

- Opens from an Orders row, its single `OPEN` action, or a mobile order card.
- Does not open from unrelated inline controls.
- Preserves Orders filters, search, page scroll, and table scroll.
- Supports close button, Escape, and backdrop close.
- Restores focus to the exact opening row, action, or mobile card.
- Locks background scrolling and scrolls the drawer body independently.
- Implements loading, ready, not-found, non-order, error, retry, and limited
  history states.
- Uses request cancellation and request versions to prevent stale-order mixes.
- Uses a 560px desktop drawer, 520px tablet drawer, and full-screen 390px
  mobile drawer.
- The mobile header is sticky and compact with a top-right 40px close control.
- No tested viewport had clipping, page overflow, or nested horizontal scroll.

## Content And Navigation

The drawer contains flat sections for:

- order and customer summary
- quotation and secure artwork access
- payment state and history
- read-only production readiness
- reliable stored activity

Missing optional values render as `Not set`. The drawer has no Odoo label,
Pay Online action, quotation editor, or production-stage mutation control.

`OPEN ORIGINAL INQUIRY` navigates to Inquiries and opens the same canonical
record. `VIEW IN PRODUCTION` filters the existing Production list to the same
record without opening or implementing a Production Drawer.

## Roles And Payment Reuse

- Owner: full read; existing pending Pay-at-Shop confirmation is available.
- Admin: full read; existing pending Pay-at-Shop confirmation is available.
- Staff: full operational read; confirmation control is hidden and a direct
  confirmation request remains `403`.
- All roles: production readiness is read-only.

The drawer reuses the Phase 8C Pay-at-Shop renderer, canonical server action,
full-payment-only validation, payment-method selector, internal-note rules,
custom confirmation dialog, idempotency, and conflict handling. Successful
confirmation refreshes both the canonical Orders list state and the open
drawer without a page reload. Payment remains non-blocking for conversion and
production.

## QA Data

Browser and API QA used only in-process synthetic fixtures labeled
`QA ORDER DRAWER PHASE 8D1` for:

- unpaid confirmed order
- pending Pay-at-Shop order
- paid-at-shop order
- production-ready order
- blocked/not-ready order

No staging or production customer record was mutated, so no data cleanup was
required. Optional screenshots were captured outside the repository.

## Automated Results

PASS:

- `npm run build`
- `scripts/test-order-details-api.mjs`
- `scripts/test-order-details-browser.mjs`
- `scripts/test-pay-at-shop-admin.mjs`
- `scripts/test-ops-workflow-direct-order.mjs`
- `scripts/test-overview-dashboard.mjs`
- `scripts/test-work-chat-mvp.mjs`
- `scripts/test-work-chat-launcher-browser.mjs`
- `scripts/test-my-tasks-http.mjs`
- `scripts/test-my-tasks-ui.mjs`
- `scripts/test-my-tasks-browser.mjs`
- `scripts/test-workboard-http.mjs`
- `scripts/test-workboard-ui.mjs`
- `scripts/test-workboard-browser.mjs`
- `scripts/test-task-api.mjs` - 18 API suites
- `scripts/test-task-dispatch.mjs`
- `scripts/test-task-gateway-http.mjs`
- `scripts/test-task-service.mjs`
- `scripts/validate-task-domain.mjs`
- `scripts/verify-vercel-functions.mjs` - 12 deployable functions
- `git diff --check`
- tracked credential and artifact scan

Environment-limited:

- `scripts/verify-task-concurrency.mjs` could not run because its required
  disposable container `codex-trry-task-verify-20260725` no longer exists.
  Docker itself was verified healthy. This is not an Order Drawer blocker;
  task API replay, stale-version, simultaneous-winner, idempotency, role, and
  projection contracts passed in `scripts/test-task-api.mjs`.

## Regression Assessment

PASS for Inquiry Drawer routing, inquiry follow-ups, quote/artwork access,
Pay at Shop, Orders, Production list navigation, Work Chat, Overview,
Workboard, My Tasks, direct TRRY order conversion, parked Pay Online,
payment-nonblocking behavior, and Odoo removal.

Phase 8D.2 may begin as a separate Production Drawer implementation. Phase
8D.1 does not contain production-stage controls and must not be interpreted as
authorization to merge or deploy production.
