# Phase 8.8 Task Hardening and Staging Release Checklist

Status: PASS on staging

PRODUCTION RELEASE: NOT AUTHORIZED
OWNER APPROVAL: REQUIRED

## Approved Baseline

- Phase 8.1 Task Foundation: b5fa70731e3d62797662c05837f4640062ff7cb9
- Phase 8.2 Task API: c523512919b61c4b94503d2526cfa84f79ef6cd8
- Phase 8.3 n8n Foundation: 7fb3d76c2b90857f4149a04445c7dc983bffbdd5
- Phase 8.4 Workboard MVP: cfe86431e6d650dc51487cf1457c9995dcbcabc4
- Phase 8.5 My Tasks MVP: a78bf24
- Phase 8.6 Calendar MVP: 85d8507
- Phase 8.7 Auto Plan Today: 4e94ea26008da69a47c6c344a35146f43715aba4

## Approved Task Migration Order

Apply only approved task migrations. Exclude the parked payment workflow migration.

1. supabase/migrations/202607250001_create_task_domain_schema.sql
2. supabase/migrations/202607250002_create_task_domain_functions.sql
3. supabase/migrations/202608010001_align_task_foundation_phase_8_1.sql
4. supabase/migrations/202608030001_add_task_approve_and_assign.sql
5. supabase/migrations/202608030002_enable_none_task_start.sql
6. supabase/migrations/20260803033131_phase_8_3_n8n_foundation.sql
7. supabase/migrations/20260803033132_phase_8_7_auto_plan_today.sql

Excluded:

- supabase/migrations/202607260001_complete_payment_workflow.sql

## Environment Identity

- Vercel staging project: adminportal-staging
- Vercel staging project ID: prj_K0oDSa6r1MgAEpQMcl3mKVdJvtNI
- Vercel team/account ID: team_lLNAY28RJHud9QjW9vcIh7WO
- Vercel production project is separate: adminportal / prj_ObjP9WVxYHHvfYgsLgZYd3PrXQ0g
- Supabase staging project: trry-admin-staging
- Supabase staging ref: fszkypwovpdthqfobxrk
- Supabase staging host: db.fszkypwovpdthqfobxrk.supabase.co
- Supabase production project is separate: trryportalsystem / wcgtwfctpnwgpglywvvx

Proven:

- Staging Auth QA identity for Owner/Admin/Staff

Staging n8n identity:

- Local self-hosted Docker n8n: PASS at localhost:5678.
- Imported marketing workflows inspected only by name/node shape and not activated or modified.
- Separate verifier workflow created: `TRRY STAGING - AUTO PLAN TODAY VERIFIER`.
- Verifier workflow contains 3 nodes, no credentials, and only returns safe `AI_MARKETING` / `DAILY_CONTENT` draft suggestions.
- n8n editor remained private on localhost.
- Public exposure used a temporary SSH tunnel in front of the local allowlist proxy only; n8n editor was not exposed.
- The proxy forwarded only `/trry-staging-auto-plan-today` and signed drafts back to staging ingestion.
- Credentials, tokens, secrets, browser storage, and full credential configuration were not printed or committed.
- Post-verification cleanup: temporary proxy stopped, temporary tunnels stopped, throwaway SSH key removed, verifier workflow returned to inactive.

Staging Auth proof captured on 2026-08-03:

- Supabase project: trry-admin-staging / fszkypwovpdthqfobxrk
- Owner QA sign-in: PASS; active test profile; Auth UUID matches admin profile UUID
- Admin QA sign-in: PASS; active test profile; Auth UUID matches admin profile UUID
- Staff QA sign-in: PASS; active test profile; Auth UUID matches admin profile UUID
- Credentials, session tokens, and browser storage were not printed, stored, or committed.

Local n8n inspection on 2026-08-03:

- Approved n8n shape: self-hosted local Docker n8n at localhost:5678.
- Docker container: `trry-n8n`, bound to 127.0.0.1:5678.
- Health check: PASS.
- n8n Cloud is not used.

Temporary tunnel recommendation for staging verification:

- Run local n8n only on localhost.
- Put a tiny local allowlist proxy in front of n8n that forwards only the required staging webhook path and allowed method(s), not the n8n editor UI.
- Expose that proxy through a temporary no-subscription tunnel, preferably Cloudflare Quick Tunnel via Docker, or `npx localtunnel` if Cloudflare tooling is unavailable.
- Point only the `adminportal-staging` `N8N_AUTO_PLAN_TODAY_URL` value at the temporary tunnel webhook URL.
- Remove the tunnel and restore/disable the staging server gate after verification.

## Staging Schema Status

Applied to staging Supabase ref `fszkypwovpdthqfobxrk`:

- phase_8_2_add_task_approve_and_assign
- phase_8_5_enable_none_task_start
- phase_8_1_align_task_foundation
- phase_8_3_n8n_foundation
- phase_8_7_auto_plan_today
- phase_8_8_task_runtime_grants

Excluded:

- supabase/migrations/202607260001_complete_payment_workflow.sql

Corrective grant root cause:

- The deployed Task API selected newer task projection columns not covered by the original column-level `authenticated` grant.
- Server-side Auto Plan needed `service_role` execute on `task_domain_enabled()` and readback access on `tasks`.
- Added source migration: `supabase/migrations/20260803033200_phase_8_8_task_runtime_grants.sql`.

## Backup and Recovery Readiness

Primary rollback path for staging:

1. Disable the affected feature flag.
2. Stop further rollout.
3. Preserve browser/API/database evidence.
4. Roll back the Vercel staging deployment if the deployed artifact is the cause.
5. Do not run destructive down migrations against staging data.

Production rollback planning remains pending separate Owner approval.

## Required Production Environment Variables

Required only after a separate Owner-approved production activation:

- VITE_ENABLE_TASK_DOMAIN
- VITE_ENABLE_WORKBOARD
- VITE_ENABLE_MY_TASKS
- VITE_ENABLE_CALENDAR
- VITE_ENABLE_AUTO_PLAN_TODAY
- ENABLE_AUTO_PLAN_TODAY
- N8N_AUTO_PLAN_TODAY_URL
- N8N_AUTO_PLAN_TODAY_WORKFLOW
- N8N_AUTO_PLAN_TODAY_TOKEN
- N8N_TASK_DRAFTS_SECRET
- N8N_TASK_DRAFTS_MAX_TASKS

Secret rotation readiness required before production activation:

- Rotate or confirm n8n signing secret.
- Confirm staging and production n8n credentials are distinct.
- Confirm no service-role keys or n8n secrets are exposed in browser env.

## Feature-Flag Rollout Order

1. TASK_DOMAIN
2. WORKBOARD
3. MY_TASKS
4. CALENDAR
5. VITE_ENABLE_AUTO_PLAN_TODAY
6. ENABLE_AUTO_PLAN_TODAY
7. Staging-only n8n workflow execution

Flags must remain independent. UI flags are not security controls.

Final staging flag state:

- TASK_DOMAIN: enabled
- WORKBOARD: enabled
- MY_TASKS: enabled
- CALENDAR: enabled
- N8N_FOUNDATION: enabled
- AUTO_PLAN_TODAY: enabled

Staging deployments:

- Task surfaces enabled, Auto Plan off: `dpl_BgRhxGSfDM8krxU613VN52qSkTAK`
- Auto Plan env configured with first tunnel: `dpl_HvJtCSQYtg6ZoEwWwQWTFzoFL2cy`
- Healthy tunnel retry: `dpl_FQ5hFbF8XsLbmAFoAkb3DMWuGHbZ`

## Required Smoke Tests

- Owner/Admin/Staff smoke-test accounts: PASS
- Owner permission matrix
- Admin permission matrix
- Staff permission matrix
- Unauthenticated denial: PASS for n8n ingestion endpoint
- Workboard list, draft drawer, Edit Brief, Approve and Assign, Discard: automated regression PASS
- My Tasks assigned-only list, timer, submit, revision cycle: automated regression PASS; deployed `/api/my-tasks` Owner/Admin/Staff smoke PASS
- Calendar month, agenda, filters, dense-day display: automated regression PASS
- Auto Plan Today Owner success: PASS
- Auto Plan Today Admin denial: PASS
- Auto Plan Today Staff denial: PASS
- n8n HMAC, timestamp, expiry, payload hash, replay, changed-payload conflict: automated regression PASS; deployed replay smoke PASS
- Operational regressions for Inquiry, Order, Payment, Production: no workflow/API path mutated these records during verifier run; protected payment-event count remained unchanged
- Runtime log scan for sustained 5xx: PASS; no sustained 5xx in staging Vercel logs after the successful tunnel deployment

Staging Auto Plan evidence:

- Planning request: `f0a1f140-0e38-4b13-b602-a7b5eeaa3797`
- Trace code: `PLN-S2WA-3C39NPWVPLH`
- Status: COMPLETED
- Drafts received: 3
- Draft source mix: 1 `AI_MARKETING`, 2 `DAILY_CONTENT`
- Canonical task checks: all `DRAFT`, all unassigned, no reviewer, allowed sources only, approval required, automation receipt present, external task IDs present
- Receipt count for planning request: 1, status COMPLETED
- Replay with same Owner idempotency key: PASS, no duplicate receipt/tasks
- Admin and Staff Auto Plan requests: 403 FORBIDDEN

Operational count evidence:

- `admin_users`: 8, unchanged from pre-run
- `clients`: 3, unchanged from pre-run
- `inquiry_payment_events`: 12, unchanged from pre-run
- Task-domain rows changed only by synthetic Phase 8.8 verifier activity: `tasks` 4 total, `task_events` 10 total, `planning_requests` 3 total, `automation_receipts` 1 total

## Rollback Triggers

- Any critical permission bypass
- Duplicate timer or duplicate task activation
- Missing immutable audit event
- n8n signature/replay failure
- Operational record mutation outside Task domain
- Sustained 5xx or broken auth in staging
- Responsive layout blocking primary actions

## Owner Approval

- [ ] Owner reviewed staging evidence
- [ ] Owner approved production migration plan
- [ ] Owner approved production feature-flag rollout
- [ ] Owner approved production n8n workflow identity

Production activation status: NOT AUTHORIZED

Final verdict: PHASE 8.8 STAGING PASS
