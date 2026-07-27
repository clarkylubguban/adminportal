import { cleanText, getAuthorizedAdmin, getBearerToken, readJsonBody, sendJson } from "./_lib/adminAccess.js";
import { createServerSupabaseClient } from "./_lib/supabaseServer.js";

const BUCKET = "work-chat-files";
const MAX_BODY_LENGTH = 4000;
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const MESSAGE_PAGE_SIZE = 50;
const ROUTES = [
  { action: "bootstrap", pattern: /^\/api\/work-chat\/bootstrap\/?$/, methods: ["GET"], handler: handleBootstrap },
  { action: "channel-messages", pattern: /^\/api\/work-chat\/channels\/[^/]+\/messages\/?$/, methods: ["GET", "POST"], handler: handleChannelMessages },
  { action: "channel-read", pattern: /^\/api\/work-chat\/channels\/[^/]+\/read\/?$/, methods: ["POST"], handler: handleChannelRead },
  { action: "order-threads", pattern: /^\/api\/work-chat\/order-threads\/?$/, methods: ["GET", "POST"], handler: handleOrderThreads },
  { action: "attachment-prepare", pattern: /^\/api\/work-chat\/attachments\/prepare\/?$/, methods: ["POST"], handler: handleAttachmentPrepare },
  { action: "attachment-url", pattern: /^\/api\/work-chat\/attachments\/[^/]+\/url\/?$/, methods: ["GET"], handler: handleAttachmentUrl },
];

const ROUTES_BY_ACTION = new Map(ROUTES.map((route) => [route.action, route]));
export { ROUTES as workChatRouteDispatchTable };

