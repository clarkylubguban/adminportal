import assert from "node:assert/strict";
import {
  PRODUCTION_SUPABASE_PROJECT_REF,
  STAGING_SUPABASE_PROJECT_REF,
  assertInventoryWriteProject,
  receiveAdminInventoryStock,
} from "../src/services/adminInventory.js";
import {
  createInventoryReceiveAttemptStore,
  validateInventoryReceiveIdempotencyKey,
} from "../src/services/inventoryReceiveAttempts.js";

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;

function configure(environment, projectRef) {
  globalThis.window = {
    TRRY_ADMIN_ENV: {
      VITE_APP_ENV: environment,
      VITE_SUPABASE_URL: `https://${projectRef}.supabase.co`,
      VITE_SUPABASE_ANON_KEY: "test-anon-key",
      VITE_USE_SUPABASE_DATA: "true",
    },
  };
}

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

try {
  configure("staging", STAGING_SUPABASE_PROJECT_REF);
  assert.doesNotThrow(() => assertInventoryWriteProject(), "Configured staging project must be allowed");
  configure("production", PRODUCTION_SUPABASE_PROJECT_REF);
  assert.doesNotThrow(() => assertInventoryWriteProject(), "Configured production project must remain allowed");

  for (const [environment, projectRef] of [
    ["staging", PRODUCTION_SUPABASE_PROJECT_REF],
    ["production", STAGING_SUPABASE_PROJECT_REF],
    ["staging", "unknownprojectref0000"],
    ["qa", STAGING_SUPABASE_PROJECT_REF],
    ["", STAGING_SUPABASE_PROJECT_REF],
  ]) {
    configure(environment, projectRef);
    assert.throws(() => assertInventoryWriteProject(), /Inventory .*writes require|VITE_APP_ENV/, `${environment || "missing"} must reject ${projectRef}`);
  }

  const storage = new MemoryStorage();
  const exactKey = "SW3-BATCH-RECEIVE-L2-01";
  const payload = {
    locationId: "9cc81235-0af3-4ad6-aa95-35af81178312",
    variantId: "86d11ac3-efc1-4778-a768-809603a67745",
    quantity: 2,
    sourceReference: "SW3-STAGING-BATCH-L2-RECEIVE-01",
    reason: "SW3 remaining acceptance test stock",
  };
  const store = createInventoryReceiveAttemptStore(storage);
  assert.equal(validateInventoryReceiveIdempotencyKey(exactKey), exactKey, "Approved receipt key must be accepted exactly");
  assert.equal(validateInventoryReceiveIdempotencyKey("SW3-BATCH-RECEIVE-XL1-01"), "SW3-BATCH-RECEIVE-XL1-01", "Approved XL receipt key must be accepted exactly");
  assert.throws(() => validateInventoryReceiveIdempotencyKey("short"), /16-120/, "Short retry keys must be rejected");

  store.saveDraft({ open: true, mode: "row", rowId: `${payload.variantId}:${payload.locationId}`, quantity: "2", sourceReference: payload.sourceReference, reason: payload.reason, idempotencyKey: exactKey, status: "saving", error: "old" });
  const reloadedStore = createInventoryReceiveAttemptStore(storage);
  assert.deepEqual(reloadedStore.loadDraft(), {
    open: true,
    mode: "row",
    rowId: `${payload.variantId}:${payload.locationId}`,
    quantity: "2",
    sourceReference: payload.sourceReference,
    reason: payload.reason,
    idempotencyKey: exactKey,
    status: "idle",
    error: "",
  }, "Receive draft and exact retry key must survive a page reload");

  assert.equal(store.claim(exactKey, payload), exactKey, "First exact-key claim must succeed");
  assert.equal(reloadedStore.claim(exactKey, { ...payload }), exactKey, "Same payload retry after reload must reuse the exact key");
  assert.throws(() => reloadedStore.claim(exactKey, { ...payload, quantity: 1 }), /different receive details/, "Conflicting payload reuse must be rejected");

  configure("staging", STAGING_SUPABASE_PROJECT_REF);
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return { ok: true, status: 200, text: async () => JSON.stringify({ movementId: "movement-1", idempotent: requests.length > 1, balanceAfter: 2 }) };
  };

  await assert.rejects(() => receiveAdminInventoryStock({ ...payload, idempotencyKey: exactKey }, null), /auth session is required/i, "Unauthenticated receive must be denied before RPC");
  assert.equal(requests.length, 0, "Unauthorized receive must not call the canonical RPC");

  await receiveAdminInventoryStock({ ...payload, idempotencyKey: exactKey }, { access_token: "owner-admin-token" });
  await receiveAdminInventoryStock({ ...payload, idempotencyKey: exactKey }, { access_token: "owner-admin-token" });
  assert.equal(requests.length, 2, "An uncertain retry must reach the same canonical idempotent RPC");
  for (const request of requests) {
    assert.ok(request.url.endsWith("/rest/v1/rpc/receive_inventory"), "Only canonical receive_inventory may be called");
    assert.equal(request.options.headers.Authorization, "Bearer owner-admin-token", "Real authenticated Admin token must be preserved");
    assert.equal(request.options.headers["Content-Profile"], "trry_api", "Canonical trry_api schema must be preserved");
    assert.equal(JSON.parse(request.options.body).p_idempotency_key, exactKey, "Every retry must carry the exact approved key");
  }

  configure("production", STAGING_SUPABASE_PROJECT_REF);
  await assert.rejects(() => receiveAdminInventoryStock({ ...payload, idempotencyKey: exactKey }, { access_token: "owner-admin-token" }), /production Supabase project/, "Mismatched production configuration must fail closed");
  assert.equal(requests.length, 2, "Project mismatch must be rejected before RPC");

  console.log("PASS SW3 Admin Receive Stock environment, auth, exact-key retry, reload, and conflict controls");
} finally {
  globalThis.window = originalWindow;
  globalThis.fetch = originalFetch;
}

