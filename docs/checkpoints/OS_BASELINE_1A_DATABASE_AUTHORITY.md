# OS-BASELINE-1A Database Authority Decision

Date: 2026-08-30
Branch: codex/os-baseline-1-reconcile
Production authority commit: aa483f0cc053d37dfa1fe86ca9cafdf7478aa7ee

## Decision

For OS-BASELINE-1, production authorization behavior is the canonical baseline authority.

The production Supabase project is `trryportalsystem` (`wcgtwfctpnwgpglywvvx`). The staging Supabase project is `trry-admin-staging` (`fszkypwovpdthqfobxrk`). Staging contains additional Employee E7 role/module access work that has not been promoted to production and is not part of this baseline reconciliation.

## Canonical Access Paths

OS-BASELINE-1 preserves these production access paths:

- Owner/Admin authorization through existing admin-user checks.
- Existing E5 temporary employee access through `public.has_active_employee_temporary_access(...)`.
- Inventory temporary access through `public.has_active_employee_temporary_access('inventory')`.
- Purchasing/Suppliers temporary access through `public.has_active_employee_temporary_access('purchasing_suppliers')`.
- POS cashier branch-scoped read access through `private.m9b4c_is_active_cashier_for_branch(...)` and `private.m9b4c_cashier_can_read_inventory_location(...)`.

## Explicit Non-Promotion

OS-BASELINE-1 must not introduce these staging-only E7 access expansions:

- `public.has_admin_module_access('inventory')`
- `public.has_admin_module_access('purchasing')`
- Any other E7 role/module permission expansion not currently present in production.

## E7 Parking Rule

E7 is parked and unpromoted, not rejected. Baseline reconciliation must not destroy, rewrite, or erase the E7 work from staging, branch history, or future promotion planning. It also must not accidentally promote E7 into the production baseline.

Future Employee/Access-Control work should resume E7 as a controlled phase with its own production-readiness review, migration lineage audit, and acceptance gate.

## Evidence

Production live catalog on 2026-08-30:

- `public.has_active_employee_temporary_access(text)` exists and is executable by `authenticated` and `service_role`.
- `public.get_pos_sales_effective_access()` exists and is executable by `authenticated` and `service_role`.
- `public.has_admin_module_access(text)` is absent.
- Inventory policies preserve Owner/Admin, E5 inventory temporary access, and POS cashier branch-scoped reads.
- Purchasing policies preserve Owner/Admin and E5 `purchasing_suppliers` temporary access.
- Production migration history includes `20260820000000_m2b_inventory_foundation` and `20260820001000_m2c_inventory_rls_helper_execute`, restored into source control during OS-BASELINE-1A because later receiving migrations require that inventory authority.

Staging live catalog on 2026-08-30:

- `public.has_admin_module_access(text)` exists.
- Staging August 30 policy consolidation includes `has_admin_module_access('inventory')` and `has_admin_module_access('purchasing')`.
- Those staging-only policy paths are classified as `PARKED_UNPROMOTED_EMPLOYEE_ACCESS_CONTROL`.

## Source-Control Recovery

Recovered production-authority migrations:

- `supabase/migrations/20260820000000_m2b_inventory_foundation.sql`
- `supabase/migrations/20260820001000_m2c_inventory_rls_helper_execute.sql`
- `supabase/migrations/20260830125100_os_baseline_1_production_db_hardening.sql`

The August 30 recovery migration documents staging version-number differences and excludes executable E7 module-access predicates. Optional hardening policy blocks are guarded by the table/function dependencies they reference so local migration validation can run against partial historical schemas while production keeps the exact canonical policy semantics.
