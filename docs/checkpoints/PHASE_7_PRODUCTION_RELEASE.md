# Phase 7A Production Release Preparation

Date: 2026-07-28
Source branch: `staging`
Production branch: `main`
Approved staging head: `b2086e45066781c462ef2fb707b51ede42922116`
Current main / rollback commit: `1585ec333df72c8f1553e9ae5eaaae035c219e80`

## Branch Status

PASS: `staging` is ahead of `main` by 16 commits and is not behind.

Command result: `git rev-list --left-right --count main...staging` returned `0 16`.

No merge, push to `main`, production deployment, or production Supabase migration was performed during Phase 7A.

## Chronological Commit List: `main..staging`

1. `f94484e` Clean inquiry drawer follow-up UI
2. `bd5db67` Recover latest admin UI baseline
3. `3406da7` Complete inquiry follow-up recording flow
4. `38763e8` Document Phase 0 staging checkpoint
5. `e28ddf6` Polish admin foundation and inquiry drawer
6. `fc14c6f` Unify quote status badges
7. `facbc8e` Simplify Workboard Kanban
8. `05d13d9` Build professional Overview dashboard
9. `446074c` Add secure Work Chat foundation
10. `d661e52` Build Work Chat interface
11. `ddba7ce` Document Phase 6 staging QA
12. `f14922b` Complete Phase 6 credentialed QA
13. `1dcc064` Document Phase 6C credentialed QA blocker
14. `d0a3861` Complete programmatic Phase 6 QA
15. `0b89693` Document Phase 6E credentialed QA blockers
16. `b2086e4` Complete Phase 6 authenticated staging QA

## Release Manifest

### Approved UI and Workflow Changes

- Inquiry drawer cleanup and follow-up polish: `f94484e`, `3406da7`, `e28ddf6`.
- Quote badge consistency and admin UI baseline recovery: `bd5db67`, `fc14c6f`.
- Updated workflow handling in `api/_lib/opsWorkflow.js`, `api/inquiries/[id]/workflow.js`, `api/inquiries/[id]/customer-actions.js`, `src/main.js`, `src/mvpDashboard.js`, `src/services/opsBoard.js`, and generated `dist/src/*` assets.
- Local and validation support updates in `scripts/local-dev.mjs`, `scripts/validate.mjs`, and `vercel.json`.

### Work Chat

- Secure Work Chat API and routing foundation: `446074c`.
- Work Chat interface and client service: `d661e52`.
- Files: `api/work-chat.js`, `src/services/workChat.js`, `src/main.js`, `src/styles.css`, generated `dist/src/*` assets, and admin user API relocation under `api/_lib/admin-users/*` with `api/admin-users.js`.
- Work Chat database migrations included in source scope: `supabase/migrations/202607260003_work_chat_mvp.sql`, `supabase/migrations/202607260004_work_chat_allowed_attachment_types.sql`, and `supabase/migrations/202607260005_work_chat_active_user_invoker.sql`.

### Follow-Up Workflow

- Follow-up recording API and UI flow: `3406da7`.
- Files: `api/inquiries/[id]/follow-ups.js`, `src/main.js`, `src/mvpDashboard.js`, `src/services/opsBoard.js`, generated `dist/src/*` assets, and local routing in `scripts/local-dev.mjs`.
- Follow-up database migration included in source scope: `supabase/migrations/202607260002_inquiry_follow_up_events.sql`.

### Overview / Workboard / My Tasks

- Workboard Kanban simplification: `facbc8e`.
- Professional Overview dashboard: `05d13d9`.
- Files: `src/main.js`, `src/mvpDashboard.js`, `src/services/opsBoard.js`, `src/styles.css`, generated `dist/src/*` assets, and regression tests `scripts/test-overview-dashboard.mjs`, `scripts/test-task-gateway-http.mjs`.

### Documentation and QA-Only Changes

