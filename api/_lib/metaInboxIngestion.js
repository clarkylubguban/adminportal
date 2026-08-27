import { createHash } from "node:crypto";
import { cleanReplyText } from "./metaSend.js";
import { enrichMetaProfilesForEvents, persistMetaProfileEnrichment } from "./metaProfileEnrichment.js";

const CHANNEL = "facebook_messenger";
const OPEN_STATES = new Set(["needs_reply", "waiting", "follow_up", "converted"]);
const ATTACHMENT_TYPES = new Set(["image", "file", "audio", "video", "sticker"]);

export async function ingestMetaWebhookPayload(payload, options) {
  const repository = options.repository;
  const receivedAt = options.receivedAt || new Date();
  const events = extractMessagingEvents(payload);
  if (typeof repository.ingestNormalizedEvents === "function") {
    const normalized = events.map((event) => normalizeMessagingEvent(event));
    const enrichment = await enrichMetaProfilesForEvents(normalized, {
      repository,
      env: options.env,
      fetchImpl: options.fetchImpl,
      now: receivedAt,
      timeoutMs: options.profileTimeoutMs,
    }).catch(() => ({ successes: [], failures: [], skipped: normalized.length }));
    await repository.ingestNormalizedEvents({
      events: normalized.map(serializeNormalizedEvent),
      receivedAt,
      objectType: payload.object || "page",
    });
    await persistMetaProfileEnrichment(enrichment, { repository, now: receivedAt }).catch(() => null);
    return;
  }
  for (const event of events) {
    await ingestMessagingEvent(event, { repository, receivedAt, objectType: payload.object });
  }
}

export function extractMessagingEvents(payload) {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  const events = [];
  for (const entry of entries) {
    const pageId = cleanText(entry.id, 200);
    for (const field of ["messaging", "standby"]) {
      const items = Array.isArray(entry[field]) ? entry[field] : [];
      for (const item of items) events.push({ pageId, standby: field === "standby", item });
    }
  }
  return events;
}

export async function ingestMessagingEvent(event, context) {
  const normalized = normalizeMessagingEvent(event);
  const webhook = await context.repository.recordWebhookEvent({
    eventKey: normalized.eventKey,
    objectType: context.objectType || "page",
    pageId: normalized.pageId,
    eventType: normalized.eventType,
    payload: normalized.raw,
    processingStatus: normalized.shouldProcess ? "received" : "ignored",
    receivedAt: context.receivedAt,
  });
  if (webhook.duplicate || !normalized.shouldProcess) return { status: webhook.duplicate ? "duplicate" : "ignored" };

  try {
    const page = await context.repository.ensurePageConnection(normalized.pageId, context.receivedAt);
    let conversation = null;
    if (normalized.customerPsid) {
      const identity = await context.repository.ensureChannelIdentity({
        pageConnectionId: page.id,
        channel: CHANNEL,
        externalUserId: normalized.customerPsid,
        displayName: normalized.customerDisplayName,
        lastSeenAt: normalized.eventTime,
      });
      conversation = await context.repository.ensureOpenConversation({
        channelIdentityId: identity.id,
        state: normalized.conversationState,
        lastMessageAt: normalized.message ? normalized.eventTime : null,
        attribution: normalized.referralAttribution,
      });
    }

    if (conversation && normalized.message) {
      const message = await context.repository.upsertMessage({
        conversationId: conversation.id,
        webhookEventId: webhook.id,
        externalMessageId: normalized.message.externalMessageId,
        direction: normalized.message.direction,
        messageType: normalized.message.messageType,
        body: normalized.message.body,
        senderExternalId: normalized.message.senderExternalId,
        isEcho: normalized.message.isEcho,
        sentAt: normalized.eventTime,
        metadata: normalized.message.metadata,
      });
      if (!message.duplicate) {
        for (const attachment of normalized.attachments) {
          await context.repository.createAttachment({
            messageId: message.id,
            externalAttachmentId: attachment.externalAttachmentId,
            attachmentType: attachment.attachmentType,
            sourceUrl: attachment.sourceUrl,
            originalFilename: attachment.originalFilename,
            mimeType: attachment.mimeType,
            metadata: attachment.metadata,
          });
        }
      }
    }

    if (conversation && normalized.delivery) {
      await context.repository.markDelivered({
        conversationId: conversation.id,
        messageIds: normalized.delivery.messageIds,
        deliveredAt: normalized.eventTime,
      });
    }

    if (conversation && normalized.read) {
      await context.repository.markRead({
        conversationId: conversation.id,
        watermark: normalized.eventTime,
      });
    }

    await context.repository.markWebhookProcessed(webhook.id, "processed", context.receivedAt);
    return { status: "processed" };
  } catch (error) {
    await context.repository.markWebhookProcessed(webhook.id, "failed", context.receivedAt, safeErrorSummary(error));
    throw error;
  }
}

