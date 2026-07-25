import { createClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "./supabaseServer.js";

export function createTaskAuthClient() {
  return createServerSupabaseClient();
}

export function createTaskCallerClient(token) {
  const supabaseUrl = normalizeUrl(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "");
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  if (!supabaseUrl || !anonKey) throw new Error("Supabase caller env is missing.");

  return createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/$/, "");
}