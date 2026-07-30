# Phase 9A Online Payment Review Staging

## Status

**PASS - GO FOR PHASE 9B AUTHENTICATED STAGING ACCEPTANCE**

The staging-only Admin Online Payment Receipt Review foundation is complete.
Owner and Admin can review, confirm, or request correction for a full GCash or
bank-transfer receipt. Staff can read the normalized payment state and request
a short-lived proof URL but cannot mutate payment state.

Pay at Shop and Task Domain remain enabled independently. Pay Online remains
parked. Payment remains excluded from production readiness and direct TRRY
order conversion. Odoo remains absent from the active workflow.

## References

- Starting staging SHA:
  `f2d36ea2e2faff2c729da72f2fd8074c0fe2fe8e`
- Foundation implementation SHA:
  `f2af2e9ac53a62b3ab863a71a4ec48444136764e`
- Stale-version correction SHA:
  `1449e3cb73f9458c1beb3c19aa547e8fc851f679`
- Production main:
  `a7da022fbc1a9d9e92c571f49462dcefd16dff95`
- Production deployment:
  `dpl_ErTbEwTWnhnP6TdPK22RGSDC969a`
- Final staging deployment:
  `dpl_ADrT1XCKTT7KCWWH3EQy8efjXfkm`
- Staging URL: `https://adminportal-staging.vercel.app`
- Staging Supabase: `fszkypwovpdthqfobxrk`
- Production Supabase: `wcgtwfctpnwgpglywvvx`

## Baseline Audit

- Branch: `staging`
- Starting HEAD and `origin/staging`: exact expected SHA
- `origin/main`: exact expected production SHA
- Worktree before implementation: clean
- Staging versus main: ahead 4, behind 0
- Production deployment at baseline: READY
- Baseline build: PASS
- Baseline automated suites: PASS
- Protected POS, Client Portal, and alternate Admin Portal folders: unchanged

## Customer Submission Contract

The active customer submission route is
`api/inquiries/[id]/payments.js`. No field name was inferred from the parked
`202607260001_complete_payment_workflow.sql` migration.

| Customer field | Database field | Admin display | Required | Production before Phase 9A | Staging before Phase 9A |
| --- | --- | --- | --- | --- | --- |
| Payment method | `payment_method` | Payment method | Required: `gcash` or `bank_transfer` | Present | Present |
| Payment type | `payment_type` | Payment type/limitation | Required: `full` for Admin review | Present | Present |
| Submitted amount | `payment_selected_amount` | Submitted amount | Required | Present | Absent |
| Bank/GCash reference | `payment_reference` | Customer reference | Optional | Present | Absent |
| Customer note | `payment_customer_note` | Customer note | Optional | Present | Absent |
| Canonical proof pointer | `payment_proof_path` | Never displayed raw | Required | Present | Present |
| Original safe filename | `payment_receipt_filename` | Receipt filename | Required | Present | Absent |
| Content type | `payment_receipt_content_type` | Receipt content type | Required | Present | Absent |
| File size | `payment_receipt_size` | Receipt size | Required | Present | Absent |
| Submitted timestamp | `payment_proof_submitted_at` | Submitted timestamp | Required | Present | Present |
| Payment status | `payment_status` | Status badge | Required | Present | Present |

Customer submission supports both `full` and `down_payment`, with a 50 percent
down-payment option for quotes of at least 1000. Phase 9A intentionally supports
Admin confirmation of `full` only. Down-payment Admin confirmation remains
unsupported until separately approved.

The customer route now requires a specific GCash or bank-transfer method,
checks the exact full/down-payment amount, and validates filename, extension,
content type, size, and proof ownership before storing the pointer.

Correction resubmission remains customer-driven through the same
`submit_receipt` action. `correction_required` is not blocked by the customer
route. A replacement uses a new object name and changes the canonical pointer;
the rejected object is not deleted, preserving historical evidence.

## Receipt Storage Contract

- Bucket: `inquiry-artworks`
- Bucket visibility: private
- Canonical path:
  `{INQUIRY_REFERENCE}/payments/{UUID}-{SAFE_FILENAME}`