export function normalizeMessagingEvent(event) {
  const item = event.item || {};
  const pageId = cleanText(event.pageId || item.recipient?.id || item.sender?.id, 200);
  const timestamp = metaTime(item.timestamp || item.read?.watermark || item.delivery?.watermark);
  const senderId = cleanText(item.sender?.id, 240);
  const recipientId = cleanText(item.recipient?.id, 240);
  const message = item.message && typeof item.message === "object" ? item.message : null;
  const delivery = item.delivery && typeof item.delivery === "object" ? item.delivery : null;
  const read = item.read && typeof item.read === "object" ? item.read : null;
  const referral = item.referral && typeof item.referral === "object" ? item.referral : null;
  const postbackReferral = item.postback?.referral && typeof item.postback.referral === "object" ? item.postback.referral : null;
  const effectiveReferral = referral || postbackReferral;
  const eventType = classifyEvent(item, event.standby);
  const mid = cleanText(message?.mid, 500);
  const eventKey = mid ? `meta:message:${mid}` : `meta:${eventType}:${stableHash({ pageId, senderId, recipientId, timestamp: timestamp.toISOString(), item })}`;
  const isEcho = message?.is_echo === true;
  const customerPsid = deriveCustomerPsid({ pageId, senderId, recipientId, isEcho, eventType });
  const direction = isEcho ? "outbound" : "inbound";

  const normalized = {
    eventKey,
    pageId,
    eventType,
    raw: item,
    eventTime: timestamp,
    shouldProcess: Boolean(pageId) && eventType !== "unknown",
    customerPsid,
    customerDisplayName: "",
    conversationState: isEcho || eventType === "delivery" || eventType === "read" ? "waiting" : "needs_reply",
    message: null,
    attachments: [],
    delivery: null,
    read: null,
    referralAttribution: effectiveReferral ? referralAttribution(effectiveReferral) : null,
  };

  if (message) {
    const body = cleanNullableText(message.text, 10000);
    normalized.message = {
      externalMessageId: mid || null,
      direction,
      messageType: messageType(message),
      body,
      bodyHash: isEcho ? createReplyBodyHash(body) : null,
      senderExternalId: senderId || null,
      isEcho,
      metadata: stripUndefined({
        rawMessage: message,
        quickReply: message.quick_reply || null,
        referral: effectiveReferral || null,
        standby: event.standby === true,
      }),
    };
    normalized.attachments = attachmentsFromMessage(message);
  } else if (delivery) {
    normalized.delivery = {
      messageIds: Array.isArray(delivery.mids) ? delivery.mids.map((value) => cleanText(value, 500)).filter(Boolean) : [],
    };
  } else if (read) {
    normalized.read = true;
  }

  return normalized;
}

export function createSupabaseMetaInboxRepository(client) {
  return new SupabaseMetaInboxRepository(client);
}

class SupabaseMetaInboxRepository {
  constructor(client) {
    this.client = client;
  }

  async ingestNormalizedEvents(row) {
    const { error } = await this.client.rpc("ingest_meta_messenger_events", {
      events: row.events,
      received_at: row.receivedAt.toISOString(),
      object_type: row.objectType || "page",
    });
    if (error) throw error;
  }

  async recordWebhookEvent(row) {
    const payload = {
      event_key: row.eventKey,
      object_type: row.objectType,
      page_id: row.pageId,
      event_type: row.eventType,
      payload: row.payload,
      processing_status: row.processingStatus,
      received_at: row.receivedAt.toISOString(),
    };
    const { data, error } = await this.client.from("meta_webhook_events").insert(payload).select("id").single();
    if (isUnique(error)) {
      const existing = await this.single("meta_webhook_events", "event_key", row.eventKey);
      return { id: existing?.id || null, duplicate: true };
    }
    if (error) throw error;
    return { id: data.id, duplicate: false };
  }