- Phase 0 staging baseline documentation: `38763e8`.
- Phase 6 QA documentation and completion records: `ddba7ce`, `f14922b`, `1dcc064`, `d0a3861`, `0b89693`, `b2086e4`.
- Files: `docs/checkpoints/PHASE_0_STAGING_BASELINE.md`, `docs/checkpoints/PHASE_6_STAGING_QA.md`.

### Payment-Related or Parked Changes

- Payment baseline code and pending migration entered the branch in `bd5db67`.
- Parked migration: `supabase/migrations/202607260001_complete_payment_workflow.sql`.
- Payment API: `api/inquiries/[id]/payments.js`.
- Payment-related workflow fields/actions: `api/inquiries/[id]/customer-actions.js`, `api/inquiries/[id]/workflow.js`, `api/_lib/opsWorkflow.js`.
- Payment/Pay at Shop UI and service logic: `src/main.js`, `src/mvpDashboard.js`, `src/services/opsBoard.js`, generated `dist/src/*` assets.
- Local and validation routing: `scripts/local-dev.mjs`, `scripts/validate.mjs`.

## Exact Parked / Excluded Items

- The pending payment migration `supabase/migrations/202607260001_complete_payment_workflow.sql` must not be applied to production in Phase 7.
- Production must not set `ENABLE_CUSTOMER_PAYMENT_WORKFLOW=true` during this release.
- The public payment API route `api/inquiries/[id]/payments.js` is release-guarded and returns 404 unless `ENABLE_CUSTOMER_PAYMENT_WORKFLOW` is explicitly enabled.
- Admin payment actions that depend on the parked payment schema return 503 if the parked payment columns are absent; non-payment customer actions and workflow updates fall back to the legacy column set.
- No Odoo Sales Order number is required for this release.

The payment migration file remains tracked as parked source history for a later controlled payment release. It is not safe to apply in Phase 7.

## Production Safety Guard

Phase 7A adds a minimal release-safe guard without changing staging-approved behavior unless the payment workflow is explicitly enabled by environment:

- `api/inquiries/[id]/payments.js` is disabled by default.
- `api/inquiries/[id]/workflow.js` falls back if `payment_verified_amount` is missing from production.
- `api/inquiries/[id]/customer-actions.js` falls back for non-payment actions when parked payment columns are missing and blocks payment-only actions with a clear 503.

This allows payment-related code to remain dormant in the release while avoiding failures against a production schema that has not received the parked payment migration.

## Verification

PASS: Full build completed.

PASS: Automated regression tests completed:

- `node .\scripts\test-work-chat-mvp.mjs`
- `node .\scripts\test-overview-dashboard.mjs`
- `node .\scripts\test-workboard-ui.mjs`
- `node .\scripts\test-my-tasks-ui.mjs`
- `node .\scripts\test-task-api.mjs`
- `node .\scripts\test-task-service.mjs`
- `node .\scripts\test-task-dispatch.mjs`
- `node .\scripts\test-task-gateway-http.mjs`
- `node .\scripts\test-workboard-http.mjs`
- `node .\scripts\test-my-tasks-http.mjs`
- `node .\scripts\test-workboard-browser.mjs`
- `node .\scripts\test-my-tasks-browser.mjs`

Note: `scripts/test-my-tasks-browser.mjs` showed one transient catalog-route assertion on the first run and passed on immediate rerun, matching the prior Phase 6 transient observation.

PASS: `git diff --check` completed with no whitespace errors.

PASS: Tracked secret/artifact scan found no QA credentials, QA screenshots, local runner files, browser storage, committed `.env` files, access tokens, refresh tokens, cookies, or signed URLs. Only `.env.example` is tracked as a template.

## Deployment and Migration Checks

PASS: Vercel production target for the production project continues to track `main`.

- Production project candidate: `adminportal`.
- Latest production-target deployment observed: `dpl_CFgZsybftYzNKu9aKrBUTGHuiEYP`.
- Production deployment commit/ref observed: `1585ec333df72c8f1553e9ae5eaaae035c219e80` / `main`.
- Staging branch deployments observed on the production project are preview deployments, not production-target deployments.
- No Vercel project settings, deployments, aliases, or environment variables were modified.

