import { createClient } from "@supabase/supabase-js";

export function createServerSupabaseClient() {
  const supabaseUrl = normalizeUrl(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase server env is missing.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function createServerSupabaseUserClient(accessToken) {
  const supabaseUrl = normalizeUrl(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const token = String(accessToken || "").trim();

  if (!supabaseUrl || !serviceRoleKey || !token) {
    throw new Error("Supabase server user context is missing.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: { Authorization: `Bearer ${token}` },
    },
  });
}

function normalizeUrl(value) {
  return value.trim().replace(/\/$/, "");
}
