import { getAuthorizedAdmin, getBearerToken, sendJson } from "../api/_lib/adminAccess.js";
import { createServerSupabaseClient } from "../api/_lib/supabaseServer.js";

const DEFAULT_PROJECT_ID = "prj_LPRPl6lfeVllNTJz9NgndeI5HYyC";
const DEFAULT_TEAM_ID = "team_lLNAY28RJHud9QjW9vcIh7WO";
const API_BASE = "https://api.vercel.com/v1/query/web-analytics";

export async function handleOverviewWebsiteAnalytics(request, response) {
  if (request.method !== "GET") return sendJson(response, 405, { ok: false, connected: false, error: "method not allowed" });

  const adminToken = getBearerToken(request);
  if (!adminToken) return sendJson(response, 401, { ok: false, connected: false, error: "admin session required" });

  try {
    const supabase = createServerSupabaseClient();
    const caller = await getAuthorizedAdmin(supabase, adminToken);
    if (!caller) return sendJson(response, 401, { ok: false, connected: false, error: "admin session required" });

    const vercelToken = process.env.TRRY_VERCEL_API_TOKEN || process.env.VERCEL_API_TOKEN || process.env.VERCEL_OIDC_TOKEN || "";
    if (!vercelToken) {
      return sendJson(response, 503, {
        ok: false,
        connected: false,
        status: "credential_required",
        error: "Vercel analytics reporting credential is not configured.",
      });
    }

    const projectId = process.env.TRRY_WEBAPP_VERCEL_PROJECT_ID || DEFAULT_PROJECT_ID;
    const teamId = process.env.TRRY_VERCEL_TEAM_ID || DEFAULT_TEAM_ID;
    const now = new Date();
    const currentSince = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const previousSince = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const [
      currentVisits,
      previousVisits,
      currentEvents,
      previousEvents,
      productOpens,
      productInquiries,
    ] = await Promise.all([
      queryVercel("visits/count", { projectId, teamId, since: currentSince.toISOString(), until: now.toISOString() }, vercelToken),
      queryVercel("visits/count", { projectId, teamId, since: previousSince.toISOString(), until: currentSince.toISOString() }, vercelToken),
      queryVercel("events/aggregate", { projectId, teamId, since: currentSince.toISOString(), until: now.toISOString(), by: "eventName", limit: "100" }, vercelToken),
      queryVercel("events/aggregate", { projectId, teamId, since: previousSince.toISOString(), until: currentSince.toISOString(), by: "eventName", limit: "100" }, vercelToken),
      queryVercel("events/aggregate", { projectId, teamId, since: currentSince.toISOString(), until: now.toISOString(), by: "eventData/productName", filter: "eventName eq 'ProductOpen'", limit: "50" }, vercelToken),
      queryVercel("events/aggregate", { projectId, teamId, since: currentSince.toISOString(), until: now.toISOString(), by: "eventData/productName", filter: "eventName eq 'InquirySubmitted'", limit: "50" }, vercelToken),
    ]);

    const currentEventCounts = eventCountMap(currentEvents);
    const previousEventCounts = eventCountMap(previousEvents);
    const pageViews = readPageViews(currentVisits);
    const previousPageViews = readPageViews(previousVisits);
    const startOrders = currentEventCounts.get("StartOrder") || 0;
    const productOpenCount = currentEventCounts.get("ProductOpen") || 0;
    const inquirySubmitted = currentEventCounts.get("InquirySubmitted") || 0;
    const products = mergeProductIntent(productOpens, productInquiries);

    return sendJson(response, 200, {
      ok: true,
      connected: true,
      range: "7d",
      metrics: {
        pageViews,
        startOrders,
        productOpens: productOpenCount,
        inquirySubmitted,
      },
      previous: {
        pageViews: previousPageViews,
        startOrders: previousEventCounts.get("StartOrder") || 0,
        productOpens: previousEventCounts.get("ProductOpen") || 0,
        inquirySubmitted: previousEventCounts.get("InquirySubmitted") || 0,
      },
      pageViewChange: percentChange(pageViews, previousPageViews),
      products,
    });
  } catch (error) {
    const status = Number(error?.status) || 500;
    console.error("Overview website analytics request failed.", { message: error?.message, status });
    return sendJson(response, status === 401 || status === 403 ? 503 : 500, {
      ok: false,
      connected: false,
      status: status === 401 || status === 403 ? "credential_invalid" : "reporting_error",
      error: status === 401 || status === 403 ? "Vercel analytics reporting credential is unavailable or invalid." : "Website analytics reporting failed.",
    });
  }
}

async function queryVercel(path, params, token) {
  const url = new URL(`${API_BASE}/${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });

  const result = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const text = await result.text();
  const payload = text ? JSON.parse(text) : {};
  if (!result.ok) {
    const error = new Error(`Vercel analytics request failed: ${result.status}`);
    error.status = result.status;
    throw error;
  }
  return payload;
}

function readPageViews(payload) {
  const data = payload?.data || {};
  return numberValue(data.pageviews ?? data.pageViews ?? data.count ?? data.total);
}

function eventCountMap(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const counts = new Map();
  rows.forEach((row) => {
    const name = String(row?.eventName ?? row?.event_name ?? row?.name ?? "").trim();
    if (!name) return;
    counts.set(name, numberValue(row?.count ?? row?.events ?? row?.total));
  });
  return counts;
}

function groupedProductMap(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const counts = new Map();
  rows.forEach((row) => {
    const rawName = row?.eventData ?? row?.productName ?? row?.["eventData/productName"] ?? row?.value;
    const name = typeof rawName === "object" && rawName ? rawName.productName : rawName;
    const normalizedName = String(name || "").trim();
    if (!normalizedName) return;
    counts.set(normalizedName, numberValue(row?.count ?? row?.events ?? row?.total));
  });
  return counts;
}

function mergeProductIntent(openPayload, inquiryPayload) {
  const opens = groupedProductMap(openPayload);
  const inquiries = groupedProductMap(inquiryPayload);
  const names = new Set([...opens.keys(), ...inquiries.keys()]);
  return [...names]
    .map((name) => {
      const openCount = opens.get(name) || 0;
      const inquiryCount = inquiries.get(name) || 0;
      return {
        name,
        opens: openCount,
        inquiries: inquiryCount,
        conversion: openCount ? (inquiryCount / openCount) * 100 : 0,
      };
    })
    .sort((a, b) => b.opens - a.opens || b.inquiries - a.inquiries || a.name.localeCompare(b.name))
    .slice(0, 8);
}

function percentChange(current, previous) {
  if (!previous) return current ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
