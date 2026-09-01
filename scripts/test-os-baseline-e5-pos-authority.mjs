import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runSupabaseQuery(sql) {
  const tempDir = mkdtempSync(join(tmpdir(), "trry-os-baseline-e5-pos-"));
  const sqlPath = join(tempDir, "query.sql");
  const isWindows = process.platform === "win32";
  const cliSqlPath = isWindows ? sqlPath.replaceAll("\\", "/") : sqlPath;
  const command = isWindows ? "cmd.exe" : "npx";
  const args = isWindows
    ? ["/d", "/s", "/c", `npx.cmd supabase db query --file ${cliSqlPath} --local --output csv`]
    : ["supabase", "db", "query", "--file", cliSqlPath, "--local", "--output", "csv"];
  try {
    writeFileSync(sqlPath, sql, "utf8");
    return execFileSync(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

const sql = String.raw`
with checks(check_name, ok) as (
  values
    ('E7 has_admin_module_access absent', not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'has_admin_module_access'
    )),
    ('E7 role/module tables absent', not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in (
          'admin_modules',
          'admin_actions',
          'admin_access_roles',
          'admin_role_module_permissions',
          'admin_role_action_permissions',
          'admin_temporary_module_grants',
          'admin_employee_activity_events',
          'admin_employee_shift_defaults',
          'admin_employee_attendance'
        )
    )),
    ('pos_staff_profiles exists', to_regclass('public.pos_staff_profiles') is not null),
    ('employee_temporary_access_grants exists', to_regclass('public.employee_temporary_access_grants') is not null),
    ('POS base functions exist',
      to_regprocedure('private.m3b_current_pos_staff()') is not null
      and to_regprocedure('private.m3b_is_active_pos_staff()') is not null
    ),
    ('E5/POS authority functions exist',
      to_regprocedure('public.has_active_employee_temporary_access(text)') is not null
      and to_regprocedure('public.get_pos_sales_effective_access()') is not null
      and to_regprocedure('private.m9b4c_is_active_cashier_for_branch(uuid)') is not null
      and to_regprocedure('private.m9b4c_cashier_can_read_inventory_location(uuid)') is not null
    ),
    ('employee temp access FK-covering indexes exist', (
      select count(*) = 6
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'employee_temporary_access_grants'
        and indexname in (
          'employee_temp_access_employee_idx',
          'employee_temp_access_expires_idx',
          'employee_temp_access_revoked_idx',
          'employee_temp_access_module_idx',
          'employee_temporary_access_grants_granted_by_fkey_idx',
          'employee_temporary_access_grants_revoked_by_fkey_idx'
        )
    )),
    ('employee temp grants not exposed to anon/authenticated', not exists (
      select 1
      from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name = 'employee_temporary_access_grants'
        and grantee in ('anon', 'authenticated')
    )),
    ('pos_staff_profiles select policy exists', (
      select count(*) = 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'pos_staff_profiles'
        and policyname = 'pos_staff_profiles_m3b_select'
        and cmd = 'SELECT'
        and qual like '%m3b_is_active_pos_staff%'
        and qual like '%m3b_current_pos_staff%'
    )),
    ('inventory temp read policies exist', (
      select count(*) = 3
      from pg_policies
      where schemaname = 'public'
        and tablename in ('inventory_locations', 'inventory_balances', 'stock_movements')
        and cmd = 'SELECT'
        and qual like '%inventory%'
    )),
    ('inventory temp write policies absent', not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename in ('inventory_locations', 'inventory_balances', 'stock_movements')
        and cmd in ('INSERT', 'UPDATE', 'DELETE')
        and coalesce(qual, '') like '%inventory%'
    )),
    ('purchasing temp read policies exist', (
      select count(*) = 5
      from pg_policies
      where schemaname = 'public'
        and tablename in (
          'suppliers',
          'purchase_orders',
          'purchase_order_lines',
          'purchase_order_receipts',
          'purchase_order_receipt_lines'
        )
        and cmd = 'SELECT'
        and qual like '%purchasing_suppliers%'
    )),
    ('purchasing temp write policies absent', not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename in (
          'suppliers',
          'purchase_orders',
          'purchase_order_lines',
          'purchase_order_receipts',
          'purchase_order_receipt_lines'
        )
        and cmd in ('INSERT', 'UPDATE', 'DELETE')
        and coalesce(qual, '') like '%purchasing_suppliers%'
    )),
    ('branch-scoped cashier read policies exist', (
      select count(*) = 3
      from pg_policies
      where schemaname = 'public'
        and tablename in ('branches', 'inventory_locations', 'inventory_balances')
        and cmd = 'SELECT'
        and qual like '%m9b4c%'
    )),
    ('branch-scoped cashier write policies absent', not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename in ('branches', 'inventory_locations', 'inventory_balances')
        and cmd in ('INSERT', 'UPDATE', 'DELETE')
        and coalesce(qual, '') like '%m9b4c%'
    )),
    ('anon cannot execute public E5/POS RPCs',
      not has_function_privilege('anon', 'public.has_active_employee_temporary_access(text)', 'execute')
      and not has_function_privilege('anon', 'public.get_pos_sales_effective_access()', 'execute')
    ),
    ('authenticated can execute public E5/POS RPCs',
      has_function_privilege('authenticated', 'public.has_active_employee_temporary_access(text)', 'execute')
      and has_function_privilege('authenticated', 'public.get_pos_sales_effective_access()', 'execute')
    ),
    ('policies do not reference E7 module access', not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and (
          coalesce(qual, '') like '%has_admin_module_access%'
          or coalesce(with_check, '') like '%has_admin_module_access%'
        )
    ))
)
select check_name
from checks
where not ok
order by check_name;
`;

const output = runSupabaseQuery(sql);
const failures = output.split(/\r?\n/).slice(1).filter(Boolean);

assert.deepEqual(failures, [], `OS Baseline POS/E5 authority failures:\n${failures.join("\n")}`);

console.log("PASS OS Baseline 1A POS/E5 authority recovery contract");
