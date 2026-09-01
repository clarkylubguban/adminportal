import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const main = readFileSync(join(root, "src", "main.js"), "utf8");
const styles = readFileSync(join(root, "src", "styles.css"), "utf8");

const sidebarStart = main.indexOf("function renderSidebar(currentRoute)");
const sidebarEnd = main.indexOf("function getAdminDisplayName", sidebarStart);
assert.ok(sidebarStart >= 0 && sidebarEnd > sidebarStart, "renderSidebar source must be discoverable");
const sidebar = main.slice(sidebarStart, sidebarEnd);

const bindStart = main.indexOf("function bindEvents()");
assert.ok(bindStart >= 0, "bindEvents source must be discoverable");
const bindEvents = main.slice(bindStart);

const activeChildStart = styles.indexOf(".sidebar a.sidebar-group-child.active,");
const activeChildEnd = styles.indexOf(".sidebar a.sidebar-group-child.active::before", activeChildStart);
assert.ok(activeChildStart >= 0 && activeChildEnd > activeChildStart, "Active child styles must be discoverable");
const activeChildStyles = styles.slice(activeChildStart, activeChildEnd);

const masterOrder = ["Products", "Brands", "Categories"].map((label) => sidebar.indexOf(`{ label: "${label}"`));
const supplyOrder = ["Suppliers", "Purchasing", "Inventory"].map((label) => sidebar.indexOf(`{ label: "${label}"`));

const checks = [
  ["Settings route registered", main.includes('"/settings": "Settings"')],
  ["Master Catalog route family declared", main.includes('const MASTER_CATALOG_PATHS = ["/catalog", "/catalog/brands", "/catalog/categories"]')],
  ["Supply & Inventory route family declared", main.includes('const SUPPLY_INVENTORY_PATHS = ["/catalog/suppliers", "/catalog/purchasing", "/catalog/inventory"]')],
  ["Master Catalog parent exists", sidebar.includes('label: "Master Catalog"') && sidebar.includes('key: "master-catalog"')],
  ["Supply & Inventory parent exists", sidebar.includes('label: "Supply & Inventory"') && sidebar.includes('key: "supply-inventory"')],
  ["Parent rows are buttons", sidebar.includes('class="sidebar-group-toggle') && sidebar.includes('data-sidebar-group-toggle="${key}"')],
  ["No parent chevron", !sidebar.includes("chevron-down") && !sidebar.includes("chevron-right") && !sidebar.includes("catalog-nav-chevron")],
  ["Master Catalog children ordered", masterOrder.every((index) => index >= 0) && masterOrder.every((index, i) => i === 0 || index > masterOrder[i - 1])],
  ["Supply children ordered", supplyOrder.every((index) => index >= 0) && supplyOrder.every((index, i) => i === 0 || index > supplyOrder[i - 1])],
  ["Settings appears after workflows", sidebar.includes('{ label: "Settings", path: "/settings/people-access", icon: "settings", activePaths: ["/settings", "/settings/people-access"] }')],
  ["Legacy Catalog & Supply heading removed", !sidebar.includes("CATALOG &amp; SUPPLY") && !sidebar.includes("sidebar-section-label")],
  ["Group toggle binding exists", bindEvents.includes('data-sidebar-group-toggle') && bindEvents.includes('master-catalog') && bindEvents.includes('supply-inventory')],
  ["Parent rows open their landing routes", bindEvents.includes('group === "master-catalog" ? "/catalog" : "/catalog/suppliers"') && bindEvents.includes("navigateTo(targetPath)")],
  ["Leaving a group clears manual expansion", bindEvents.includes("MASTER_CATALOG_PATHS.includes(targetPath)") && bindEvents.includes("SUPPLY_INVENTORY_PATHS.includes(targetPath)")],
  ["Settings renders Employee People & Access page", main.includes('currentRoute === "Settings"') && main.includes("renderPeopleAccessEmployeesPage()")],
  ["Figma parent height", styles.includes(".sidebar .sidebar-group-toggle") && styles.includes("min-height: 44px")],
  ["Figma child height", styles.includes(".sidebar .sidebar-group-child") && styles.includes("min-height: 32px")],
  ["Active parent has lime rail", styles.includes(".sidebar .sidebar-group-toggle.active::before") && styles.includes("height: 22px")],
  ["Active child uses text highlight only", activeChildStyles.includes("background: transparent") && activeChildStyles.includes("box-shadow: none") && activeChildStyles.includes("color: var(--trry-lime")],
  ["Grouped sidebar marker exists", styles.includes("TRRY GROUPED SIDEBAR — FIGMA SOURCE OF TRUTH")],
];

const failures = checks.filter(([, pass]) => !pass).map(([label]) => label);
checks.forEach(([label, pass]) => console.log(`${pass ? "PASS" : "FAIL"} ${label}`));
assert.deepEqual(failures, [], `Grouped sidebar checks failed: ${failures.join(", ")}`);
console.log("PASS grouped sidebar navigation source-of-truth");
