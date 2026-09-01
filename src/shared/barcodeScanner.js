const DEFAULT_MIN_LENGTH = 4;
const DEFAULT_MAX_INTER_KEY_DELAY = 45;
const DEFAULT_STALE_BUFFER_MS = 250;
const ignoredKeys = new Set([
  "Alt",
  "AltGraph",
  "CapsLock",
  "Control",
  "Meta",
  "Shift",
  "Tab",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

export function normalizeBarcode(value) {
  return String(value ?? "").replace(/\s+/g, "").trim().toUpperCase();
}

export function isEditableScannerTarget(target) {
  const element = target?.nodeType === 1 ? target : null;
  if (!element) return false;
  if (element.closest?.("[data-barcode-scan-input], [data-scanner-allow-global]")) return false;
  if (element.isContentEditable) return true;
  const tag = String(element.tagName || "").toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag !== "input") return false;
  const type = String(element.getAttribute("type") || "text").toLowerCase();
  return !["button", "checkbox", "radio", "range", "submit", "reset"].includes(type);
}

export function createBarcodeScanner({
  onScan,
  onInvalid,
  enabled = true,
  minLength = DEFAULT_MIN_LENGTH,
  maxInterKeyDelay = DEFAULT_MAX_INTER_KEY_DELAY,
  staleBufferMs = DEFAULT_STALE_BUFFER_MS,
  target = globalThis.document,
} = {}) {
  let buffer = "";
  let lastKeyAt = 0;
  let attached = false;
  let candidateWasRapid = true;

  const reset = () => {
    buffer = "";
    lastKeyAt = 0;
    candidateWasRapid = true;
  };

  const isEnabled = () => typeof enabled === "function" ? enabled() !== false : enabled !== false;

  const commit = () => {
    const code = normalizeBarcode(buffer);
    const wasRapid = candidateWasRapid;
    reset();
    if (!wasRapid) return "";
    if (!code || code.length < minLength) {
      onInvalid?.(code);
      return "";
    }
    onScan?.(code);
    return code;
  };

  const feedKey = (key, event = {}) => {
    if (!isEnabled()) return "";
    if (event.ctrlKey || event.metaKey || event.altKey || ignoredKeys.has(key)) return "";
    if (isEditableScannerTarget(event.target)) return "";

    const now = Number(event.timeStamp || Date.now());
    if (lastKeyAt && now - lastKeyAt > staleBufferMs) buffer = "";

    if (key === "Enter") {
      return commit();
    }

    if (String(key || "").length !== 1) return "";

    if (lastKeyAt && now - lastKeyAt > maxInterKeyDelay && buffer.length > 0) {
      buffer = "";
      candidateWasRapid = false;
    }

    buffer += key;
    lastKeyAt = now;
    return "";
  };

  const handleKeydown = (event) => {
    const scanned = feedKey(event.key, event);
    if (scanned) event.preventDefault();
  };

  const attach = () => {
    if (attached || !target?.addEventListener) return;
    target.addEventListener("keydown", handleKeydown, true);
    attached = true;
  };

  const detach = () => {
    if (!attached || !target?.removeEventListener) return;
    target.removeEventListener("keydown", handleKeydown, true);
    attached = false;
    reset();
  };

  attach();
  return { attach, detach, reset, feedKey };
}
