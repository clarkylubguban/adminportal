import { adminLegacyRoleToAccessRole, getAuthorizedAdmin, getBearerToken, hasAdminActionPermission, readJsonBody, sendJson } from "./adminAccess.js";
import { validateAssignmentUser } from "./adminAssignments.js";
import { cleanReplyText, getMetaReplyCapability, sendMetaTextMessage } from "./metaSend.js";
import { createSupabaseMetaInboxRepository } from "./metaInboxIngestion.js";
import { refreshMetaProfileForConversation } from "./metaProfileEnrichment.js";
import { createServerSupabaseClient } from "./supabaseServer.js";

const ACTIONS = new Set(["reply", "assign", "note", "follow-up", "close", "convert-to-inquiry", "capability", "send-state", "refresh-profile", "update-contact"]);

export async function handleInboxAction(request, response, dependencies = {}) {
  const route = parseInboxRoute(request.url || "/");
  if (!route || !ACTIONS.has(route.action)) return sendJson(response, 404, { ok: false, error: "not found" });
  if (route.action === "capability") return sendJson(response, 200, { ok: true, ...getMetaReplyCapability(dependencies.env || process.env) });
  if (route.action === "send-state" && request.method !== "GET") return sendJson(response, 405, { ok: false, error: "method not allowed" });
  if (route.action !== "send-state" && request.method !== "POST") return sendJson(response, 405, { ok: false, error: "method not allowed" });

  const token = getBearerToken(request);
  if (!token) return sendJson(response, 401, { ok: false, error: "admin session required" });

  const supabase = dependencies.supabase || createServerSupabaseClient();
  const actor = await getAuthorizedAdmin(supabase, token);
  if (!actor) return sendJson(response, 401, { ok: false, error: "admin session required" });

  try {
    if (route.action === "send-state") return handleSendState({ response, supabase, actor, conversationId: route.id });
    const body = await readJsonBody(request);
    if (route.action === "reply") return handleReply({ request, response, supabase, actor, conversationId: route.id, body, dependencies });
    if (route.action === "assign") return handleAssign({ response, supabase, actor, conversationId: route.id, body });
    if (route.action === "note") return handleNote({ response, supabase, actor, conversationId: route.id, body });
    if (route.action === "follow-up") return handleFollowUp({ response, supabase, actor, conversationId: route.id, body });
    if (route.action === "close") return handleClose({ response, supabase, actor, conversationId: route.id, body });
    if (route.action === "convert-to-inquiry") return handleConvertToInquiry({ response, supabase, actor, conversationId: route.id, body });
    if (route.action === "refresh-profile") return handleRefreshProfile({ response, supabase, actor, conversationId: route.id, body, dependencies });
    if (route.action === "update-contact") return handleUpdateContact({ response, supabase, actor, conversationId: route.id, body });
  } catch (error) {
    console.error("Inbox action failed.", { message: error?.message, code: error?.code });
    return sendJson(response, 500, { ok: false, error: "inbox action failed" });
  }
}

async function handleUpdateContact({ response, supabase, actor, conversationId, body }) {
  if (!await canAccessInbox(supabase, actor)) return sendJson(response, 403, { ok: false, error: "inbox access required" });

  const allowed = new Set(["displayName", "primaryPhone", "primaryEmail", "companyName"]);
  const unknown = Object.keys(body || {}).filter((key) => !allowed.has(key) && key !== "idempotencyKey" && key !== "idempotency_key");
  if (unknown.length) return sendJson(response, 400, { ok: false, error: "UNSUPPORTED_CONTACT_FIELD" });

  const { data: conversation, error: conversationError } = await supabase
    .from("inbox_conversations")
    .select("id,channel_identity_id,state,owner_user_id,reply_window_expires_at")
    .eq("id", conversationId)
    .maybeSingle();
  if (conversationError) throw conversationError;
  if (!conversation?.channel_identity_id) return sendJson(response, 404, { ok: false, error: "CONVERSATION_NOT_FOUND" });

  const { data: identity, error: identityError } = await supabase
    .from("inbox_channel_identities")
    .select("id,contact_id")
    .eq("id", conversation.channel_identity_id)
    .maybeSingle();
  if (identityError) throw identityError;
  if (!identity?.contact_id) return sendJson(response, 404, { ok: false, error: "CONTACT_NOT_FOUND" });

  const update = {};
  if (Object.hasOwn(body || {}, "displayName")) {
    const displayName = normalizeOptionalText(body.displayName, 200);
    if (!displayName) return sendJson(response, 400, { ok: false, error: "DISPLAY_NAME_REQUIRED" });
    update.display_name = displayName;
  }
  if (Object.hasOwn(body || {}, "primaryPhone")) update.primary_phone = normalizeOptionalText(body.primaryPhone, 40);
  if (Object.hasOwn(body || {}, "primaryEmail")) update.primary_email = normalizeOptionalText(body.primaryEmail, 254);
  if (Object.hasOwn(body || {}, "companyName")) update.company_name = normalizeOptionalText(body.companyName, 200);
  if (!Object.keys(update).length) return sendJson(response, 400, { ok: false, error: "CONTACT_UPDATE_REQUIRED" });

  const { data: contact, error: updateError } = await supabase
    .from("inbox_contacts")
    .update(update)
    .eq("id", identity.contact_id)
    .select("display_name,primary_phone,primary_email,company_name")
    .maybeSingle();
  if (updateError) throw updateError;
  if (!contact) return sendJson(response, 404, { ok: false, error: "CONTACT_NOT_FOUND" });

  return sendJson(response, 200, {
    ok: true,
    contact: {
      displayName: contact.display_name || "",
      primaryPhone: contact.primary_phone || "",
      primaryEmail: contact.primary_email || "",
      companyName: contact.company_name || "",
    },
  });
}

