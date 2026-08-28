import { readSupabaseTableWithAuth } from "../lib/supabaseClient.js";

export const INBOX_MODULE_KEY = "inbox";

export const INBOX_WORK_VIEWS = [
  { key: "all", label: "All" },
  { key: "needs_reply", label: "New", state: "needs_reply" },
  { key: "waiting", label: "Waiting", state: "waiting" },
  { key: "follow_up", label: "Follow-up", state: "follow_up" },
  { key: "assigned_to_me", label: "Assigned" },
  { key: "converted", label: "Converted", state: "converted" },
  { key: "closed", label: "Closed", state: "closed" },
];

export const INBOX_VISIBLE_WORK_VIEWS = [
  { key: "all", label: "All" },
  { key: "follow_up", label: "Follow Up", state: "follow_up" },
  { key: "assigned_to_me", label: "Mine" },
];

const CONVERSATION_SELECT = [
  "id",
  "channel_identity_id",
  "state",
  "owner_user_id",
  "opened_at",
  "closed_at",
  "snoozed_until",
  "last_message_at",
  "last_inbound_at",
  "last_outbound_at",
  "reply_window_expires_at",
  "updated_at",
  "entry_source",
  "referral_ref",
  "campaign_id",
  "campaign_name",
  "ad_id",
  "ad_name",
  "external_thread_id",
  "created_at",
].join(",");

export async function getAdminInboxConversationRows(authSession, { limit = 100 } = {}) {
  const token = getAccessToken(authSession);
  const conversations = await readSupabaseTableWithAuth(
    "inbox_conversations",
    {
      select: CONVERSATION_SELECT,
      order: "last_message_at.desc.nullslast,opened_at.desc",
      limit: String(limit),
    },
    token
  );

  const identityIds = unique(conversations.map((row) => row.channel_identity_id));
  const identities = identityIds.length
    ? await readSupabaseTableWithAuth(
        "inbox_channel_identities",
        {
          select: "id,contact_id,page_connection_id,channel,external_user_id,external_username,display_name,profile_picture_url,last_seen_at",
          id: `in.(${identityIds.join(",")})`,
        },
        token
      )
    : [];

  const contactIds = unique(identities.map((row) => row.contact_id));
  const contacts = contactIds.length
    ? await readSupabaseTableWithAuth(
        "inbox_contacts",
        {
          select: "id,display_name,primary_phone,primary_email,company_name",
          id: `in.(${contactIds.join(",")})`,
        },
        token
      )
    : [];

  const pageIds = unique(identities.map((row) => row.page_connection_id));
  const pages = pageIds.length
    ? await readSupabaseTableWithAuth(
        "meta_page_connections",
        {
          select: "id,page_id,page_name,status",
          id: `in.(${pageIds.join(",")})`,
        },
        token
      )
    : [];

  const conversationIds = unique(conversations.map((row) => row.id));
  const links = conversationIds.length
    ? await readSupabaseTableWithAuth(
        "inbox_inquiry_links",
        {
          select: "conversation_id,inquiry_id,converted_at",
          conversation_id: `in.(${conversationIds.join(",")})`,
        },
        token
      )
    : [];
  const latestMessages = conversationIds.length
    ? await readSupabaseTableWithAuth(
        "inbox_messages",
        {
          select: "conversation_id,body,message_type,sent_at,created_at",
          conversation_id: `in.(${conversationIds.join(",")})`,
          order: "sent_at.desc.nullslast,created_at.desc",
          limit: String(Math.min(Math.max(conversationIds.length * 4, 40), 250)),
        },
        token
      )
    : [];

  const byId = (rows) => new Map(rows.map((row) => [row.id, row]));
  const identitiesById = byId(identities);
  const contactsById = byId(contacts);
  const pagesById = byId(pages);
  const linksByConversation = new Map(links.map((row) => [row.conversation_id, row]));
  const latestMessageByConversation = new Map();
  latestMessages.forEach((message) => {
    if (!latestMessageByConversation.has(message.conversation_id)) {
      latestMessageByConversation.set(message.conversation_id, message);
    }
  });

  return sortInboxConversations(conversations.map((conversation) => {
    const identity = identitiesById.get(conversation.channel_identity_id) || null;
    return normalizeInboxConversationRow({
      conversation,
      identity,
      contact: identity ? contactsById.get(identity.contact_id) || null : null,
      page: identity ? pagesById.get(identity.page_connection_id) || null : null,
      inquiryLink: linksByConversation.get(conversation.id) || null,
      latestMessage: latestMessageByConversation.get(conversation.id) || null,
    });
  }));
}

