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
    } catch {
      // Session storage can be unavailable in hardened browser contexts.
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
    getKey(orderId, action, payload = {}) {
      const key = storageKey(orderId, action);
      const fingerprint = payloadFingerprint(payload);
      const existing = read(key);
      if (existing?.fingerprint === fingerprint && existing?.idempotencyKey) {
        return existing.idempotencyKey;
      }

      const idempotencyKey = `admin-retail-${action}-${randomUUID()}`;
      write(key, { fingerprint, idempotencyKey });
      return idempotencyKey;
    },

    clear(orderId, action, idempotencyKey) {
      const key = storageKey(orderId, action);
      const existing = read(key);
      if (!existing || existing.idempotencyKey === idempotencyKey) remove(key);
    },
  };
}
