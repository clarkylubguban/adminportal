# Phase 8E Drawers Production Preparation

## Status

**STAGING ACCEPTANCE PASS - PRODUCTION RELEASE NO-GO**

The combined Order Drawer and Production Job Drawer passed credentialed staging
acceptance. Production release is blocked because the production
`public.ops_inquiries` table does not contain `notes` or `customer_notes`, while
the Order Drawer API selects both columns unconditionally. Deploying the current
executable candidate would make authenticated Order Drawer reads fail.

No production branch, deployment, environment variable, database object, or
record was changed during this phase.

## Release References

- Starting and tested staging SHA:
  `621cf1924e86a0658a9726f64abc6fb449d8eb2e`
- Last executable candidate SHA:
  `78badbd0917e070270fd2f9ca199ef54e2188c47`
- Production main and code rollback SHA:
  `8d71713111c1f4434af6af3a8c53b00d2e77017e`
- Tested staging deployment:
  `dpl_GeXWATYhXTkuvwddmjkWXbEFu2dm` - READY
- Production rollback deployment:
  `dpl_44QPvaSq8XJhkqTNtJjztEob2xgU` - READY
- Staging URL: `https://adminportal-staging.vercel.app`
- Production URL: `https://admin.trryapparel.com`

## Branch Audit

After a fresh fetch:

- `HEAD` and `origin/staging` exactly matched the required starting SHA.
- `origin/main` exactly matched the required production SHA.
- Staging was seven commits ahead and zero commits behind main.
- The worktree was clean.
- Production remained on the required main SHA and READY deployment.

Chronological `main..staging` classification:

| Commit | Classification |
| --- | --- |
| `a3f474ff80340127a669641195fa0b15674bcb94` | Phase 8C documentation only |
| `9c923a154a29e42bdc5144f882a790f9758b12f0` | Phase 8C documentation only |
| `3c70215d0a8281ed45bb7b75ef3ce8fa8e174dad` | Phase 8C release documentation only relative to current main |
| `d81f19475a1ce0dc07c6341e1ea7b1ba2c5add45` | Order Drawer executable implementation |
| `4b40dc84a0db195f73ea64791ced06386a9d901a` | Phase 8D.1 documentation only |
| `78badbd0917e070270fd2f9ca199ef54e2188c47` | Production Drawer executable implementation |
| `621cf1924e86a0658a9726f64abc6fb449d8eb2e` | Phase 8D.2 documentation only |

No unrelated executable change was found.

## Combined Staging QA

Credentialed live QA used the synthetic Owner, Admin, and Staff staging
accounts. Credentials and browser storage were used only inside the temporary
QA process and were not printed, logged, screenshotted, tracked, or retained.

One canonical synthetic staging order was retained as audit evidence:

- Reference: `QA-PHASE-8E-DRAWERS-20260730060032`
- Labels: `QA ORDER DRAWER PHASE 8E` and
  `QA PRODUCTION DRAWER PHASE 8E`
- Data class: synthetic staging QA only; no customer data

### Order Drawer

- Row, `OPEN` action, and mobile card opening: PASS
- Correct canonical record and rapid-switch stale-response protection: PASS
- Loading, ready, error, retry, and not-found handling: PASS
- Close button, Escape, backdrop, focus trap/restoration, and scroll lock: PASS
- Search, filters, and list scroll preservation: PASS
- Reference, customer, product, quantity, quote, artwork, due date, ownership,
  assignment, payment, readiness, blocker, and genuine history rendering: PASS
- No raw UUID, Odoo information, invented history, or duplicate artwork action:
  PASS
- Inquiry and Production navigation for the same canonical order: PASS
- Owner/Admin full-payment-only Pay at Shop confirmation: PASS
- Staff payment confirmation denial and read-only payment state: PASS
- Payment confirmation refreshed the canonical state exactly once: PASS
- Pay Online remained unavailable: PASS

### Production Drawer

- Row, `OPEN` action, and mobile card opening: PASS
- Canonical `ops_inquiries` record reuse with no second job source: PASS
- Authenticated GET/PATCH and safe projection: PASS
- Assignment, blocker, and note permissions: PASS
- Assigned Staff action and unassigned Staff denial: PASS
- Stale compare-and-set request rejection (`409`): PASS
- Exact-once stage advancement: PASS
- Active blocker progression denial: PASS
- Payment excluded from production readiness: PASS
- Ready/completed detail locks: PASS
- Generic queued job exposes no unsafe generic start action: PASS
- No Odoo dependency: PASS

The live service-specific route passed:

`queued -> printing (DTF) -> qc -> ready -> completed`

The synthetic browser/API suites additionally passed Embroidery and Screen
Printing starts, invalid/skipped/backward/repeated transitions, unsupported
generic starts, and all required error states.

## Cross-Drawer Consistency

**PASS**

Without a full page reload, the Order Drawer handed off to Production, the
Production Drawer updated the canonical record, and the refreshed Order Drawer
showed the latest state. The two drawers did not stack.

