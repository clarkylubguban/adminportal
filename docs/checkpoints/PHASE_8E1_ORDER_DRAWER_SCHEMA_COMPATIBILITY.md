# Phase 8E.1 Order Drawer Schema Compatibility

## Status

**PASS - GO FOR PHASE 8F CONTROLLED PRODUCTION RELEASE**

The Order Drawer now uses one production-compatible base select. The corrected
select contains 61 fields, all 61 exist in production, and zero are missing.

No migration was introduced. Production main, production Vercel, production
Supabase, production environment settings, TRRY POS, and the client portal were
not changed.

## References

- Starting staging SHA:
  `f91d4657d66224b2f5f4685bf52bec982935a7f2`
- Previous drawer implementation:
  `78badbd0917e070270fd2f9ca199ef54e2188c47`
- Corrected executable SHA:
  `a7da022fbc1a9d9e92c571f49462dcefd16dff95`
- Production main:
  `8d71713111c1f4434af6af3a8c53b00d2e77017e`
- Production deployment:
  `dpl_44QPvaSq8XJhkqTNtJjztEob2xgU`
- Corrected staging deployment:
  `dpl_3pUdFezKP2jFamY6EYLSQhee8YC9`
- Staging URL: `https://adminportal-staging.vercel.app`

## Original Blocker

`api/_lib/orderDetails.js` selected both of these columns unconditionally:

- `public.ops_inquiries.notes`
- `public.ops_inquiries.customer_notes`

Neither column exists in production. PostgREST rejects the complete select when
one requested column is absent, so an authenticated production Order Drawer
request would have returned the generic `500` failure response.

The defect was confirmed through source review and a read-only production
`information_schema.columns` audit. No production customer row was selected.

## Reference Audit

Order Drawer-specific references before correction:

- `api/_lib/orderDetails.js`: both columns in `ORDER_SELECT`
- `api/_lib/orderDetails.js`: normalized `notes` and `customerNotes` properties
- `scripts/test-order-details-browser.mjs`: both fields in synthetic API/list
  fixtures

Related but separate references retained:

- `src/services/opsBoard.js` has a tolerant legacy inquiry/list mapper that
  checks several possible note keys. It does not issue the Order Details query.
- `src/main.js` and `src/mvpDashboard.js` have existing inquiry/customer-message
  helpers outside the Order Drawer API projection.
- `supabase/migrations/202607110001_create_catalog_products.sql` describes the
  historical baseline in which the two columns were originally declared. The
  real production table predates or differs from that optional shape.

The Order Drawer UI did not render an Order Notes or Customer Notes row. No UI
row needed removal, and no unrelated note field was substituted.

## Code Correction

The corrected implementation:

- Removes `notes` and `customer_notes` from the unconditional base select.
- Removes normalized `notes` and `customerNotes` properties.
- Exports `ORDER_SELECT_FIELDS` so tests can assert the exact query contract.
- Performs one known-good query rather than a failing query followed by retry.
- Does not add duplicate columns or a migration.
- Does not map `production_note`, `quote_notes`, `payment_internal_note`, or
  `next_action` as customer notes.

Canonical note ownership remains:

- `quote_notes`: Quote and Artwork section only
- `production_note`: Production Readiness section only
- `payment_internal_note`: Payment section/history only
- Follow-up event `note`: genuine activity entry only

Missing production-note content uses the existing calm `Not set` helper.
Unsupported Customer Notes content is not rendered or fabricated.

## Production-Compatible Select Audit

Read-only production metadata comparison:

- Corrected selected fields: 61
- Selected fields present in production: 61
- Selected fields absent in production: 0
- Legacy note columns present in production: 0

Field classification:

- Required and present: identity/status, customer/company fallback,
  product/service, quantity, due date, quotation status, artwork status,
  assignment, production stage, blocker, and timestamps used by the drawer.
- Optional and present: contact, source/channel, fulfillment/address/tracking,
  quote details, artwork detail, payment detail, production detail, ownership,
  and activity source timestamps.
- Absent and excluded: `notes`, `customer_notes`.
- Legacy/deprecated and excluded: Odoo fields, authentication metadata, raw
  storage paths, tokens, and signed URLs.

The response contains normalized strings, numbers, booleans, arrays, or nulls.
It contains no undefined values, unsupported raw fields, raw auth identifiers,
Odoo data, storage paths, signed URLs, or raw schema error messages.

## API Verification

- Production-shaped row without `notes` or `customer_notes`: `200`
- Owner read: `200`
- Admin read: `200`
- Staff read: `200`
- Anonymous read: `401`
- Invalid session: `401`
- Inactive account: `403`
- Unauthorized role: `403`
- Missing order: `404`
- Non-won inquiry: `404`
- Simulated schema failure: generic `500`; raw database message not exposed
- No auth identifiers in the normalized projection: PASS
- No Odoo dependency: PASS

