const DEFAULT_GRAPH_VERSION = "v23.0";
const DEFAULT_SEND_TIMEOUT_MS = 5000;

export async function sendMetaTextMessage({
  pageId,
  recipientPsid,
  text,
  fetchImpl = globalThis.fetch,
  env = process.env,
  timeoutMs = Number(env.META_SEND_TIMEOUT_MS || DEFAULT_SEND_TIMEOUT_MS),
} = {}) {
  const graphVersion = cleanGraphVersion(env.META_GRAPH_API_VERSION || DEFAULT_GRAPH_VERSION);
  const configuredPageId = cleanText(env.META_PAGE_ID, 200);
  const token = String(env.META_PAGE_ACCESS_TOKEN || "").trim();
  const safePageId = cleanText(pageId, 200);
  const safeRecipient = cleanText(recipientPsid, 240);
  const bodyText = cleanReplyText(text);

  if (!configuredPageId || !token || !graphVersion) {
    return { ok: false, status: 503, errorCode: "META_SEND_NOT_CONFIGURED" };
  }
  if (safePageId !== configuredPageId) {
    return { ok: false, status: 409, errorCode: "META_PAGE_MISMATCH" };
  }
  if (!safeRecipient) {
    return { ok: false, status: 400, errorCode: "META_RECIPIENT_REQUIRED" };
  }
  if (!bodyText.ok) {
    return { ok: false, status: 400, errorCode: bodyText.errorCode };
  }
  if (typeof fetchImpl !== "function") {
    return { ok: false, status: 503, errorCode: "META_FETCH_UNAVAILABLE" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || DEFAULT_SEND_TIMEOUT_MS));
  const endpoint = `https://graph.facebook.com/${encodeURIComponent(graphVersion)}/${encodeURIComponent(configuredPageId)}/messages`;

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        recipient: { id: safeRecipient },
        messaging_type: "RESPONSE",
        message: { text: bodyText.text },
      }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        status: response.status || 502,
        errorCode: safeMetaErrorCode(payload?.error?.code || payload?.error?.type || "META_SEND_FAILED"),
        definitive: true,
      };
    }

    const messageId = cleanText(payload?.message_id, 500);
    if (!messageId) {
      return { ok: false, status: 502, errorCode: "META_MESSAGE_ID_MISSING", definitive: true };
    }

    return { ok: true, messageId };
  } catch (error) {
    if (error?.name === "AbortError") return { ok: false, status: 504, errorCode: "META_SEND_TIMEOUT", unknown: true };
    return { ok: false, status: 502, errorCode: "META_SEND_AMBIGUOUS", unknown: true };
  } finally {
    clearTimeout(timer);
  }
}

export function getMetaReplyCapability(env = process.env) {
  return {
    replyConfigured: Boolean(
      cleanGraphVersion(env.META_GRAPH_API_VERSION || DEFAULT_GRAPH_VERSION)
      && cleanText(env.META_PAGE_ID, 200)
      && String(env.META_PAGE_ACCESS_TOKEN || "").trim()
    ),
  };
}

export function cleanReplyText(value) {
  const text = String(value || "").trim();
  if (!text) return { ok: false, errorCode: "REPLY_TEXT_REQUIRED" };
  if (text.length > 2000) return { ok: false, errorCode: "REPLY_TEXT_TOO_LONG" };
  return { ok: true, text };
}

function cleanGraphVersion(value) {
  const version = String(value || "").trim();
  return /^v\d+\.\d+$/.test(version) ? version : "";
}

function cleanText(value, max) {
  return String(value || "").trim().slice(0, max);
}

function safeMetaErrorCode(value) {
  return String(value || "META_SEND_FAILED").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 120) || "META_SEND_FAILED";
}
