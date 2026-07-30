# Phase 8D.2 Production Job Drawer - Staging

## Status

**PASS - GO FOR PHASE 8E COMBINED STAGING QA AND PRODUCTION RELEASE PREPARATION**

This checkpoint covers the Admin Portal Production Job Drawer on `staging` only.
No production branch, production deployment, production environment setting, or
production database was changed.

## Release References

- Starting staging SHA: `4b40dc84a0db195f73ea64791ced06386a9d901a`
- Production main reference: `8d71713111c1f4434af6af3a8c53b00d2e77017e`
- Implementation commit: `78badbd0917e070270fd2f9ca199ef54e2188c47`
- Canonical record: `public.ops_inquiries` where `status = 'won'`
- Migration status: **NO MIGRATION**

At the starting audit, staging was five commits ahead of main and zero commits
behind. The implementation commit made the local staging branch six commits
ahead. The implementation did not create a second job table, production event
table, Odoo integration, payment action, or new source of truth.

## Implementation

The existing eight-column Production list and mobile cards now open a dedicated,
stateful right-side drawer through the row, `OPEN` action, or mobile card. The
drawer preserves filters and scroll, supports loading/error/retry states, guards
against stale rapid-switch responses, locks background scrolling, traps focus,
closes by button/Escape/backdrop, and restores focus to the opening control.

The drawer contains:

- Compact job header, service/stage/blocker badges, and canonical reference
- Job summary with payment and quote information displayed read-only
- Eight-item production-readiness checklist
- Existing authenticated artwork action and Order Drawer handoff
- Manager assignment and blocker controls
- Role-aware production note editing
- One valid forward stage action with a custom confirmation dialog
- Limited real activity and an explicit detailed-history limitation
- Read-only completed state

`VIEW ORDER DETAILS` replaces the Production Drawer with the existing Phase 8D.1
Order Drawer for the same `ops_inquiries` record. The two drawers never stack.

## API Contract

`GET /api/production/:id`

- Requires bearer authentication and an active Owner, Admin, or Staff portal account
- Returns `401` for missing/invalid authentication
- Returns `403` for inactive or unauthorized accounts
- Returns `404` for a missing record or a record whose status is not `won`
- Returns a normalized safe projection with hydrated display names
- Does not expose auth metadata, raw visible UUIDs, signed URLs, or Odoo fields

`PATCH /api/production/:id`

- Accepts only `assign_production_staff`, `set_production_blocker`,
  `clear_production_blocker`, `update_production_note`, and
  `advance_production_stage`
- Rereads the canonical job and enforces status, role, assignment, blocker,
  readiness, stage, and completed-state rules
- Requires the expected canonical stage and expected production timestamp
- Uses a stage/timestamp compare-and-set update and returns `409` for stale state
- Maps expected validation, permission, and missing-record failures to
  `400`, `403`, and `404`
- Does not call payment RPCs or change quotation, artwork, due-date, or payment data

The Vercel rewrite reuses the existing workflow function entrypoint, keeping the
deployment at the validated 12-function limit.

## Permissions

| Capability | Owner | Admin | Assigned Staff | Unassigned Staff |
| --- | --- | --- | --- | --- |
| Read confirmed production jobs | PASS | PASS | PASS | PASS |
| Assign/reassign active eligible users | PASS | PASS (Staff targets only) | DENIED | DENIED |
| Set/clear blocker | PASS | PASS | DENIED | DENIED |
| Edit production note | PASS | PASS | PASS | DENIED |
| Perform valid next stage | PASS | PASS | PASS | DENIED |

Ready and completed production details retain the existing stricter lock.
Completed jobs expose no assignment, blocker, note, or stage controls.

## Readiness And Stages

Starting a queued job requires:

- Confirmed TRRY order
- Approved quotation
- Product/service
- Positive quantity
- Due date
- Approved artwork
- Assigned production staff
- No blocker

Payment is intentionally absent from readiness. Unpaid, Pay at Shop pending, and
paid states remain informational and non-blocking.

Validated forward transitions:

