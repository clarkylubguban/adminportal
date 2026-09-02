import assert from "node:assert/strict";
import fs from "node:fs";
import {
  TEMPORARY_ACCESS_MODULES,
  UNAVAILABLE_TEMPORARY_ACCESS_MODULES,
  validateModuleCodes,
} from "../api/_lib/employeeTemporaryAccess.js";
import { employeeTemporaryAccessModules } from "../src/services/adminEmployeeTemporaryAccess.js";

const verifiedModules = [
  "calendar",
  "workboard",
  "master_catalog",
  "inquiries",
  "orders",
  "production",
  "design_artwork",
  "inventory",
  "purchasing_suppliers",
  "pos_sales",
];

const parkedModules = ["pricing_discounts", "people_access"];
const serverCodes = new Set(TEMPORARY_ACCESS_MODULES.map(([code]) => code));
const uiByCode = new Map(employeeTemporaryAccessModules.map((item) => [item.code, item]));
const main = fs.readFileSync("src/main.js", "utf8");
const service = fs.readFileSync("src/services/adminEmployeeTemporaryAccess.js", "utf8");
const styles = fs.readFileSync("src/employeeE1.css", "utf8");

for (const moduleCode of verifiedModules) {
  assert.equal(serverCodes.has(moduleCode), true, `${moduleCode} must remain in the server module set.`);
  assert.equal(uiByCode.has(moduleCode), true, `${moduleCode} must remain selectable in Authorize for Today.`);
  assert.equal(uiByCode.get(moduleCode).unavailableReason, undefined, `${moduleCode} must not be marked unavailable.`);
  assert.equal(validateModuleCodes([moduleCode], { role: "admin" }).ok, true, `${moduleCode} must remain grantable by Admin.`);
}

for (const moduleCode of parkedModules) {
  const uiModule = uiByCode.get(moduleCode);
  assert.ok(uiModule, `${moduleCode} must stay visible as a parked protected option.`);
  assert.equal(uiModule.protected, true, `${moduleCode} must keep the protected badge.`);
  assert.equal(typeof uiModule.unavailableReason, "string", `${moduleCode} must show an unavailable reason.`);
  assert.equal(UNAVAILABLE_TEMPORARY_ACCESS_MODULES.has(moduleCode), true, `${moduleCode} must be server-unavailable.`);
  assert.equal(validateModuleCodes([moduleCode], { role: "owner" }).ok, false, `${moduleCode} must be rejected for Owner.`);
  assert.equal(validateModuleCodes([moduleCode], { role: "admin" }).ok, false, `${moduleCode} must be rejected for Admin.`);
}

assert.ok(service.includes("Not available yet"), "Pricing parked copy must be in the selector metadata.");
assert.ok(service.includes("Not available for temporary access"), "People Access parked copy must be in the selector metadata.");
assert.ok(main.includes("item.unavailableReason") && main.includes("is-unavailable"), "UI must render parked modules as unavailable.");
assert.ok(styles.includes(".employee-temp-module-option.is-unavailable"), "Unavailable module styling must exist.");
assert.ok(!main.includes("pricingEffectiveAccess") && !main.includes("peopleAccessEffectiveAccess"), "E5J0 must not add temporary enforcement for parked modules.");

console.log("PASS: Employee E5J0 protected module closure audit");
