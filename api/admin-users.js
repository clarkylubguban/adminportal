import handleAdminUsersCollection from "./_lib/admin-users/index.js";
import handleAdminUserDetail from "./_lib/admin-users/[id].js";
import { sendJson } from "./_lib/adminAccess.js";

export default function handler(request, response) {
  const url = new URL(request.url ?? "/", `http://${request.headers?.host || "localhost"}`);
  const targetId = request.query?.adminUserId || url.searchParams.get("adminUserId");
  if (targetId) {
    return withAdminUserPath(request, url, String(Array.isArray(targetId) ? targetId[0] : targetId), () => handleAdminUserDetail(request, response));
  }
  if (/^\/api\/admin-users\/?$/.test(url.pathname)) return handleAdminUsersCollection(request, response);
  return sendJson(response, 404, { ok: false, error: "staff access route not found" });
}

function withAdminUserPath(request, url, targetId, callback) {
  const originalUrl = request.url;
  const hadQuery = Object.prototype.hasOwnProperty.call(request, "query");
  const originalQuery = request.query;
  const query = { ...Object.fromEntries(url.searchParams.entries()), ...(request.query || {}), id: targetId };
  delete query.adminUserId;

  const cleanUrl = new URL(url);
  cleanUrl.pathname = `/api/admin-users/${encodeURIComponent(targetId)}`;
  cleanUrl.searchParams.delete("adminUserId");

  request.url = `${cleanUrl.pathname}${cleanUrl.search}`;
  request.query = query;

  return Promise.resolve(callback()).finally(() => {
    request.url = originalUrl;
    if (hadQuery) request.query = originalQuery;
    else delete request.query;
  });
}