export async function getAdminInboxConversationDetail(authSession, conversationId) {
  const token = getAccessToken(authSession);
  const [messages, notes, events, links] = await Promise.all([
    readSupabaseTableWithAuth("inbox_messages", {
      select: "id,conversation_id,external_message_id,direction,message_type,body,sender_external_id,sender_user_id,is_echo,sent_at,delivered_at,read_at,created_at",
      conversation_id: `eq.${conversationId}`,
      order: "sent_at.asc,id.asc",
    }, token),
    readSupabaseTableWithAuth("inbox_conversation_notes", {
      select: "id,conversation_id,body,created_by_user_id,created_at,updated_at,deleted_at",
      conversation_id: `eq.${conversationId}`,
      deleted_at: "is.null",
      order: "created_at.desc",
    }, token),
    readSupabaseTableWithAuth("inbox_conversation_events", {
      select: "id,conversation_id,event_type,actor_user_id,actor_kind,payload,occurred_at",
      conversation_id: `eq.${conversationId}`,
      order: "occurred_at.desc,id.desc",
    }, token),
    readSupabaseTableWithAuth("inbox_inquiry_links", {
      select: "conversation_id,inquiry_id,converted_by_user_id,converted_at",
      conversation_id: `eq.${conversationId}`,
      limit: "1",
    }, token),
  ]);

  const messageIds = unique(messages.map((row) => row.id));
  const attachments = messageIds.length
    ? await readSupabaseTableWithAuth(
        "inbox_attachments",
        {
          select: "id,message_id,external_attachment_id,attachment_type,bucket_id,storage_path,original_filename,mime_type,size_bytes,ingestion_status,created_at,stored_at",
          message_id: `in.(${messageIds.join(",")})`,
          order: "created_at.asc,id.asc",
        },
        token
      )
    : [];

  return normalizeInboxConversationDetail({ messages, attachments, notes, events, inquiryLink: links[0] || null });
}

export async function getInboxReplyCapability(authSession) {
  const token = getAccessToken(authSession);
  const response = await fetch("/api/inbox/capability", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) return { replyConfigured: false };
  return { replyConfigured: payload.replyConfigured === true };
}

export async function getInboxSendState(authSession, conversationId) {
  const token = getAccessToken(authSession);
  const response = await fetch(`/api/inbox/${encodeURIComponent(conversationId)}/send-state`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) return { status: "none" };
  return { status: normalizeInboxSendState(payload.status) };
}

export async function sendInboxReply(authSession, conversationId, { text, expectedUpdatedAt, idempotencyKey }) {
  return postInboxAction(authSession, conversationId, "reply", { text, expectedUpdatedAt, idempotencyKey });
}

export async function assignInboxConversation(authSession, conversationId, { targetUserId, expectedUpdatedAt, idempotencyKey }) {
  return postInboxAction(authSession, conversationId, "assign", { targetUserId, expectedUpdatedAt, idempotencyKey });
}

export async function addInboxInternalNote(authSession, conversationId, { body, idempotencyKey }) {
  return postInboxAction(authSession, conversationId, "note", { body, idempotencyKey });
}

export async function scheduleInboxFollowUp(authSession, conversationId, { snoozedUntil, reason, expectedUpdatedAt, idempotencyKey }) {
  return postInboxAction(authSession, conversationId, "follow-up", { snoozedUntil, reason, expectedUpdatedAt, idempotencyKey });
}

export async function closeInboxConversation(authSession, conversationId, { expectedUpdatedAt, idempotencyKey }) {
  return postInboxAction(authSession, conversationId, "close", { expectedUpdatedAt, idempotencyKey });
}

export async function convertInboxConversationToInquiry(authSession, conversationId, { idempotencyKey }) {
  return postInboxAction(authSession, conversationId, "convert-to-inquiry", { idempotencyKey });
}

export async function refreshInboxFacebookProfile(authSession, conversationId, { force = true } = {}) {
  try {
    const result = await postInboxAction(authSession, conversationId, "refresh-profile", { force });
    return {
      ok: result?.ok === true,
      status: result?.status || "",
      displayName: result?.displayName || "",
      profilePictureAvailable: result?.profilePictureAvailable === true,
      fields: result?.fields || {},
      error: "",
    };
  } catch (error) {
    return {
      ok: false,
      status: "blocked",
      displayName: "",
      profilePictureAvailable: false,
      fields: {},
      error: String(error?.code || error?.message || "META_PROFILE_UNAVAILABLE").slice(0, 120),
    };
  }
}

