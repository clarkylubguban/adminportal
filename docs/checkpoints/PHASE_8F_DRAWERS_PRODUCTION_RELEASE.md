# Phase 8F Drawers Production Release

## Status

**PHASE 8F RELEASE COMPLETE**

The approved Order Drawer and Production Drawer executable was released to
production and passed synthetic, credentialed production acceptance.

No migration or production environment change was required or performed. No
live customer order or existing Pay-at-Shop inquiry was accessed or mutated.

## Release References

- Production main:
  `a7da022fbc1a9d9e92c571f49462dcefd16dff95`
- Production deployment:
  `dpl_ErTbEwTWnhnP6TdPK22RGSDC969a` - READY
- Previous production rollback SHA:
  `8d71713111c1f4434af6af3a8c53b00d2e77017e`
- Previous production rollback deployment:
  `dpl_44QPvaSq8XJhkqTNtJjztEob2xgU`
- Staging documentation base:
  `6fbc09a9a97800d1d5775ca41b27ccb8cdb4f65f`
- Production URL: `https://admin.trryapparel.com`

Production `main` was fast-forwarded directly from the previous release to the
approved executable SHA. Documentation-only staging commits were not released.

## Credential Repair

The two exact designated production QA Auth users and their profiles were
verified by exact email before repair:

- one confirmed Auth identity each;
- one `admin_users` profile each;
- `is_test = true`;
- expected Admin and Staff roles.

Production generated two distinct cryptographically secure temporary passwords
and applied their bcrypt hashes only to those exact Auth users. Each generated
password was returned encrypted to a one-time local public key, decrypted only
inside the temporary repair runner, and written to the external QA credential
file without being printed.

Normal public Supabase sign-in then passed for both accounts. Each returned Auth
identity matched the intended user and its active `is_test` portal profile and
expected role. Both proof sessions were globally revoked before release.

No password, hash, API key, token, cookie, browser storage, signed URL, or
credential-bearing URL was printed, committed, or documented.

## Synthetic Evidence

One clearly labeled canonical production QA order was retained:

- Reference: `QA-PHASE-8F-DRAWERS-20260730-01`
- Customer label: `QA ORDER DRAWER PRODUCTION ACCEPTANCE`
- Company label: `QA PRODUCTION DRAWER PRODUCTION ACCEPTANCE`
- Data class: synthetic Phase 8F QA only
- Route: DTF
- Final production stage: completed

The retained record has exactly one Pay-at-Shop selection event and exactly one
shop-payment confirmation event.

## Order Drawer

**PASS**

- Anonymous request isolation: `401`
- Owner, Admin, and Staff authenticated reads: PASS
- Canonical reference, customer, product, quantity, due date, assignment,
  payment, readiness, blocker, and production state: PASS
- Staff Pay-at-Shop confirmation denial: `403`
- Admin full-amount Pay-at-Shop confirmation: PASS
- Same-key payment replay: PASS with one confirmation event
- Second confirmation with a different key: `409`
- Pay Online action: `404`
- No Odoo dependency or Odoo content in the drawer: PASS

## Production Drawer

**PASS**

- Anonymous request isolation: `401`
- Owner, Admin, and Staff authenticated reads: PASS
- Admin and Owner assignment, blocker, and note controls: PASS
- Unassigned Staff write denial: `403`
- Assigned Staff note and stage actions: PASS
- Active-blocker progression denial: PASS
- Staff blocker mutation denial: `403`
- Valid DTF route:
  `queued -> printing -> qc -> ready -> completed`
- Completed detail/action lock: PASS
- Payment excluded from production readiness and unchanged by all production
  actions: PASS

## Role Matrix

| Capability | Owner | Admin | Assigned Staff | Unassigned Staff | Anonymous |
| --- | --- | --- | --- | --- | --- |
| Read Order Drawer | PASS | PASS | PASS | PASS | `401` |
| Read Production Drawer | PASS | PASS | PASS | PASS | `401` |
| Confirm Pay at Shop | Covered by Owner/Admin contract; Admin live PASS | PASS | `403` | `403` | DENIED |
| Assign Staff | PASS | PASS | DENIED | DENIED | DENIED |
| Set/clear blocker | PASS | PASS | `403` | `403` | DENIED |
| Edit production note | PASS | PASS | PASS | `403` | DENIED |
| Advance valid stage | PASS | PASS | PASS | `403` | DENIED |

The designated QA Admin profile was temporarily changed from Admin to Owner
only for the Owner production boundary pass, then restored to Admin before the
final stage sequence.

## Concurrency And Consistency

**PASS**

- A repeated update using the stale stage/version pair returned `409`.
- A duplicate queued-to-printing command produced one successful transition and
  one stale `409`.
- The final production note was the canonical winning value.
- Order and Production projections matched on reference, customer, quantity,
  due date, assigned Staff, production stage, and payment state.
- Payment state and confirmed amount did not change during production updates.

## Responsive And Module QA

**PASS**

- Authenticated Order and Production drawers at 1366px: PASS
- Authenticated Order and Production drawers at 820px: PASS
- Authenticated full-screen drawers and Pay-at-Shop dialog at 390px: PASS
- No page or drawer horizontal overflow at the tested widths: PASS
- Admin modules: Overview, Orders, Production, Workboard, My Tasks, and
  Settings loaded
- Staff modules: Overview, Orders, Production, My Tasks, and Settings loaded
- Workboard visible to Admin and hidden from Staff: PASS
- My Tasks visible to Admin and Staff: PASS
- Admin Task API and Staff My Tasks API: `200`

No screenshots or browser-storage artifacts were retained.

## Runtime And Feature Posture

- Deployment state: READY
- Production release requests in the review window: 246 successful `200`
  responses
- Expected acceptance denials/conflicts: observed `400`, `401`, `403`, `404`,
  and `409`
- Sustained or individual `5xx` responses on the release deployment: 0
- Schema-column errors: 0
- Runtime error groups: no application failure; one existing Node
  `url.parse()` deprecation warning group on Task routes
- `VITE_ENABLE_TASK_DOMAIN`: true
- `VITE_ENABLE_ADMIN_PAY_AT_SHOP_WORKFLOW`: true
- Server Pay at Shop: enabled and proven by the live synthetic confirmation
- Pay Online: parked; endpoint returned `404`
- Odoo: no release dependency; drawers did not expose or require Odoo
- Payment: excluded from production readiness

## Migration And Environment Status

- Supabase migrations applied: none
- Production environment variables changed: none
- Production settings changed: none
- Production schema compatibility: PASS
- TRRY POS changes: none
- Client Portal changes: none

## QA Cleanup

After acceptance:

- both designated QA profiles set inactive;
- both designated QA Auth users banned;
- Admin/Staff profile roles restored;
- all QA sessions revoked; final session count zero;
- profile rows and required synthetic audit evidence retained;
- external QA credential file deleted;
- temporary repair/acceptance runners deleted;
- one-time encryption keys and temporary package files deleted;
- no screenshot or browser artifact retained.

## Final Decision

**PHASE 8F RELEASE COMPLETE**

The controlled production release and all critical Phase 8F acceptance gates
passed. The prior production SHA and deployment remain the rollback references.