  async markWebhookProcessed(id, status, processedAt, summary = null) {
    if (!id) return;
    await this.client.from("meta_webhook_events").update({
      processing_status: status,
      processed_at: processedAt.toISOString(),
      last_error_summary: summary,
    }).eq("id", id);
  }

  async ensurePageConnection(pageId, now) {
    const existing = await this.single("meta_page_connections", "page_id", pageId);
    if (existing) {
      await this.client.from("meta_page_connections").update({ last_webhook_at: now.toISOString() }).eq("id", existing.id);
      return existing;
    }
    const { data, error } = await this.client.from("meta_page_connections").insert({
      page_id: pageId,
      status: "testing",
      last_webhook_at: now.toISOString(),
    }).select("id,page_id").single();
    if (isUnique(error)) return this.single("meta_page_connections", "page_id", pageId);
    if (error) throw error;
    return data;
  }

  async ensureChannelIdentity(row) {
    const found = await this.findIdentity(row.pageConnectionId, row.channel, row.externalUserId);
    if (found) return found;

    const { data: contact, error: contactError } = await this.client.from("inbox_contacts").insert({
      display_name: row.displayName || null,
      metadata: {},
    }).select("id").single();
    if (contactError) throw contactError;

    const { data, error } = await this.client.from("inbox_channel_identities").insert({
      contact_id: contact.id,
      page_connection_id: row.pageConnectionId,
      channel: row.channel,
      external_user_id: row.externalUserId,
      display_name: row.displayName || null,
      last_seen_at: row.lastSeenAt?.toISOString?.() || null,
      metadata: {},
    }).select("id,contact_id").single();
    if (isUnique(error)) return this.findIdentity(row.pageConnectionId, row.channel, row.externalUserId);
    if (error) throw error;
    return data;
  }

  async ensureOpenConversation(row) {
    const existing = await this.findOpenConversation(row.channelIdentityId);
    const updates = stripUndefined({
      state: row.state,
      last_message_at: row.lastMessageAt?.toISOString?.(),
      entry_source: row.attribution?.entrySource,
      referral_ref: row.attribution?.ref,
      ad_id: row.attribution?.adId,
      ad_name: row.attribution?.adName,
      campaign_id: row.attribution?.campaignId,
      campaign_name: row.attribution?.campaignName,
      metadata: row.attribution ? { referral: row.attribution.raw } : undefined,
    });
    if (existing) {
      if (Object.keys(updates).length) await this.client.from("inbox_conversations").update(updates).eq("id", existing.id);
      return existing;
    }
    const { data, error } = await this.client.from("inbox_conversations").insert({
      channel_identity_id: row.channelIdentityId,
      state: row.state || "needs_reply",
      last_message_at: row.lastMessageAt?.toISOString?.() || null,
      entry_source: row.attribution?.entrySource || null,
      referral_ref: row.attribution?.ref || null,
      ad_id: row.attribution?.adId || null,
      ad_name: row.attribution?.adName || null,
      campaign_id: row.attribution?.campaignId || null,
      campaign_name: row.attribution?.campaignName || null,
      metadata: row.attribution ? { referral: row.attribution.raw } : {},
    }).select("id").single();
    if (isUnique(error)) return this.findOpenConversation(row.channelIdentityId);
    if (error) throw error;
    return data;
  }

  async upsertMessage(row) {
    if (row.externalMessageId) {
      const existing = await this.single("inbox_messages", "external_message_id", row.externalMessageId);
      if (existing) return { ...existing, duplicate: true };
    }
    const { data, error } = await this.client.from("inbox_messages").insert({
      conversation_id: row.conversationId,
      webhook_event_id: row.webhookEventId,
      external_message_id: row.externalMessageId,
      direction: row.direction,
      message_type: row.messageType,
      body: row.body,
      sender_external_id: row.senderExternalId,
      is_echo: row.isEcho,
      sent_at: row.sentAt.toISOString(),
      metadata: row.metadata,
    }).select("id").single();
    if (isUnique(error) && row.externalMessageId) {
      const existing = await this.single("inbox_messages", "external_message_id", row.externalMessageId);
      return { ...existing, duplicate: true };
    }
    if (error) throw error;
    return { id: data.id, duplicate: false };
  }

  async createAttachment(row) {
    const { error } = await this.client.from("inbox_attachments").insert({
      message_id: row.messageId,
      external_attachment_id: row.externalAttachmentId,
      attachment_type: row.attachmentType,
      source_url: row.sourceUrl,
      original_filename: row.originalFilename,
      mime_type: row.mimeType,
      ingestion_status: "pending",
      metadata: row.metadata,
    });
    if (error && !isUnique(error)) throw error;
  }

