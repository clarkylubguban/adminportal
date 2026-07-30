# Phase 8C - Pay at Shop Production Release

## Status

**PHASE 8C - RELEASE COMPLETE**

Date: 2026-07-30

The approved Pay at Shop release is live in production. Migration 008, the
approved code, credentialed Admin/Staff acceptance, runtime review, and QA
cleanup all passed.

## Release Scope

- Approved production code:
  `8d71713111c1f4434af6af3a8c53b00d2e77017e`
- Previous production rollback reference:
  `c31da4a153c9cdeb76e2dff8f053b04ac2d16b63`
- Production `main` was fast-forwarded directly to the approved code SHA.
- Documentation-only staging commits were excluded from production.
- Migration 008 was applied individually:
  `202607290008_pay_at_shop_admin_workflow.sql`
- Production migration-history version:
  `20260730012857`
- Migration 007 remained applied and was not rerun.
- No other production migration was applied.

## Production Deployment

- Initial approved-code deployment:
  `dpl_2GtEWvEZEe14RFyv4G6HJv8Zhwnc`
- Task-domain corrective redeployment:
  `dpl_DXG7ijUXHKdjB4VBpgAJtx7eAg3L`
- Final Pay at Shop deployment:
  `dpl_44QPvaSq8XJhkqTNtJjztEob2xgU`
- Final state: `READY`
- Target: production from `main`
- Production alias: `admin.trryapparel.com`
- Deployed Git SHA:
  `8d71713111c1f4434af6af3a8c53b00d2e77017e`

## Environment Separation

Only the approved production keys were changed:

- `VITE_ENABLE_TASK_DOMAIN=true`
- `ENABLE_ADMIN_PAY_AT_SHOP_WORKFLOW=true`
- `VITE_ENABLE_ADMIN_PAY_AT_SHOP_WORKFLOW=true`

The following remained parked:

- `ENABLE_CUSTOMER_PAYMENT_WORKFLOW` is absent or not `true`.
- Customer Pay Online remains unavailable.
- The removed Odoo workflow was not restored.

No unrelated production environment key was changed.

## Migration Verification

Migration 008 created and verified:

- Pay at Shop payment fields and canonical constraints;
- append-only `inquiry_payment_events`;
- selection and confirmation event constraints and indexes;
- authenticated read policy with anonymous access denied;
- `confirm_inquiry_shop_payment(text,numeric,text,text,text)`;
- Owner/Admin authorization and Staff denial;
- quote, artwork, amount, row-lock, and idempotency guards;
- selection-event trigger;
- required grants and revocations.

The migration was absent before execution and present afterward. Migration 007
was not rerun.

## Production Acceptance

One synthetic inquiry was created with the label
`QA PAY AT SHOP PRODUCTION ACCEPTANCE`. No real customer data was used.

Admin acceptance passed:

- pending Pay at Shop state and full amount rendered;
- payment method and internal note controls rendered;
- custom confirmation dialog rendered at 1366px, 820px, and 390px;
- Cancel caused no mutation;
- confirmation succeeded once for the full quoted amount;
- confirmer, timestamps, method, amount, and QA note were stored and rendered;
- confirmation controls disappeared after success.

Staff acceptance passed:

- pending and confirmed states rendered read-only;
- no confirmation controls were available;
- direct confirmation returned `403`;
- payment history remained readable to the authenticated Staff role.

Payment and idempotency acceptance passed:

- `payment_status=full_payment_confirmed`;
- `payment_type=shop`;
- same-key retry returned an idempotent success with no field changes;
- different-key retry returned `409`;
- exactly one `SHOP_PAYMENT_CONFIRMED` event exists;
- history contains exactly `PAY_AT_SHOP_SELECTED` followed by
  `SHOP_PAYMENT_CONFIRMED`;
- no payment event was deleted.

Workflow regression passed:

- direct TRRY order conversion succeeded without an Odoo Sales Order;
- Orders displays `PAID AT SHOP`;
- payment confirmation did not advance production;
- the retained QA order remains `queued`;
- an incomplete production handoff returns a clean non-payment readiness
  blocker and does not mutate the order;
- Inquiry, Orders, Production, Overview, Work Chat, Workboard, and My Tasks
  remained healthy;
- Admin Workboard and My Tasks APIs returned `200`;
- Staff My Tasks returned `200` and Staff Workboard access returned `403`;
- Admin and Staff desktop, tablet, and 390px layouts had no page-level
  horizontal overflow or uncaught page errors;
- anonymous payment-history access returned `401`;
- the Pay Online confirmation path returned `404`.

## Runtime Health

The final production deployment had no `5xx` requests during the acceptance
window. Observed `400`, `401`, `403`, `404`, and `409` responses matched the
intentional negative permission, readiness, anonymous, parked-feature, and
conflict probes.

The only runtime error group was the pre-existing Node `url.parse()`
deprecation warning. No Pay at Shop internal error, permission leakage,
duplicate confirmation, online payment activation, unrelated-module error, or
unexpected inquiry mutation was observed.

## QA Cleanup

- The synthetic QA inquiry was clearly retained as production acceptance audit
  evidence in Orders.
- Its two append-only payment events were preserved.
- Both temporary `public.admin_users` profiles were set inactive.
- Both matching Auth users received a finite future ban.
- All matching Auth sessions and refresh tokens were revoked.
- Fresh login checks for both accounts failed after deactivation.
- The external QA credential file was deleted.
- The empty external credential directory was removed.
- All temporary Phase 8C runner files were deleted.
- No credential, token, cookie, browser storage, signed URL, screenshot, or
  local runner was committed.

The pre-existing live pending Pay at Shop inquiry was never opened or mutated.
Its aggregate pending count was `1` before the release and remained `1` after
acceptance and cleanup.

## Final Decision

All Phase 8C release gates passed. Pay at Shop is enabled for the approved
Admin workflow, Pay Online remains parked, Odoo remains removed, and the
release is complete.
