export async function getAdminAssignmentUsers(authSession, { moduleKey = "" } = {}) {
  const accessToken = typeof authSession === "string" ? authSession : authSession?.access_token;
  if (!accessToken) throw new Error("Supabase auth session is required for assignment users.");

  const path = moduleKey ? `/api/assignment-users?module=${encodeURIComponent(moduleKey)}` : "/api/assignment-users";
  const response = await fetch(path, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Unable to load team members.");
  return Array.isArray(payload.users) ? payload.users : [];
}

export async function updateInquiryAssignment(id, updates, authSession) {
  const accessToken = typeof authSession === "string" ? authSession : authSession?.access_token;
  if (!accessToken) throw new Error("Supabase auth session is required for assignment updates.");

  const response = await fetch(`/api/inquiries/${encodeURIComponent(id)}/assignment`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(updates),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Assignment update failed.");
  return payload.inquiry || null;
}