  async markDelivered(row) {
    if (!row.messageIds.length) return;
    await this.client.from("inbox_messages").update({ delivered_at: row.deliveredAt.toISOString() })
      .eq("conversation_id", row.conversationId)
      .in("external_message_id", row.messageIds);
  }

  async markRead(row) {
    const { data, error } = await this.client.from("inbox_messages").select("id,read_at")
      .eq("conversation_id", row.conversationId)
      .eq("direction", "outbound");
    if (error) throw error;
    for (const message of data || []) {
      if (message.read_at && Date.parse(message.read_at) >= row.watermark.getTime()) continue;
      const result = await this.client.from("inbox_messages")
        .update({ read_at: row.watermark.toISOString() })
        .eq("id", message.id);
      if (result.error) throw result.error;
    }
  }

  async single(table, column, value) {
    const { data, error } = await this.client.from(table).select("*").eq(column, value).maybeSingle();
    if (error) throw error;
    return data;
  }

  async findIdentity(pageConnectionId, channel, externalUserId) {
    const { data, error } = await this.client.from("inbox_channel_identities").select("*")
      .eq("page_connection_id", pageConnectionId)
      .eq("channel", channel)
      .eq("external_user_id", externalUserId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async findOpenConversation(identityId) {
    const { data, error } = await this.client.from("inbox_conversations").select("*")
      .eq("channel_identity_id", identityId)
      .neq("state", "closed")
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async getProfileEnrichmentTarget({ pageId, channel, externalUserId }) {
    const page = await this.single("meta_page_connections", "page_id", pageId);
    if (!page) return null;
    const identity = await this.findIdentity(page.id, channel, externalUserId);
    if (!identity) return null;
    const contact = identity.contact_id ? await this.single("inbox_contacts", "id", identity.contact_id) : null;
    return normalizeProfileTarget({ page, identity, contact });
  }

  async getProfileEnrichmentTargetForConversation(conversationId) {
    const conversation = await this.single("inbox_conversations", "id", conversationId);
    if (!conversation) return null;
    const identity = await this.single("inbox_channel_identities", "id", conversation.channel_identity_id);
    if (!identity) return null;
    const page = await this.single("meta_page_connections", "id", identity.page_connection_id);
    const contact = identity.contact_id ? await this.single("inbox_contacts", "id", identity.contact_id) : null;
    return normalizeProfileTarget({ page, identity, contact });
  }

  async applyProfileEnrichment({ pageId, channel, externalUserId, target = null, profile, now }) {
    const found = target?.identityId
      ? target
      : await this.getProfileEnrichmentTarget({ pageId, channel, externalUserId });
    if (!found?.identityId || !profile?.displayName) return { ok: false };

    const currentMetadata = found.metadata && typeof found.metadata === "object" ? found.metadata : {};
    const profileStatus = {
      status: "success",
      last_attempt_at: now.toISOString(),
      last_success_at: now.toISOString(),
      fields: profile.fields || {},
    };
    const identityUpdates = {
      display_name: found.displayName || profile.displayName,
      profile_picture_url: found.profilePictureUrl || profile.profilePictureUrl || null,
      metadata: { ...currentMetadata, profile_enrichment: profileStatus },
    };
    const identityResult = await this.client.from("inbox_channel_identities").update(identityUpdates).eq("id", found.identityId);
    if (identityResult.error) throw identityResult.error;

    if (found.contactId && !found.contactDisplayName) {
      const contactMetadata = found.contactMetadata && typeof found.contactMetadata === "object" ? found.contactMetadata : {};
      const contactResult = await this.client.from("inbox_contacts").update({
        display_name: profile.displayName,
        metadata: { ...contactMetadata, profile_enrichment: profileStatus },
      }).eq("id", found.contactId);
      if (contactResult.error) throw contactResult.error;
    }
    return { ok: true };
  }

  async recordProfileEnrichmentFailure({ pageId, channel, externalUserId, target = null, errorCode, now }) {
    const found = target?.identityId
      ? target
      : await this.getProfileEnrichmentTarget({ pageId, channel, externalUserId });
    if (!found?.identityId) return { ok: false };
    const currentMetadata = found.metadata && typeof found.metadata === "object" ? found.metadata : {};
    const { error } = await this.client.from("inbox_channel_identities").update({
      metadata: {
        ...currentMetadata,
        profile_enrichment: {
          status: "failed",
          last_attempt_at: now.toISOString(),
          safe_error_code: errorCode || "META_PROFILE_FAILED",
        },
      },
    }).eq("id", found.identityId);
    if (error) throw error;
    return { ok: true };
  }
}

function normalizeProfileTarget({ page, identity, contact }) {
  return {
    pageId: page?.page_id || "",
    channel: identity?.channel || CHANNEL,
    externalUserId: identity?.external_user_id || "",
    identityId: identity?.id || "",
    contactId: identity?.contact_id || "",
    displayName: cleanText(identity?.display_name, 240),
    contactDisplayName: cleanText(contact?.display_name, 200),
    profilePictureUrl: cleanText(identity?.profile_picture_url, 2048),
    metadata: identity?.metadata || {},
    contactMetadata: contact?.metadata || {},
  };
}

function serializeNormalizedEvent(event) {
  return {
    eventKey: event.eventKey,
    pageId: event.pageId,
    eventType: event.eventType,
    raw: event.raw,
    eventTime: event.eventTime.toISOString(),
    shouldProcess: event.shouldProcess,
    customerPsid: event.customerPsid,
    customerDisplayName: event.customerDisplayName,
    conversationState: event.conversationState,
    message: event.message,
    attachments: event.attachments,
    delivery: event.delivery,
    read: event.read,
    referralAttribution: event.referralAttribution,
  };
}

function classifyEvent(item, standby) {
  if (standby) return "standby";
  if (item.message?.is_echo === true) return "message_echo";
  if (item.message) return "message";
  if (item.delivery) return "delivery";
  if (item.read) return "read";
  if (item.referral || item.postback?.referral) return "referral";
  return "unknown";
}

function deriveCustomerPsid({ pageId, senderId, recipientId, isEcho }) {
  if (isEcho && senderId === pageId) return recipientId;
  if (senderId && senderId !== pageId) return senderId;
  if (recipientId && recipientId !== pageId) return recipientId;
  return senderId || recipientId || "";
}

function messageType(message) {
  const first = Array.isArray(message.attachments) ? message.attachments[0] : null;
  if (!first) return "text";
  const type = cleanText(first.type, 40);
  return ATTACHMENT_TYPES.has(type) ? type : "unknown";
}

function attachmentsFromMessage(message) {
  if (!Array.isArray(message.attachments)) return [];
  return message.attachments.map((attachment) => {
    const payload = attachment?.payload && typeof attachment.payload === "object" ? attachment.payload : {};
    const type = cleanText(attachment?.type, 40);
    return {
      externalAttachmentId: cleanNullableText(payload.attachment_id || payload.sticker_id, 500),
      attachmentType: ATTACHMENT_TYPES.has(type) ? type : "unknown",
      sourceUrl: cleanNullableText(payload.url, 4096),
      originalFilename: cleanNullableText(payload.name || attachment.name, 240),
      mimeType: cleanNullableText(payload.mime_type || attachment.mime_type, 200),
      metadata: stripUndefined({ attachment, pendingPrivateIngestion: true }),
    };
  });
}

function referralAttribution(referral) {
  return {
    entrySource: cleanNullableText(referral.source || referral.type, 120),
    ref: cleanNullableText(referral.ref, 1000),
    adId: cleanNullableText(referral.ad_id || referral.ads_context_data?.ad_id, 240),
    adName: cleanNullableText(referral.ads_context_data?.ad_title, 500),
    campaignId: cleanNullableText(referral.campaign_id, 240),
    campaignName: cleanNullableText(referral.campaign_name, 500),
    raw: referral,
  };
}

function metaTime(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const ms = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    return new Date(ms);
  }
  return new Date();
}

function stableHash(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function createReplyBodyHash(value) {
  const result = cleanReplyText(value);
  return result.ok ? createHash("sha256").update(result.text).digest("hex") : null;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, stripUndefined(item)]),
  );
}

function cleanText(value, max) {
  return String(value || "").trim().slice(0, max);
}

function cleanNullableText(value, max) {
  const normalized = cleanText(value, max);
  return normalized || null;
}

function safeErrorSummary(error) {
  return String(error?.code || error?.message || "INGESTION_FAILED").slice(0, 1000);
}

function isUnique(error) {
  return String(error?.code || "") === "23505";
}
