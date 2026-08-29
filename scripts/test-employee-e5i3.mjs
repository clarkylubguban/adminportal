import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EFFECTIVE_ACCESS_MODULES } from "../api/_lib/effectiveAccess.js";

const effectiveAccess = read("api/_lib/effectiveAccess.js");
const effectiveApi = read("api/_lib/adminUsersEffectiveAccessRoute.js");
const migration = read("supabase/migrations/202608280001_employee_e5i3_pos_sales_temp_access.sql");
const packageJson = JSON.parse(read("package.json"));

assert.equal(EFFECTIVE_ACCESS_MODULES.has("pos_sales"), true, "POS Sales must use the canonical effective-access evaluator.");
for (const moduleCode of ["calendar", "workboard", "master_catalog", "inquiries", "orders", "production", "design_artwork", "inventory", "purchasing_suppliers"]) {
  assert.equal(EFFECTIVE_ACCESS_MODULES.has(moduleCode), true, `${moduleCode} must remain in canonical effective access.`);
}
for (const forbidden of ["pricing_discounts", "people_access", "my_tasks"]) {
  assert.equal(EFFECTIVE_ACCESS_MODULES.has(forbidden), false, `${forbidden} must remain out of E5I.3 scope.`);
}

assert.match(effectiveAccess, /\["pos_sales", new Set\(\["owner", "admin"\]\)\]/, "Owner/Admin permanent POS access must be preserved in Admin effective access.");
assert.match(effectiveAccess, /moduleCode === "pos_sales"\) return "POS \/ Sales"/, "POS Sales label must be minimal and canonical.");
assert.match(effectiveApi, /getAuthorizedAdmin\(supabase, token\)/, "HTTP effective access must derive caller from authenticated session.");
assert.doesNotMatch(effectiveApi, /employee_id|employeeId|user_id|userId.*searchParams/, "HTTP effective access must not accept caller-supplied employee identity.");

assert.match(migration, /create or replace function public\.get_pos_sales_effective_access\(\)/, "POS Sales database evaluator must take no employee identity argument.");
assert.match(migration, /where user_id = \(select auth\.uid\(\)/, "POS Sales evaluator must map auth.uid() to admin_users.user_id.");
assert.match(migration, /is_active is true/, "POS Sales evaluator must require an active Admin employee.");
assert.match(migration, /module_code = 'pos_sales'/, "POS Sales evaluator must only evaluate pos_sales grants.");
assert.match(migration, /starts_at <= v_now[\s\S]*v_now < expires_at[\s\S]*revoked_at is null/, "POS Sales evaluator must enforce the active grant window.");
assert.match(migration, /jsonb_build_object\([\s\S]*'allowed'[\s\S]*'source'[\s\S]*'expires_at'[\s\S]*'grant_id'/, "POS Sales evaluator must return only the minimum result.");
assert.doesNotMatch(migration, /email|display_name|other module|module_code.*<>|p_employee|p_user|p_role/i, "POS Sales evaluator must not expose unrelated employee data or trust supplied identity.");
assert.match(migration, /revoke execute on function public\.get_pos_sales_effective_access\(\) from public/, "POS Sales evaluator must revoke PUBLIC execute.");
assert.match(migration, /revoke execute on function public\.get_pos_sales_effective_access\(\) from anon/, "POS Sales evaluator must revoke anon execute.");
assert.match(migration, /grant execute on function public\.get_pos_sales_effective_access\(\) to authenticated/, "POS Sales evaluator must be callable only by authenticated users.");

assert.equal(packageJson.scripts["test:employee-e5i3"], "node scripts/test-employee-e5i3.mjs", "package script test:employee-e5i3 missing");
assert.equal(packageJson.scripts["test:employee-e5i3-runtime"], "node scripts/test-employee-e5i3-runtime.mjs", "package script test:employee-e5i3-runtime missing");

console.log("PASS: Employee E5I.3 source contract: pos_sales canonical effective access and shared DB evaluator");

function read(path) {
  return readFileSync(path, "utf8");
}
