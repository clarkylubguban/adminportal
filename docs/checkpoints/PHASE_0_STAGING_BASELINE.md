# Phase 0 - Staging Safety Baseline

## Status

- Phase status: COMPLETE WITH DATABASE DUMP BLOCKED
- Date and time completed: 2026-07-26T21:53:04.6457395+08:00
- Baseline Git commit: 3406da7b197a0ef10243b573f965c241071f34bb
- Documentation commit: recorded in the Phase 0 delivery report after commit creation

## Environment

- Git repository: clarkylubguban/adminportal
- Working branch: staging
- Baseline commit: 3406da7b197a0ef10243b573f965c241071f34bb
- Checkpoint branch: checkpoint/phase-0-3406da7b
- Vercel staging project: adminportal-staging
- Supabase staging project: trry-admin-staging
- Supabase staging project ref: fszkypwovpdthqfobxrk

Environment variable names only:

- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY

## Git Checkpoint

- Baseline commit SHA: 3406da7b197a0ef10243b573f965c241071f34bb
- Baseline commit message: Complete inquiry follow-up recording flow
- Checkpoint branch: checkpoint/phase-0-3406da7b
- Checkpoint branch commit SHA: 3406da7b197a0ef10243b573f965c241071f34bb
- `staging` was 3 commits ahead of `main` and 0 commits behind `main` at checkpoint time.
- No Git merge conflict existed at checkpoint time.
- Merge base with `main`: 1585ec333df72c8f1553e9ae5eaaae035c219e80
- `main` was not checked out, changed, merged, reset, pushed, or deployed during Phase 0.

Baseline verification results:

- `npm.cmd run build`: PASSED
- `node --check .\src\main.js`: PASSED
- `node --check .\src\mvpDashboard.js`: PASSED
- `node --check .\scripts\validate.mjs`: PASSED
- `node --check .\api\inquiries\[id]\follow-ups.js`: PASSED
- `git diff --check`: PASSED

## Database Checkpoint

- Latest applied migration version: 20260726133055
- Latest applied migration name: inquiry_follow_up_events
- Backup storage path: `C:\tmp\trry-admin-staging-backups\phase-0-3406da7b\`

Backup files:

| Filename | Status | Size | SHA-256 |
| --- | --- | ---: | --- |
| trry-admin-staging_phase-0-3406da7b_full.dump | BLOCKED | not created | not available |
| trry-admin-staging_phase-0-3406da7b_schema.sql | BLOCKED | not created | not available |
| trry-admin-staging_phase-0-3406da7b_migrations.csv | CREATED | 969 bytes | 68A3EAF64D8505F8FA3EF87CD470495E54CEED40D12585780F8C1DC28699719B |
| trry-admin-staging_phase-0-3406da7b_row-counts.csv | CREATED | 147 bytes | 1B85F9734097C6C6E7297F70DF6BCA715736B8F32BEC39E6E2A0206E40059194 |
| trry-admin-staging_phase-0-3406da7b_manifest.txt | CREATED | 1101 bytes | 20D145712344CF7C500F2132CC92489F10DDF25B2A66B042F28CF8B6642345AD |

Backup validation result: BLOCKED. `pg_dump`, `pg_restore`, `psql`, and `supabase` CLI were not installed on PATH, and no staging database password was available in the staging worktree. Git checkpoint and database metadata checkpoint were still completed using staging-only read-only metadata access.

Verified staging-only row-count baseline:

| Table | Row count |
| --- | ---: |
| admin_users | 2 |
| ops_inquiries | 3 |
| inquiry_follow_up_events | 0 |
| tasks | 1 |
| task_events | 7 |
| task_submissions | 1 |
| task_time_entries | 1 |

Confirmed staging-only database facts:

- `inquiry_follow_up_events` exists.
- Migration `20260726133055 inquiry_follow_up_events` is applied.
- Pending payment migration version `202607260001` is not recorded as applied.
- No production customer data was copied during this task.

## Pending Migration Review

`supabase/migrations/202607260001_complete_payment_workflow.sql`

- Present in Git.
- Not recorded as applied in staging migration history.
- Intentionally not applied during Phase 0.
- Requires separate Payment scope review.
- Must not reach production without staging migration and workflow QA.

The applied follow-up migration remained unchanged:

`supabase/migrations/202607260002_inquiry_follow_up_events.sql`

## Confirmed Working Flows

| Flow | Status |
| --- | --- |
| Owner login | NOT VERIFIED |
| Inquiry listing | NOT VERIFIED |
| Inquiry drawer opening | NOT VERIFIED |
| Details tab | NOT VERIFIED |
| Request tab | NOT VERIFIED |
| Notes tab | NOT VERIFIED |
| History tab | NOT VERIFIED |
| Owner assignment | NOT VERIFIED |
| Follow-up schedule saving | NOT VERIFIED |
| Follow-up event recording | NOT VERIFIED |
| Follow-up notes display | NOT VERIFIED |
| Follow-up History display | NOT VERIFIED |
| Orders page loading | NOT VERIFIED |
| Production page loading | NOT VERIFIED |
| Workboard page loading | NOT VERIFIED |
| My Tasks page loading | NOT VERIFIED |
| Calendar page loading | NOT VERIFIED |
| Staff access and role lookup | NOT VERIFIED |

## Baseline Record Counts

| Table | Row count |
| --- | ---: |
| admin_users | 2 |
| ops_inquiries | 3 |
| inquiry_follow_up_events | 0 |
| tasks | 1 |
| task_events | 7 |
| task_submissions | 1 |
| task_time_entries | 1 |

## Rollback Plan

### Application rollback

1. Stop new staging deployments.
2. Redeploy commit: 3406da7b197a0ef10243b573f965c241071f34bb
3. Or reset a temporary recovery branch from: checkpoint/phase-0-3406da7b
4. Never force-reset production.
5. Run staging smoke tests.

### Database rollback

1. Stop staging writes.
2. Capture a new pre-rollback backup.
3. Confirm target project is: fszkypwovpdthqfobxrk
4. Restore the Phase 0 backup to staging only.
5. Verify migration history.
6. Verify baseline row counts.
7. Run staging smoke tests.
8. Do not restore into production.

## Known Risks for Later Review

Record only. Do not fix in Phase 0.

- `task_feature_flags` has RLS enabled with no direct policy.
- `catalog-images` public bucket allows broad file listing.
- Supabase advisor reports authenticated SECURITY DEFINER functions.
- Leaked password protection is disabled.
- Payment migration exists in Git but is pending in staging.
- Security advisor findings require intent and remediation review before Phase 7.

Relevant Supabase remediation references:

- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/guides/database/database-advisors
- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/guides/auth/password-security

## Production Safety Confirmation

- Production Git was untouched.
- Production Vercel was untouched.
- Production Supabase was untouched.
- No production customer data was copied.
- No production deployment occurred.