- DTF queued -> `printing`
- Embroidery queued -> `embroidery`
- Screen Printing queued -> `screen_printing`
- Active production -> `qc`
- `qc` / `qc_finishing` -> `ready`
- `ready` / `ready_for_fulfillment` -> `completed`

Skipped, repeated, backward, blocked, incomplete, duplicate, and stale
transitions are rejected. The live database trigger does not currently allow a
generic queued job to enter `in_production`; the drawer preserves that stricter
database guard and shows no unsafe start action when a service cannot be mapped.
No constraint was loosened and no migration was introduced.

## Assignment, Blocker, And Note

- Owner/Admin assignment validates the target against active eligible portal users.
- A successful assignment refreshes the drawer and Production row/card in place.
- Blocker reason is required and limited to 500 characters.
- Clearing a blocker uses a custom confirmation dialog; Cancel performs no write.
- Notes are limited to 2,000 characters.
- Draft note/blocker text remains present after failed requests.
- Every write uses stale-update protection, preventing silent overwrite.

## Responsive And Accessibility QA

Synthetic browser QA used disposable records labeled
`QA PRODUCTION DRAWER PHASE 8D2` and did not access production data.

- 1366x900: PASS, right-side drawer at no more than 560px
- 820x900: PASS, drawer at no more than 520px
- 390x844: PASS, full-screen one-column drawer
- Horizontal overflow/clipping: PASS
- Sticky mobile header and reachable stage footer: PASS
- Dialog semantics/title: PASS
- Keyboard controls, Escape, focus trap, and focus restoration: PASS
- Backdrop/close controls and background scroll lock: PASS
- Confirmation dialogs at mobile width: PASS

Screenshots used for visual inspection were written outside the repository and
were not tracked.

## Automated Results

- `npm.cmd run build`: PASS
- `node scripts/validate.mjs`: PASS
- `node scripts/verify-vercel-functions.mjs`: PASS, 12 functions
- `node scripts/test-production-job-api.mjs`: PASS
- `node scripts/test-production-job-browser.mjs`: PASS
- All 18 repository `scripts/test-*.mjs` files: PASS
- Existing Order Drawer API/browser regression: PASS
- Direct TRRY order conversion and parked payment/Odoo regression: PASS
- Pay at Shop separation and anonymous boundary regression: PASS
- Work Chat launcher/MVP regression: PASS
- Overview, Workboard, My Tasks, and task-domain regressions: PASS
- `git diff --check`: PASS
- Tracked credential/artifact scan: PASS

`scripts/verify-task-concurrency.mjs` could not run because its required
disposable container runtime is unavailable in this environment. The task API's
own simultaneous stale-command test passed, and this limitation predates and is
unrelated to the Production Drawer.

## History Limitation

No canonical append-only production event table exists. The API reports only
genuine stored events, currently including artwork approval when present, and
does not infer stage meaning from `updated_at` or fabricate a timeline.

The drawer therefore states:

`No detailed production history recorded yet.`

An append-only production-event system remains a later operational-hardening
candidate and was not introduced in Phase 8D.2.

## Files Changed

- `api/_lib/productionJob.js`
- `api/inquiries/[id]/workflow.js`
- `scripts/local-dev.mjs`
- `scripts/test-production-job-api.mjs`
- `scripts/test-production-job-browser.mjs`
- `src/main.js`
- `src/mvpDashboard.js`
- `src/services/productionJob.js`
- `src/styles.css`
- `vercel.json`
- Generated tracked counterparts under `dist/src`

## Production Safety

- Production main: unchanged
- Production Supabase: untouched
- Production Vercel: untouched
- Staging Supabase schema: unchanged
- Pay at Shop: preserved and non-blocking
- Pay Online: parked
- Odoo: remains removed
- TRRY POS and client portal: untouched

## Phase 8E Recommendation

**GO.** Proceed to combined credentialed staging QA and controlled production
release preparation for the exact staging head containing the implementation
and this checkpoint. Production release still requires the Phase 8E acceptance
gates; this checkpoint does not authorize a production merge or deployment.
