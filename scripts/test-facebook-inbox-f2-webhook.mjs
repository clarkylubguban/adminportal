import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import taskAutomationHandler, { config } from "../api/task-automation.js";
import { signMetaBody } from "../api/_lib/metaWebhook.js";

const SECRET = "synthetic-meta-app-secret-at-least-32-characters";
const VERIFY_TOKEN = "synthetic-verify-token";
const PAGE_ID = "PAGE-100";
const CUSTOMER_ID = "PSID-200";
const NOW = new Date("2026-08-25T12:00:00.000Z");

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("Meta webhook shares the task-automation serverless entrypoint", async () => {
  const vercel = JSON.parse(await readFile("vercel.json", "utf8"));
  const rewrite = vercel.rewrites.find((item) => item.source === "/api/integrations/meta/webhook");
  assert.equal(rewrite?.destination, "/api/task-automation");
  assert.equal(config.api.bodyParser, false);
  await assert.rejects(access("api/meta-webhook.js"), /ENOENT/);
});

test("GET verification accepts the correct token and rejects wrong or missing config", async () => {
  const ok = await invokeGet(`/api/integrations/meta/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=CHALLENGE`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body, "CHALLENGE");

  const wrong = await invokeGet("/api/integrations/meta/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=CHALLENGE");
  assert.equal(wrong.status, 403);

  const missing = await invokeGet(`/api/integrations/meta/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=CHALLENGE`, { verifyToken: "" });
  assert.equal(missing.status, 503);
});

test("signature validation accepts valid raw HMAC and rejects missing, invalid, and altered bodies", async () => {
  const repo = new MemoryMetaInboxRepository();
  assert.equal((await invokePost(pagePayload([messageEvent("MID-SIG", "signed")]), { repo })).status, 200);
  assert.equal(repo.messages.length, 1);

  assert.equal((await invokeRaw(Buffer.from("{}"), {}, { repo: new MemoryMetaInboxRepository() })).status, 401);

  const invalid = await invokePost(pagePayload([messageEvent("MID-BAD", "bad")]), {
    signature: `sha256=${"0".repeat(64)}`,
    repo: new MemoryMetaInboxRepository(),
  });
  assert.equal(invalid.status, 401);

  const raw = Buffer.from(JSON.stringify(pagePayload([messageEvent("MID-TAMPER", "original")])));
  const tampered = Buffer.from(JSON.stringify(pagePayload([messageEvent("MID-TAMPER", "changed")])));
  const altered = await invokeRaw(tampered, { "x-hub-signature-256": signMetaBody(raw, SECRET) }, { repo: new MemoryMetaInboxRepository() });
  assert.equal(altered.status, 401);
});

test("payload validation handles invalid JSON, payload limit, and non-page objects", async () => {
  const invalidJson = await invokeRaw(Buffer.from("{not-json"), { "x-hub-signature-256": signMetaBody(Buffer.from("{not-json"), SECRET) });
  assert.equal(invalidJson.status, 400);

  const tooLarge = await invokePost(pagePayload([messageEvent("MID-LARGE", "large")]), { limits: { maxPayloadBytes: 10 } });
  assert.equal(tooLarge.status, 413);

  const repo = new MemoryMetaInboxRepository();
  const nonPage = await invokePost({ object: "instagram", entry: [{ id: PAGE_ID, messaging: [messageEvent("MID-NONPAGE")] }] }, { repo });
  assert.equal(nonPage.status, 200);
  assert.equal(repo.webhookEvents.length, 0);
  assert.equal(repo.messages.length, 0);
});

test("inbound messages normalize once, preserve Meta time, and set needs_reply", async () => {
  const repo = new MemoryMetaInboxRepository();
  const payload = pagePayload([messageEvent("MID-INBOUND", "hello", 1787654321000)]);
  assert.equal((await invokePost(payload, { repo })).status, 200);
  assert.equal((await invokePost(payload, { repo })).status, 200);

  assert.equal(repo.webhookEvents.length, 1);
  assert.equal(repo.contacts.length, 1);
  assert.equal(repo.identities.length, 1);
  assert.equal(repo.conversations.length, 1);
  assert.equal(repo.messages.length, 1);
  assert.equal(repo.messages[0].sent_at, "2026-08-25T10:38:41.000Z");
  assert.equal(repo.conversations[0].state, "needs_reply");
  assert.equal(repo.conversations[0].reply_window_expires_at, "2026-08-26T10:38:41.000Z");
});

