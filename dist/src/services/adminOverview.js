import {
  getCurrentAdminAuthSession,
  isSupabaseReady,
  readSupabaseTableWithAuth,
} from "../lib/supabaseClient.js";
import { getAdminInventory } from "./adminInventory.js";
import { getPurchaseOrders } from "./adminPurchasing.js";

const MANILA_TIME_ZONE = "Asia/Manila";
const ACTIVE_ORDER_BLOCKLIST = new Set(["completed", "cancelled", "canceled", "voided"]);
const ACTIVE_PRODUCTION_STAGES = new Set(["printing", "embroidery", "screen_printing", "in_production", "qc", "qc_finishing"]);
const READY_PRODUCTION_STAGES = new Set(["ready", "ready_for_fulfillment"]);

export async function getAdminOverviewSnapshot() {
  if (!isSupabaseReady()) {
    return unavailableSnapshot("Supabase data is unavailable.");
  }

  const authSession = await getCurrentAdminAuthSession();
  const accessToken = authSession?.access_token;
  if (!accessToken) {
    return unavailableSnapshot("Admin session is unavailable.");
  }

  const [salesResult, ordersResult, inquiriesResult, inventoryResult, purchasingResult] = await Promise.allSettled([
    readSupabaseTableWithAuth("sales", {
      select: "id,total,status,created_at,completed_at",
      order: "completed_at.desc",
      limit: "500",
    }, accessToken),
    readSupabaseTableWithAuth("orders", {
      select: "id,source_inquiry_id,status,due_date,fulfillment_method,created_at,updated_at",
      order: "created_at.desc",
      limit: "500",
    }, accessToken),
    readSupabaseTableWithAuth("ops_inquiries", {
      select: "id,status,quote_status,quote_published_at,quote_sent_at,quote_approved_at,created_at,source,channel,product,product_desc,quantity,production_stage,production_started_at,blocked_reason,fulfillment_method,due_date",
      order: "created_at.desc",
      limit: "1000",
    }, accessToken),
    getAdminInventory(authSession),
    getPurchaseOrders(authSession),
  ]);

  const salesAvailable = salesResult.status === "fulfilled";
  const ordersAvailable = ordersResult.status === "fulfilled";
  const inquiriesAvailable = inquiriesResult.status === "fulfilled";
  const inventoryAvailable = inventoryResult.status === "fulfilled" && inventoryResult.value?.status !== "error";
  const purchasingAvailable = purchasingResult.status === "fulfilled" && purchasingResult.value?.status !== "error";

  const sales = salesAvailable && Array.isArray(salesResult.value) ? salesResult.value : [];
  const orders = ordersAvailable && Array.isArray(ordersResult.value) ? ordersResult.value : [];
  const inquiries = inquiriesAvailable && Array.isArray(inquiriesResult.value) ? inquiriesResult.value : [];
  const inventoryRows = inventoryAvailable && Array.isArray(inventoryResult.value?.rows) ? inventoryResult.value.rows : [];
  const purchaseOrders = purchasingAvailable && Array.isArray(purchasingResult.value?.purchaseOrders) ? purchasingResult.value.purchaseOrders : [];

  const today = manilaDateKey(new Date());
  const last7 = dayKeys(7);
  const previous7 = dayKeys(14).slice(7);
  const last30 = new Set(dayKeys(30));
  const completedSales = sales.filter((sale) => key(sale.status) === "completed");
  const salesByDate = sumSalesByDate(completedSales);
  const salesTodayTotal = salesByDate.get(today)?.total ?? 0;
  const salesTodayCount = salesByDate.get(today)?.count ?? 0;
  const salesTodayAov = salesTodayCount ? salesTodayTotal / salesTodayCount : 0;
  const weekTotal = sumDayTotals(last7, salesByDate);
  const previousWeekTotal = sumDayTotals(previous7, salesByDate);
  const salesTrend = last7.slice().reverse().map((dateKey) => ({
    dateKey,
    day: weekdayForDateKey(dateKey),
    value: salesByDate.get(dateKey)?.total ?? 0,
  }));

  const todayInquiries = inquiries.filter((item) => manilaDateKey(item.created_at) === today);
  const newInquiryNeedAction = todayInquiries.filter(isOpenInquiry).length;
  const todayWebInquiries = todayInquiries.filter(isWebsiteInquiry).length;

  const activeOrders = orders.filter((order) => !ACTIVE_ORDER_BLOCKLIST.has(key(order.status)));
  const dueTodayOrders = activeOrders.filter((order) => order.due_date === today).length;
  const overdueOrders = activeOrders.filter((order) => order.due_date && order.due_date < today).length;

  const readyRows = inquiries.filter((item) => isConfirmedInquiry(item) && READY_PRODUCTION_STAGES.has(key(item.production_stage)));
  const readyPickup = readyRows.filter((item) => key(item.fulfillment_method).includes("pickup")).length;
  const readyDelivery = readyRows.filter((item) => key(item.fulfillment_method).includes("delivery")).length;

  const quoteWaiting = inquiries.filter((item) => {
    if (!isOpenInquiry(item) || hasQuoteSent(item)) return false;
    const created = dateMs(item.created_at);
    return created !== null && created <= Date.now() - 24 * 60 * 60 * 1000;
  }).length;
  const productionBlocked = inquiries.filter((item) => isConfirmedInquiry(item) && Boolean(String(item.blocked_reason || "").trim())).length;

  const lowStockRows = inventoryRows.filter((row) => ["LOW STOCK", "OUT OF STOCK"].includes(String(row.stockState || "").toUpperCase()));
  const outOfStockRows = inventoryRows.filter((row) => String(row.stockState || "").toUpperCase() === "OUT OF STOCK");

  const openPurchaseOrders = purchaseOrders.filter((order) => ["ORDERED", "PARTIALLY_RECEIVED"].includes(String(order.status || "").toUpperCase()));
  const partialPurchaseOrders = purchaseOrders.filter((order) => String(order.status || "").toUpperCase() === "PARTIALLY_RECEIVED");

  const inProductionRows = inquiries.filter((item) => isConfirmedInquiry(item) && ACTIVE_PRODUCTION_STAGES.has(key(item.production_stage)));
  const recentInquiries = inquiries.filter((item) => last30.has(manilaDateKey(item.created_at)));
  const orderInquiryIds = new Set(orders.map((order) => order.source_inquiry_id).filter(Boolean));
  const qualified = recentInquiries.filter(isQualifiedInquiry);
  const quoteSent = recentInquiries.filter(hasQuoteSent);
  const confirmed = recentInquiries.filter((item) => orderInquiryIds.has(item.id) || isConfirmedInquiry(item));
  const inProduction = confirmed.filter((item) => ACTIVE_PRODUCTION_STAGES.has(key(item.production_stage)));

  const last7Set = new Set(last7);
  const websiteInquiryCount = inquiries.filter((item) => last7Set.has(manilaDateKey(item.created_at)) && isWebsiteInquiry(item)).length;

  const attention = [
    { label: "QUOTES WAITING", value: quoteWaiting, note: ">24h", tone: quoteWaiting ? "danger" : "green", available: inquiriesAvailable },
    { label: "PRODUCTION BLOCKED", value: productionBlocked, note: "jobs", tone: productionBlocked ? "danger" : "green", available: inquiriesAvailable },
    { label: "ORDERS DUE TODAY", value: dueTodayOrders, note: "orders", tone: dueTodayOrders ? "warning" : "green", available: ordersAvailable },
    { label: "LOW STOCK", value: lowStockRows.length, note: outOfStockRows.length ? `${outOfStockRows.length} out` : "SKUs", tone: lowStockRows.length ? "warning" : "green", available: inventoryAvailable },
  ];

  const sourceStates = {
    sales: salesAvailable ? "success" : "error",
    orders: ordersAvailable ? "success" : "error",
    inquiries: inquiriesAvailable ? "success" : "error",
    inventory: inventoryAvailable ? "success" : "error",
    purchasing: purchasingAvailable ? "success" : "error",
    websiteAnalytics: "not_connected",
  };

  return {
    status: Object.values(sourceStates).some((state) => state === "success") ? "success" : "error",
    sourceStates,
    salesToday: salesAvailable ? {
      value: formatMoney(salesTodayTotal),
      note: `${formatCount(salesTodayCount, "transaction")} · AOV ${formatMoney(salesTodayAov)}`,
      tone: "green",
      available: true,
    } : unavailableMetric("green"),
    newInquiries: inquiriesAvailable ? {
      value: String(todayInquiries.length),
      note: `${newInquiryNeedAction} need action · ${todayWebInquiries} from website`,
      tone: "purple",
      available: true,
    } : unavailableMetric("purple"),
    activeOrders: ordersAvailable ? {
      value: String(activeOrders.length),
      note: `${dueTodayOrders} due today · ${overdueOrders} overdue`,
      tone: "blue",
      available: true,
    } : unavailableMetric("blue"),
    readyToRelease: inquiriesAvailable ? {
      value: String(readyRows.length),
      note: `${readyPickup} pickup · ${readyDelivery} delivery`,
      tone: "teal",
      available: true,
    } : unavailableMetric("teal"),
    attention,
    attentionOpen: attention.filter((item) => item.available && Number(item.value) > 0).reduce((sum, item) => sum + Number(item.value), 0),
    sales: {
      available: salesAvailable,
      rows: salesTrend,
      weekTotal,
      change: salesAvailable ? percentChange(weekTotal, previousWeekTotal) : "—",
    },
    funnel: {
      available: inquiriesAvailable,
      conversion: quoteSent.length ? (confirmed.length / quoteSent.length) * 100 : null,
      rows: [
        { label: "New inquiries", value: recentInquiries.length, tone: "blue" },
        { label: "Qualified", value: qualified.length, tone: "teal" },
        { label: "Quote sent", value: quoteSent.length, tone: "purple" },
        { label: "Order confirmed", value: confirmed.length, tone: "green" },
        { label: "In production", value: inProduction.length, tone: "orange" },
      ],
    },
    website: {
      connected: false,
      change: "NOT CONNECTED",
      metrics: [
        { label: "PRODUCT VIEWS", value: "—", note: "Reporting source not connected", tone: "teal", available: false },
        { label: "ADD TO CART", value: "—", note: "Reporting source not connected", tone: "purple", available: false },
        { label: "CHECKOUT STARTED", value: "—", note: "Reporting source not connected", tone: "blue", available: false },
        inquiriesAvailable
          ? { label: "INQUIRY SUBMITTED", value: String(websiteInquiryCount), note: "website / portal · last 7 days", tone: "green", available: true }
          : { label: "INQUIRY SUBMITTED", value: "—", note: "Inquiry source unavailable", tone: "green", available: false },
      ],
      products: [],
      note: "Meta Pixel events exist, but no dashboard reporting source is connected yet.",
    },
    operations: [
      { group: "PRODUCTION", value: inquiriesAvailable ? String(inProductionRows.length) : "—", note: "in production", tone: "blue", available: inquiriesAvailable },
      { group: "PRODUCTION", value: inquiriesAvailable ? String(readyRows.length) : "—", note: "ready to release", tone: "green", available: inquiriesAvailable },
      { group: "PRODUCTION", value: ordersAvailable ? String(overdueOrders) : "—", note: "overdue", tone: overdueOrders ? "danger" : "green", available: ordersAvailable },
      { group: "INVENTORY", value: inventoryAvailable ? String(lowStockRows.length) : "—", note: outOfStockRows.length ? `${outOfStockRows.length} out of stock` : "stock risk SKUs", tone: lowStockRows.length ? "warning" : "green", available: inventoryAvailable },
      { group: "PURCHASING", value: purchasingAvailable ? String(openPurchaseOrders.length) : "—", note: "open POs", tone: "teal", available: purchasingAvailable },
      { group: "PURCHASING", value: purchasingAvailable ? String(partialPurchaseOrders.length) : "—", note: "partial receive", tone: "purple", available: purchasingAvailable },
    ],
    operationsFlags: [
      inquiriesAvailable ? productionBlocked : 0,
      ordersAvailable ? overdueOrders : 0,
      inventoryAvailable ? lowStockRows.length : 0,
      purchasingAvailable ? partialPurchaseOrders.length : 0,
    ].reduce((sum, value) => sum + value, 0),
  };
}

