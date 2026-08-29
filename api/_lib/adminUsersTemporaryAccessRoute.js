import { createServerSupabaseClient } from "./supabaseServer.js";
import {
  cleanText,
  getAuthorizedAdmin,
  getBearerToken,
  readJsonBody,
  sendJson,
} from "./adminAccess.js";
import {
  assertTemporaryAccessTarget,
  getManilaBusinessDayWindow,
  normalizeModuleCodes,
  shapeTemporaryGrant,
  validateModuleCodes,
} from "./employeeTemporaryAccess.js";

const GRANT_SELECT = "id,employee_id,module_code,granted_by,starts_at,expires_at,reason,revoked_at,revoked_by,created_at";

export default async function handler(request, response) {
  const token = getBearerToken(request);
  if (!token) return sendJson(response, 401, { ok: false, error: "admin session required" });

  try {
    const supabase = createServerSupabaseClient();
    const caller = await getAuthorizedAdmin(supabase, token);
    if (!caller) return sendJson(response, 401, { ok: false, error: "admin session required" });

    if (request.method === "GET") return handleRead(request, response, supabase, caller);
    if (request.method === "POST") return handleGrant(request, response, supabase, caller);
    if (request.method === "PATCH") return handleRevoke(request, response, supabase, caller);
    return sendJson(response, 405, { ok: false, error: "method not allowed" });
  } catch (error) {
    console.error("Employee temporary access request failed.", { message: error?.message, code: error?.code, status: error?.status || error?.statusCode });
    return sendJson(response, 500, { ok: false, error: "employee temporary access request failed" });
  }
}

async function handleRead(request, response, supabase, caller) {
  const employeeId = getQueryParam(request, "employee_id");
  const now = new Date().toISOString();
  let query = supabase
    .from("employee_temporary_access_grants")
    .select(GRANT_SELECT)
    .is("revoked_at", null)
    .lte("starts_at", now)
    .gt("expires_at", now)
    .order("created_at", { ascending: false });

  if (employeeId) {
    const target = await readTarget(supabase, employeeId);
    const targetError = assertTemporaryAccessTarget(caller, target);
    if (targetError) return sendJson(response, getTargetErrorStatus(targetError), { ok: false, error: targetError });
    query = query.eq("employee_id", employeeId);
  } else if (caller.role !== "owner" && caller.role !== "admin") {
    return sendJson(response, 403, { ok: false, error: "employee temporary access read is restricted" });
  }

  const { data, error } = await query;
  if (error) throw error;
  const rows = employeeId ? (data || []) : await filterManageableGrantRows(supabase, caller, data || []);
  const usersById = await readUsersById(supabase, collectActorIds(rows));
  return sendJson(response, 200, { ok: true, grants: rows.map((row) => shapeTemporaryGrant(row, usersById)), summaries: summarizeByEmployee(rows) });
}

async function handleGrant(request, response, supabase, caller) {
  const body = await readJsonBody(request);
  const employeeId = cleanText(body.employee_id || body.employeeId, 80);
  if (!employeeId) return sendJson(response, 400, { ok: false, error: "employee is required" });

  const target = await readTarget(supabase, employeeId);
  const targetError = assertTemporaryAccessTarget(caller, target);
  if (targetError) return sendJson(response, getTargetErrorStatus(targetError), { ok: false, error: targetError });

  const moduleValidation = validateModuleCodes(body.module_codes || body.moduleCodes, caller);
  if (!moduleValidation.ok) return sendJson(response, 400, { ok: false, error: moduleValidation.error });

  const now = new Date();
  const window = getManilaBusinessDayWindow(now);
  const { data: activeRows, error: activeError } = await supabase
    .from("employee_temporary_access_grants")
    .select(GRANT_SELECT)
    .eq("employee_id", employeeId)
    .in("module_code", moduleValidation.codes)
    .is("revoked_at", null)
    .lte("starts_at", now.toISOString())
    .gt("expires_at", now.toISOString());
  if (activeError) throw activeError;

  const activeCodes = new Set((activeRows || []).map((row) => row.module_code));
  const missingCodes = moduleValidation.codes.filter((code) => !activeCodes.has(code));
  const reason = cleanText(body.reason, 500) || null;

  if (missingCodes.length) {
    const rows = missingCodes.map((moduleCode) => ({
      employee_id: employeeId,
      module_code: moduleCode,
      granted_by: caller.id,
      starts_at: window.startsAt,
      expires_at: window.expiresAt,
      reason,
    }));
    const { error: insertError } = await supabase.from("employee_temporary_access_grants").insert(rows);
    if (insertError && insertError.code !== "23505") throw insertError;
  }

  return sendEmployeeActiveGrants(response, supabase, employeeId, 201);
}