The focused API test captures the actual select passed to the Supabase client
and confirms it exactly matches `ORDER_SELECT_FIELDS`.

## Content Verification

- Drawer loads when both unsupported columns are absent: PASS
- Customer Notes row/content is absent: PASS
- Quote notes remain under Quote and Artwork: PASS
- Production note remains under Production Readiness: PASS
- Payment internal note remains under Payment: PASS
- Missing production note displays `Not set`: PASS
- No note type is renamed or reused as customer content: PASS

## Automated Regression

- `npm.cmd run build`: PASS
- `node scripts/validate.mjs`: PASS
- `node scripts/verify-vercel-functions.mjs`: PASS, 12 functions
- Order Drawer API/browser tests: PASS
- Production Drawer API/browser tests: PASS
- Combined cross-drawer navigation tests: PASS
- Pay at Shop tests: PASS
- Inquiry drawer/follow-up tests: PASS
- Quotation and artwork regressions: PASS
- Direct TRRY order conversion: PASS
- Orders and Production list regressions: PASS
- Work Chat tests: PASS
- Workboard tests: PASS
- My Tasks tests: PASS
- Task API/service/dispatch/gateway tests: PASS
- Payment remains non-blocking for production: PASS
- Pay Online remains parked: PASS
- Odoo remains removed: PASS
- All 19 repository `scripts/test-*.mjs` files: PASS
- `git diff --check`: PASS
- Tracked credential/artifact scan: PASS

The only tracked environment-shaped file is the value-free `.env.example`
template. No QA credential file, screenshot, browser storage, signed URL, token,
or temporary QA runner is tracked.

### Container Limitation

`scripts/verify-task-concurrency.mjs` did not run because a disposable container
runtime remains unavailable. The equivalent Task API simultaneous stale-command
test passed. No task database/concurrency-boundary file changed in Phase 8E.1,
so the retained prior SQL concurrency evidence remains applicable.

## Staging Deployment QA

Deployment `dpl_3pUdFezKP2jFamY6EYLSQhee8YC9`:

- Git SHA:
  `a7da022fbc1a9d9e92c571f49462dcefd16dff95`
- Branch: `staging`
- State: READY
- Canonical staging alias attached: PASS
- Function count: 12
- Deployment-scoped `5xx` after QA: 0
- Observed successful runtime responses after QA: 17

Credentialed live QA used only the temporary synthetic staging Owner account and
the retained synthetic canonical order:

`QA-PHASE-8E-DRAWERS-20260730060032`

Results:

- Authenticated Order Drawer load: PASS
- Authenticated Production Drawer load: PASS
- Order to Production canonical navigation: PASS
- Production to Order canonical navigation: PASS
- No Customer Notes or Odoo content: PASS
- 1366px: PASS
- 820px: PASS
- 390px: PASS
- Horizontal overflow: none
- Anonymous Order Details API: `401`

The temporary runner was deleted after the pass. It did not print or retain
credentials, access tokens, refresh tokens, cookies, signed URLs, or browser
storage. Only synthetic staging data was accessed, and no staging mutation was
required for this compatibility smoke.

## Production Read-Only Confirmation

- `origin/main` remained
  `8d71713111c1f4434af6af3a8c53b00d2e77017e`.
- Production deployment
  `dpl_44QPvaSq8XJhkqTNtJjztEob2xgU` remained READY and targeted production main.
- Production schema received metadata-only `information_schema` queries.
- Zero production customer records were selected by identity.
- Zero production records or schema objects were mutated.
- Production environment settings were untouched.
- No drawer migration is required.

## Files Changed

Executable correction:

- `api/_lib/orderDetails.js`
- `scripts/test-order-details-api.mjs`
- `scripts/test-order-details-browser.mjs`

Documentation:

- `docs/checkpoints/PHASE_8E1_ORDER_DRAWER_SCHEMA_COMPATIBILITY.md`

## Migration And Environment Status

- Drawer migration: none
- Production Supabase write: none
- Staging Supabase write: none
- Production environment change: none
- Staging environment change: none
- Pay at Shop: unchanged
- Pay Online: parked
- Odoo: removed

## Phase 8F Recommendation

**GO.** The original production-schema blocker is resolved by executable SHA
`a7da022fbc1a9d9e92c571f49462dcefd16dff95`.

Phase 8F should release only through that executable SHA. A later
documentation-only staging commit must not independently define or trigger the
production release target. No migration or environment change is required.