function unavailableSnapshot(message) {
  return {
    status: "error",
    error: message,
    sourceStates: {
      sales: "error",
      orders: "error",
      inquiries: "error",
      inventory: "error",
      purchasing: "error",
      websiteAnalytics: "not_connected",
    },
    salesToday: unavailableMetric("green"),
    newInquiries: unavailableMetric("purple"),
    activeOrders: unavailableMetric("blue"),
    readyToRelease: unavailableMetric("teal"),
    attention: [
      { label: "QUOTES WAITING", value: "—", note: "unavailable", tone: "danger", available: false },
      { label: "PRODUCTION BLOCKED", value: "—", note: "unavailable", tone: "danger", available: false },
      { label: "ORDERS DUE TODAY", value: "—", note: "unavailable", tone: "warning", available: false },
      { label: "LOW STOCK", value: "—", note: "unavailable", tone: "warning", available: false },
    ],
    attentionOpen: 0,
    sales: { available: false, rows: [], weekTotal: 0, change: "—" },
    funnel: {
      available: false,
      conversion: null,
      rows: [
        { label: "New inquiries", value: 0, tone: "blue" },
        { label: "Qualified", value: 0, tone: "teal" },
        { label: "Quote sent", value: 0, tone: "purple" },
        { label: "Order confirmed", value: 0, tone: "green" },
        { label: "In production", value: 0, tone: "orange" },
      ],
    },
    website: {
      connected: false,
      change: "NOT CONNECTED",
      metrics: [
        { label: "PRODUCT VIEWS", value: "—", note: "Reporting source not connected", tone: "teal", available: false },
        { label: "ADD TO CART", value: "—", note: "Reporting source not connected", tone: "purple", available: false },
        { label: "CHECKOUT STARTED", value: "—", note: "Reporting source not connected", tone: "blue", available: false },
        { label: "INQUIRY SUBMITTED", value: "—", note: "Inquiry source unavailable", tone: "green", available: false },
      ],
      products: [],
      note: "Meta Pixel events exist, but no dashboard reporting source is connected yet.",
    },
    operations: [
      { group: "PRODUCTION", value: "—", note: "in production", tone: "blue", available: false },
      { group: "PRODUCTION", value: "—", note: "ready to release", tone: "green", available: false },
      { group: "PRODUCTION", value: "—", note: "overdue", tone: "danger", available: false },
      { group: "INVENTORY", value: "—", note: "stock risk SKUs", tone: "warning", available: false },
      { group: "PURCHASING", value: "—", note: "open POs", tone: "teal", available: false },
      { group: "PURCHASING", value: "—", note: "partial receive", tone: "purple", available: false },
    ],
    operationsFlags: 0,
  };
}

