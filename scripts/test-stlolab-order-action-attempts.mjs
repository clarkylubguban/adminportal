import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createOrderActionAttemptStore } from "../src/services/orderActionAttempts.js";

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

const main = readFileSync("src/main.js", "utf8");
assert.match(main, /retailOrderActionAttempts\.getKey\(retailOrder\.id, action, attemptPayload\)/, "payment must use the persisted attempt key");
assert.match(main, /retailOrderActionAttempts\.getKey\(retailOrder\.id, attemptAction\)/, "handover must use the persisted attempt key");
assert.equal(main.includes("orderActionKey("), false, "per-click retail order keys must not remain active");

console.log("PASS STLOLAB Admin order action keys persist across retries and rotate only for changed or completed attempts");
