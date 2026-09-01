const SUPABASE_REST_VERSION = "v1";
const ADMIN_AUTH_STORAGE_KEY = "trry_admin_supabase_auth_session_v1";

export function getSupabaseConfig() {
  const env = window.TRRY_ADMIN_ENV ?? {};

  return {
    url: normalizeUrl(env.VITE_SUPABASE_URL ?? ""),
    anonKey: env.VITE_SUPABASE_ANON_KEY ?? "",
    useSupabaseData: String(env.VITE_USE_SUPABASE_DATA ?? "true") === "true",
  };
}

export function isSupabaseReady() {
  const config = getSupabaseConfig();
  return Boolean(config.useSupabaseData && config.url && config.anonKey);
}

export async function readSupabaseTable(tableName, params = {}) {
  return readSupabaseTableRequest(tableName, params);
}

export async function readSupabaseTableWithAuth(tableName, params = {}, accessToken) {
  if (!accessToken) {
    throw new Error("Supabase auth session is missing.");
  }

  return readSupabaseTableRequest(tableName, params, accessToken);
}

async function readSupabaseTableRequest(tableName, params = {}, accessToken = "") {
  const config = getSupabaseConfig();

  if (!isSupabaseReady()) {
    throw new Error("Supabase env is missing or disabled.");
  }

  const url = new URL(`${config.url}/rest/${SUPABASE_REST_VERSION}/${tableName}`);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetch(url.toString(), {
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${accessToken || config.anonKey}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase read failed for ${tableName}: ${message || response.status}`);
  }

  return response.json();
}

export async function writeSupabaseTable(tableName, { method = "POST", params = {}, body, prefer = "return=representation" } = {}) {
  return writeSupabaseTableRequest(tableName, { method, params, body, prefer });
}

export async function writeSupabaseTableWithAuth(tableName, { method = "POST", params = {}, body, prefer = "return=representation" } = {}, accessToken) {
  if (!accessToken) {
    throw new Error("Supabase auth session is missing.");
  }

  return writeSupabaseTableRequest(tableName, { method, params, body, prefer }, accessToken);
}

async function writeSupabaseTableRequest(tableName, { method = "POST", params = {}, body, prefer = "return=representation" } = {}, accessToken = "") {
  const config = getSupabaseConfig();

  if (!isSupabaseReady()) {
    throw new Error("Supabase env is missing or disabled.");
  }

  const url = new URL(`${config.url}/rest/${SUPABASE_REST_VERSION}/${tableName}`);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetch(url.toString(), {
    method,
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${accessToken || config.anonKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: prefer,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase write failed for ${tableName}: ${message || response.status}`);
  }

  if (response.status === 204) return [];
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

export async function executeSupabaseRpcWithAuth(functionName, body = {}, accessToken) {
  return executeSupabaseRpcRequest({ functionName, body, accessToken });
}

export async function executeSupabaseSchemaRpcWithAuth(schemaName, functionName, body = {}, accessToken) {
  return executeSupabaseRpcRequest({ schemaName, functionName, body, accessToken });
}

async function executeSupabaseRpcRequest({ schemaName = "", functionName, body = {}, accessToken }) {
  if (!accessToken) {
    throw new Error("Supabase auth session is missing.");
  }

  const config = getSupabaseConfig();
  if (!isSupabaseReady()) {
    throw new Error("Supabase env is missing or disabled.");
  }

  const headers = {
    apikey: config.anonKey,
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  if (schemaName) {
    headers["Content-Profile"] = schemaName;
    headers["Accept-Profile"] = schemaName;
  }

  const response = await fetch(`${config.url}/rest/${SUPABASE_REST_VERSION}/rpc/${functionName}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase RPC failed for ${functionName}: ${message || response.status}`);
  }

  if (response.status === 204) return [];
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

export function createSupabaseRow(tableName, row) {
  return writeSupabaseTable(tableName, {
    method: "POST",
    body: row,
  });
}

export function createSupabaseRowWithAuth(tableName, row, accessToken) {
  return writeSupabaseTableWithAuth(tableName, {
    method: "POST",
    body: row,
  }, accessToken);
}

export function updateSupabaseRows(tableName, params, row) {
  return writeSupabaseTable(tableName, {
    method: "PATCH",
    params,
    body: row,
  });
}

export function updateSupabaseRowsWithAuth(tableName, params, row, accessToken) {
  return writeSupabaseTableWithAuth(tableName, {
    method: "PATCH",
    params,
    body: row,
  }, accessToken);
}

export async function signInAdminWithPassword(email, password) {
  const config = getSupabaseConfig();

  if (!isSupabaseReady()) {
    throw new Error("Supabase env is missing or disabled.");
  }

  const response = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: config.anonKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    throw new Error("Invalid login. Check your email or password.");
  }

  return storeAdminAuthSession(await response.json());
}

export async function requestAdminPasswordReset(email, redirectTo = getAdminPasswordResetRedirectUrl()) {
  const config = getSupabaseConfig();
  const normalizedEmail = String(email || "").trim();

  if (!isSupabaseReady()) {
    throw new Error("Supabase env is missing or disabled.");
  }
  if (!normalizedEmail) {
    throw new Error("Enter the email address for your admin account.");
  }

  const url = new URL(`${config.url}/auth/v1/recover`);
  url.searchParams.set("redirect_to", redirectTo);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      apikey: config.anonKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ email: normalizedEmail }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(getPasswordResetRequestError(message, response.status));
  }

  return { email: normalizedEmail, redirectTo };
}

export function readInviteSessionFromUrl() {
  return readAuthSessionFromUrl("invite");
}

export function readRecoverySessionFromUrl() {
  return readAuthSessionFromUrl("recovery");
}

