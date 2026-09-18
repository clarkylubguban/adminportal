export const STLOLAB_ACCEPTANCE_KEY_PATTERN = /^[A-Za-z0-9_-]{16,120}$/;
const STLOLAB_ACCEPTANCE_KEY_NAMESPACE = /^SW3-BATCH-[A-Z0-9_-]{6,110}$/;

export function isStlolabAcceptanceKeyControlEnabled(env = {}) {
  return env.VITE_APP_ENV === "staging" && env.VITE_STLO_ACCEPTANCE_KEYS_ENABLED === "true";
}

export function isStlolabAcceptanceKey(value) {
  return STLOLAB_ACCEPTANCE_KEY_NAMESPACE.test(String(value || "").trim());
}

export function isStlolabAcceptanceKeyRequestAllowed(env, value) {
  return !isStlolabAcceptanceKey(value) || isStlolabAcceptanceKeyControlEnabled(env);
}

export function normalizeStlolabAcceptanceKey(value) {
  const key = String(value || "").trim();
  if (!key) return "";
  if (!STLOLAB_ACCEPTANCE_KEY_PATTERN.test(key) || !isStlolabAcceptanceKey(key)) {
    throw new Error("Staging acceptance key must use the SW3-BATCH- namespace and contain 16-120 uppercase letters, numbers, underscores, or hyphens.");
  }
  return key;
}