PASS: No automatic production Supabase migration path was found in this repository.

- No `.github` workflow files are present.
- `package.json` scripts are limited to local development, build, and preview.
- No repository script or workflow was found that runs `supabase db push`, `supabase migration`, or the parked `complete_payment_workflow` migration automatically.

## Production Risk Assessment

Risk level: LOW for code merge after the Phase 7A guard is included, assuming `main` remains at `1585ec333df72c8f1553e9ae5eaaae035c219e80`.

Primary risks and controls:

- Parked payment workflow: Controlled by default-off route guard, schema fallback, and explicit instruction not to apply `202607260001_complete_payment_workflow.sql`.
- Production schema readiness for approved Work Chat and follow-up features: Migration files are included in source but do not run automatically. Any production database changes must be separately controlled and must exclude the parked payment migration.
- Production deployment: Vercel production target tracks `main`; no production deploy was initiated in Phase 7A.
- Rollback: Git rollback reference is `1585ec333df72c8f1553e9ae5eaaae035c219e80`; Vercel rollback candidate observed for production is `dpl_CFgZsybftYzNKu9aKrBUTGHuiEYP`.

## Recommended Merge Method

Recommendation: clean fast-forward or normal merge from `staging` to `main` for Phase 7B, after this Phase 7A preparation commit is on `origin/staging` and `main` is still `1585ec333df72c8f1553e9ae5eaaae035c219e80`.

A controlled cherry-pick/release branch is not required unless the release owner decides the parked payment migration file itself must be absent from `main`. The file is inert by repository automation and the executable payment path is guarded by default.

## Phase 7B Recommendation

GO for Phase 7B controlled production merge preparation after the Phase 7A guard/documentation commit is pushed to `origin/staging`.

Do not apply the parked payment migration, do not enable `ENABLE_CUSTOMER_PAYMENT_WORKFLOW`, do not push directly to `main` outside the controlled Phase 7B process, and do not modify production Supabase or Vercel settings as part of Phase 7A.

## Phase 7C Release Attempt

Status: STOPPED before `main` merge and before any production Vercel deployment.

Production Supabase project `wcgtwfctpnwgpglywvvx` received and verified only the approved Phase 7 migrations:

1. `inquiry_follow_up_events`
2. `work_chat_mvp`
3. `work_chat_allowed_attachment_types`
4. `work_chat_active_user_invoker`

Production `main` remained at `1585ec333df72c8f1553e9ae5eaaae035c219e80`, and no production Vercel deployment was triggered.

During the final Phase 7C gate, production migration history showed a pre-existing record named `complete_payment_workflow` with version `20260726082535`. That migration was not applied during Phase 7C, but its historical production presence meant Phase 7C could not truthfully confirm that payment workflow migration history was absent. The release was stopped for forward correction.

No production migration-history record was deleted, edited, reversed, or falsified.

## Phase 7C.1 Odoo and Payment Gate Correction

Status: STAGING QA COMPLETE.

New corrective migration:

- `supabase/migrations/202607280006_remove_odoo_dependency_and_park_payment_gate.sql`

Behavior:

- Replaces `public.enforce_ops_inquiry_mvp_workflow()` with a forward-only correction.
- Order conversion rejects lost/cancelled inquiries, requires `quote_status = approved`, and requires a positive `quoted_amount`.
- Order conversion no longer inspects or requires `odoo_so`.
- Production stage changes require a confirmed TRRY order (`status = won`) and approved quote.
- Production no longer inspects or requires `odoo_so`.
- Production no longer calls `trry_payment_gate_satisfied` and does not require payment confirmation while the customer payment workflow is parked.
- Product/service, quantity, due date, artwork approval, assigned staff, active blocker, valid-stage-transition, and ready/completed lock rules remain enforced.
- Existing payment columns, payment functions, Odoo fields, and historical values remain untouched.

