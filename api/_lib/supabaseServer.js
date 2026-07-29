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

export function createServerUserSupabaseClient(token) {
  const supabaseUrl = normalizeUrl(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "");
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

  if (!supabaseUrl || !anonKey || !token) {
    throw new Error("Supabase caller env is missing.");
  }

  return createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
}

function normalizeUrl(value) {
  return value.trim().replace(/\/$/, "");
}
