import { createHmac, timingSafeEqual } from "node:crypto";
import { sendJson } from "./adminAccess.js";
import { createServerSupabaseClient } from "./supabaseServer.js";
import {
  createSupabaseMetaInboxRepository,
  ingestMetaWebhookPayload,
} from "./metaInboxIngestion.js";

const SIGNATURE_PATTERN = /^sha256=([a-f0-9]{64})$/i;

export class MetaWebhookError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "MetaWebhookError";
    this.code = code;
    this.status = status;
  }
}

export async function handleMetaWebhook(request, response, dependencies = {}) {
  if (request.method === "GET") return handleVerify(request, response, dependencies);
  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    return sendMetaError(response, new MetaWebhookError("METHOD_NOT_ALLOWED", 405, "Method not allowed."));
  }

  try {
    const limits = dependencies.limits || getLimits();
    const rawBody = await readRawBody(request, limits.maxPayloadBytes);
    verifyMetaSignature(request, rawBody, dependencies);
    const payload = parsePayload(rawBody);

    if (payload.object !== "page") {
      return sendText(response, 200, "EVENT_RECEIVED");
    }

    const repository = dependencies.repository
      || createSupabaseMetaInboxRepository(dependencies.client || createServerSupabaseClient());
    await ingestMetaWebhookPayload(payload, {
      repository,
      receivedAt: dependencies.receivedAt || new Date(),
      env: dependencies.env || process.env,
      fetchImpl: dependencies.fetchImpl || globalThis.fetch,
      profileTimeoutMs: dependencies.profileTimeoutMs,
    });
    return sendText(response, 200, "EVENT_RECEIVED");
  } catch (error) {
    return sendMetaError(response, mapMetaError(error));
  }
}

function handleVerify(request, response, dependencies = {}) {
  const url = new URL(request.url || "/", "http://localhost");
  const mode = url.searchParams.get("hub.mode") || "";
  const token = url.searchParams.get("hub.verify_token") || "";
  const challenge = url.searchParams.get("hub.challenge") || "";
  const expected = dependencies.verifyToken ?? process.env.META_WEBHOOK_VERIFY_TOKEN ?? "";
  if (!expected) return sendText(response, 503, "WEBHOOK_UNAVAILABLE");
  if (mode === "subscribe" && token === expected) return sendText(response, 200, challenge);
  return sendText(response, 403, "FORBIDDEN");
}

export function verifyMetaSignature(request, rawBody, dependencies = {}) {
  const secret = dependencies.appSecret ?? process.env.META_APP_SECRET ?? "";
  if (!secret) throw new MetaWebhookError("WEBHOOK_UNAVAILABLE", 503, "Webhook endpoint is unavailable.");

  const signature = headerValue(request, "x-hub-signature-256");
  const match = signature.match(SIGNATURE_PATTERN);
  if (!match) throw new MetaWebhookError("SIGNATURE_INVALID", 401, "Meta signature is invalid.");

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const provided = Buffer.from(match[1], "hex");
  if (provided.length !== expectedBuffer.length || !timingSafeEqual(provided, expectedBuffer)) {
    throw new MetaWebhookError("SIGNATURE_INVALID", 401, "Meta signature is invalid.");
  }
}

export function signMetaBody(rawBody, secret) {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

async function readRawBody(request, maxBytes) {
  if (Buffer.isBuffer(request.body)) {
    if (request.body.length > maxBytes) throw new MetaWebhookError("PAYLOAD_TOO_LARGE", 413, "Payload is too large.");
    return request.body;
  }
  if (typeof request.body === "string") {
    const body = Buffer.from(request.body, "utf8");
    if (body.length > maxBytes) throw new MetaWebhookError("PAYLOAD_TOO_LARGE", 413, "Payload is too large.");
    return body;
  }
  if (!request || typeof request[Symbol.asyncIterator] !== "function") return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new MetaWebhookError("PAYLOAD_TOO_LARGE", 413, "Payload is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function parsePayload(rawBody) {
  try {
    const payload = JSON.parse(rawBody.toString("utf8"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new MetaWebhookError("INVALID_JSON", 400, "Webhook payload is invalid.");
    }
    return payload;
  } catch (error) {
    if (error instanceof MetaWebhookError) throw error;
    throw new MetaWebhookError("INVALID_JSON", 400, "Webhook payload must be valid JSON.");
  }
}

function mapMetaError(error) {
  if (error instanceof MetaWebhookError) return error;
  return new MetaWebhookError("INTERNAL_ERROR", 500, "Meta webhook processing failed.");
}

function sendMetaError(response, error) {
  if (error.code === "INTERNAL_ERROR") {
    console.error("Meta webhook failed.", { code: error.code, status: error.status });
  }
  return sendJson(response, error.status || 500, {
    ok: false,
    error: { code: error.code, message: error.message },
  });
}

function sendText(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end(body);
}

function headerValue(request, name) {
  const lower = name.toLowerCase();
  const raw = request.headers?.[name] ?? request.headers?.[lower] ?? "";
  return Array.isArray(raw) ? String(raw[0] || "").trim() : String(raw || "").trim();
}

function getLimits() {
  return {
    maxPayloadBytes: readIntegerEnv("META_WEBHOOK_MAX_PAYLOAD_BYTES", 1024 * 1024, 1024, 5 * 1024 * 1024),
  };
}

function readIntegerEnv(name, fallback, min, max) {
  const parsed = Number(process.env[name] || fallback);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
