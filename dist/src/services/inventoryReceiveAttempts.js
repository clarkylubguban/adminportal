const DRAFT_STORAGE_KEY = "trry-admin-inventory-receive-draft-v1";
const ATTEMPT_STORAGE_PREFIX = "trry-admin-inventory-receive-attempt-v1";
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,120}$/;

function attemptStorageKey(idempotencyKey) {
  return `${ATTEMPT_STORAGE_PREFIX}:${idempotencyKey}`;
}

function payloadFingerprint(payload) {
  return JSON.stringify({
    locationId: String(payload?.locationId || "").trim(),
    variantId: String(payload?.variantId || "").trim(),
    quantity: Number(payload?.quantity || 0),
    sourceReference: String(payload?.sourceReference || "").trim(),
    reason: String(payload?.reason || "").trim(),
  });
}

export function validateInventoryReceiveIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new Error("Idempotency key must be 16-120 letters, numbers, underscores, or hyphens.");
  }
  return key;
}

export function createInventoryReceiveAttemptStore(storage) {
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
      // The in-memory copy still preserves retry safety for this page load.
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
    loadDraft() {
      const draft = read(DRAFT_STORAGE_KEY);
      return draft?.open === true ? { ...draft, status: "idle", error: "" } : null;
    },

    saveDraft(draft) {
      write(DRAFT_STORAGE_KEY, { ...draft, status: "idle", error: "" });
    },

    clearDraft() {
      remove(DRAFT_STORAGE_KEY);
    },

    claim(idempotencyKey, payload) {
      const key = validateInventoryReceiveIdempotencyKey(idempotencyKey);
      const storageKey = attemptStorageKey(key);
      const fingerprint = payloadFingerprint(payload);
      const existing = read(storageKey);
      if (existing?.fingerprint && existing.fingerprint !== fingerprint) {
        throw new Error("This idempotency key is already assigned to different receive details.");
      }
      write(storageKey, { idempotencyKey: key, fingerprint });
      return key;
    },
  };
}