function readAuthSessionFromUrl(expectedType) {
  const params = getAuthCallbackParams();
  const accessToken = params.get("access_token") || "";
  const refreshToken = params.get("refresh_token") || "";
  const expiresIn = Number(params.get("expires_in") || 3600);
  const type = params.get("type") || "";
  const error = params.get("error_description") || params.get("error") || "";

  if (error) {
    return { error };
  }

  const typeMatches = type === expectedType || (expectedType === "recovery" && !type);
  if (!accessToken || !typeMatches) {
    return null;
  }

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    user: {},
    type,
  };
}

function getAuthCallbackParams() {
  const params = new URLSearchParams();
  const appendParams = (value) => {
    const normalized = String(value || "").replace(/^[?#]/, "");
    if (!normalized) return;
    const nextParams = new URLSearchParams(normalized);
    nextParams.forEach((paramValue, key) => {
      if (!params.has(key)) params.set(key, paramValue);
    });
  };

  appendParams(window.location.hash);
  appendParams(window.location.search);
  return params;
}

export function cleanAdminAuthCallbackUrl(pathname = window.location.pathname) {
  const route = String(pathname || "/").replace(/\/+$/, "") || "/";
  window.history.replaceState({}, "", route);
}

export async function updateAdminInvitePassword(inviteSession, password) {
  return updateAdminAuthPassword(inviteSession, password, "Invalid or expired invitation link.");
}

export async function updateAdminRecoveryPassword(recoverySession, password) {
  return updateAdminAuthPassword(recoverySession, password, "Invalid or expired recovery link.");
}

async function updateAdminAuthPassword(authSession, password, invalidSessionMessage) {
  const config = getSupabaseConfig();

  if (!authSession?.access_token || !isSupabaseReady()) {
    throw new Error(invalidSessionMessage);
  }

  const response = await fetch(`${config.url}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${authSession.access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ password }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(getPasswordUpdateError(message, response.status));
  }

  clearAdminAuthSession();
  return response.json();
}

export function getAdminPasswordResetRedirectUrl() {
  const host = String(window.location.hostname || "").toLowerCase();
  if (host === "adminportal-staging.vercel.app" || host.startsWith("adminportal-staging-")) {
    return "https://adminportal-staging.vercel.app/reset-password";
  }
  return `${window.location.origin}/reset-password`;
}

function getPasswordResetRequestError(message, status) {
  const normalized = String(message || "").toLowerCase();
  if (status === 429 || normalized.includes("rate")) {
    return "Too many reset requests. Wait a minute and try again.";
  }
  if (normalized.includes("redirect")) {
    return "Password reset redirect is not configured for Admin Staging.";
  }
  return "Unable to send password reset email. Check the address and try again.";
}

function getPasswordUpdateError(message, status) {
  const normalized = String(message || "").toLowerCase();
  if (status === 401 || status === 403 || normalized.includes("jwt") || normalized.includes("token")) {
    return "Invalid or expired password link. Request a new reset link.";
  }
  if (status === 422 || normalized.includes("password")) {
    return "Password does not meet the minimum requirements.";
  }
  return "Unable to update password. Request a new reset link and try again.";
}
export async function getCurrentAdminAuthSession() {
  const storedSession = readStoredAdminAuthSession();
  if (!storedSession) return null;

  const expiresAt = Number(storedSession.expires_at ?? 0);
  const shouldRefresh = expiresAt && expiresAt - Math.floor(Date.now() / 1000) < 60;

  if (!shouldRefresh) return storedSession;

  try {
    return await refreshAdminAuthSession(storedSession.refresh_token);
  } catch {
    clearAdminAuthSession();
    return null;
  }
}

export async function refreshAdminAuthSession(refreshToken) {
  const config = getSupabaseConfig();

  if (!refreshToken || !isSupabaseReady()) {
    throw new Error("Supabase auth refresh token is missing.");
  }

  const response = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: config.anonKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!response.ok) {
    throw new Error("Admin session expired.");
  }

  return storeAdminAuthSession(await response.json());
}

export async function signOutAdmin() {
  const config = getSupabaseConfig();
  const session = readStoredAdminAuthSession();

  if (session?.access_token && isSupabaseReady()) {
    try {
      await fetch(`${config.url}/auth/v1/logout`, {
        method: "POST",
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${session.access_token}`,
          Accept: "application/json",
        },
      });
    } catch {
      // Local session cleanup below is the important part for the browser gate.
    }
  }

  clearAdminAuthSession();
}

export function clearAdminAuthSession() {
  try {
    localStorage.removeItem(ADMIN_AUTH_STORAGE_KEY);
  } catch {
    // Auth fallback remains logged out if localStorage is unavailable.
  }
}

function storeAdminAuthSession(payload) {
  const session = {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_at: payload.expires_at ?? Math.floor(Date.now() / 1000) + Number(payload.expires_in ?? 3600),
    user: payload.user,
  };

  try {
    localStorage.setItem(ADMIN_AUTH_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // The current page can still use the returned session.
  }

  return session;
}

function readStoredAdminAuthSession() {
  try {
    const raw = localStorage.getItem(ADMIN_AUTH_STORAGE_KEY);
    if (!raw) return null;

    const session = JSON.parse(raw);
    if (!session?.access_token || !session?.user?.id) return null;

    const expiresAt = Number(session.expires_at ?? 0);
    if (expiresAt && expiresAt <= Math.floor(Date.now() / 1000) && !session.refresh_token) {
      clearAdminAuthSession();
      return null;
    }

    return session;
  } catch {
    clearAdminAuthSession();
    return null;
  }
}

function normalizeUrl(value) {
  return value.trim().replace(/\/$/, "");
}
