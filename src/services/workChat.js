import { createBrowserSupabaseClient } from "../lib/supabaseClient.js";

const JSON_HEADERS = { Accept: "application/json", "Content-Type": "application/json" };
const WORK_CHAT_BUCKET = "work-chat-files";

export async function getWorkChatBootstrap(session) {
  return workChatRequest("/api/work-chat/bootstrap", { session });
}

export async function getWorkChatMessages(channelId, session, { before = "", pageSize = 50 } = {}) {
  const params = new URLSearchParams({ pageSize: String(pageSize) });
  if (before) params.set("before", before);
  return workChatRequest(`/api/work-chat/channels/${encodeURIComponent(channelId)}/messages?${params.toString()}`, { session });
}

export async function sendWorkChatMessage(channelId, body, session) {
  return workChatRequest(`/api/work-chat/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    body,
    session,
  });
}

export async function markWorkChatRead(channelId, messageId, session) {
  return workChatRequest(`/api/work-chat/channels/${encodeURIComponent(channelId)}/read`, {
    method: "POST",
    body: { messageId },
    session,
  });
}

export async function createWorkChatOrderThread(orderId, session) {
  return workChatRequest("/api/work-chat/order-threads", {
    method: "POST",
    body: { orderId },
    session,
  });
}

export async function prepareWorkChatAttachment(file, session) {
  const payload = await workChatRequest("/api/work-chat/attachments/prepare", {
    method: "POST",
    body: {
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
    },
    session,
  });

  await uploadPreparedAttachment(file, payload.upload, session);
  return payload.attachment;
}

export async function openWorkChatAttachment(attachmentId, session) {
  const payload = await workChatRequest(`/api/work-chat/attachments/${encodeURIComponent(attachmentId)}/url`, { session });
  window.open(payload.url, "_blank", "noopener,noreferrer");
  return payload;
}

export function subscribeToWorkChatMessages(session, onMessage, onStatus = () => {}) {
  const state = { client: null, channel: null, cancelled: false };
  ensureSupabaseBrowserSdk()
    .then(() => {
      if (state.cancelled) return;
      const client = createBrowserSupabaseClient(session?.access_token || "");
      if (!client?.channel) {
        onStatus("unavailable");
        return;
      }
      const channel = client
        .channel("admin-work-chat-messages")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "work_chat_messages" },
          (payload) => onMessage(payload.new)
        )
        .subscribe((status) => onStatus(String(status || "idle").toLowerCase()));
      state.client = client;
      state.channel = channel;
    })
    .catch(() => onStatus("unavailable"));

  return {
    unsubscribe() {
      state.cancelled = true;
      if (!state.client || !state.channel) return;
      try {
        state.client.removeChannel(state.channel);
      } catch {
        // Realtime cleanup is best effort during logout/navigation.
      }
    },
  };
}

async function uploadPreparedAttachment(file, upload, session) {
  await ensureSupabaseBrowserSdk();
  const client = createBrowserSupabaseClient(session?.access_token || "");
  if (client?.storage?.from && upload?.path && upload?.token) {
    const { error } = await client.storage.from(WORK_CHAT_BUCKET).uploadToSignedUrl(upload.path, upload.token, file);
    if (error) throw createWorkChatClientError(error.code || "UPLOAD_FAILED", error.message || "Attachment upload failed.", error.status || 500);
    return;
  }

  if (!upload?.signedUrl) throw createWorkChatClientError("UPLOAD_UNAVAILABLE", "Attachment upload is unavailable.", 503);
  const response = await fetch(upload.signedUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!response.ok) throw createWorkChatClientError("UPLOAD_FAILED", "Attachment upload failed.", response.status);
}


function ensureSupabaseBrowserSdk() {
  if (window.supabase?.createClient) return Promise.resolve();
  if (window.__trrySupabaseSdkPromise) return window.__trrySupabaseSdkPromise;
  window.__trrySupabaseSdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Supabase browser SDK failed to load."));
    document.head.appendChild(script);
  });
  return window.__trrySupabaseSdkPromise;
}
async function workChatRequest(path, { method = "GET", body, session } = {}) {
  if (!session?.access_token) {
    throw createWorkChatClientError("AUTH_REQUIRED", "Admin session is missing.", 401);
  }

  const headers = {
    ...JSON_HEADERS,
    Authorization: `Bearer ${session.access_token}`,
  };
  if (body === undefined) delete headers["Content-Type"];

  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await readJson(response);
  if (!response.ok || payload?.ok === false) {
    throw createWorkChatClientError(
      payload?.error?.code || "WORK_CHAT_REQUEST_FAILED",
      payload?.error?.message || "Work Chat request failed.",
      response.status,
    );
  }
  return payload;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: { code: "INVALID_JSON", message: "Work Chat response was invalid." } };
  }
}

function createWorkChatClientError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}