Application changes:

- `api/_lib/opsWorkflow.js` now confirms a TRRY order directly with `status = won` and `next_action = TRRY order confirmed - ready for production handoff`.
- `api/inquiries/[id]/follow-ups.js` now treats `status = won` as the follow-up cutoff instead of checking `odoo_so`.
- `src/mvpDashboard.js` now treats confirmed orders as `status = won` plus approved quote, and removes Odoo/payment from production readiness.
- `src/main.js` replaces active Odoo prompts with TRRY order language, disables customer payment actions with `CUSTOMER_PAYMENT_WORKFLOW_ENABLED = false`, and renders payment as parked.
- `src/services/opsBoard.js` updates the legacy confirm helper message to TRRY order language.
- Generated `dist/src/*` assets were rebuilt from source.

Staging migration verification on `fszkypwovpdthqfobxrk`:

- `remove_odoo_dependency_and_park_payment_gate` recorded.
- `ops_inquiries_mvp_workflow_guard` trigger still exists.
- Current trigger function no longer contains `odoo_so`.
- Current trigger function no longer calls `trry_payment_gate_satisfied`.
- Current trigger function no longer contains the obsolete confirmed-Odoo message.
- Staging migrations `inquiry_follow_up_events`, `work_chat_mvp`, `work_chat_allowed_attachment_types`, and `work_chat_active_user_invoker` remain intact.
- Staging does not have the same recorded `complete_payment_workflow` migration-history entry that production has; production's historical record remains a production-only release note and must not be falsified.

Focused staging QA:

- PASS: Approved inquiry with positive quote and blank/null `odoo_so` converts directly to `won`.
- PASS: Lost inquiry cannot convert.
- PASS: Unapproved quote cannot convert.
- PASS: Zero quote cannot convert.
- PASS: Confirmed TRRY order with blank/null `odoo_so` can enter production when normal production requirements are complete.
- PASS: Valid production stage progression still works.
- PASS: Missing product/quantity/due date/artwork/assigned staff prevents production.
- PASS: Active blocker prevents production.
- PASS: Invalid stage transition is rejected.
- PASS: Ready/completed production detail locks remain enforced.
- PASS: Payment endpoint returns disabled response when the feature flag is absent.

Automated regression:

- PASS: `node .\scripts\test-ops-workflow-direct-order.mjs`
- PASS: `npm run build`
- PASS: Work Chat static verification
- PASS: Overview dashboard test
- PASS: Workboard UI/HTTP/browser tests
- PASS: My Tasks UI/HTTP/browser tests after immediate rerun
- PASS: Task API, service, dispatch, and gateway tests
- PASS: `git diff --check`

Note: `scripts/test-my-tasks-browser.mjs` failed once on a transient Settings-route load assertion and passed on immediate rerun.

Phase 7D recommendation: GO after the Phase 7C.1 staging commit is pushed to `origin/staging`. Phase 7D must apply only migration `006` to production as the forward correction before merging the updated staging release to `main`.

## Phase 7D.1 Work Chat Launcher Hotfix

Status: HOTFIX DEPLOYED; RELEASE COMPLETION STILL BLOCKED FOR PRODUCTION ADMIN/STAFF SMOKE.

Hotfix commit:

- `c31da4a153c9cdeb76e2dff8f053b04ac2d16b63` - `Fix Work Chat launcher binding`

Scope:

- `src/main.js` now binds Work Chat launcher events during global event binding.
- Work Chat launcher click and keyboard activation are explicitly handled in `bindWorkChatEvents()`.
- Generated `dist/src/main.js` was rebuilt from source.
- `scripts/test-work-chat-mvp.mjs` now statically asserts the Work Chat binder is wired.
- `scripts/test-work-chat-launcher-browser.mjs` adds browser coverage for launcher open, close, keyboard activation, route navigation, duplicate-drawer protection, and 390px layout.