The order reference, customer, quantity, due date, assigned Staff, production
stage, blocker, and payment state matched across both API projections. Payment
remained unchanged during all production actions, and no old/new field mixture
was observed.

## Role Matrix

| Capability | Owner | Admin | Assigned Staff | Unassigned Staff | Anonymous | Inactive |
| --- | --- | --- | --- | --- | --- | --- |
| Read Order Drawer | PASS | PASS | PASS | PASS | `401` | `403` |
| Read Production Drawer | PASS | PASS | PASS | PASS | `401` | `403` |
| Confirm Pay at Shop | PASS | PASS | DENIED | DENIED | DENIED | DENIED |
| Assign Staff | PASS | PASS | DENIED | DENIED | DENIED | DENIED |
| Set/clear blocker | PASS | PASS | DENIED | DENIED | DENIED | DENIED |
| Edit production note | PASS | PASS | PASS | DENIED | DENIED | DENIED |
| Advance valid production stage | PASS | PASS | PASS | DENIED | DENIED | DENIED |

The Staff account was temporarily disabled through the Owner-controlled staging
QA path. Both drawer APIs returned `403`, and the account was restored active
before the QA process ended.

## Responsive And Accessibility

**PASS**

- 1366px desktop: both drawers, controls, and dialogs usable
- 820px tablet: both drawers, controls, and dialogs usable
- 390px mobile: full-screen drawers and dialogs fit without horizontal overflow
- Sticky headers, independent drawer scrolling, and reachable actions: PASS
- Keyboard navigation, visible focus, Escape, and focus restoration: PASS
- Backdrop/close controls and background scroll lock: PASS
- Reduced-motion emulation: PASS

Synthetic browser coverage exercised both drawers at all three widths. The live
credentialed pass repeated representative desktop/tablet/mobile flows,
including the 390px Pay at Shop dialog and production confirmation dialog.

## Automated Regression

- `npm.cmd run build`: PASS
- `node scripts/validate.mjs`: PASS
- `node scripts/verify-vercel-functions.mjs`: PASS, 12 functions
- Order Drawer API and browser suites: PASS
- Production Drawer API and browser suites: PASS
- Pay at Shop, inquiry drawer, and follow-up suites: PASS
- Quotation, artwork, and direct TRRY conversion suites: PASS
- Orders and Production list suites: PASS
- Work Chat suites: PASS
- Overview, Workboard, and My Tasks suites: PASS
- Task API, service, dispatch, gateway, and stale-command suites: PASS
- Responsive suites: PASS
- All repository `scripts/test-*.mjs` suites: PASS
- `git diff --check`: PASS
- Tracked credential, `.env`, screenshot, browser-storage, and runner scan: PASS

One Production Drawer mobile-card wait timed out during the full aggregate
sweep. Its immediate isolated rerun passed, as did the earlier repeated suite
and the final credentialed live flow. This was test timing, not a reproduced
product failure.

### Container Concurrency Limitation

`scripts/verify-task-concurrency.mjs` did not run because a disposable container
runtime is unavailable. It is not reported as run.

Equivalent application concurrency coverage passed, including the Task API
simultaneous stale-command winner test. The retained SQL concurrency harness
still covers eleven genuine races, and no task/concurrency-boundary file changed
after the prior retained SQL evidence at
`52099c1b1891219b842b154512eae766762ad3a3`.

## Production Read-Only Audit

### Deployment And Flags

- Production main remained
  `8d71713111c1f4434af6af3a8c53b00d2e77017e`.
- Current production deployment
  `dpl_44QPvaSq8XJhkqTNtJjztEob2xgU` was READY, targeted `main`, and remained the
  rollback deployment.
- Production home and generated public environment script returned `200`.
- `VITE_ENABLE_TASK_DOMAIN`: true.
- `VITE_ENABLE_ADMIN_PAY_AT_SHOP_WORKFLOW`: true.
- Server Pay at Shop remained enabled by the unchanged accepted Phase 8C
  deployment and schema functions/triggers.
- `ENABLE_CUSTOMER_PAYMENT_WORKFLOW`: absent or not true, verified by the
  customer Pay Online endpoint returning `404`.
- Seven-day deployment-scoped runtime log audit found zero `5xx` responses.
- Odoo remained removed from the executable workflow.

No environment value, credential, token, cookie, signed URL, or customer row was
read or exposed.

### Schema And Data Shape

Read-only production metadata/aggregate checks found:

- All 4 required `admin_users` columns: present.
- All 8 required `inquiry_payment_events` projection columns: present.
- All 5 required `inquiry_follow_up_events` projection columns: present.
- Required `ops_inquiries` projection columns: 61 of 63 present.
- Missing: `ops_inquiries.notes` and `ops_inquiries.customer_notes`.
- RLS enabled on all four relevant tables.
- Pay at Shop functions and append-only/actor/selection triggers: present and
  enabled.
