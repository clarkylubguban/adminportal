import fs from "node:fs";

const main = fs.readFileSync("src/main.js", "utf8");
const localDev = fs.readFileSync("scripts/local-dev.mjs", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("src/employeeE1.css", "utf8");
const build = fs.readFileSync("scripts/build.mjs", "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(main.includes('"/settings": "Settings"'), "Missing /settings route.");
assert(main.includes('"/settings/people-access": "Settings"'), "Missing /settings/people-access route.");
assert(main.includes('currentRoute === "Settings"') && main.includes("renderPeopleAccessEmployeesPage()"), "Settings render branch missing.");
assert(main.includes('label: "Employee Access", path: "/settings/people-access", icon: "settings"'), "Employee Access sidebar nav must use settings icon.");
assert(main.includes("function renderPeopleAccessEmployeesPage()"), "Employee page renderer missing.");

for (const header of ["EMPLOYEE", "ROLE", "STATUS", "LAST LOGIN", "ACCESS", "ACTION"]) {
  assert(main.includes(`<span>${header}</span>`) || main.includes(header), `Missing table header ${header}.`);
}

assert(main.includes('let employeeQuery = ""'), "Employee search state missing.");
assert(main.includes('let employeeRoleFilter = "all"'), "Employee role filter state missing.");
assert(main.includes('let employeeStatusFilter = "active"'), "Employee status filter state missing.");
assert(main.includes("function getVisibleEmployeeUsers()") && main.includes("return staffUsers.filter"), "Employee filters must use staffUsers.");
assert(main.includes("const activeUsers = staffUsers.filter") && main.includes("new Set(activeUsers.map"), "Employee KPIs must derive from staffUsers.");

const rendererStart = main.indexOf("function renderPeopleAccessEmployeesPage()");
const rendererEnd = main.indexOf("function renderEmployeeKpiCard", rendererStart);
const renderer = main.slice(rendererStart, rendererEnd);
for (const forbidden of ["TEMP ·", "REVOKE NOW", "TEMPORARY ACCESS ACTIVE", "Authorize for Today"]) {
  assert(!renderer.includes(forbidden), `Temporary access UI leaked into E1 renderer: ${forbidden}`);
}

assert(main.includes('staffApiRequest("/api/admin-users", { method: "GET" })'), "Existing /api/admin-users lifecycle must remain used.");
assert(localDev.includes('"/settings"') && localDev.includes('"/settings/people-access"'), "Local dev direct Settings routes missing.");
assert(html.includes('/src/employeeE1.css'), "index.html must load employeeE1.css.");
assert(css.includes(".people-access-page"), "Employee E1 CSS class missing.");
assert(!renderer.includes("clark@trry.local") && !renderer.includes("Louvelyngel") && !renderer.includes("rachelle@trry.local"), "E1 renderer must not introduce sample employee rows.");
assert(renderer.includes("Roles &amp; Permissions") && renderer.includes("disabled aria-disabled=\"true\""), "Roles & Permissions must be parked/non-interactive.");
assert(build.includes('await cp("src", "dist/src", { recursive: true })'), "Build must still copy all source files.");
assert(main.includes("formatEmployeeLastLogin") && main.includes("Asia/Manila") && main.includes("lastSignInAt"), "Last Login must use lastSignInAt in Asia/Manila.");
assert(main.includes("canViewSettingsRoute") && main.includes("canManageStaffAccounts"), "Settings route must reuse Owner/Admin management gate.");

console.log("PASS: Employee E1 foundation guard");