- Maximum size: 10 MB
- Allowed types: PNG, JPEG, and PDF
- Upload behavior: signed upload, `upsert: false`
- Inquiry association: path prefix must exactly match the requested inquiry
- Raw path in normalized review response: absent
- Raw path in drawer UI: absent
- Permanent public URL: absent

The proof endpoint validates the inquiry prefix, one-level object name,
extension, filename, declared MIME type, stored object MIME type, and private
bucket state before signing access for 300 seconds.

## Schema Audit

After migration 009, staging contains all active receipt and review fields:

- `payment_status`
- `payment_method`
- `payment_type`
- `payment_proof_submitted_at`
- `payment_confirmed_at`
- `payment_confirmed_amount`
- `payment_verified_amount`
- `payment_verified_at`
- `payment_verified_by`
- `payment_review_note`
- `payment_rejected_at`
- `payment_internal_note`
- `payment_selected_amount`
- `payment_reference`
- `payment_customer_note`
- `payment_proof_path`
- `payment_receipt_filename`
- `payment_receipt_content_type`
- `payment_receipt_size`

Production already contains the six fields that staging lacked. Production
received metadata-only schema queries and no write.

`inquiry_payment_events` retains Pay-at-Shop events and now also accepts:

- `ONLINE_PAYMENT_REVIEW_STARTED`
- `ONLINE_PAYMENT_CONFIRMED`
- `ONLINE_PAYMENT_CORRECTION_REQUESTED`

Authenticated users have event-table `SELECT` only. Direct event writes remain
revoked. Anonymous RPC execution remains revoked.

## Migrations

Applied to staging only:

1. `202607300009_online_payment_review.sql`
   - Adds only the six proven missing customer receipt fields with
     `IF NOT EXISTS`.
   - Adds event `review_note` and `expected_version`.
   - Preserves `PAY_AT_SHOP_SELECTED` and `SHOP_PAYMENT_CONFIRMED`.
   - Creates the atomic `review_online_payment` RPC.
2. `202607300010_online_payment_review_stale_version_fix.sql`
   - Replaces the retryable `40001` stale business error with non-retryable
     `P0001`.
   - Leaves the function contract, role checks, row lock, idempotency, and
     mutation scope unchanged.

The second migration was required by live QA. Postgres stores `updated_at` with
microseconds, while the first API normalization converted it to milliseconds.
Valid requests therefore appeared stale. The API now preserves the exact
database timestamp string, and stale conflicts return an immediate clean `409`
instead of retrying to a `504`.

Never applied, edited, renamed, rerun, or copied:

- `202607260001_complete_payment_workflow.sql`
- `202607290008_pay_at_shop_admin_workflow.sql`

## RPC Contract

`review_online_payment` is `SECURITY DEFINER` with an empty `search_path`.
It derives the actor from `auth.uid()` and accepts only an active Owner/Admin.

Inputs:

- inquiry reference
- action
- verified amount
- customer-safe review note
- private internal note
- exact expected `updated_at`
- idempotency key

Supported actions:

- `start_online_payment_review`
- `confirm_online_payment`
- `request_online_payment_correction`

The RPC locks the inquiry, validates the source payment, updates payment fields,
and appends one event in the same transaction. Event insert failure rolls back
the row update.

It does not update order status, production stage, assignment, blockers,
production readiness, or Odoo fields.

## API Contract

Routes:

- `GET /api/inquiries/[id]/payment-review`
- `PATCH /api/inquiries/[id]/payment-review`
- `GET /api/inquiries/[id]/payment-proof`

All routes require a bearer token and an active portal profile.

`GET payment-review` returns normalized payment values, safe receipt metadata,
history labels, display names, permissions, and the exact opaque version. It
does not expose raw actor UUIDs, storage paths, idempotency keys, service
credentials, or signed URLs.

`PATCH payment-review` accepts only the atomic RPC actions. Validation and
database failures map to stable responses, including clean stale and
idempotency `409` results. Raw Postgres errors are not returned.

`GET payment-proof` allows active Owner/Admin/Staff, validates private object
ownership and MIME metadata, and returns only a short-lived signed access result
with safe filename/type/size metadata.

