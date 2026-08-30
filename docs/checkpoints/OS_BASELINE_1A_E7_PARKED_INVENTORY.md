# OS-BASELINE-1A E7 Parked Inventory

Date: 2026-08-30
Classification: `PARKED_UNPROMOTED_EMPLOYEE_ACCESS_CONTROL`

## Scope

Employee E7 role/module access is parked outside OS-BASELINE-1. The work remains valuable and recoverable, but it is not production authority for this baseline.

## Staging-Only Authority Objects

Observed on staging project `trry-admin-staging` (`fszkypwovpdthqfobxrk`):

- `public.admin_modules`
- `public.admin_actions`
- `public.admin_access_roles`
- `public.admin_role_module_permissions`
- `public.admin_role_action_permissions`
- `public.admin_temporary_module_grants`
- `public.admin_employee_activity_events`
- `public.admin_employee_shift_defaults`
- `public.admin_employee_attendance`
- `public.has_admin_module_access(text)`
- `public.has_admin_temporary_module_access(text)`
- `public.has_admin_action_permission(text)`
- `public.current_admin_access_role_key()`
- `public.get_effective_employee_access(uuid)`
- `public.authorize_employee_modules_today(uuid,text[],text)`
- `public.revoke_employee_temporary_access(uuid,text[],text)`
- `public.set_employee_access_role(uuid,text,text)`
- `public.set_employee_lifecycle_status(uuid,text,text)`

## Staging Migration Lineage

Staging remote migration history includes:

- `20260825050117_add_employee_access_security_e7`
- `20260830124816_consolidate_permissive_select_policies`, which uses `has_admin_module_access('inventory')`
- `20260830124844_consolidate_purchasing_select_policies`, which uses `has_admin_module_access('purchasing')` and `has_admin_module_access('inventory')`

Related branch/file lineage observed in Git history:

- `codex/admin-employees-e1` / `a7f1fe1` - employee tab foundation
- `codex/admin-employees-e2` / `357ffad` - employee lifecycle
- `codex/admin-employees-e3` / `90ab9a0` - temporary access foundation
- `codex/admin-employees-e5g` / `f92b8d0` - inventory temporary access
- `codex/admin-employees-e5h` / `14747ca` - purchasing temporary access
- `codex/admin-employees-e5i` / `7cc6a14` - POS temporary access authority
- `codex/admin-employee-production-release` / `8576908` - employee-only production release preparation

## Baseline Rule

Do not merge E7 into OS-BASELINE-1. Do not delete E7 from staging or branch history. When E7 resumes, promote it through a separate Employee/Access-Control phase with a new database authority decision.