async function handleRevoke(request, response, supabase, caller) {
  const body = await readJsonBody(request);
  const employeeId = cleanText(body.employee_id || body.employeeId, 80);
  if (!employeeId) return sendJson(response, 400, { ok: false, error: "employee is required" });

  const target = await readTarget(supabase, employeeId);
  const targetError = assertTemporaryAccessTarget(caller, target);
  if (targetError) return sendJson(response, getTargetErrorStatus(targetError), { ok: false, error: targetError });

  const moduleCodes = normalizeModuleCodes(body.module_codes || body.moduleCodes);
  if (moduleCodes.length) {
    const moduleValidation = validateModuleCodes(moduleCodes, caller);
    if (!moduleValidation.ok) return sendJson(response, 400, { ok: false, error: moduleValidation.error });
  }

  const now = new Date().toISOString();
  let query = supabase
    .from("employee_temporary_access_grants")
    .update({ revoked_at: now, revoked_by: caller.id })
    .eq("employee_id", employeeId)
    .is("revoked_at", null)
    .lte("starts_at", now)
    .gt("expires_at", now);
  if (moduleCodes.length) query = query.in("module_code", moduleCodes);
  const { error } = await query;
  if (error) throw error;

  return sendEmployeeActiveGrants(response, supabase, employeeId, 200);
}

async function sendEmployeeActiveGrants(response, supabase, employeeId, status) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("employee_temporary_access_grants")
    .select(GRANT_SELECT)
    .eq("employee_id", employeeId)
    .is("revoked_at", null)
    .lte("starts_at", now)
    .gt("expires_at", now)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const usersById = await readUsersById(supabase, collectActorIds(data || []));
  return sendJson(response, status, { ok: true, grants: (data || []).map((row) => shapeTemporaryGrant(row, usersById)), summaries: summarizeByEmployee(data || []) });
}

async function readTarget(supabase, employeeId) {
  const { data, error } = await supabase
    .from("admin_users")
    .select("id,user_id,email,display_name,role,is_active")
    .eq("id", employeeId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function readUsersById(supabase, ids) {
  if (!ids.length) return new Map();
  const { data, error } = await supabase.from("admin_users").select("id,email,display_name").in("id", ids);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.id, row]));
}

async function filterManageableGrantRows(supabase, caller, rows) {
  const ids = [...new Set(rows.map((row) => row.employee_id).filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from("admin_users")
    .select("id,user_id,email,display_name,role,is_active")
    .in("id", ids);
  if (error) throw error;
  const manageable = new Set((data || [])
    .filter((target) => !assertTemporaryAccessTarget(caller, target))
    .map((target) => target.id));
  return rows.filter((row) => manageable.has(row.employee_id));
}

function collectActorIds(rows) {
  return [...new Set(rows.flatMap((row) => [row.granted_by, row.revoked_by]).filter(Boolean))];
}

function summarizeByEmployee(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const current = grouped.get(row.employee_id) || { employeeId: row.employee_id, moduleCodes: [], moduleCount: 0, expiresAt: row.expires_at || null };
    if (!current.moduleCodes.includes(row.module_code)) current.moduleCodes.push(row.module_code);
    current.moduleCount = current.moduleCodes.length;
    if (!current.expiresAt || row.expires_at < current.expiresAt) current.expiresAt = row.expires_at;
    grouped.set(row.employee_id, current);
  }
  return [...grouped.values()];
}

function getQueryParam(request, key) {
  if (request.query?.[key]) return String(Array.isArray(request.query[key]) ? request.query[key][0] : request.query[key]).trim();
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  return String(url.searchParams.get(key) || "").trim();
}

function getTargetErrorStatus(message) {
  if (message.includes("not found")) return 404;
  if (message.includes("restricted") || message.includes("manageable") || message.includes("own account")) return 403;
  return 400;
}
