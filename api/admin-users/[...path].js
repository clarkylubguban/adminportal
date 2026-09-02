import handleEffectiveAccessRequest from "../_lib/adminUsersEffectiveAccessRoute.js";
import handleAdminUserRequest from "../_lib/adminUsersIdRoute.js";
import handleTemporaryAccessRequest from "../_lib/adminUsersTemporaryAccessRoute.js";
import { sendJson } from "../_lib/adminAccess.js";

const NAMED_ROUTES = new Set(["effective-access", "temporary-access"]);

export default async function handler(request, response) {
  const segments = getAdminUsersPathSegments(request);
  if (segments.length !== 1) {
    return sendJson(response, 404, { ok: false, error: "admin users route not found" });
  }

  const [segment] = segments;
  if (segment === "effective-access") return handleEffectiveAccessRequest(request, response);
  if (segment === "temporary-access") return handleTemporaryAccessRequest(request, response);
  if (NAMED_ROUTES.has(segment) || !segment) {
    return sendJson(response, 404, { ok: false, error: "admin users route not found" });
  }

  return handleAdminUserRequest(request, response);
}

function getAdminUsersPathSegments(request) {
  const queryPath = request.query?.path;
  if (Array.isArray(queryPath)) return queryPath.map(cleanSegment).filter(Boolean);
  if (typeof queryPath === "string" && queryPath.trim()) return queryPath.split("/").map(cleanSegment).filter(Boolean);

  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  return url.pathname
    .replace(/^\/api\/admin-users\/?/, "")
    .split("/")
    .map(cleanSegment)
    .filter(Boolean);
}

function cleanSegment(value) {
  return decodeURIComponent(String(value || "")).trim();
}
