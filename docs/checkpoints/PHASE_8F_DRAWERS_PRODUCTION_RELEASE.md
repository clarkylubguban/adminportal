# Phase 8F Drawers Production Release

## Status

**BLOCKED IN FINAL PREFLIGHT - PRODUCTION RELEASE NOT STARTED**

The required production QA credential file was absent. Credentialed acceptance
could not be guaranteed, so Phase 8F stopped before activating QA accounts,
moving production main, deploying code, creating QA data, or making any
production write.

Phase 8F is not release complete.

## Release References

- Staging documentation head:
  `462e7e119e1c52d07c5606237db361d77d322ed4`
- Approved executable release SHA:
  `a7da022fbc1a9d9e92c571f49462dcefd16dff95`
- Expected and observed production main:
  `8d71713111c1f4434af6af3a8c53b00d2e77017e`
- Current production deployment:
  `dpl_44QPvaSq8XJhkqTNtJjztEob2xgU`
- Approved staging deployment:
  `dpl_3pUdFezKP2jFamY6EYLSQhee8YC9`

## Passed Preflight Gates

- Local `HEAD` matched the required staging documentation head.
- `origin/staging` matched the required staging documentation head.
- `origin/main` matched the required production main.
- Approved executable commit exists.
- Approved executable is an ancestor of the documentation head.
- Production main can fast-forward to the executable SHA.
- Worktree was clean.
- No migration exists in the production release diff.
- Current production deployment was READY, targeted production `main`, and
  included `admin.trryapparel.com`.
- Corrected Order Details select: 61 fields.
- Production-present selected fields: 61.
- Missing selected fields: 0.
- Incompatible production stage values: 0.
- `VITE_ENABLE_ADMIN_PAY_AT_SHOP_WORKFLOW`: true.
- `VITE_ENABLE_TASK_DOMAIN`: true.
- Customer Pay Online endpoint: `404`.
- Pay Online remained parked.
- Odoo remained absent from the active release implementation.

All production database checks were read-only metadata or aggregate checks. No
customer row was opened by identity.

## Credential Blocker

Required file:

`C:\tmp\trry-admin-production-qa-secrets\qa-accounts.env`

Observed state:

- Credential file exists: **NO**
- Four required keys populated: **NOT TESTABLE**
- QA Admin login: **NOT TESTABLE**
- QA Staff login: **NOT TESTABLE**

Read-only production account metadata found exactly one expected QA Admin role
record and one expected QA Staff role record. Both public profiles remained
inactive and both Auth accounts remained unavailable for login, consistent with
the previous production QA cleanup.

The accounts were deliberately not activated or unbanned because the missing
credential file prevented the mandatory pre-release login proof and guaranteed
post-release acceptance.

No credential, token, cookie, browser storage, signed URL, or environment value
was printed, stored, committed, or documented.

## Production Changes

- Production main change: none
- Production deployment: none
- Production Supabase migration: none
- Production Supabase record write: none
- Production environment change: none
- QA account activation/unban: none
- Synthetic production QA order: not created
- TRRY POS change: none
- Client portal change: none

## Resume Gate

Before Phase 8F can resume:

1. Restore
   `C:\tmp\trry-admin-production-qa-secrets\qa-accounts.env`.
2. Populate all four required QA Admin/Staff email and password keys.
3. Resume Phase 8F from Step 1 with:
   - executable SHA
     `a7da022fbc1a9d9e92c571f49462dcefd16dff95`;
   - production main
     `8d71713111c1f4434af6af3a8c53b00d2e77017e`;
   - production deployment
     `dpl_44QPvaSq8XJhkqTNtJjztEob2xgU`.
4. Temporarily activate and unban the two QA accounts only after the credential
   file passes key-presence validation.
5. Prove both logins before moving production main.

## Recommendation

**BLOCKED.** Do not fast-forward or deploy production until both credentialed
QA logins pass preflight. The approved executable and production references
remain unchanged and ready for a controlled resume.
