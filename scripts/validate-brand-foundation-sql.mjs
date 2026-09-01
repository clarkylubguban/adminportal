import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migrationsDir = join(root, "supabase", "migrations");
const brandMigrationName = readdirSync(migrationsDir).find((name) => name.endsWith("_add_brand_foundation.sql"));

if (!brandMigrationName) {
  console.error("Brand Foundation SQL validation failed:");
  console.error("- add_brand_foundation migration is missing");
  process.exit(1);
}

const sql = readFileSync(join(migrationsDir, brandMigrationName), "utf8");

const checks = [
  ["Creates public.brands", sql.includes("create table if not exists public.brands")],
  ["Brand fields exist", ["brand_code text not null", "ownership_type text not null", "owner_name text not null", "website_slug text", "status text not null", "created_by_user_id uuid references public.admin_users(user_id)", "updated_by_user_id uuid references public.admin_users(user_id)"].every((token) => sql.includes(token))],
  ["Brand code/name/owner constraints exist", ["brands_brand_code_not_blank", "brands_name_not_blank", "brands_owner_name_not_blank"].every((token) => sql.includes(token))],
  ["Ownership and status checks exist", sql.includes("ownership_type in ('internal', 'partner')") && sql.includes("status in ('active', 'archived')")],
  ["Case-insensitive unique indexes exist", ["brands_brand_code_lower_key", "brands_name_lower_key", "brands_website_slug_lower_key"].every((token) => sql.includes(token))],
  ["Initial canonical brands are deterministic", ["'STLO', 'STLO', 'internal', 'Clark', 'stlo', 'active'", "'TRRY', 'TRRY Apparel', 'internal', 'TRRY Operations', 'trry-apparel', 'active'", "'GENERIC', 'Generic / Unbranded', 'internal', 'TRRY Operations', null, 'active'"].every((token) => sql.includes(token))],
  ["Existing products require mapping gate", sql.includes("PRODUCT_BRAND_MAPPING_GATE_REQUIRED") && sql.includes("if exists (select 1 from public.products)")],
  ["Products require brand_id FK restrict", sql.includes("add column if not exists brand_id uuid") && sql.includes("alter column brand_id set not null") && sql.includes("foreign key (brand_id)") && sql.includes("references public.brands(id)") && sql.includes("on delete restrict")],
  ["Brand Code normalization and immutability trigger exist", sql.includes("normalize_brand_before_write") && sql.includes("upper(btrim(coalesce(new.brand_code") && sql.includes("BRAND_CODE_IMMUTABLE")],
  ["Brand audit identity is derived from auth.uid", sql.includes("v_actor_user_id uuid := (select auth.uid())") && sql.includes("new.created_by_user_id := v_actor_user_id") && sql.includes("new.updated_by_user_id := v_actor_user_id") && sql.includes("new.created_by_user_id := old.created_by_user_id") && !sql.includes("coalesce(new.created_by_user_id") && !sql.includes("coalesce(new.updated_by_user_id")],
  ["Product active Brand assignment trigger exists", sql.includes("validate_product_brand_assignment") && sql.includes("PRODUCT_BRAND_REQUIRED") && sql.includes("PRODUCT_BRAND_MUST_BE_ACTIVE")],
  ["Assigned Brand archive is rejected", sql.includes("prevent_brand_archive_with_products") && sql.includes("BRAND_HAS_ASSIGNED_PRODUCTS")],
  ["Brand delete is rejected", sql.includes("reject_brand_delete") && sql.includes("BRAND_DELETE_DISABLED")],
  ["Brands RLS and explicit grants exist", sql.includes("alter table public.brands enable row level security") && sql.includes("revoke all privileges on table public.brands from anon") && sql.includes("grant select, insert, update on table public.brands to authenticated")],
  ["Role policies match contract", sql.includes("Active admins can read brands") && sql.includes("array['owner','admin','staff','viewer']") && sql.includes("Active owners and admins can insert brands") && sql.includes("Active owners and admins can update brands") && sql.includes("array['owner','admin']")],
  ["No destructive delete policy exists", !sql.includes("for delete")],
  ["Trigger helper direct execute revoked", ["normalize_brand_before_write", "set_brand_audit_fields", "prevent_brand_archive_with_products", "reject_brand_delete", "validate_product_brand_assignment"].every((fn) => sql.includes(`revoke all on function public.${fn}() from public`) && sql.includes(`revoke all on function public.${fn}() from anon`) && sql.includes(`revoke all on function public.${fn}() from authenticated`))],
  ["No public Brand RPC introduced", !sql.includes("grant execute on function public.")],
];

const failures = checks.filter(([, passed]) => !passed);

if (failures.length) {
  console.error("Brand Foundation SQL validation failed:");
  for (const [label] of failures) console.error(`- ${label}`);
  process.exit(1);
}

console.log(`Brand Foundation SQL validation passed: ${brandMigrationName}`);
