const SUPABASE_REST_VERSION = "v1";

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
      Authorization: `Bearer ${config.anonKey}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase read failed for ${tableName}: ${message || response.status}`);
  }

  return response.json();
}

function normalizeUrl(value) {
  return value.trim().replace(/\/$/, "");
}
