import { createClient } from "@supabase/supabase-js";
import { getAuthorizedAdmin, getBearerToken, sendJson } from "./adminAccess.js";
import {
  EFFECTIVE_ACCESS_MODULES,
  getEffectiveModuleAccess,
  normalizeEffectiveModule,
} from "./effectiveAccess.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return sendJson(response, 405, { ok: false, error: "method not allowed" });
  }

  try {
    const module = normalizeEffectiveModule(new URL(request.url || "/", "http://localhost").searchParams.get("module") || "calendar");
    if (!EFFECTIVE_ACCESS_MODULES.has(module)) {
      return sendJson(response, 400, { ok: false, error: "effective access module is not permitted" });
    }

    const token = getBearerToken(request);
    const supabase = createAdminSupabaseClient();
    const caller = await getAuthorizedAdmin(supabase, token);
    if (!caller) return sendJson(response, 401, { ok: false, error: "admin session required" });

    const access = await getEffectiveModuleAccess(supabase, caller, module);
    return sendJson(response, 200, { ok: true, access });
  } catch (error) {
    console.error("Effective access request failed.", { message: error?.message });
    return sendJson(response, 500, { ok: false, error: "effective access request failed" });
  }
}

function createAdminSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin environment is not configured.");
  return createClient(url, key, { auth: { persistSession: false } });
}