Verification before production:

- PASS: `npm run build`
- PASS: Full automated regression suite used for Phase 7D.1, including Work Chat, Overview, Workboard, My Tasks, task API/service/dispatch/gateway, and ops workflow tests.
- PASS: `git diff --check`
- PASS: Staging deployment `dpl_HKJEdz9tQLobk7AVDehjtkUqdx4h` reached `READY`.
- PASS: Staging Owner/Admin/Staff Work Chat launcher hotfix smoke using synthetic staging accounts. Credentials were read only inside the temporary QA process and were not printed, stored, screenshotted, or committed.

Production deployment:

- Previous production deployment: `dpl_nitJ9u3qywDA8JvXWNFXEHAwDaVY`
- Hotfix production deployment: `dpl_349VPfKCxW3NHyg5xvJHzWgrfWHC`
- Production commit: `c31da4a153c9cdeb76e2dff8f053b04ac2d16b63`
- Production state: `READY`
- Production aliases include `admin.trryapparel.com`.

Production smoke:

- PASS: Owner authenticated session loaded `https://admin.trryapparel.com/overview` without redirecting to login.
- PASS: Owner Work Chat launcher is present.
- PASS: Owner click opens the Work Chat drawer.
- PASS: Owner drawer loads expected channels after bootstrap: General, Front Desk, Production, Mentions.
- PASS: Owner Escape closes the drawer.
- PASS: Owner close button closes the drawer.
- PASS: Owner launcher opens across Overview, Inquiries, Orders, Production, Workboard, My Tasks, Settings, and Staff routes.
- PASS: Payment API remains parked; production payment endpoint returned the expected unavailable response.
- PASS: Vercel production deployment is `READY` and post-smoke runtime requests returned 200 responses.
- WARN: Vercel logged Node `DEP0169` deprecation warnings on successful `/api/work-chat/bootstrap` and `/api/admin-users` requests. No request failure or release-blocking runtime error was observed from this warning.

Remaining blockers:

- BLOCKED: Production Admin smoke was not completed because no authenticated production Admin session or production Admin credentials were available. Staging accounts must not be used against production.
- BLOCKED: Production Staff smoke was not completed because no authenticated production Staff session or production Staff credentials were available. Staging accounts must not be used against production.
- BLOCKED: Production Work Chat realtime/exact-once delivery, cross-role unread counts, read markers, mentions, and attachment flows require at least two authenticated production internal-user sessions. Only an authenticated production Owner session was available during Phase 7D.1.
- BLOCKED: Authenticated production 390px browser smoke could not be performed in the available in-app Owner session because the connector did not expose viewport resizing for that authenticated tab. The same 390px path passed in local and staging credentialed hotfix QA.

Do not mark Phase 7 production release complete until the remaining production Admin/Staff and cross-session Work Chat smoke tests pass with real production internal-user sessions.

## Phase 7E Production Acceptance Attempt

Status: BLOCKED; RELEASE NOT COMPLETE.

Date: 2026-07-29

Final state checks:

- PASS: `origin/main` remains `c31da4a153c9cdeb76e2dff8f053b04ac2d16b63`.
- PASS: `origin/staging` remains at the documentation-only checkpoint head before this note: `b5d10ec85a691052032e22abedcba805bd402d1b`.
- PASS: Production deployment `dpl_349VPfKCxW3NHyg5xvJHzWgrfWHC` is `READY`.
- PASS: Production deployment aliases include `admin.trryapparel.com`.
- PASS: Payment endpoint remains parked and returned HTTP 404 with `payment workflow is not available`.
- PASS: No production runtime error groups were reported for the final pre-test window.
- PASS: No tracked QA account file, browser storage, cookies, screenshots, or local QA artifact files were found. Only `.env.example` matched the tracked environment-file scan.

Blocked production acceptance scope:

