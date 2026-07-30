# Phase 8F Drawers Production Release

## Status

**BLOCKED IN FINAL PREFLIGHT - PRODUCTION RELEASE NOT STARTED**

The required production QA credential file now exists and all four required
keys are populated. The designated QA accounts were temporarily activated and
unbanned, but the QA Admin login returned the safe Supabase Auth code
`invalid_credentials`. Credentialed acceptance could not be guaranteed, so
Phase 8F stopped before moving production main, deploying code, or creating QA
data.

Phase 8F is not release complete.

## Release References

- Staging documentation head:
  `f26762e7c4e4964d1a9a250df95be0b60c2eb4b6`
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
- Production QA Admin and Staff records each existed exactly once with the
  expected role and confirmed Auth identity.

All production database checks were read-only metadata or aggregate checks. No
customer row was opened by identity.

## Credential Blocker

Required file:

`C:\tmp\trry-admin-production-qa-secrets\qa-accounts.env`

Observed state:

- Credential file exists: **YES**
- `QA_ADMIN_EMAIL`: populated
- `QA_ADMIN_PASSWORD`: populated
- `QA_STAFF_EMAIL`: populated
- `QA_STAFF_PASSWORD`: populated
- QA Admin login: **FAIL - `invalid_credentials`**
- QA Staff login: **NOT ATTEMPTED after the hard Admin failure**

The expected QA Admin and QA Staff records were confirmed, then temporarily
activated and unbanned as authorized. Login proof stopped at the QA Admin
failure.

Cleanup immediately restored both profiles to inactive, banned both Auth
accounts, and revoked their sessions. Final session counts were zero for both
accounts. The credential file was retained for correction because production
acceptance did not run.

No credential, token, cookie, browser storage, signed URL, or environment value
was printed, stored, committed, or documented.

## Production Changes

- Production main change: none
- Production deployment: none
- Production Supabase migration: none
- Production business-data write: none
- Production QA account administration: temporary activate/unban, fully reversed
- QA session revocation: complete; zero sessions retained
- Production environment change: none
- Synthetic production QA order: not created
- TRRY POS change: none
- Client portal change: none

## Resume Gate

Before Phase 8F can resume:

1. Repair the QA Admin credential in
   `C:\tmp\trry-admin-production-qa-secrets\qa-accounts.env`.
2. Confirm both QA Admin and QA Staff credentials match their designated
   production Auth accounts without exposing their values.
3. Resume Phase 8F from Step 1 with:
   - executable SHA
     `a7da022fbc1a9d9e92c571f49462dcefd16dff95`;
   - production main
     `8d71713111c1f4434af6af3a8c53b00d2e77017e`;
   - production deployment
     `dpl_44QPvaSq8XJhkqTNtJjztEob2xgU`.
4. Temporarily activate and unban only the two designated QA accounts.
5. Prove both logins before moving production main.

## Recommendation

**BLOCKED.** Do not fast-forward or deploy production until both credentialed
QA logins pass preflight. The approved executable and production references
remain unchanged and ready for a controlled resume.