export async function updateInboxContact(authSession, conversationId, contact = {}) {
  const result = await postInboxAction(authSession, conversationId, "update-contact", {
    displayName: contact.displayName,
    primaryPhone: contact.primaryPhone,
    primaryEmail: contact.primaryEmail,
    companyName: contact.companyName,
  });
  return {
    ok: result?.ok === true,
    displayName: result?.contact?.displayName || "",
    primaryPhone: result?.contact?.primaryPhone || "",
    primaryEmail: result?.contact?.primaryEmail || "",
    companyName: result?.contact?.companyName || "",
  };
}

export function normalizeInboxConversationRow({ conversation, identity = null, contact = null, page = null, inquiryLink = null, latestMessage = null }) {
  return {
    id: conversation.id,
    state: conversation.state || "needs_reply",
    ownerUserId: conversation.owner_user_id || "",
    ownerLabel: conversation.owner_user_id ? conversation.owner_user_id : "Unassigned",
    openedAt: conversation.opened_at || "",
    closedAt: conversation.closed_at || "",
    snoozedUntil: conversation.snoozed_until || "",
    lastMessageAt: conversation.last_message_at || "",
    lastInboundAt: conversation.last_inbound_at || "",
    lastOutboundAt: conversation.last_outbound_at || "",
    replyWindowExpiresAt: conversation.reply_window_expires_at || "",
    updatedAt: conversation.updated_at || "",
    entrySource: conversation.entry_source || "",
    referralRef: conversation.referral_ref || "",
    campaignId: conversation.campaign_id || "",
    campaignName: conversation.campaign_name || "",
    adId: conversation.ad_id || "",
    adName: conversation.ad_name || "",
    externalThreadId: conversation.external_thread_id || "",
    channel: identity?.channel || "facebook_messenger",
    externalUserId: identity?.external_user_id || "",
    externalUsername: identity?.external_username || "",
    identityDisplayName: identity?.display_name || "",
    profilePictureUrl: getSafeProfilePictureUrl(identity?.profile_picture_url),
    contactName: contact?.display_name || "",
    primaryPhone: contact?.primary_phone || "",
    primaryEmail: contact?.primary_email || "",
    companyName: contact?.company_name || "",
    pageName: page?.page_name || "",
    pageId: page?.page_id || "",
    inquiryId: inquiryLink?.inquiry_id || "",
    convertedAt: inquiryLink?.converted_at || "",
    customerLabel: formatInboxCustomerName({ identity, contact }),
    customerSecondary: getSafeIdentitySecondary(identity),
    lastMessageSnippet: formatInboxLastMessageSnippet(latestMessage, conversation),
  };
}

export function normalizeInboxConversationDetail({ messages = [], attachments = [], notes = [], events = [], inquiryLink = null }) {
  const attachmentsByMessage = new Map();
  attachments.forEach((attachment) => {
    const list = attachmentsByMessage.get(attachment.message_id) || [];
    list.push(normalizeInboxAttachment(attachment));
    attachmentsByMessage.set(attachment.message_id, list);
  });

  return {
    messages: [...messages]
      .sort(compareMessageRows)
      .map((message) => ({
        id: message.id,
        direction: message.direction || "system",
        messageType: message.message_type || "unknown",
        body: message.body || "",
        sentAt: message.sent_at || "",
        deliveredAt: message.delivered_at || "",
        readAt: message.read_at || "",
        externalMessageId: message.external_message_id || "",
        senderUserId: message.sender_user_id || "",
        statusLabel: getInboxOutboundStatus(message),
        attachments: attachmentsByMessage.get(message.id) || [],
      })),
    notes: notes.map((note) => ({
      id: note.id,
      body: note.body || "",
      createdByUserId: note.created_by_user_id || "",
      createdAt: note.created_at || "",
    })),
    events: events.map((event) => ({
      id: event.id,
      eventType: event.event_type || "",
      actorKind: event.actor_kind || "system",
      occurredAt: event.occurred_at || "",
    })),
    inquiryLink: inquiryLink
      ? {
          inquiryId: inquiryLink.inquiry_id || "",
          convertedByUserId: inquiryLink.converted_by_user_id || "",
          convertedAt: inquiryLink.converted_at || "",
        }
      : null,
  };
}

export function filterInboxConversations(conversations, viewKey, currentUserId = "") {
  const view = INBOX_WORK_VIEWS.find((item) => item.key === viewKey) || INBOX_WORK_VIEWS[0];
  if (view.key === "all") return conversations;
  if (view.key === "assigned_to_me") {
    return conversations.filter((conversation) => conversation.ownerUserId && conversation.ownerUserId === currentUserId);
  }
  return conversations.filter((conversation) => conversation.state === view.state);
}