- BLOCKED: The required production QA account file was not present at `C:\tmp\trry-admin-production-qa-secrets\qa-accounts.env`.
- BLOCKED: The parent directory `C:\tmp\trry-admin-production-qa-secrets` was also not present.
- BLOCKED: Isolated production Admin and Staff browser contexts could not be created without the production QA account file.
- BLOCKED: Production Admin role smoke could not be completed.
- BLOCKED: Production Staff role smoke could not be completed.
- BLOCKED: Cross-session Work Chat realtime exact-once delivery, unread/read markers, mentions, attachment security, and authenticated 390px Admin/Staff responsive QA could not be completed.

Runtime note:

- The only recent production runtime status-code count observed during this attempt was one HTTP 404 from the intentional parked-payment probe. No sustained 5xx condition or runtime error group was observed.

Release decision:

- RELEASE NOT COMPLETE.
- Do not mark Phase 7 complete until the production QA account file is restored and the Admin/Staff cross-session acceptance smoke passes with real production internal-user sessions.

## Phase 7E Production Acceptance Resume

Status: BLOCKED; RELEASE NOT COMPLETE.

Date: 2026-07-29

Resume state checks:

- PASS: Starting staging head was `1ef7c174f008bb56f577fef522473e9d5d070df9`.
- PASS: `origin/main` remains `c31da4a153c9cdeb76e2dff8f053b04ac2d16b63`.
- PASS: Production deployment `dpl_349VPfKCxW3NHyg5xvJHzWgrfWHC` remains `READY`.
- PASS: Production deployment aliases include `admin.trryapparel.com`.
- PASS: The production app public Supabase configuration points at the expected production project ref. No environment values were printed.
- PASS: The production QA account file now exists and contains the expected QA Admin and QA Staff credential key names.
- PASS: Payment endpoint remains parked and returned HTTP 404 with `payment workflow is not available`.
- PASS: No production runtime error groups were reported during the resumed acceptance window.

Credentialed acceptance result:

- BLOCKED: QA Admin login against production Supabase Auth returned HTTP 400 with sanitized code `invalid_credentials`.
- BLOCKED: QA Staff login against production Supabase Auth returned HTTP 400 with sanitized code `invalid_credentials`.
- BLOCKED: Isolated production Admin and Staff browser contexts could not be created because both credentialed logins failed.
- BLOCKED: Admin role smoke, Staff role smoke, cross-session Work Chat realtime exact-once, unread/read markers, mentions, attachment security, authenticated 390px QA, and remaining credentialed module/permission regression could not be completed.

Runtime note:

- Production deployment health remained stable during the resumed attempt. Vercel reported no runtime error groups; grouped runtime logs showed successful traffic in the selected window and no sustained 5xx condition.

Security note:

- The credential file was read only inside temporary QA processes.
- Passwords, tokens, cookies, browser storage, signed URLs, and environment values were not printed, stored, committed, or documented.
- No production migrations, production settings, payment enablement, Odoo restoration, or customer workflow record mutations were performed.

Release decision:

- RELEASE NOT COMPLETE.
- The next Phase 7E resume needs production QA Admin and Staff credentials that successfully authenticate against production Supabase Auth before the remaining acceptance tests can run.

## Phase 7E Production Acceptance After Account Repair

Status: BLOCKED; RELEASE NOT COMPLETE.

Date: 2026-07-29

Resume state checks:

- PASS: Starting staging head was `8378be49a2307b136e96966aba5039ccc9708fc4`.
- PASS: `origin/main` remains `c31da4a153c9cdeb76e2dff8f053b04ac2d16b63`.
- PASS: Production deployment `dpl_349VPfKCxW3NHyg5xvJHzWgrfWHC` remains `READY`.
- PASS: Production deployment aliases include `admin.trryapparel.com`.
- PASS: Production app public Supabase configuration points at the expected production project ref. No environment values were printed.
- PASS: QA Admin and QA Staff credentials authenticated successfully against production Supabase Auth.
- PASS: Payment endpoint remains parked and returned HTTP 404 with `payment workflow is not available`.
- PASS: Odoo dependency was not restored; active Odoo prompt text was not observed in route smoke.