The generic production workflow action set was not expanded. Dispatch uses the
existing workflow function entrypoint solely to stay within the 12-function
Vercel gate.

## Role Matrix

| Capability | Owner | Admin | Staff | Anonymous | Inactive |
| --- | --- | --- | --- | --- | --- |
| Read normalized payment state | PASS | PASS | PASS | 401 | 403 |
| Request signed proof access | PASS | PASS | PASS | 401 | 403 |
| Start review | PASS | PASS | 403 | 401 | 403 |
| Confirm full payment | PASS | PASS | 403 | 401 | 403 |
| Request correction | PASS | PASS | 403 | 401 | 403 |
| Read internal note | PASS | PASS | Hidden | N/A | N/A |

Credentialed staging bootstrap confirmed exact active roles for QA Owner,
QA Admin, and QA Staff. Credentials and sessions were read only inside the
temporary process and were not printed, committed, screenshotted, or persisted.
All temporary sessions were revoked after QA.

## Full-Payment Rule

Confirmation requires:

- approved quotation;
- approved artwork, matching the active customer contract;
- positive quote and amount due;
- `payment_type = full`;
- `payment_method = gcash` or `bank_transfer`;
- safe receipt pointer and complete metadata;
- submitted amount equal to the current full amount due;
- verified amount equal to the same current amount due;
- reviewable source status;
- exact current version.

The live wrong-amount scenario remained `proof_submitted` and returned the
stable `SUBMITTED_AMOUNT_MISMATCH` response.

## Event And Concurrency Results

- Owner start review: PASS, one review-started event
- Admin confirmation: PASS, one confirmed event
- Same confirmation replay: PASS, still two total events on the inquiry
- Same key with conflicting payload: PASS, clean `409`
- Parallel Owner/Admin review from one version: PASS
- Parallel result: one success, one immediate stale `409`
- Canonical stale scenario event count: one
- Correction request: PASS, one correction event
- Correction reason retained separately from internal note: PASS
- Rejected proof pointer retained: PASS
- Forced event insert failure rollback: PASS in isolated database test
- Direct event-table mutation: rejected

Before retained-evidence cleanup, the live canonical audit contained exactly:

- valid review and confirmation: two events;
- correction: one event;
- parallel stale scenario: one event;
- seeded confirmed scenario: one event.

The connector permits normal table cleanup but blocks direct mutation of the
managed `storage.objects` schema. The six clearly labeled synthetic inquiry
rows and private receipt metadata were therefore retained as staging audit
evidence rather than bypassing the managed-storage guard. Their five compact
canonical event rows were restored after the attempted cleanup. No customer
record or object was accessed.

## Drawer UI

One shared payment review renderer/service is injected into:

- Inquiry Details Drawer
- Order Details Drawer

It displays status, method, submitted amount, quoted/current due amount,
submitted time, safe receipt metadata, reference, customer note, review note,
verified amount/actor, and normalized payment history.

Owner/Admin receive Review Payment, Confirm Payment, and Request Correction
controls. Staff receives the same read state without mutation controls.

Dialog and state behavior:

- no `alert()`, `confirm()`, or `prompt()`;
- correction reason remains typed after validation failure;
- save controls disable during mutation;
- duplicate clicks are suppressed;
- stale conflicts refresh canonical payment state;
- successful actions refresh drawer and matching list state;
- current tab, search, filter, scroll, and drawer remain in place;
- Escape and focus containment are supported.

## Responsive QA

The shared Inquiry/Order payment component passed its browser suite at:

- 1366px: PASS
- 820px: PASS
- 390px: PASS

Also passed:

- no horizontal overflow;
- visible keyboard focus;
- keyboard navigation;
- Escape close;
- disabled save state;
- double-click protection;
- stale conflict refresh;
- Staff read-only rendering;
- no browser console errors.

Live staging QA verified the deployed API and role/security boundaries. The
synthetic storage entry contained receipt metadata sufficient to verify private
object lookup and signed-access generation; it did not contain a customer
receipt binary. Opening a genuine customer-uploaded PNG/JPEG/PDF end to end
remains an explicit Phase 9B acceptance item while the customer Pay Online
workflow remains parked.

