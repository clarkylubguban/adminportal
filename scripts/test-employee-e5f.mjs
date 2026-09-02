import assert from "node:assert/strict";
import fs from "node:fs";

const effectiveAccess = read("api/_lib/effectiveAccess.js");
const frontendAccess = read("src/services/adminEffectiveAccess.js");
const main = read("src/main.js");
const artworkApi = read("api/inquiries/[id]/artwork.js");
const customerActionsApi = read("api/inquiries/[id]/customer-actions.js");
const migration = read("supabase/migrations/20260827011526_employee_e5f_design_artwork_temp_access.sql");
const packageJson = JSON.parse(read("package.json"));

assert.match(effectiveAccess, /"design_artwork"/, "canonical effective access must register design_artwork");
assert.match(effectiveAccess, /\["design_artwork", new Set\(\["owner", "admin"\]\)\]/, "Owner/Admin permanent design_artwork access must be preserved");
assert.match(effectiveAccess, /Design & Artwork/, "effective access label must include Design & Artwork");

assert.match(frontendAccess, /getDesignArtworkEffectiveAccess/, "frontend effective-access service must expose design_artwork");
assert.match(frontendAccess, /design_artwork/, "frontend service must request design_artwork exactly");

assert.match(main, /designArtworkEffectiveAccess/, "main UI must track design_artwork effective access");
assert.match(main, /getDesignArtworkEffectiveAccess/, "main UI must load design_artwork effective access");
assert.match(main, /canViewInquiriesRoute\(\)[\s\S]*designArtworkEffectiveAccess/, "existing Inquiries artwork entry path must account for design_artwork");
assert.doesNotMatch(main, /Design\s*&\s*Artwork["']?\s*,\s*path:/, "E5F must not create a standalone Design & Artwork route/sidebar item");

assert.match(artworkApi, /getEffectiveModuleAccess\(supabase, adminUser, "design_artwork"\)/, "artwork file API must consult canonical design_artwork access");
assert.match(artworkApi, /enforceTemporaryDesignArtworkBoundary/, "artwork file API must enforce temp design_artwork record boundary");
assert.match(artworkApi, /assigned_user_id[\s\S]*adminUser\?\.userId/, "artwork file API must stay assigned-record scoped");

assert.match(customerActionsApi, /DESIGN_ARTWORK_ACTIONS = new Set/, "customer action API must define narrow design_artwork action set");
for (const action of ["prepare_artwork_proof_upload", "finalize_artwork_proof_upload", "mark_artwork_under_review", "mark_artwork_usable", "publish_artwork"]) {
  assert.match(customerActionsApi, new RegExp(`"${action}"`), `${action} must be explicitly allowed for temp design_artwork`);
}
const actionSet = customerActionsApi.match(/DESIGN_ARTWORK_ACTIONS = new Set\(\[[\s\S]*?\]\)/)?.[0] || "";
assert.doesNotMatch(actionSet, /approve_artwork|confirm_payment|require_payment|publish_quote|set_due_date|request_new_artwork/, "design_artwork temporary actions must exclude approval, payment, quote, due-date, and destructive reset authority");
assert.match(customerActionsApi, /ARTWORK_APPROVAL_ROLES = new Set\(\["owner", "admin"\]\)/, "artwork approval must remain Owner/Admin-only");
assert.match(customerActionsApi, /DESIGN_ARTWORK_ASSETS = new Set\(\["customer-artwork", "artwork-proof"\]\)/, "design_artwork asset reads must exclude payment proof");
assert.match(customerActionsApi, /enforceTemporaryDesignArtworkBoundary/, "customer action API must enforce temp design_artwork record/action boundary");
assert.match(customerActionsApi, /Approved artwork is restricted/, "temporary design_artwork actions must not override approved/final artwork");

assert.match(migration, /has_active_employee_temporary_access\('design_artwork'\)/, "RLS must recognize active design_artwork grants");
assert.match(migration, /assigned_user_id = \(select auth\.uid\(\)\)/, "design_artwork RLS read must stay assigned-user scoped");
assert.doesNotMatch(migration, /for update[\s\S]*design_artwork/i, "design_artwork must not create broad update RLS");
assert.doesNotMatch(migration, /storage\.objects[\s\S]*(insert|update|delete)/i, "design_artwork must not open storage object writes directly");

assert.equal(packageJson.scripts["test:employee-e5f"], "node scripts/test-employee-e5f.mjs", "package script test:employee-e5f missing");
assert.equal(packageJson.scripts["test:employee-e5f-runtime"], "node scripts/test-employee-e5f-runtime.mjs", "package script test:employee-e5f-runtime missing");

console.log("PASS Employee E5F source contract: canonical design_artwork access, existing artwork surface, assigned boundary, and approval/payment isolation");

function read(path) {
  return fs.readFileSync(path, "utf8");
}
