import { getBearerToken, sendJson } from "./adminAccess.js";
import { createTaskAuthClient, createTaskCallerClient } from "./taskSupabase.js";
import { createTaskService } from "./taskService.js";
import { TaskValidationError } from "./taskValidation.js";

const ACTIVE_ROLES = new Set(["owner", "admin", "staff"]);

export class TaskApiError extends Error {
  constructor(code, status, message, details = undefined) {
    super(message);
    this.name = "TaskApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function runTaskApi(request, response, config, dependencies = {}) {
  const methods = new Set(config.methods || []);
  if (!methods.has(request.method)) {
    response.setHeader("Allow", [...methods].join(", "));
    return sendTaskError(response, new TaskApiError("VALIDATION_ERROR", 405, "Method not allowed."));
  }

  try {
    const context = dependencies.authenticate
      ? await dependencies.authenticate(request)
      : await authenticateTaskRequest(request, dependencies);
    const service = dependencies.createService
      ? dependencies.createService(context)
      : createTaskService(context.callerClient, context.actor, { profileClient: context.authClient });

    if (!await service.isFeatureEnabled()) {
      throw new TaskApiError("FEATURE_DISABLED", 503, "Task domain is unavailable.");
    }

    const result = await config.handler({
      request,
      actor: context.actor,
      service,
      readBody: dependencies.readBody || readTaskJsonBody,
    });
    return sendJson(response, config.successStatus || 200, { ok: true, ...result });
  } catch (error) {
    return sendTaskError(response, mapTaskError(error));
  }
}

export async function authenticateTaskRequest(request, dependencies = {}) {
  const token = getBearerToken(request);
  if (!token) throw new TaskApiError("AUTH_REQUIRED", 401, "Authentication required.");

  const authClient = dependencies.authClient || createTaskAuthClient();
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData?.user?.id) {
    throw new TaskApiError("AUTH_REQUIRED", 401, "Authentication required.");
  }

  const { data: account, error: accountError } = await authClient
    .from("admin_users")
    .select("user_id,role,is_active")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (accountError) throw accountError;
  if (!account) throw new TaskApiError("FORBIDDEN", 403, "Task access is not permitted.");
  if (account.is_active === false) throw new TaskApiError("ACCOUNT_INACTIVE", 403, "Portal account is inactive.");

  const role = String(account.role || "").trim().toLowerCase();
  if (!ACTIVE_ROLES.has(role)) throw new TaskApiError("FORBIDDEN", 403, "Task access is not permitted.");
  return {
    actor: { userId: account.user_id, role, isActive: true },
    authClient,
    callerClient: dependencies.callerClient || createTaskCallerClient(token),
  };
}

export async function readTaskJsonBody(request) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) return request.body;
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object required");
    return value;
  } catch {
    throw new TaskValidationError("Request body must be valid JSON object.");
  }
}

export function mapTaskError(error) {
  if (error instanceof TaskApiError || error instanceof TaskValidationError || error?.status === 404) return error;
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();

  if (code === "P0002" || code === "PGRST116") return new TaskApiError("NOT_FOUND", 404, "Task resource not found.");
  if (code === "40001") {
    const details = Number.isSafeInteger(Number(error?.currentVersion))
      ? { currentVersion: Number(error.currentVersion) }
      : undefined;
    return new TaskApiError("VERSION_CONFLICT", 409, "Task version is stale.", details);
  }
  if (code === "23505" && message.includes("idempotency")) {
    return new TaskApiError("IDEMPOTENCY_CONFLICT", 409, "Idempotency key conflicts with an earlier command.");
  }
  if (code === "42501") {
    if (/assign|target user/.test(message)) return new TaskApiError("ASSIGNMENT_NOT_ALLOWED", 403, "Task assignment is not permitted.");
    if (/review|approve/.test(message)) return new TaskApiError("REVIEW_NOT_ALLOWED", 403, "Task review is not permitted.");
    return new TaskApiError("FORBIDDEN", 403, "Task action is not permitted.");
  }
  if (code === "55000") {
    if (message.includes("domain is disabled")) return new TaskApiError("FEATURE_DISABLED", 503, "Task domain is unavailable.");
    if (/another open timer|already.*open|open timer cannot/.test(message)) {
      return new TaskApiError("TIMER_ALREADY_OPEN", 409, "A conflicting timer is already open.");
    }
    if (/must have an open timer|has no open timer|requires.*timer/.test(message)) {
      return new TaskApiError("TIMER_REQUIRED", 409, "An open task timer is required.");
    }
    return new TaskApiError("INVALID_TRANSITION", 409, "Task state does not permit this action.");
  }
  if (["22023", "23514", "23P01"].includes(code)) {
    return new TaskApiError("VALIDATION_ERROR", 400, "Task request is invalid.");
  }
  return new TaskApiError("INTERNAL_ERROR", 500, "Task request failed.");
}

export function sendTaskError(response, error) {
  const mapped = error instanceof TaskApiError || error instanceof TaskValidationError ? error : mapTaskError(error);
  const body = {
    ok: false,
    error: {
      code: mapped.code || "INTERNAL_ERROR",
      message: mapped.message || "Task request failed.",
    },
  };
  if (mapped.details !== undefined) body.error.details = mapped.details;
  if (body.error.code === "INTERNAL_ERROR") {
    console.error("Task API request failed.", { code: body.error.code, status: mapped.status || 500 });
  }
  return sendJson(response, mapped.status || 500, body);
}
