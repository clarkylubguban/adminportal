import { createServerSupabaseClient } from "../../_lib/supabaseServer.js";

const ARTWORK_BUCKET = "inquiry-artworks";
const SIGNED_URL_EXPIRES_IN_SECONDS = 300;

export default async function handler(request, response) {
  if (request.method !== "GET") {
    sendJson(response, 405, { ok: false, error: "method not allowed" });
    return;
  }

  const inquiryReference = getInquiryReference(request);

  if (!isValidInquiryReference(inquiryReference)) {
    sendJson(response, 400, { ok: false, error: "invalid reference" });
    return;
  }

  const token = getBearerToken(request);

  if (!token) {
    sendJson(response, 401, {
      ok: false,
      error: "admin session required",
    });
    return;
  }

  let failureStage = "server_client";

  try {
    failureStage = "server_client";
    const supabase = createServerSupabaseClient();

    failureStage = "auth";
    let userData = null;

    try {
      const result = await supabase.auth.getUser(token);
      userData = result.data;

      if (result.error) {
        throw result.error;
      }
        } catch {
      sendJson(response, 401, {
        ok: false,
        error: "admin session required",
      });
      return;
    }

    if (!userData?.user) {
      sendJson(response, 401, {
        ok: false,
        error: "admin session required",
      });
      return;
    }

    failureStage = "admin_role";

    const adminUser = await readAdminUser(supabase, userData.user.id);

    if (!isAuthorizedAdmin(adminUser)) {
      sendJson(response, 403, {
        ok: false,
        error: "admin access required",
      });
      return;
    }

    failureStage = "inquiry_lookup";

    const { data: inquiry, error: inquiryError } = await supabase
      .from("ops_inquiries")
      .select("id")
      .eq("id", inquiryReference)
      .maybeSingle();

    if (inquiryError) {
      throw inquiryError;
    }

    if (!inquiry) {
      sendJson(response, 404, {
        ok: false,
        error: "inquiry not found",
      });
      return;
    }

    failureStage = "storage_list";

    const { data: files, error: listError } = await supabase.storage
      .from(ARTWORK_BUCKET)
      .list(inquiryReference, {
        limit: 100,
      });

    if (listError) {
      throw listError;
    }

    const artworkFile = selectNewestFile(files);

    if (!artworkFile) {
      sendJson(response, 404, {
        ok: false,
        error: "no artwork uploaded",
      });
      return;
    }

    const objectPath = `${inquiryReference}/${artworkFile.name}`;

    failureStage = "signed_url";

    const { data: signedData, error: signedUrlError } =
      await supabase.storage
        .from(ARTWORK_BUCKET)
        .createSignedUrl(
          objectPath,
          SIGNED_URL_EXPIRES_IN_SECONDS
        );

    if (signedUrlError || !signedData?.signedUrl) {
      throw signedUrlError || new Error("Signed URL missing.");
    }

    sendJson(response, 200, {
      ok: true,
      filename: artworkFile.name,
      signedUrl: signedData.signedUrl,
    });
  } catch (error) {
    console.error("Secure artwork access failed.", {
      stage: failureStage,
      message: error?.message,
      code: error?.code,
      status: error?.status || error?.statusCode,
    });

sendJson(response, 500, {
  ok: false,
  error: "secure artwork access failed",
});
  }
}

function getInquiryReference(request) {
  const queryId = Array.isArray(request.query?.id)
    ? request.query.id[0]
    : request.query?.id;

  if (queryId) {
    return String(queryId).trim();
  }

  const url = new URL(
    request.url || "/",
    `http://${request.headers.host || "localhost"}`
  );

  const match = url.pathname.match(
    /^\/api\/inquiries\/([^/]+)\/artwork\/?$/
  );

  return match ? decodeURIComponent(match[1]).trim() : "";
}

function isValidInquiryReference(value) {
  return /^[a-z0-9][a-z0-9_-]{2,79}$/i.test(value);
}

async function readAdminUser(supabase, userId) {
  const query = (select) => supabase
    .from("admin_users")
    .select(select)
    .eq("user_id", userId)
    .maybeSingle();

  const { data, error } = await query("id,role,is_active");
  if (!error) return data;
  if (!isMissingAdminProfileColumn(error)) throw error;

  const fallback = await query("id,role");
  if (fallback.error) throw fallback.error;
  return fallback.data;
}

function isAuthorizedAdmin(adminUser) {
  return adminUser?.is_active !== false && ["owner", "admin", "staff"].includes(String(adminUser?.role || "").trim().toLowerCase());
}

function isMissingAdminProfileColumn(error) {
  return /is_active|42703|schema cache|could not find/i.test(String(error?.message || error || ""));
}

function getBearerToken(request) {
  const authorization =
    request.headers.authorization ||
    request.headers.Authorization ||
    "";

  const match = String(authorization).match(/^Bearer\s+(.+)$/i);

  return match ? match[1].trim() : "";
}

function selectNewestFile(files) {
  return (
    (Array.isArray(files) ? files : [])
      .filter((file) => file?.name && file.id)
      .sort((a, b) => getFileTime(b) - getFileTime(a))[0] ?? null
  );
}

function getFileTime(file) {
  return (
    Date.parse(
      file.updated_at ||
        file.created_at ||
        file.last_accessed_at ||
        ""
    ) || 0
  );
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}