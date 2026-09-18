export const STLOLAB_ACCEPTANCE_KEY_PATTERN = /^[A-Za-z0-9_-]{16,120}$/;

export function isStlolabAcceptanceKeyControlEnabled(env = {}) {
  return String(env.VITE_APP_ENV || "").trim().toLowerCase() === "staging"
    && String(env.VITE_STLO_ACCEPTANCE_KEYS_ENABLED || "").trim().toLowerCase() === "true";
}

export function normalizeStlolabAcceptanceKey(value) {
  const key = String(value || "").trim();
  if (!key) return "";
  if (!STLOLAB_ACCEPTANCE_KEY_PATTERN.test(key)) throw new Error("Staging acceptance key must be 16-120 letters, numbers, underscores, or hyphens.");
  return key;
}