async function handleRefreshProfile({ response, supabase, actor, conversationId, body, dependencies }) {
  if (!await canAccessInbox(supabase, actor)) return sendJson(response, 403, { ok: false, error: "inbox access required" });

  const result = await refreshMetaProfileForConversation(conversationId, {
    repository: createSupabaseMetaInboxRepository(supabase),
    env: dependencies.env || process.env,
    fetchImpl: dependencies.fetchImpl || globalThis.fetch,
    timeoutMs: dependencies.profileTimeoutMs,
    force: body?.force === true,
  });

  if (result.ok) {
    return sendJson(response, 200, {
      ok: true,
      status: result.status,
      displayName: result.displayName || "",
      profilePictureAvailable: Boolean(result.profilePictureUrl),
      fields: result.fields || {},
    });
  }
  return sendJson(response, 409, { ok: false, error: result.errorCode || "META_PROFILE_ENRICHMENT_BLOCKED" });
}

async function handleSendState({ response, supabase, actor, conversationId }) {
  if (!await canAccessInbox(supabase, actor)) return sendJson(response, 403, { ok: false, error: "inbox access required" });

  const visible = await canReadConversation(supabase, conversationId);
  if (!visible) return sendJson(response, 404, { ok: false, error: "conversation not found" });

  const { data, error } = await supabase
    .from("inbox_outbound_attempts")
    .select("status,created_at")
    .eq("conversation_id", conversationId)
    .in("status", ["sending", "unknown", "failed", "sent"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;

  const status = normalizeSendStateStatus(data?.[0]?.status);
  return sendJson(response, 200, { ok: true, status });
}

async function handleReply({ response, supabase, actor, conversationId, body, dependencies }) {
  const textResult = cleanReplyText(body?.text);
  if (!textResult.ok) return sendJson(response, 400, { ok: false, error: textResult.errorCode });

  const idempotencyKey = getIdempotencyKey(body);
  const reserve = await rpc(supabase, "reserve_inbox_reply", {
    p_conversation_id: conversationId,
    p_actor_user_id: actor.userId,
    p_idempotency_key: idempotencyKey,
    p_body_hash: await sha256Hex(textResult.text),
    p_expected_updated_at: body?.expectedUpdatedAt || null,
  });

  if (reserve?.replay === true) return sendJson(response, 200, { ok: true, replay: true, message: reserve.message || null, conversation: reserve.conversation || null });
  if (reserve?.ok !== true) return sendRpcError(response, reserve);

  const send = await sendMetaTextMessage({
    pageId: reserve.pageId,
    recipientPsid: reserve.customerPsid,
    text: textResult.text,
    fetchImpl: dependencies.fetchImpl || globalThis.fetch,
    env: dependencies.env || process.env,
  });

  if (send.ok) {
    const complete = await rpc(supabase, "complete_inbox_reply", {
      p_attempt_id: reserve.attemptId,
      p_external_message_id: send.messageId,
      p_body: textResult.text,
    });
    if (complete?.ok !== true) return sendRpcError(response, complete);
    return sendJson(response, 200, { ok: true, message: complete.message, conversation: complete.conversation });
  }

  await rpc(supabase, "fail_inbox_reply", {
    p_attempt_id: reserve.attemptId,
    p_status: send.unknown ? "unknown" : "failed",
    p_error_code: send.errorCode,
  });
  return sendJson(response, send.status || 502, { ok: false, error: send.unknown ? "SEND_STATUS_UNKNOWN" : send.errorCode });
}

async function handleAssign({ response, supabase, actor, conversationId, body }) {
  const targetUserId = body?.targetUserId || actor.userId;
  const target = await validateAssignmentUser(supabase, targetUserId, actor, { moduleKey: "inbox" });
  if (!target) return sendJson(response, 403, { ok: false, error: "ASSIGNMENT_TARGET_DENIED" });

  const result = await rpc(supabase, "mutate_inbox_assignment", {
    p_conversation_id: conversationId,
    p_actor_user_id: actor.userId,
    p_target_user_id: target.userId,
    p_expected_updated_at: body?.expectedUpdatedAt || null,
    p_idempotency_key: getIdempotencyKey(body),
  });
  return result?.ok === true ? sendJson(response, 200, { ok: true, conversation: result.conversation }) : sendRpcError(response, result);
}

async function handleNote({ response, supabase, actor, conversationId, body }) {
  const result = await rpc(supabase, "add_inbox_internal_note", {
    p_conversation_id: conversationId,
    p_actor_user_id: actor.userId,
    p_body: String(body?.body || "").trim(),
    p_idempotency_key: getIdempotencyKey(body),
  });
  return result?.ok === true ? sendJson(response, 200, { ok: true, note: result.note, conversation: result.conversation }) : sendRpcError(response, result);
}

async function handleFollowUp({ response, supabase, actor, conversationId, body }) {
  const result = await rpc(supabase, "schedule_inbox_follow_up", {
    p_conversation_id: conversationId,
    p_actor_user_id: actor.userId,
    p_snoozed_until: body?.snoozedUntil || null,
    p_reason: String(body?.reason || "").trim() || null,
    p_expected_updated_at: body?.expectedUpdatedAt || null,
    p_idempotency_key: getIdempotencyKey(body),
  });
  return result?.ok === true ? sendJson(response, 200, { ok: true, conversation: result.conversation }) : sendRpcError(response, result);
}

async function handleClose({ response, supabase, actor, conversationId, body }) {
  const result = await rpc(supabase, "close_inbox_conversation", {
    p_conversation_id: conversationId,
    p_actor_user_id: actor.userId,
    p_expected_updated_at: body?.expectedUpdatedAt || null,
    p_idempotency_key: getIdempotencyKey(body),
  });
  return result?.ok === true ? sendJson(response, 200, { ok: true, conversation: result.conversation }) : sendRpcError(response, result);
}

async function handleConvertToInquiry({ response, supabase, actor, conversationId, body }) {
  if (!await canAccessInbox(supabase, actor)) return sendJson(response, 403, { ok: false, error: "inbox access required" });
  if (!await hasAdminActionPermission(supabase, actor, "inbox_convert_to_inquiry")) {
    return sendJson(response, 403, { ok: false, error: "INBOX_CONVERT_TO_INQUIRY_DENIED" });
  }

  const result = await rpc(supabase, "convert_inbox_conversation_to_inquiry", {
    p_conversation_id: conversationId,
    p_actor_user_id: actor.userId,
    p_idempotency_key: getIdempotencyKey(body),
  });
  return result?.ok === true
    ? sendJson(response, 200, {
        ok: true,
        inquiry: result.inquiry || null,
        conversation: result.conversation || null,
        replay: result.replay === true,
      })
    : sendRpcError(response, result);
}

async function rpc(supabase, name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data || {};
}

async function canAccessInbox(supabase, actor) {
  const roleKey = actor.accessRoleKey || adminLegacyRoleToAccessRole(actor.role);
  const { data, error } = await supabase
    .from("admin_role_module_permissions")
    .select("can_access")
    .eq("role_key", roleKey)
    .eq("module_key", "inbox")
    .maybeSingle();
  if (error) throw error;
  if (data?.can_access === true) return true;

  const { data: grants, error: grantError } = await supabase
    .from("admin_temporary_module_grants")
    .select("user_id")
    .eq("user_id", actor.userId)
    .eq("module_key", "inbox")
    .is("revoked_at", null)
    .lte("starts_at", new Date().toISOString())
    .gt("expires_at", new Date().toISOString())
    .limit(1);
  if (grantError) throw grantError;
  return (grants || []).length > 0;
}

async function canReadConversation(supabase, conversationId) {
  const { data, error } = await supabase
    .from("inbox_conversations")
    .select("id")
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.id);
}

function normalizeSendStateStatus(status) {
  return ["sending", "unknown", "failed", "sent"].includes(status) ? status : "none";
}

function sendRpcError(response, result = {}) {
  const error = result?.error || "INBOX_ACTION_DENIED";
  const status = error === "CONVERSATION_CHANGED" || error === "SEND_IN_PROGRESS" || error === "SEND_STATUS_UNKNOWN" ? 409
    : error === "REPLY_WINDOW_CLOSED" ? 409
    : error === "IDEMPOTENCY_KEY_CONFLICT" ? 409
    : error.endsWith("_NOT_FOUND") ? 404
    : error.endsWith("_DENIED") || error === "CONVERSATION_OWNED_BY_OTHER" ? 403
    : error.endsWith("_REQUIRED") || error.endsWith("_INVALID") ? 400
    : 500;
  return sendJson(response, status, { ok: false, error });
}

function parseInboxRoute(rawUrl) {
  const pathname = new URL(rawUrl, "http://localhost").pathname;
  const match = pathname.match(/^\/api\/inbox\/([^/]+)\/([^/]+)$/);
  if (match) return { id: decodeURIComponent(match[1]), action: match[2] };
  if (pathname === "/api/inbox/capability") return { id: "", action: "capability" };
  return null;
}

function getIdempotencyKey(body) {
  return String(body?.idempotencyKey || body?.idempotency_key || "").trim();
}

function normalizeOptionalText(value, maxLength) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
