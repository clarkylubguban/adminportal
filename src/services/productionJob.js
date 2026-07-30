export async function getProductionJob(jobId, authSession, { signal } = {}) {
  return requestProductionJob(jobId, authSession, {
    method: "GET",
    signal,
  });
}

export async function updateProductionJob(jobId, command, authSession, { signal } = {}) {
  return requestProductionJob(jobId, authSession, {
    method: "PATCH",
    body: command,
    signal,
  });
}

async function requestProductionJob(jobId, authSession, { method, body, signal }) {
  const reference = String(jobId || "").trim();
  if (!reference) throw productionError("INVALID_JOB_REFERENCE", "Production job not found.", 400);
  const token = String(authSession?.access_token || "").trim();
  if (!token) throw productionError("AUTH_REQUIRED", "Authentication required.", 401);

  const response = await fetch(`/api/production/${encodeURIComponent(reference)}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok || !payload?.job) {
    const code = String(payload?.error?.code || "PRODUCTION_JOB_FAILED");
    throw productionError(code, productionMessage(response.status, code, method), response.status);
  }
  return payload.job;
}

export function productionMessage(status, code, method = "GET") {
  if (status === 404 && code === "PRODUCTION_JOB_NOT_CONFIRMED") {
    return "This record is not a confirmed TRRY order.";
  }
  if (status === 404) return "Production job not found.";
  if (status === 409) return "This job was updated by another user. Refresh and try again.";
  if (status === 401 || status === 403) return "Production action is not available.";
  if (code === "PRODUCTION_BLOCKER_REQUIRED") return "A blocker reason is required.";
  if (code === "PRODUCTION_NOT_READY") return "Production requirements are incomplete.";
  if (code === "PRODUCTION_BLOCKED") return "Clear the active blocker before advancing.";
  if (code === "PRODUCTION_START_UNSUPPORTED") {
    return "This service has no safe start stage under the current production rules.";
  }
  if (status === 400) return "The production update is not valid for the current job state.";
  return method === "PATCH"
    ? "Unable to update production details."
    : "Unable to load production details.";
}

function productionError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}
