import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = read("supabase/migrations/20260910132057_customer_identity_pos_walk_in_c2_4b.sql");
const packageJson = JSON.parse(read("package.json"));

assert.match(
  migration,
  /create or replace function public\.resolve_pos_walk_in_customer_identity_c2_4b\(\s*p_full_name text,\s*p_mobile text\s*\)/,
  "C2.4B must expose the two-input POS identity RPC.",
);
assert.match(migration, /security invoker/, "C2.4B must not bypass C1/C2.1 RLS or actor attribution.");
assert.doesNotMatch(migration, /security definer/, "C2.4B must not introduce a definer capability.");
assert.match(migration, /set search_path = public, pg_temp/, "C2.4B must use a fixed search path.");
assert.match(migration, /auth\.uid\(\).*is null/s, "C2.4B must require an authenticated caller.");
assert.match(migration, /public\.get_pos_sales_effective_access\(\)/, "C2.4B must derive POS/Sales access server-side.");
assert.match(migration, /v_pos_access\s*->>\s*'allowed'/, "C2.4B must require an allowed POS/Sales result.");
assert.match(
  migration,
  /public\.find_or_create_customer_identity_c2_1\(\s*p_full_name,\s*p_mobile,\s*'POS_WALK_IN'\s*\)/s,
  "C2.4B must delegate identity work with an internally fixed POS_WALK_IN source.",
);
assert.match(migration, /revoke all on function public\.resolve_pos_walk_in_customer_identity_c2_4b\(text, text\) from public/, "PUBLIC must be denied.");
assert.match(migration, /revoke all on function public\.resolve_pos_walk_in_customer_identity_c2_4b\(text, text\) from anon/, "anon must be denied.");
assert.match(migration, /revoke all on function public\.resolve_pos_walk_in_customer_identity_c2_4b\(text, text\) from service_role/, "service_role must be denied.");
assert.match(migration, /grant execute on function public\.resolve_pos_walk_in_customer_identity_c2_4b\(text, text\) to authenticated/, "authenticated must be the only granted caller role.");
assert.equal(packageJson.scripts["validate:customer-identity-c2-4b"], "node scripts/validate-customer-identity-c2-1.mjs", "C2.4B local SQL validator script is missing.");

console.log("PASS: Customer C2.4B POS walk-in identity source contract");

function read(path) {
  return readFileSync(path, "utf8");
}
