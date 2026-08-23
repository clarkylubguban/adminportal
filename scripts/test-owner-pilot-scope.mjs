import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile("src/main.js", "utf8");
const env = await readFile("src/env.js", "utf8");
const localDev = await readFile("scripts/local-dev.mjs", "utf8");

const routeBlock = matchBlock(/const routes = \{([\s\S]*?)\n\};/, "routes");
const sidebarBlock = matchBlock(/function renderSidebar\(currentRoute\) \{([\s\S]*?)\n\}/, "desktop sidebar");
const mobileNavBlock = matchBlock(/function renderMobileBottomNav\(currentRoute\) \{([\s\S]*?)\n\}/, "mobile nav");
const searchHintBlock = matchBlock(/function renderGlobalSearchHint\(\) \{([\s\S]*?)\n\}/, "search hint");
const searchRouteBlock = matchBlock(/function getSearchRoute\(value\) \{([\s\S]*?)\n\}/, "search route");
const getRoutePathBlock = matchBlock(/function getRoutePath\(\) \{([\s\S]*?)\n\}/, "route guard");
const normalizeRoutePathBlock = matchBlock(/function normalizeRoutePath\(path\) \{([\s\S]*?)\n\}/, "route normalizer");

for (const route of ["/", "/overview", "/inquiries", "/orders", "/production", "/workboard", "/calendar", "/catalog", "/catalog/brands", "/catalog/categories", "/catalog/inventory"]) {
  assert.ok(routeBlock.includes(`"${route}"`), `approved route missing: ${route}`);
}

assert.ok(main.includes('const legacyOrderDashboardPath = "/order-dashboard"'), "legacy order dashboard redirect path missing");

for (const label of ["Overview", "Inquiries", "Orders", "Production"]) {
  assert.ok(sidebarBlock.includes(`label: "${label}"`), `approved desktop nav missing: ${label}`);
  assert.ok(mobileNavBlock.includes(`label: "${label}"`), `approved mobile nav missing: ${label}`);
}

for (const label of ["Products", "Brands", "Categories", "Inventory"]) {
  assert.ok(sidebarBlock.includes(`label: "${label}"`), `approved catalog desktop nav missing: ${label}`);
}

for (const parkedSupply of [
  '{ label: "Suppliers", path: "/catalog/suppliers", icon: "truck", disabled: true }',
  '{ label: "Purchasing", path: "/catalog/purchasing", icon: "shopping-cart", disabled: true }',
]) {
  assert.ok(sidebarBlock.includes(parkedSupply), `parked supply desktop disabled nav missing: ${parkedSupply}`);
}

assert.ok(sidebarBlock.includes("canViewWorkboardRoute() ?"), "Workboard desktop nav must be feature gated");
assert.ok(mobileNavBlock.includes("canViewWorkboardRoute() ?"), "Workboard mobile nav must be feature gated");
assert.ok(sidebarBlock.includes("canViewCalendarRoute() ?"), "Calendar desktop nav must be feature gated");
assert.ok(mobileNavBlock.includes("canViewCalendarRoute() ?"), "Calendar mobile nav must be feature gated");

for (const parked of ["Clients", "Staff", "Settings", "Reports"]) {
  assert.equal(sidebarBlock.includes(`label: "${parked}"`), false, `parked desktop nav leaked: ${parked}`);
  assert.equal(mobileNavBlock.includes(parked), false, `parked mobile nav leaked: ${parked}`);
  assert.equal(searchHintBlock.includes(parked), false, `parked search hint leaked: ${parked}`);
}

for (const parked of ["Suppliers", "Purchasing"]) {
  assert.equal(mobileNavBlock.includes(parked), false, `parked mobile nav leaked: ${parked}`);
  assert.equal(searchHintBlock.includes(parked), false, `parked search hint leaked: ${parked}`);
}

assert.ok(main.includes('placeholder="Search orders..."'), "global search should advertise only orders");
for (const parkedSearchCopy of ["Search orders, clients, products", "clients, products"]) {
  assert.equal(sidebarBlock.includes(parkedSearchCopy), false, `parked global search copy leaked: ${parkedSearchCopy}`);
}

for (const parkedPath of ["/clients", "/staff", "/settings", "/reorders", "/catalog/suppliers", "/catalog/purchasing"]) {
  assert.equal(routeBlock.includes(`"${parkedPath}"`), false, `parked route registered: ${parkedPath}`);
  assert.equal(localDev.includes(`"${parkedPath}"`), false, `parked local route registered: ${parkedPath}`);
  assert.equal(searchHintBlock.includes(parkedPath), false, `parked search hint path leaked: ${parkedPath}`);
  assert.equal(searchRouteBlock.includes(parkedPath), false, `parked search route leaked: ${parkedPath}`);
  assert.equal(main.includes(`data-route-target="${parkedPath}"`), false, `parked shortcut target leaked: ${parkedPath}`);
  assert.equal(main.includes(`navigateTo("${parkedPath}"`), false, `parked navigation shortcut leaked: ${parkedPath}`);
}

assert.ok(getRoutePathBlock.includes('path === "/workboard" && !canViewWorkboardRoute()'), "Workboard direct route guard missing");
assert.ok(normalizeRoutePathBlock.includes('routePath === "/workboard" && !canViewWorkboardRoute()'), "Workboard normalizer guard missing");
assert.ok(getRoutePathBlock.includes('path === "/calendar" && !canViewCalendarRoute()'), "Calendar direct route guard missing");
assert.ok(normalizeRoutePathBlock.includes('routePath === "/calendar" && !canViewCalendarRoute()'), "Calendar normalizer guard missing");
assert.ok(getRoutePathBlock.includes('path === "/my-tasks" && !canViewMyTasksRoute()'), "My Tasks direct route guard missing");
assert.ok(normalizeRoutePathBlock.includes('routePath === "/my-tasks" && !canViewMyTasksRoute()'), "My Tasks normalizer guard missing");

assert.ok(main.includes("VITE_ENABLE_TASK_DOMAIN"), "Task Domain UI flag missing");
assert.ok(main.includes("VITE_ENABLE_WORKBOARD"), "Workboard UI flag missing");
assert.ok(main.includes("VITE_ENABLE_CALENDAR"), "Calendar UI flag missing");
assert.ok(main.includes("VITE_ENABLE_MY_TASKS"), "My Tasks UI flag missing");
assert.ok(env.includes('VITE_ENABLE_MY_TASKS: "false"'), "My Tasks must default off for Owner pilot");
assert.ok(env.includes('VITE_ENABLE_AUTO_PLAN_TODAY: "false"'), "Auto Plan must default off for Owner pilot");

process.stdout.write("PASS Owner-pilot UI scope, parked routes, search, and feature guards\n");

function matchBlock(pattern, label) {
  const match = main.match(pattern);
  assert.ok(match, `missing ${label} block`);
  return match[0];
}
