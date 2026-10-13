import { getAuthorizedAdmin, getBearerToken, sendJson } from "./_lib/adminAccess.js";
import { listAssignmentUsers } from "./_lib/adminAssignments.js";
import { createServerSupabaseClient } from "./_lib/supabaseServer.js";
import catalogHandler from "./_lib/stlolabCatalogRoute.js";

export default async function handler(request, response) {
  const route = new URL(request.url, "https://admin.invalid");
  if (route.pathname === "/api/stlolab-catalog" || route.searchParams.get("_publicRoute") === "stlolab-catalog") return catalogHandler(request, response);
  if (request.method !== "GET") return sendJson(response, 405, { ok: false, error: "method not allowed" });

  const token = getBearerToken(request);
  if (!token) return sendJson(response, 401, { ok: false, error: "admin session required" });

  try {
    const supabase = createServerSupabaseClient();
    const caller = await getAuthorizedAdmin(supabase, token);
    if (!caller) return sendJson(response, 401, { ok: false, error: "admin session required" });

    const users = await listAssignmentUsers(supabase, caller);
    return sendJson(response, 200, { ok: true, users });
  } catch (error) {
    console.error("Assignment users request failed.", { message: error?.message, code: error?.code });
    return sendJson(response, 500, { ok: false, error: "assignment users request failed" });
  }
}
