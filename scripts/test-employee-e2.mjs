import fs from "node:fs";

const main = fs.readFileSync("src/main.js", "utf8");
const apiIndex = fs.readFileSync("api/admin-users/index.js", "utf8");
const apiId = fs.readFileSync("api/_lib/adminUsersIdRoute.js", "utf8");
const packageJson = fs.readFileSync("package.json", "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(main.includes('staffApiRequest("/api/admin-users", {') && main.includes('method: "POST"'), "Invite must POST to /api/admin-users.");
assert(main.includes("body: { displayName: staffDraft.displayName.trim(), email: staffDraft.email.trim(), role: staffDraft.role }"), "Invite payload must use displayName, email, and role only.");
assert(main.includes("validateStaffDraft()") && main.includes("staffSaveError"), "Invite/edit validation and modal error handling must exist.");
assert(!main.includes("supabase.auth.admin") && !main.includes("inviteUserByEmail"), "Browser code must not call Supabase Admin Auth directly.");

assert(main.includes('method: "PATCH"') && main.includes('const body = { action: "update", displayName: nextDisplayName }'), "Edit must use PATCH action update with supported fields.");
const editStart = main.indexOf('const payload = await staffApiRequest(`/api/admin-users/${encodeURIComponent(staffEditingId)}`');
const editEnd = main.indexOf("} else {", editStart);
const editMutation = main.slice(editStart, editEnd);
assert(main.includes("body.role = nextRole") && !editMutation.includes("email") && main.includes("Email is read-only"), "Edit must not mutate employee email.");
assert(main.includes("await loadStaffUsers()"), "Lifecycle mutations must refresh canonical employee data.");

assert(main.includes("body: { action }") && main.includes('"disable"') && main.includes('"activate"'), "Activate/deactivate must use existing PATCH lifecycle actions.");
assert(main.includes("window.confirm") && main.includes("Deactivate"), "Deactivate must require confirmation.");
assert(!main.includes('method: "DELETE"'), "E2 must not add hard delete.");

assert(apiIndex.includes('.from("admin_users")') && apiId.includes('.from("admin_users")'), "Canonical admin_users identity must remain the API source.");
assert(apiIndex.includes("allowedCreateRole") && apiId.includes("allowedUpdateRole"), "Server role authorization helpers must remain in use.");
assert(apiId.includes("you cannot disable your own account"), "Self-disable protection must remain.");
assert(apiId.includes("last active owner cannot be disabled"), "Last active owner protection must remain.");

for (const forbidden of ["Roles & Permissions implementation"]) {
  assert(!main.includes(forbidden), `Out-of-scope employee feature leaked into source: ${forbidden}`);
}

for (const forbiddenTable of ["create table public.employees", "create table if not exists public.employees", "staff_profiles"]) {
  assert(!main.includes(forbiddenTable) && !apiIndex.includes(forbiddenTable) && !apiId.includes(forbiddenTable), `Duplicate employee identity model found: ${forbiddenTable}`);
}

assert(packageJson.includes('"test:employee-e2"'), "package.json must expose the E2 test script.");

console.log("PASS: Employee E2 lifecycle guard");
