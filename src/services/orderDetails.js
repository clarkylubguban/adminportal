export async function getOrderDetails(orderId, authSession, { signal } = {}) {
  const reference = String(orderId || "").trim();
  if (!reference) {
    throw orderDetailsError("INVALID_ORDER_REFERENCE", "Order not found.", 400);
  }

  const token = String(authSession?.access_token || "").trim();
  if (!token) {
    throw orderDetailsError("AUTH_REQUIRED", "Authentication required.", 401);
  }

  const response = await fetch(`/api/orders/${encodeURIComponent(reference)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload?.ok || !payload?.order) {
    const code = String(payload?.error?.code || "ORDER_DETAILS_FAILED");
    const message = getOrderDetailsMessage(response.status, code);
    throw orderDetailsError(code, message, response.status);
  }

  return payload.order;
}

export function getOrderDetailsMessage(status, code) {
  if (status === 404 && code === "ORDER_NOT_CONFIRMED") {
    return "This record is not a confirmed TRRY order.";
  }
  if (status === 404) return "Order not found.";
  if (status === 401 || status === 403) return "Order access is not available.";
  return "Unable to load order details.";
}

function orderDetailsError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}