function unavailableMetric(tone) {
  return { value: "—", note: "Data unavailable", tone, available: false };
}

function sumSalesByDate(rows) {
  const map = new Map();
  rows.forEach((sale) => {
    const date = manilaDateKey(sale.completed_at || sale.created_at);
    if (!date) return;
    const current = map.get(date) || { total: 0, count: 0 };
    current.total += number(sale.total);
    current.count += 1;
    map.set(date, current);
  });
  return map;
}

function sumDayTotals(keys, map) {
  return keys.reduce((sum, day) => sum + (map.get(day)?.total ?? 0), 0);
}

function isOpenInquiry(item) {
  return !["won", "lost", "cancelled", "canceled"].includes(key(item.status));
}

function isConfirmedInquiry(item) {
  return key(item.status) === "won";
}

function isQualifiedInquiry(item) {
  if (!isOpenInquiry(item) && !isConfirmedInquiry(item)) return false;
  const hasProduct = Boolean(String(item.product_desc || item.product || "").trim());
  const hasQuantity = Boolean(String(item.quantity || "").trim());
  return (hasProduct && hasQuantity) || hasQuoteSent(item) || isConfirmedInquiry(item);
}

function hasQuoteSent(item) {
  const status = key(item.status);
  const quoteStatus = key(item.quote_status);
  return Boolean(
    item.quote_published_at
    || item.quote_sent_at
    || ["sent", "approved", "won"].includes(status)
    || ["sent", "ready", "approved"].includes(quoteStatus)
  );
}

function isWebsiteInquiry(item) {
  const source = `${item.source || ""} ${item.channel || ""}`.toLowerCase();
  return source.includes("website") || source.includes("webapp") || source.includes("portal");
}

function manilaDateKey(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MANILA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function dayKeys(count) {
  return Array.from({ length: count }, (_, index) => manilaDateKey(new Date(Date.now() - index * 86400000)));
}

function weekdayForDateKey(dateKey) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat("en-US", { timeZone: MANILA_TIME_ZONE, weekday: "short" }).format(date).toUpperCase();
}

function dateMs(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function key(value) {
  return String(value || "").trim().toLowerCase();
}

function number(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function formatMoney(value) {
  const amount = number(value);
  return `₱${Math.round(amount).toLocaleString("en-PH")}`;
}

function formatCount(value, singular) {
  const count = Number(value) || 0;
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function percentChange(current, previous) {
  if (previous > 0) {
    const value = ((current - previous) / previous) * 100;
    return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
  }
  if (current > 0) return "NEW";
  return "0.0%";
}
