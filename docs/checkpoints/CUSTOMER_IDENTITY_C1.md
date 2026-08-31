# Customer Ecosystem C1 — Customer Identity

## Status

Implementation checkpoint only. No staging or production database migration has been applied by this worktree.

## Authority

- Upstream: `clarkylubguban/adminportal`
- Accepted implementation base: `codex/mcvg1-grouped-sidebar-reconcile`
- Accepted base SHA: `aa483f0cc053d37dfa1fe86ca9cafdf7478aa7ee`
- C1 local branch: `codex/customer-identity-c1`
- Worktree: `/mnt/data/trry-admin-customer-identity-c1`

Normal GitHub clone/ref writes are unavailable in this runtime, so the local worktree is based on a minimal authority snapshot of the accepted upstream commit. The C1 files are intentionally transplantable onto the accepted upstream SHA.

## C1 Contract

C1 establishes customer identity only:

- one `public.customers` master table;
- one canonical Philippine mobile identity per customer;
- automatic normalization to E.164 `+639XXXXXXXXX`;
- database-level duplicate protection across raw formats (`0917...`, `+63917...`, `63917...`, `917...`);
- stable human reference `CUS-000001`;
- canonical first-source values:
  - `POS_WALK_IN`
  - `STLO_WEB`
  - `TRRY_WEB`
  - `ADMIN_MANUAL`
- immutable `first_source` and `first_seen_at` after creation;
- anonymous walk-ins create no customer row;
- RLS enabled; no anonymous direct table access;
- active Owner/Admin/Staff may capture a customer;
- only Owner/Admin may update a customer profile;
- no authenticated delete privilege.

## Explicit Non-Goals

C1 does **not** add:

- order history projections;
- lifetime spend;
- order count;
- STLO Journey state;
- loyalty points;
- discounts or benefits;
- POS customer UI wiring;
- STLO Web customer lookup/linking;
- cross-device customer verification;
- customer merge tooling.

Those belong to C2+.

## Files

- `supabase/migrations/20260831003000_add_customer_identity_c1.sql`
- `supabase/tests/customer_identity_c1.sql`
- `scripts/validate-customer-identity-c1.mjs`
- `package.json` (`validate:customer-identity-c1`)

## Validation Gate

Run:

```bash
npm run validate:customer-identity-c1
```

The validator boots disposable PostgreSQL 17 in Docker, creates the minimum accepted auth/admin prerequisites, applies only the C1 migration, runs the C1 contract test, then destroys the container.

Remote/staging/production databases must remain untouched until a later explicit migration approval gate.

## Validation Result — This Runtime

- `node --check scripts/validate-customer-identity-c1.mjs`: PASS
- static C1 migration scope/required-marker audit: PASS
- `git diff --check`: PASS
- disposable PostgreSQL contract test: **BLOCKED IN THIS RUNTIME**
  - Docker: not installed
  - `psql`: not installed
  - Supabase CLI: not installed

The migration has therefore **not** been applied to staging or production as a substitute for local validation. Database execution remains an approval/validation gate before any remote migration.