export default async function handler(request, response) {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers?.host || "localhost"}`);
    const route = getRoute(request, url);
    if (!route) return errorResponse(response, 404, "NOT_FOUND", "Work Chat API route not found.");
    if (!route.methods.includes(request.method)) {
      response.setHeader("Allow", route.methods.join(", "));
      return errorResponse(response, 405, "METHOD_NOT_ALLOWED", "HTTP method is not supported for this Work Chat route.");
    }

    const supabase = createServerSupabaseClient();
    const token = getBearerToken(request);
    const actor = await getAuthorizedAdmin(supabase, token);
    if (!actor) return errorResponse(response, 401, "AUTH_REQUIRED", "Active Admin Portal session required.");

    const params = getRoutingParams(request, url);
    const payload = await route.handler({ request, url, supabase, actor, params });
    return sendJson(response, payload.status || 200, { ok: true, ...payload.body });
  } catch (error) {
    console.error("Work Chat API failed.", error);
    return errorResponse(response, error.status || 500, error.code || "WORK_CHAT_ERROR", error.message || "Work Chat request failed.");
  }
}

async function handleBootstrap({ supabase, actor }) {
  const [channels, users, mentionMessages] = await Promise.all([
    listChannels(supabase, { includeOrders: true }),
    listActiveUsers(supabase),
    listMentionMessages(supabase, actor.userId),
  ]);
  const unread = await getUnreadSummary(supabase, actor.userId, channels);
  return {
    body: {
      currentUser: publicUser(actor),
      channels: channels.filter((channel) => channel.channelType === "STANDARD"),
      orderThreads: channels.filter((channel) => channel.channelType === "ORDER").slice(0, 25),
      activeUsers: users,
      unreadByChannel: unread.byChannel,
      globalUnreadCount: unread.globalUnreadCount,
      unreadMentionCount: unread.unreadMentionCount,
      mentionMessages,
      defaultChannelId: channels.find((channel) => channel.channelKey === "general")?.id || channels[0]?.id || "",
    },
  };
}

async function handleChannelMessages(context) {
  const channelId = context.params.channelId || getPathPart(context.url.pathname, 3);
  if (!isUuid(channelId)) throw apiError("BAD_REQUEST", 400, "Channel id is required.");

  if (context.request.method === "GET") {
    const pageSize = clampNumber(context.url.searchParams.get("pageSize"), 1, MESSAGE_PAGE_SIZE, MESSAGE_PAGE_SIZE);
    const before = context.url.searchParams.get("before") || "";
    const messages = await listMessages(context.supabase, channelId, { pageSize, before });
    return { body: { messages } };
  }

  const body = await readJsonBody(context.request);
  const messageBody = cleanText(body.body, MAX_BODY_LENGTH);
  const mentionedUserIds = cleanUuidArray(body.mentionedUserIds);
  const attachmentIds = cleanUuidArray(body.attachmentIds);
  if (!messageBody && !attachmentIds.length) throw apiError("BAD_REQUEST", 400, "Message text or attachment is required.");

  const { data, error } = await context.supabase.rpc("work_chat_send_message", {
    p_channel_id: channelId,
    p_sender_user_id: context.actor.userId,
    p_body: messageBody || null,
    p_mentioned_user_ids: mentionedUserIds,
    p_prepared_attachment_ids: attachmentIds,
  });
  if (error) throw supabaseError(error);

  const [message] = await listMessages(context.supabase, channelId, { messageId: data?.messageId || data?.message_id });
  return { status: 201, body: { message } };
}

async function handleChannelRead({ request, supabase, actor, params, url }) {
  const channelId = params.channelId || getPathPart(url.pathname, 3);
  if (!isUuid(channelId)) throw apiError("BAD_REQUEST", 400, "Channel id is required.");
  const body = await readJsonBody(request);
  const messageId = cleanUuid(body.messageId || null);
  const { error } = await supabase.rpc("work_chat_mark_read", {
    p_channel_id: channelId,
    p_user_id: actor.userId,
    p_message_id: messageId,
  });
  if (error) throw supabaseError(error);
  return { body: { read: true } };
}

async function handleOrderThreads(context) {
  if (context.request.method === "GET") {
    const channels = (await listChannels(context.supabase, { includeOrders: true })).filter((channel) => channel.channelType === "ORDER");
    const unread = await getUnreadSummary(context.supabase, context.actor.userId, channels);
    return { body: { orderThreads: channels, unreadByChannel: unread.byChannel } };
  }

  const body = await readJsonBody(context.request);
  const orderId = cleanText(body.orderId || body.sourceRecordId, 200);
  if (!orderId) throw apiError("BAD_REQUEST", 400, "Order id is required.");

  const { data: order, error: orderError } = await context.supabase
    .from("ops_inquiries")
    .select("id,customer_name,product,quantity,status,odoo_so,created_at")
    .eq("id", orderId)
    .maybeSingle();
  if (orderError) throw supabaseError(orderError);
  if (!order || order.status !== "won") throw apiError("NOT_FOUND", 404, "Confirmed order was not found.");

  const channel = await upsertOrderChannel(context.supabase, order, context.actor.userId);
  return { status: 201, body: { channel } };
}

async function handleAttachmentPrepare({ request, supabase, actor }) {
  const body = await readJsonBody(request);
  const filename = cleanFilename(body.filename);
  const mimeType = cleanText(body.mimeType, 160).toLowerCase();
  const sizeBytes = Number(body.sizeBytes || 0);
  if (!filename) throw apiError("BAD_REQUEST", 400, "Attachment filename is required.");
  if (!mimeType) throw apiError("BAD_REQUEST", 400, "Attachment MIME type is required.");
  if (!ALLOWED_ATTACHMENT_TYPES.has(mimeType)) throw apiError("BAD_REQUEST", 400, "Attachment type is not allowed for Work Chat.");
  if (!Number.isFinite(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_ATTACHMENT_SIZE) {
    throw apiError("BAD_REQUEST", 400, "Attachment size must be 1 byte to 10 MB.");
  }

  const extension = filename.includes(".") ? `.${filename.split(".").pop().replace(/[^A-Za-z0-9]/g, "").slice(0, 12)}` : "";
  const preparedId = crypto.randomUUID();
  const storagePath = `${actor.userId}/${new Date().toISOString().slice(0, 10)}/${preparedId}${extension}`;
  const { data: signed, error: signedError } = await supabase.storage.from(BUCKET).createSignedUploadUrl(storagePath);
  if (signedError) throw supabaseError(signedError);

  const { data, error } = await supabase
    .from("work_chat_prepared_attachments")
    .insert({
      id: preparedId,
      bucket_id: BUCKET,
      storage_path: storagePath,
      original_filename: filename,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      uploaded_by_user_id: actor.userId,
    })
    .select("id,original_filename,mime_type,size_bytes,expires_at")
    .single();
  if (error) throw supabaseError(error);

  return {
    status: 201,
    body: {
      attachment: mapPreparedAttachment(data),
      upload: { path: storagePath, token: signed.token, signedUrl: signed.signedUrl },
    },
  };
}

async function handleAttachmentUrl({ supabase, params, url }) {
  const attachmentId = params.attachmentId || getPathPart(url.pathname, 3);
  if (!isUuid(attachmentId)) throw apiError("BAD_REQUEST", 400, "Attachment id is required.");
  const { data: attachment, error } = await supabase
    .from("work_chat_attachments")
    .select("id,bucket_id,storage_path,original_filename,mime_type,size_bytes")
    .eq("id", attachmentId)
    .maybeSingle();
  if (error) throw supabaseError(error);
  if (!attachment) throw apiError("NOT_FOUND", 404, "Attachment was not found.");
  const { data, error: signedError } = await supabase.storage.from(attachment.bucket_id || BUCKET).createSignedUrl(attachment.storage_path, 300);
  if (signedError) throw supabaseError(signedError);
  return { body: { attachment: mapAttachment(attachment), url: data.signedUrl, expiresIn: 300 } };
}

async function listChannels(supabase, { includeOrders = false } = {}) {
  let query = supabase
    .from("work_chat_channels")
    .select("id,channel_key,channel_type,name,source_record_type,source_record_id,updated_at,created_at")
    .order("updated_at", { ascending: false });
  if (!includeOrders) query = query.eq("channel_type", "STANDARD");
  const { data, error } = await query.limit(includeOrders ? 100 : 20);
  if (error) throw supabaseError(error);
  return (data || []).map(mapChannel);
}


async function listMentionMessages(supabase, userId) {
  const { data: mentions, error } = await supabase
    .from("work_chat_mentions")
    .select("message_id,channel_id,created_at,read_at")
    .eq("mentioned_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw supabaseError(error);
  if (!mentions?.length) return [];
  const messageIds = [...new Set(mentions.map((mention) => mention.message_id).filter(Boolean))];
  const channelIds = [...new Set(mentions.map((mention) => mention.channel_id).filter(Boolean))];
  const [{ data: messages, error: messageError }, { data: channels, error: channelError }] = await Promise.all([
    supabase.from("work_chat_messages").select("id,channel_id,sender_user_id,body,created_at,edited_at,deleted_at").in("id", messageIds),
    supabase.from("work_chat_channels").select("id,channel_key,channel_type,name,source_record_type,source_record_id,updated_at,created_at").in("id", channelIds),
  ]);
  if (messageError) throw supabaseError(messageError);
  if (channelError) throw supabaseError(channelError);
  const hydrated = await hydrateMessages(supabase, messages || []);
  const messagesById = new Map(hydrated.map((message) => [message.id, message]));
  const channelsById = new Map((channels || []).map((channel) => [channel.id, mapChannel(channel)]));
  return mentions.map((mention) => ({
    ...(messagesById.get(mention.message_id) || {}),
    channel: channelsById.get(mention.channel_id) || null,
    mentionReadAt: mention.read_at,
  })).filter((message) => message.id);
}
async function listActiveUsers(supabase) {
  const { data, error } = await supabase
    .from("admin_users")
    .select("user_id,email,display_name,role")
    .eq("is_active", true)
    .in("role", ["owner", "admin", "staff"])
    .order("display_name", { ascending: true });
  if (error) throw supabaseError(error);
  return (data || []).map((row) => publicUser({
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
  }));
}

async function listMessages(supabase, channelId, { pageSize = MESSAGE_PAGE_SIZE, before = "", messageId = "" } = {}) {
  let query = supabase
    .from("work_chat_messages")
    .select("id,channel_id,sender_user_id,body,created_at,edited_at,deleted_at")
    .eq("channel_id", channelId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(messageId ? 1 : pageSize);
  if (messageId) query = query.eq("id", messageId);
  if (before) query = query.lt("created_at", before);
  const { data, error } = await query;
  if (error) throw supabaseError(error);
  const messages = (data || []).slice().reverse();
  return hydrateMessages(supabase, messages);
}

async function hydrateMessages(supabase, messages) {
  if (!messages.length) return [];
  const messageIds = messages.map((message) => message.id);
  const userIds = [...new Set(messages.map((message) => message.sender_user_id).filter(Boolean))];
  const [{ data: users, error: usersError }, { data: attachments, error: attachmentsError }, { data: mentions, error: mentionsError }] = await Promise.all([
    supabase.from("admin_users").select("user_id,email,display_name,role").in("user_id", userIds),
    supabase.from("work_chat_attachments").select("id,message_id,original_filename,mime_type,size_bytes").in("message_id", messageIds),
    supabase.from("work_chat_mentions").select("message_id,mentioned_user_id").in("message_id", messageIds),
  ]);
  if (usersError) throw supabaseError(usersError);
  if (attachmentsError) throw supabaseError(attachmentsError);
  if (mentionsError) throw supabaseError(mentionsError);

  const usersById = new Map((users || []).map((row) => [row.user_id, row]));
  const attachmentsByMessage = groupBy(attachments || [], "message_id");
  const mentionsByMessage = groupBy(mentions || [], "message_id");
  return messages.map((message) => ({
    id: message.id,
    channelId: message.channel_id,
    senderUserId: message.sender_user_id,
    sender: publicUser({
      userId: message.sender_user_id,
      email: usersById.get(message.sender_user_id)?.email,
      displayName: usersById.get(message.sender_user_id)?.display_name,
      role: usersById.get(message.sender_user_id)?.role,
    }),
    body: message.body || "",
    createdAt: message.created_at,
    editedAt: message.edited_at,
    attachments: (attachmentsByMessage.get(message.id) || []).map(mapAttachment),
    mentionedUserIds: (mentionsByMessage.get(message.id) || []).map((mention) => mention.mentioned_user_id),
  }));
}

async function getUnreadSummary(supabase, userId, channels) {
  const byChannel = {};
  if (!channels.length) return { byChannel, globalUnreadCount: 0, unreadMentionCount: 0 };
  const channelIds = channels.map((channel) => channel.id);
  const { data: reads, error: readsError } = await supabase
    .from("work_chat_channel_reads")
    .select("channel_id,last_read_at")
    .eq("user_id", userId)
    .in("channel_id", channelIds);
  if (readsError) throw supabaseError(readsError);
  const readMap = new Map((reads || []).map((read) => [read.channel_id, read.last_read_at]));

  let globalUnreadCount = 0;
  await Promise.all(channelIds.map(async (channelId) => {
    const lastReadAt = readMap.get(channelId);
    let query = supabase
      .from("work_chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("channel_id", channelId)
      .neq("sender_user_id", userId);
    if (lastReadAt) query = query.gt("created_at", lastReadAt);
    const { count, error } = await query;
    if (error) throw supabaseError(error);
    byChannel[channelId] = count || 0;
    globalUnreadCount += count || 0;
  }));

  const { count: mentionCount, error: mentionError } = await supabase
    .from("work_chat_mentions")
    .select("id", { count: "exact", head: true })
    .eq("mentioned_user_id", userId)
    .is("read_at", null);
  if (mentionError) throw supabaseError(mentionError);
  return { byChannel, globalUnreadCount, unreadMentionCount: mentionCount || 0 };
}

async function upsertOrderChannel(supabase, order, userId) {
  const channelKey = `order:${order.id}`;
  const name = `${order.id} - ${order.customer_name || "Order"}`.slice(0, 120);
  const { data, error } = await supabase
    .from("work_chat_channels")
    .upsert({
      channel_key: channelKey,
      channel_type: "ORDER",
      name,
      source_record_type: "ops_inquiries",
      source_record_id: order.id,
      created_by_user_id: userId,
    }, { onConflict: "channel_key" })
    .select("id,channel_key,channel_type,name,source_record_type,source_record_id,updated_at,created_at")
    .single();
  if (error) throw supabaseError(error);
  return mapChannel(data);
}

function getRoute(request, url) {
  const action = getQueryValue(request, url, "_wcAction");
  return action ? ROUTES_BY_ACTION.get(action) : ROUTES.find((route) => route.pattern.test(url.pathname));
}

function getRoutingParams(request, url) {
  return {
    channelId: getQueryValue(request, url, "channelId") || getPathPart(url.pathname, 3),
    attachmentId: getQueryValue(request, url, "attachmentId") || getPathPart(url.pathname, 3),
  };
}

function getPathPart(pathname, index) {
  return pathname.split("/").filter(Boolean)[index] || "";
}

function getQueryValue(request, url, key) {
  const raw = request.query?.[key] ?? url.searchParams.get(key);
  return Array.isArray(raw) ? raw[0] : raw;
}

function mapChannel(row) {
  return {
    id: row.id,
    channelKey: row.channel_key,
    channelType: row.channel_type,
    name: row.name,
    sourceRecordType: row.source_record_type,
    sourceRecordId: row.source_record_id,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

function mapAttachment(row) {
  return {
    id: row.id,
    filename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes || 0),
  };
}

function mapPreparedAttachment(row) {
  return {
    id: row.id,
    filename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes || 0),
    expiresAt: row.expires_at,
  };
}

function publicUser(user) {
  return {
    userId: user.userId,
    email: user.email || "",
    displayName: user.displayName || user.email || "Staff",
    role: user.role || "staff",
  };
}

function cleanUuidArray(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(cleanUuid).filter(Boolean))];
}

function cleanUuid(value) {
  const text = String(value || "").trim();
  return isUuid(text) ? text : "";
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function cleanFilename(value) {
  return String(value || "").trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").slice(0, 240);
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const groupKey = row[key];
    const group = map.get(groupKey) || [];
    group.push(row);
    map.set(groupKey, group);
  }
  return map;
}

function supabaseError(error) {
  const status = error.status || error.statusCode || 500;
  return apiError(error.code || "SUPABASE_ERROR", status >= 400 ? status : 500, error.message || "Supabase request failed.");
}

function apiError(code, status, message) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function errorResponse(response, status, code, message) {
  return sendJson(response, status, { ok: false, error: { code, message } });
}