- Workflow guard function and trigger: present and enabled.
- Confirmed production orders by canonical stage: 9 queued.
- Confirmed orders with an incompatible production stage: 0.
- Stored inquiry statuses: 3 new, 9 sent, 9 won, and 1 lost.

The two missing optional-note columns are the sole production compatibility
failure. `api/_lib/orderDetails.js` includes them in one PostgREST select, so
their absence fails the whole query before a safe response can be built.
Production Drawer fields are otherwise complete and compatible.

## Release Package

### Executable Candidate

The last fully tested executable candidate is:

`78badbd0917e070270fd2f9ca199ef54e2188c47`

It is **not approved for production** until the missing-column incompatibility
is resolved and the corrected executable head is retested.

Executable and generated files in the candidate:

- `api/_lib/orderDetails.js`
- `api/_lib/productionJob.js`
- `api/inquiries/[id]/workflow.js`
- `src/main.js`
- `src/mvpDashboard.js`
- `src/services/orderDetails.js`
- `src/services/productionJob.js`
- `src/styles.css`
- `dist/src/main.js`
- `dist/src/mvpDashboard.js`
- `dist/src/services/productionJob.js`
- `dist/src/styles.css`
- `scripts/local-dev.mjs`
- `scripts/test-order-details-api.mjs`
- `scripts/test-order-details-browser.mjs`
- `scripts/test-production-job-api.mjs`
- `scripts/test-production-job-browser.mjs`
- `scripts/verify-vercel-functions.mjs`
- `vercel.json`

Documentation-only commits do not change runtime behavior and must not
independently trigger production deployment. In particular,
`621cf1924e86a0658a9726f64abc6fb449d8eb2e` is after the last executable
candidate and is excluded from an executable release target.

### Required Correction

Choose and validate one release-safe correction before Phase 8F:

1. Add only the two missing production columns through an explicitly approved,
   idempotent migration; or
2. Create a new executable commit that treats those legacy note columns as
   optional and does not include absent columns in the production query.

This phase authorizes neither change. After correction, rerun the Order Drawer
API/browser suites and a read-only production schema compatibility audit, then
name a new exact executable SHA.

No drawer-specific migration or environment change was included in the tested
staging candidate. The production audit shows that a schema or compatibility
correction is nevertheless required before release.

### Expected Deployment Behavior After Correction

The eventual approved executable SHA should be fast-forwarded from current
`main`. Vercel should create one production deployment from `main`, build the
same static application, retain 12 functions through rewrites, and update the
existing production aliases. No Supabase migration or environment change should
run automatically from the Git merge.

## Rollback Plan

- Code rollback reference:
  `8d71713111c1f4434af6af3a8c53b00d2e77017e`
- Vercel rollback deployment:
  `dpl_44QPvaSq8XJhkqTNtJjztEob2xgU`

Rollback conditions include Order/Production Drawer authentication failures,
canonical-state mismatch, unauthorized writes, repeated/non-idempotent stage or
payment events, sustained `5xx`, alias failure, or any regression in existing
Orders, Production, Pay at Shop, Work Chat, Workboard, or My Tasks behavior.

## Production Acceptance Plan

After the blocker is corrected and a new executable SHA is approved:

1. Reverify exact main/source SHAs and a clean worktree.
2. Fast-forward main to only the approved executable SHA.
3. Wait for the production deployment and verify READY plus aliases.
4. Run anonymous and read-only smoke checks.
5. Temporarily activate production QA Admin and QA Staff accounts.
6. Create one canonical synthetic order labeled
   `QA ORDER DRAWER PRODUCTION ACCEPTANCE` and
   `QA PRODUCTION DRAWER PRODUCTION ACCEPTANCE`.
7. Use a confirmed TRRY order with approved quote/artwork, positive quantity,
   due date, assigned QA Staff, and one valid service-specific route.
8. Verify both drawers, payment restrictions/confirmation, assignment,
   blocker/note permissions, stale protection, exact-once progression, and
   cross-drawer canonical consistency.
9. Use no live customer order, existing live Pay at Shop inquiry, or completed
   customer job.
10. Review runtime health for sustained `5xx`.
11. Disable QA accounts and remove the temporary credential file.
12. Retain payment events and production audit evidence.

## Production Safety

- Production main: unchanged
- Production Vercel deployment/settings: unchanged
- Production Supabase: read-only metadata and aggregate audit only
- Production records: untouched
- Pay at Shop: enabled and unchanged
- Pay Online: parked
- Odoo: remains removed
- TRRY POS and client portal: untouched

## Phase 8F Recommendation

**NO-GO.** Do not start the controlled production release from
`78badbd0917e070270fd2f9ca199ef54e2188c47`. Resolve the two missing
`ops_inquiries` note columns through an explicitly approved schema change or a
backward-compatible Order Drawer query, then retest and prepare a new exact
executable release SHA.