## Automated Regression

- `npm.cmd run build`: PASS
- `node scripts/validate.mjs`: PASS
- `node scripts/verify-vercel-functions.mjs`: PASS, 12 functions
- Online payment migration/API/browser suites: PASS
- Pay at Shop: PASS
- Order Drawer API/browser: PASS
- Production Drawer API/browser: PASS
- Direct TRRY order conversion: PASS
- Production readiness excluding payment: PASS
- Overview: PASS
- Orders and Production list coverage: PASS
- Work Chat: PASS
- Workboard: PASS
- My Tasks: PASS
- Task API/service/dispatch/gateway: PASS
- All 20 repository `scripts/test-*.mjs` files: PASS
- `git diff --check`: PASS
- Tracked secret/runtime-artifact scan: PASS

The generic scan initially matched the tracked `.env.example` filename. A
content check confirmed that it contains no real Supabase reference, JWT,
publishable/secret key, QA credential, token, cookie, or browser state.
No runtime `.env`, QA account file, HAR, trace, test-results directory, or
temporary runner is tracked.

## Staging Deployment QA

Final deployment `dpl_ADrT1XCKTT7KCWWH3EQy8efjXfkm`:

- Git SHA: `1449e3cb73f9458c1beb3c19aa547e8fc851f679`
- Branch: `staging`
- State: READY
- Canonical staging alias attached: PASS
- Client review flag: true, staging project Production target only
- Server review flag: true, staging project Production target only
- Pay-at-Shop client/server flags: unchanged and enabled
- Task Domain flag: unchanged and enabled
- Deployment-scoped `5xx` after corrected QA: 0
- Schema-column errors: 0
- Payment review request failures after corrected QA: 0

The failed stale requests and two generic `500` logs belong only to superseded
deployment `dpl_7XPSgfCZ2vBmhMDKMfY437ikwBSa` and directly motivated migration
010. The final deployment has only a pre-existing Node `url.parse`
deprecation warning attached to successful requests.

## Production Untouched

- `origin/main` remains
  `a7da022fbc1a9d9e92c571f49462dcefd16dff95`.
- Production deployment remains
  `dpl_ErTbEwTWnhnP6TdPK22RGSDC969a`.
- Production Supabase received read-only metadata audit queries only.
- No production migration was applied.
- No production row, storage object, Auth account, policy, function, trigger,
  bucket, publication, or environment variable was changed.
- No production Vercel deployment or setting was changed.
- Main was not merged or pushed.

## Files Changed

Schema and server:

- `supabase/migrations/202607300009_online_payment_review.sql`
- `supabase/migrations/202607300010_online_payment_review_stale_version_fix.sql`
- `api/_lib/paymentReview.js`
- `api/_lib/orderDetails.js`
- `api/inquiries/[id]/payments.js`
- `api/inquiries/[id]/workflow.js`
- `vercel.json`

Client:

- `src/env.js`
- `src/services/paymentReview.js`
- `src/paymentReviewView.js`
- `src/main.js`
- `src/styles.css`
- generated tracked `dist/src/main.js`
- generated tracked `dist/src/styles.css`

Build, local routing, and tests:

- `scripts/build.mjs`
- `scripts/local-dev.mjs`
- `scripts/test-online-payment-review-migration.mjs`
- `scripts/test-online-payment-review-api.mjs`
- `scripts/test-online-payment-review-browser.mjs`

Documentation:

- `docs/checkpoints/PHASE_9A_ONLINE_PAYMENT_REVIEW_STAGING.md`

## Phase 9B Recommendation

**GO.** The staging foundation, migration, API, role matrix, secure proof
contract, exact-once behavior, stale protection, shared drawers, responsive
behavior, and regressions pass.

Phase 9B should use a new clearly labeled synthetic customer receipt object to
exercise the existing customer signed-upload/resubmission contract and open the
actual binary through the Admin signed-proof flow. It must keep Pay Online
parked in production and must not use a live customer receipt.