Passed credentialed acceptance scope:

- PASS: QA Admin role bootstrap, login, Work Chat launcher, and standard channel load.
- PASS: QA Staff role bootstrap, login, Work Chat launcher, and standard channel load.
- PASS: Admin Staff Access scope is limited to Staff management; Admin owner-only create action is blocked.
- PASS: Staff Access remains inaccessible to Staff.
- PASS: Staff manager Workboard scope remains restricted, but see blocker note for returned status.
- PASS: Work Chat unread/read marker behavior passed using concrete message ids.
- PASS: Work Chat mention unread behavior passed.
- PASS: Plain `@` text without `mentionedUserIds` did not create a false mention.
- PASS: Anonymous Work Chat bootstrap is rejected.
- PASS: Anonymous Work Chat attachment URL API is rejected.
- PASS: Anonymous storage bucket listing exposed no object names.
- PASS: Authenticated desktop, tablet 820px, and mobile 390px Work Chat launcher/drawer/composer checks passed for both QA Admin and QA Staff.
- PASS: Follow-up read endpoint passed without mutating customer workflow records.
- PASS: Inquiries, Orders, Production, Workboard, My Tasks, Settings route smoke completed for Admin and Staff after isolated-context retries.

Retained production QA evidence:

- Work Chat messages retained with `[PRODUCTION ACCEPTANCE TEST] Admin to Staff`.
- Work Chat messages retained with `[PRODUCTION ACCEPTANCE TEST] Staff to Admin`.
- Work Chat mention retained with `[PRODUCTION ACCEPTANCE TEST] Admin mentions Staff`.
- Work Chat attachment evidence retained as `phase7e-production-qa.txt`, but attachment hydration/access did not fully pass.

Remaining blockers:

- BLOCKED: Admin Workboard manager API returned HTTP 500 for `/api/tasks?pageSize=5`; Workboard manager access cannot be marked passing.
- BLOCKED: Admin My Tasks API returned HTTP 500 for `/api/my-tasks?pageSize=5`.
- BLOCKED: Staff My Tasks API returned HTTP 500 for `/api/my-tasks?pageSize=5`.
- BLOCKED: Staff restricted Workboard API returned HTTP 500 instead of a clean 403-style restriction response.
- BLOCKED: Cross-session Work Chat exact-once Realtime did not pass. Staff did not receive exactly one Realtime INSERT for the Admin message, and Admin did not receive exactly one Realtime INSERT for the Staff message within the acceptance window.
- BLOCKED: Uploaded Work Chat attachment was not hydrated on its retained message.
- BLOCKED: Authenticated Work Chat attachment URL endpoint returned HTTP 404 for the retained attachment.

Runtime health:

- BLOCKED: Runtime health is not clean. Vercel reported repeated Task API `INTERNAL_ERROR` 500 groups on `/api/my-tasks` and `/api/tasks`.
- BLOCKED: Vercel reported Work Chat attachment URL 404 error groups with `Attachment was not found`.
- WARN: Existing Node `DEP0169` deprecation warning remains non-blocking by itself.
- WARN: One nullable Work Chat read-marker probe returned invalid UUID syntax before the harness switched to concrete message ids; concrete-message read markers passed.

Security note:

- The production QA account file was read only inside temporary QA processes.
- Passwords, tokens, cookies, browser storage, signed URLs, and environment values were not printed, stored, committed, or documented.
- Temporary isolated browser profile directories were removed at process exit, and the temporary acceptance runner was removed after testing.
- No production migrations, production settings, payment enablement, Odoo restoration, or active customer workflow record mutations were performed.

Release decision:

- RELEASE NOT COMPLETE.
- Do not mark Phase 7 complete until Task API 500s, Work Chat Realtime exact-once delivery, and Work Chat attachment hydration/authenticated access pass in production.
