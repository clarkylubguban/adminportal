import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createOrderActionAttemptStore } from "../src/services/orderActionAttempts.js";
import { isStlolabAcceptanceKeyControlEnabled } from "../src/services/stlolabAcceptanceKeys.js";

const values = new Map();
const storage = {
  getItem: (key) => values.get(key) || null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
};
let sequence = 0;
const attempts = createOrderActionAttemptStore({
  storage,
  randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
});

const payment = { amountReceived: 790, paymentSource: "cash", paymentReference: "TEST-PAY-01", internalNote: "Staging fixture" };
const first = attempts.getKey("order-1", "confirm-payment", payment);
assert.equal(attempts.getKey("order-1", "confirm-payment", payment), first, "an uncertain payment retry must reuse its key");

const changed = attempts.getKey("order-1", "confirm-payment", { ...payment, paymentReference: "TEST-PAY-02" });
assert.notEqual(changed, first, "a changed payment payload must start a new attempt");
assert.equal(attempts.getKey("order-1", "confirm-payment", { ...payment, paymentReference: "TEST-PAY-02" }), changed);

const handover = attempts.getKey("order-1", "customer-pickup");
assert.equal(attempts.getKey("order-1", "customer-pickup"), handover, "an uncertain handover retry must reuse its key");
attempts.clear("order-1", "customer-pickup", "another-key");
assert.equal(attempts.getKey("order-1", "customer-pickup"), handover, "a stale response cannot clear a newer attempt");
attempts.clear("order-1", "customer-pickup", handover);
assert.notEqual(attempts.getKey("order-1", "customer-pickup"), handover, "a verified response clears the completed attempt");

const reloaded = createOrderActionAttemptStore({ storage, randomUUID: () => "ffffffff-ffff-4fff-8fff-ffffffffffff" });
assert.equal(reloaded.getKey("order-1", "confirm-payment", { ...payment, paymentReference: "TEST-PAY-02" }), changed, "session reload preserves the active retry key");

const exactPayment = { ...payment, paymentReference: "SW3-TEST-PICKUP-PAYMENT-01" };
const exactKey = "SW3-BATCH-PICKUP-L-PAY-01";
assert.equal(attempts.getKey("order-2", "confirm-payment", exactPayment, exactKey), exactKey);
assert.equal(reloaded.getKey("order-2", "confirm-payment", exactPayment), exactKey, "reload reuses the exact UI-supplied key");
assert.throws(() => reloaded.getKey("order-2", "confirm-payment", { ...exactPayment, paymentReference: "changed" }, exactKey), /another action payload/);
assert.throws(() => attempts.getKey("order-3", "customer-pickup", {}, "short"), /16-120/);
const blockedStorage = { getItem: () => null, setItem: () => { throw new Error("blocked"); }, removeItem: () => {} };
const blockedAttempts = createOrderActionAttemptStore({ storage: blockedStorage, randomUUID: () => "10000000-0000-4000-8000-000000000001" });
assert.throws(() => blockedAttempts.getKey("order-4", "customer-pickup", {}, "SW3-BATCH-PICKUP-L-HANDOVER-01"), /persistent retry storage/);
assert.match(blockedAttempts.getKey("order-4", "customer-pickup"), /^admin-retail-customer-pickup-/i, "automatic behavior retains its in-memory fallback");
assert.equal(isStlolabAcceptanceKeyControlEnabled({ VITE_APP_ENV: "staging", VITE_STLO_ACCEPTANCE_KEYS_ENABLED: "true" }), true);
assert.equal(isStlolabAcceptanceKeyControlEnabled({ VITE_APP_ENV: "production", VITE_STLO_ACCEPTANCE_KEYS_ENABLED: "true" }), false);
assert.equal(isStlolabAcceptanceKeyControlEnabled({ VITE_APP_ENV: "staging", VITE_STLO_ACCEPTANCE_KEYS_ENABLED: "false" }), false);

const main = readFileSync("src/main.js", "utf8");
assert.match(main, /retailOrderActionAttempts\.getKey\(retailOrder\.id, action, attemptPayload, form\.acceptanceIdempotencyKey\)/, "payment must use the persisted attempt key and optional staging control");
assert.match(main, /retailOrderActionAttempts\.getKey\(retailOrder\.id, attemptAction, \{\}, changes\?\.acceptanceIdempotencyKey\)/, "handover must use the persisted attempt key and optional staging control");
assert.match(main, /isStlolabAcceptanceKeyControlEnabled\(window\.TRRY_ADMIN_ENV\)/, "acceptance fields must be gated by the exact staging environment helper");
assert.equal(main.includes("orderActionKey("), false, "per-click retail order keys must not remain active");

console.log("PASS STLOLAB Admin order action keys persist across retries and rotate only for changed or completed attempts");
