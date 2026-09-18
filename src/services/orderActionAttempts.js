import { normalizeStlolabAcceptanceKey } from "./stlolabAcceptanceKeys.js";

const STORAGE_PREFIX = "trry-admin-order-action";

function storageKey(orderId, action) {
  return `${STORAGE_PREFIX}:${String(orderId)}:${String(action)}`;
}

function payloadFingerprint(payload) {
  return JSON.stringify(payload || {});
}

export function createOrderActionAttemptStore({ storage, randomUUID }) {
  const fallback = new Map();

  function read(key) {
    try {
      const value = storage?.getItem(key);
      return value ? JSON.parse(value) : fallback.get(key) || null;
    } catch {
      return fallback.get(key) || null;
    }
  }

  function write(key, value) {
    fallback.set(key, value);
    try {
      storage?.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      // Session storage can be unavailable in hardened browser contexts.
      return false;
    }
  }

  function remove(key) {
    fallback.delete(key);
    try {
      storage?.removeItem(key);
    } catch {
      // The in-memory copy was still cleared.
    }
  }

  return {
    getKey(orderId, action, payload = {}, requestedKey = "") {
      const key = storageKey(orderId, action);
      const fingerprint = payloadFingerprint(payload);
      const existing = read(key);
      const acceptedKey = normalizeStlolabAcceptanceKey(requestedKey);
      if (existing?.fingerprint === fingerprint && existing?.idempotencyKey) {
        if (acceptedKey && existing.idempotencyKey !== acceptedKey) {
          throw new Error("This action already has a different retry key.");
        }
        return existing.idempotencyKey;
      }
      if (acceptedKey && existing?.idempotencyKey === acceptedKey && existing?.fingerprint && existing.fingerprint !== fingerprint) {
        throw new Error("This staging acceptance key is already bound to another action payload.");
      }

      const idempotencyKey = acceptedKey || `admin-retail-${action}-${randomUUID()}`;
      const persisted = write(key, { fingerprint, idempotencyKey });
      if (acceptedKey && !persisted) {
        fallback.delete(key);
        throw new Error("Staging acceptance keys require persistent retry storage.");
      }
      return idempotencyKey;
    },

    clear(orderId, action, idempotencyKey) {
      const key = storageKey(orderId, action);
      const existing = read(key);
      if (!existing || existing.idempotencyKey === idempotencyKey) remove(key);
    },
  };
}