export function sortInboxConversations(conversations) {
  return [...conversations].sort((a, b) => {
    const aTime = new Date(a.lastMessageAt || a.openedAt || 0).getTime() || 0;
    const bTime = new Date(b.lastMessageAt || b.openedAt || 0).getTime() || 0;
    return bTime - aTime || String(a.id).localeCompare(String(b.id));
  });
}

export function formatInboxCustomerName({ identity = null, contact = null } = {}) {
  return safeText(contact?.display_name) || safeText(identity?.display_name) || "Facebook customer";
}

export function getSafeIdentitySecondary(identity = null) {
  const id = safeText(identity?.external_username);
  if (!id) return "Messenger";
  return id.length <= 10 ? id : `${id.slice(0, 4)}...${id.slice(-4)}`;
}

export function getSafeProfilePictureUrl(value) {
  const url = safeText(value);
  return /^https:\/\/[^\s"'<>]+$/i.test(url) ? url : "";
}

export function formatInboxLastMessageSnippet(message = null, conversation = null) {
  const body = safeText(message?.body);
  if (body) return body.length > 140 ? `${body.slice(0, 137)}...` : body;
  const type = safeText(message?.message_type);
  if (type && type !== "text") return `${type.replace(/_/g, " ")} message`;
  return safeText(conversation?.referral_ref) || safeText(conversation?.entry_source) || "No messages captured yet.";
}

export function getInboxOutboundStatus(message) {
  if (message?.direction !== "outbound") return "";
  if (message.read_at) return "Seen";
  if (message.delivered_at) return "Delivered";
  return "Sent";
}

export function getInboxReplyWindowState(expiresAt, now = new Date()) {
  if (!expiresAt) return { tone: "unknown", label: "Not available" };
  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime())) return { tone: "unknown", label: "Not available" };
  const diffMs = expires.getTime() - now.getTime();
  if (diffMs <= 0) return { tone: "expired", label: "Closed" };
  const hours = Math.ceil(diffMs / 3600000);
  return { tone: hours <= 4 ? "soon" : "open", label: `${hours}h left` };
}

export function normalizeInboxSendState(status) {
  return ["none", "sending", "unknown", "failed", "sent"].includes(status) ? status : "none";
}

function normalizeInboxAttachment(attachment) {
  return {
    id: attachment.id,
    type: attachment.attachment_type || "unknown",
    filename: attachment.original_filename || "",
    mimeType: attachment.mime_type || "",
    sizeBytes: attachment.size_bytes ?? null,
    ingestionStatus: attachment.ingestion_status || "pending",
    bucketId: attachment.bucket_id || "inbox-files",
    storagePath: attachment.storage_path || "",
  };
}

function compareMessageRows(a, b) {
  const aTime = new Date(a.sent_at || 0).getTime() || 0;
  const bTime = new Date(b.sent_at || 0).getTime() || 0;
  return aTime - bTime || String(a.id).localeCompare(String(b.id));
}

function getAccessToken(authSession) {
  if (!authSession?.access_token) throw new Error("Authenticated Inbox read session is required.");
  return authSession.access_token;
}

async function postInboxAction(authSession, conversationId, action, body) {
  const token = getAccessToken(authSession);
  const response = await fetch(`/api/inbox/${encodeURIComponent(conversationId)}/${action}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body || {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    const error = new Error(formatInboxActionError(payload?.error || "Inbox action failed."));
    error.code = payload?.error || "";
    error.status = response.status;
    throw error;
  }
  return payload;
}

function formatInboxActionError(code) {
  const messages = {
    REPLY_WINDOW_CLOSED: "Reply window closed",
    CONVERSATION_CHANGED: "Conversation changed. Refresh before continuing.",
    SEND_IN_PROGRESS: "Send already in progress.",
    SEND_STATUS_UNKNOWN: "Send status uncertain. Check Business Suite before trying again.",
    CONVERSATION_OWNED_BY_OTHER: "This conversation is owned by another staff member.",
    META_SEND_NOT_CONFIGURED: "Messenger sending is not configured for this environment.",
    REPLY_TEXT_REQUIRED: "Enter a reply before sending.",
    REPLY_TEXT_TOO_LONG: "Reply must be 2000 characters or fewer.",
    INBOX_REASSIGN_DENIED: "You do not have permission to reassign this conversation.",
    ASSIGNMENT_TARGET_DENIED: "That employee cannot be assigned to Inbox conversations.",
  };
  return messages[code] || String(code || "Inbox action failed.").replace(/_/g, " ");
}

function safeText(value) {
  return String(value || "").trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