test("message echoes map page sender to customer recipient and set waiting", async () => {
  const repo = new MemoryMetaInboxRepository();
  await invokePost(pagePayload([echoEvent("MID-ECHO", "business reply")]), { repo });
  assert.equal(repo.identities[0].external_user_id, CUSTOMER_ID);
  assert.equal(repo.messages[0].direction, "outbound");
  assert.equal(repo.messages[0].is_echo, true);
  assert.equal(repo.conversations[0].state, "waiting");

  await invokePost(pagePayload([echoEvent("MID-ECHO", "business reply")]), { repo });
  assert.equal(repo.messages.length, 1);
});

test("delivery receipts update outbound messages without fake message rows", async () => {
  const repo = new MemoryMetaInboxRepository();
  await invokePost(pagePayload([echoEvent("MID-DELIVERY", "reply", 1787654321000)]), { repo });
  await invokePost(pagePayload([deliveryEvent(["MID-DELIVERY"], 1787654381000)]), { repo });
  assert.equal(repo.messages.length, 1);
  assert.equal(repo.messages[0].delivered_at, "2026-08-25T10:39:41.000Z");
});

test("read receipts update outbound messages without fake rows or time regression", async () => {
  const repo = new MemoryMetaInboxRepository();
  await invokePost(pagePayload([echoEvent("MID-READ", "reply", 1787654321000)]), { repo });
  await invokePost(pagePayload([readEvent(1787654381000)]), { repo });
  await invokePost(pagePayload([readEvent(1787654300000)]), { repo });
  assert.equal(repo.messages.length, 1);
  assert.equal(repo.messages[0].read_at, "2026-08-25T10:39:41.000Z");
});

test("referrals persist supplied attribution without inventing campaign data", async () => {
  const repo = new MemoryMetaInboxRepository();
  await invokePost(pagePayload([referralEvent()]), { repo });
  const conversation = repo.conversations[0];
  assert.equal(conversation.entry_source, "ADS");
  assert.equal(conversation.referral_ref, "shirt-campaign-ref");
  assert.equal(conversation.ad_id, "AD-123");
  assert.equal(conversation.ad_name, null);
  assert.equal(conversation.campaign_id, null);
  assert.equal(conversation.campaign_name, null);
});

test("attachments create pending metadata rows without downloading files", async () => {
  const repo = new MemoryMetaInboxRepository();
  await invokePost(pagePayload([attachmentEvent()]), { repo });
  assert.equal(repo.messages.length, 1);
  assert.equal(repo.attachments.length, 1);
  assert.equal(repo.attachments[0].attachment_type, "image");
  assert.equal(repo.attachments[0].source_url, "https://example.invalid/meta-image.jpg");
  assert.equal(repo.attachments[0].ingestion_status, "pending");
});

test("standby and unknown events are retained safely and do not crash", async () => {
  const repo = new MemoryMetaInboxRepository();
  const standby = pagePayload([], [messageEvent("MID-STANDBY", "standby")]);
  assert.equal((await invokePost(standby, { repo })).status, 200);
  assert.equal(repo.messages[0].metadata.standby, true);

  const unknown = pagePayload([{ sender: { id: CUSTOMER_ID }, recipient: { id: PAGE_ID }, timestamp: 1787654321000, reaction: { action: "react" } }]);
  assert.equal((await invokePost(unknown, { repo })).status, 200);
  assert.equal(repo.webhookEvents.at(-1).event_type, "unknown");
  assert.equal(repo.webhookEvents.at(-1).processing_status, "ignored");
  assert.equal(repo.messages.length, 1);
});

test("unsupported methods return 405 with Allow header", async () => {
  const result = await invoke("PUT", "/api/integrations/meta/webhook", Buffer.alloc(0), {});
  assert.equal(result.status, 405);
  assert.equal(result.headers.allow, "GET, POST");
});

async function invokeGet(url, options = {}) {
  return invoke("GET", url, Buffer.alloc(0), {}, options);
}

async function invokePost(payload, options = {}) {
  const raw = Buffer.from(JSON.stringify(payload), "utf8");
  const headers = { "x-hub-signature-256": options.signature || signMetaBody(raw, SECRET) };
  return invokeRaw(raw, headers, options);
}

