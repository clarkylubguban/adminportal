import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizePhilippineMobile, validateCustomerIdentityDraft } from "../src/services/adminCustomers.js";

const main = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../supabase/migrations/20260831021438_add_customer_identity_c1.sql", import.meta.url), "utf8");

assert.equal(normalizePhilippineMobile("0917 123 4567"), "+639171234567");
assert.equal(normalizePhilippineMobile("+63 917 123 4567"), "+639171234567");
assert.equal(normalizePhilippineMobile("9171234567"), "+639171234567");
assert.equal(normalizePhilippineMobile("12345"), "");
assert.equal(validateCustomerIdentityDraft({ fullName: "", mobile: "09171234567" }), "Full name is required.");
assert.equal(validateCustomerIdentityDraft({ fullName: "Juan", mobile: "123" }), "Enter a valid Philippine mobile number.");
assert.equal(validateCustomerIdentityDraft({ fullName: "Juan", mobile: "09171234567" }), "");

for (const contract of ["/customers", "renderCustomersPage", "No customer records yet", "EXISTING CUSTOMER FOUND", "Customer created", "Customer identity record"]) {
  assert.ok(main.includes(contract), `missing Customers UI contract: ${contract}`);
}
assert.ok(main.includes("validationMessage ?"), "validation messages must render while Save is disabled");
assert.ok(main.includes('customerDraft.firstSource === "POS_WALK_IN" ? "selected" : ""'), "first source selection must persist across rerenders");
for (const forbidden of ["lifetime spend", "loyalty points", "ADD BENEFIT"]) {
  assert.ok(!main.toLowerCase().includes(forbidden.toLowerCase()), `C1 UI leaked later-phase copy: ${forbidden}`);
}
assert.ok(styles.includes(".customers-page"), "Customers page styles missing");
assert.ok(styles.includes("@media(max-width:700px)"), "Customers mobile contract missing");
assert.ok(migration.includes("new.created_by_user_id := v_actor_user_id"), "audit user must come from auth.uid()");
assert.ok(!migration.includes("new.created_by_user_id := coalesce(new.created_by_user_id"), "caller-supplied creator spoof path remains");

console.log("Customer C1 UI and identity source contracts passed.");
