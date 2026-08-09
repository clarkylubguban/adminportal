import {
  deriveNativeOrderStatusFromFacts,
  isNativeOrderFulfillmentComplete,
  normalizeNativeOrderStatus,
  nativeOrderStatusRank,
} from "../shared/nativeOrderStatus.js";
import { readSupabaseTableWithAuth, updateSupabaseRowsWithAuth } from "../lib/supabaseClient.js";

const ORDERS_TABLE = "orders";

export async function reconcileNativeOrderStatusForInquiry(inquiry, authSession) {
  if (!inquiry?.id || !authSession?.access_token) return null;

  const rows = await readSupabaseTableWithAuth(
    ORDERS_TABLE,
    {
      select: "*",
      source_inquiry_id: `eq.${inquiry.id}`,
      limit: "1",
    },
    authSession.access_token
  );
  const order = Array.isArray(rows) ? rows[0] : null;
  if (!order) return null;

  const currentStatus = normalizeNativeOrderStatus(order.status);
  const nextStatus = deriveNativeOrderStatusFromFacts(inquiry);
  if (nativeOrderStatusRank(nextStatus) <= nativeOrderStatusRank(currentStatus)) return order;

  const updated = await updateSupabaseRowsWithAuth(
    ORDERS_TABLE,
    { source_inquiry_id: `eq.${inquiry.id}` },
    { status: nextStatus, updated_at: new Date().toISOString() },
    authSession.access_token
  );
  return Array.isArray(updated) ? updated[0] : null;
}

export function shouldReconcileFulfillmentCompletion(updates, inquiry) {
  return isNativeOrderFulfillmentComplete(updates) || isNativeOrderFulfillmentComplete(inquiry);
}