async function invokeRaw(raw, headers, options = {}) {
  return invoke("POST", "/api/integrations/meta/webhook", raw, headers, options);
}

async function invoke(method, url, raw, headers = {}, options = {}) {
  const request = Readable.from(raw.length ? [raw] : []);
  request.method = method;
  request.url = url;
  request.headers = headers;
  const response = createResponse();
  await taskAutomationHandler(request, response, {
    appSecret: options.appSecret ?? SECRET,
    verifyToken: options.verifyToken ?? VERIFY_TOKEN,
    repository: options.repo || new MemoryMetaInboxRepository(),
    receivedAt: NOW,
    limits: options.limits,
  });
  return response.result();
}

function pagePayload(messaging, standby = []) {
  return { object: "page", entry: [{ id: PAGE_ID, time: 1787654321, messaging, standby }] };
}

function messageEvent(mid, text = "hello", timestamp = 1787654321000) {
  return {
    sender: { id: CUSTOMER_ID },
    recipient: { id: PAGE_ID },
    timestamp,
    message: { mid, text },
  };
}

function echoEvent(mid, text = "reply", timestamp = 1787654321000) {
  return {
    sender: { id: PAGE_ID },
    recipient: { id: CUSTOMER_ID },
    timestamp,
    message: { mid, text, is_echo: true },
  };
}

function deliveryEvent(mids, watermark) {
  return {
    sender: { id: CUSTOMER_ID },
    recipient: { id: PAGE_ID },
    timestamp: watermark,
    delivery: { mids, watermark },
  };
}

function readEvent(watermark) {
  return {
    sender: { id: CUSTOMER_ID },
    recipient: { id: PAGE_ID },
    timestamp: watermark,
    read: { watermark },
  };
}

function referralEvent() {
  return {
    sender: { id: CUSTOMER_ID },
    recipient: { id: PAGE_ID },
    timestamp: 1787654321000,
    referral: {
      source: "ADS",
      ref: "shirt-campaign-ref",
      ad_id: "AD-123",
    },
  };
}

function attachmentEvent() {
  return {
    sender: { id: CUSTOMER_ID },
    recipient: { id: PAGE_ID },
    timestamp: 1787654321000,
    message: {
      mid: "MID-ATTACHMENT",
      attachments: [
        {
          type: "image",
          payload: {
            attachment_id: "ATT-1",
            url: "https://example.invalid/meta-image.jpg",
            mime_type: "image/jpeg",
          },
        },
      ],
    },
  };
}

class MemoryMetaInboxRepository {
  constructor() {
    this.ids = 1;
    this.webhookEvents = [];
    this.pageConnections = [];
    this.contacts = [];
    this.identities = [];
    this.conversations = [];
    this.messages = [];
    this.attachments = [];
  }

  async recordWebhookEvent(row) {
    const found = this.webhookEvents.find((event) => event.event_key === row.eventKey);
    if (found) return { id: found.id, duplicate: true };
    const event = {
      id: this.nextId("webhook"),
      event_key: row.eventKey,
      object_type: row.objectType,
      page_id: row.pageId,
      event_type: row.eventType,
      payload: row.payload,
      processing_status: row.processingStatus,
      received_at: row.receivedAt.toISOString(),
      processed_at: null,
    };
    this.webhookEvents.push(event);
    return { id: event.id, duplicate: false };
  }

  async markWebhookProcessed(id, status, processedAt, summary = null) {
    const event = this.webhookEvents.find((item) => item.id === id);
    if (event) {
      event.processing_status = status;
      event.processed_at = processedAt.toISOString();
      event.last_error_summary = summary;
    }
  }

  async ensurePageConnection(pageId, now) {
    let page = this.pageConnections.find((item) => item.page_id === pageId);
    if (!page) {
      page = { id: this.nextId("page"), page_id: pageId, status: "testing", metadata: {} };
      this.pageConnections.push(page);
    }
    page.last_webhook_at = now.toISOString();
    return page;
  }

  async ensureChannelIdentity(row) {
    let identity = this.identities.find((item) => item.page_connection_id === row.pageConnectionId && item.channel === row.channel && item.external_user_id === row.externalUserId);
    if (identity) return identity;
    const contact = { id: this.nextId("contact"), display_name: row.displayName || null, metadata: {} };
    this.contacts.push(contact);
    identity = {
      id: this.nextId("identity"),
      contact_id: contact.id,
      page_connection_id: row.pageConnectionId,
      channel: row.channel,
      external_user_id: row.externalUserId,
      display_name: row.displayName || null,
      last_seen_at: row.lastSeenAt?.toISOString?.() || null,
    };
    this.identities.push(identity);
    return identity;
  }

  async ensureOpenConversation(row) {
    let conversation = this.conversations.find((item) => item.channel_identity_id === row.channelIdentityId && item.state !== "closed");
    if (!conversation) {
      conversation = {
        id: this.nextId("conversation"),
        channel_identity_id: row.channelIdentityId,
        state: row.state || "needs_reply",
        last_message_at: null,
        reply_window_expires_at: null,
        entry_source: null,
        referral_ref: null,
        ad_id: null,
        ad_name: null,
        campaign_id: null,
        campaign_name: null,
        metadata: {},
      };
      this.conversations.push(conversation);
    }
    conversation.state = row.state || conversation.state;
    if (row.lastMessageAt && (!conversation.last_message_at || Date.parse(row.lastMessageAt) > Date.parse(conversation.last_message_at))) {
      conversation.last_message_at = row.lastMessageAt.toISOString();
    }
    if (row.attribution) {
      conversation.entry_source = row.attribution.entrySource;
      conversation.referral_ref = row.attribution.ref;
      conversation.ad_id = row.attribution.adId;
      conversation.ad_name = row.attribution.adName;
      conversation.campaign_id = row.attribution.campaignId;
      conversation.campaign_name = row.attribution.campaignName;
      conversation.metadata.referral = row.attribution.raw;
    }
    return conversation;
  }

  async upsertMessage(row) {
    const found = row.externalMessageId ? this.messages.find((item) => item.external_message_id === row.externalMessageId) : null;
    if (found) return { id: found.id, duplicate: true };
    const message = {
      id: this.nextId("message"),
      conversation_id: row.conversationId,
      webhook_event_id: row.webhookEventId,
      external_message_id: row.externalMessageId,
      direction: row.direction,
      message_type: row.messageType,
      body: row.body,
      sender_external_id: row.senderExternalId,
      is_echo: row.isEcho,
      sent_at: row.sentAt.toISOString(),
      delivered_at: null,
      read_at: null,
      metadata: row.metadata,
    };
    this.messages.push(message);
    const conversation = this.conversations.find((item) => item.id === row.conversationId);
    if (conversation && row.direction === "inbound") {
      conversation.reply_window_expires_at = new Date(row.sentAt.getTime() + 24 * 60 * 60 * 1000).toISOString();
    }
    return { id: message.id, duplicate: false };
  }

  async createAttachment(row) {
    this.attachments.push({
      id: this.nextId("attachment"),
      message_id: row.messageId,
      external_attachment_id: row.externalAttachmentId,
      attachment_type: row.attachmentType,
      source_url: row.sourceUrl,
      original_filename: row.originalFilename,
      mime_type: row.mimeType,
      ingestion_status: "pending",
      metadata: row.metadata,
    });
  }

  async markDelivered(row) {
    for (const message of this.messages) {
      if (message.conversation_id === row.conversationId && row.messageIds.includes(message.external_message_id)) {
        if (!message.delivered_at || Date.parse(row.deliveredAt) > Date.parse(message.delivered_at)) message.delivered_at = row.deliveredAt.toISOString();
      }
    }
  }

  async markRead(row) {
    for (const message of this.messages) {
      if (message.conversation_id === row.conversationId && message.direction === "outbound") {
        if (!message.read_at || Date.parse(row.watermark) > Date.parse(message.read_at)) message.read_at = row.watermark.toISOString();
      }
    }
  }

  nextId(prefix) {
    this.ids += 1;
    return `${prefix}-${this.ids}`;
  }
}

function createResponse() {
  const headers = {};
  return {
    statusCode: 200,
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    end(value = "") {
      this.body = value;
    },
    result() {
      let body = this.body;
      if (headers["content-type"]?.includes("application/json")) body = JSON.parse(body || "{}");
      return { status: this.statusCode, headers, body };
    },
  };
}

for (const { name, fn } of tests) {
  await fn();
  console.log(`PASS ${name}`);
}
console.log(`PASS ${tests.length} Facebook Inbox F2 webhook suites`);
