const CHANNEL = "facebook_messenger";
const DEFAULT_GRAPH_VERSION = "v23.0";
const DEFAULT_PROFILE_TIMEOUT_MS = 1200;
const DEFAULT_RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

const inflightLookups = new Map();

export async function enrichMetaProfilesForEvents(events, options = {}) {
  const repository = options.repository;
  if (!repository || typeof repository.getProfileEnrichmentTarget !== "function") {
    return { successes: [], failures: [], skipped: events.length };
  }

  const candidates = uniqueProfileCandidates(events);
  const successes = [];
  const failures = [];
  let skipped = 0;

  for (const candidate of candidates) {
    const target = await repository.getProfileEnrichmentTarget(candidate);
    if (hasDisplayName(target)) {
      skipped += 1;
      continue;
    }
    if (!shouldAttemptProfileEnrichment(target, options)) {
      skipped += 1;
      continue;
    }

    const result = await lookupMetaProfile(candidate, options);
    if (result.ok) {
      for (const event of events) {
        if (event.pageId === candidate.pageId && event.customerPsid === candidate.externalUserId && !event.customerDisplayName) {
          event.customerDisplayName = result.profile.displayName;
        }
      }
      successes.push({ ...candidate, target, profile: result.profile });
    } else {
      failures.push({ ...candidate, target, errorCode: result.errorCode });
    }
  }

  return { successes, failures, skipped };
}

export async function persistMetaProfileEnrichment(result, options = {}) {
  const repository = options.repository;
  if (!repository) return;

  const now = options.now || new Date();
  if (typeof repository.applyProfileEnrichment === "function") {
    for (const item of result?.successes || []) {
      await repository.applyProfileEnrichment({ ...item, now });
    }
  }
  if (typeof repository.recordProfileEnrichmentFailure === "function") {
    for (const item of result?.failures || []) {
      await repository.recordProfileEnrichmentFailure({ ...item, now });
    }
  }
}

export async function refreshMetaProfileForConversation(conversationId, options = {}) {
  const repository = options.repository;
  if (!repository || typeof repository.getProfileEnrichmentTargetForConversation !== "function") {
    return { ok: false, status: "blocked", errorCode: "PROFILE_REPOSITORY_UNAVAILABLE" };
  }

  const target = await repository.getProfileEnrichmentTargetForConversation(conversationId);
  if (!target) return { ok: false, status: "blocked", errorCode: "CONVERSATION_NOT_FOUND" };
  if (!target.externalUserId || !target.pageId) return { ok: false, status: "blocked", errorCode: "PROFILE_TARGET_UNAVAILABLE" };
  if (hasDisplayName(target) && options.force !== true) {
    return { ok: true, status: "skipped", displayName: target.displayName || target.contactDisplayName || "" };
  }
  if (options.force !== true && !shouldAttemptProfileEnrichment(target, options)) {
    return { ok: false, status: "blocked", errorCode: "PROFILE_RETRY_DEFERRED" };
  }

  const candidate = {
    pageId: target.pageId,
    channel: target.channel || CHANNEL,
    externalUserId: target.externalUserId,
  };
  const result = await lookupMetaProfile(candidate, options);
  const now = options.now || new Date();
  if (!result.ok) {
    if (typeof repository.recordProfileEnrichmentFailure === "function") {
      await repository.recordProfileEnrichmentFailure({ ...candidate, target, errorCode: result.errorCode, now });
    }
    return { ok: false, status: "blocked", errorCode: result.errorCode };
  }

  if (typeof repository.applyProfileEnrichment === "function") {
    await repository.applyProfileEnrichment({ ...candidate, target, profile: result.profile, now });
  }
  return {
    ok: true,
    status: "updated",
    displayName: result.profile.displayName,
    profilePictureUrl: result.profile.profilePictureUrl || "",
    fields: result.profile.fields,
  };
}

export async function lookupMetaProfile(candidate, options = {}) {
  const env = options.env || process.env;
  const token = String(env.META_PAGE_ACCESS_TOKEN || "").trim();
  const graphVersion = cleanGraphVersion(env.META_GRAPH_API_VERSION || DEFAULT_GRAPH_VERSION);
  const psid = cleanText(candidate.externalUserId, 240);
  if (!token || !graphVersion || !psid) return { ok: false, errorCode: "META_PROFILE_NOT_CONFIGURED" };

  const key = `${graphVersion}:${candidate.pageId}:${psid}`;
  if (inflightLookups.has(key)) return inflightLookups.get(key);

  const promise = fetchMetaProfile({ graphVersion, psid, token, ...options })
    .finally(() => inflightLookups.delete(key));
  inflightLookups.set(key, promise);
  return promise;
}

export function normalizeMetaProfile(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, errorCode: "META_PROFILE_MALFORMED" };
  }

  const firstName = cleanText(payload.first_name, 120);
  const lastName = cleanText(payload.last_name, 120);
  const fullName = cleanText(payload.name, 240);
  const displayName = cleanText(`${firstName} ${lastName}`, 240) || fullName;
  if (!displayName) return { ok: false, errorCode: "META_PROFILE_NAME_MISSING" };

  return {
    ok: true,
    profile: {
      displayName,
      profilePictureUrl: cleanUrl(payload.profile_pic),
      fields: {
        first_name: Boolean(firstName),
        last_name: Boolean(lastName),
        name: Boolean(fullName),
        profile_pic: Boolean(cleanUrl(payload.profile_pic)),
      },
    },
  };
}

function uniqueProfileCandidates(events) {
  const byKey = new Map();
  for (const event of events) {
    if (!event?.shouldProcess || !event.pageId || !event.customerPsid) continue;
    if (event.customerDisplayName) continue;
    const key = `${event.pageId}:${event.customerPsid}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        pageId: event.pageId,
        channel: CHANNEL,
        externalUserId: event.customerPsid,
      });
    }
  }
  return [...byKey.values()];
}

function hasDisplayName(target) {
  return Boolean(cleanText(target?.displayName || target?.contactDisplayName, 240));
}

function shouldAttemptProfileEnrichment(target, options) {
  const retryAfterMs = Number(options.retryAfterMs || DEFAULT_RETRY_AFTER_MS);
  const profile = target?.metadata?.profile_enrichment;
  if (!profile || profile.status !== "failed") return true;
  const lastAttempt = Date.parse(profile.last_attempt_at || "");
  if (!Number.isFinite(lastAttempt)) return true;
  const now = options.now || new Date();
  return now.getTime() - lastAttempt >= retryAfterMs;
}

async function fetchMetaProfile({ graphVersion, psid, token, fetchImpl = globalThis.fetch, timeoutMs } = {}) {
  if (typeof fetchImpl !== "function") return { ok: false, errorCode: "META_PROFILE_FETCH_UNAVAILABLE" };

  const controller = new AbortController();
  const ms = Math.max(1, Number(timeoutMs || DEFAULT_PROFILE_TIMEOUT_MS));
  const timer = setTimeout(() => controller.abort(), ms);
  const endpoint = new URL(`https://graph.facebook.com/${encodeURIComponent(graphVersion)}/${encodeURIComponent(psid)}`);
  endpoint.searchParams.set("fields", "first_name,last_name,name,profile_pic");

  try {
    const response = await fetchImpl(endpoint.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, errorCode: safeMetaProfileError(payload?.error?.code || payload?.error?.type || `HTTP_${response.status}`) };
    }
    return normalizeMetaProfile(payload);
  } catch (error) {
    if (error?.name === "AbortError") return { ok: false, errorCode: "META_PROFILE_TIMEOUT" };
    return { ok: false, errorCode: "META_PROFILE_NETWORK_ERROR" };
  } finally {
    clearTimeout(timer);
  }
}

function cleanGraphVersion(value) {
  const version = String(value || "").trim();
  return /^v\d+\.\d+$/.test(version) ? version : "";
}

function cleanText(value, max) {
  return String(value || "").trim().slice(0, max);
}

function cleanUrl(value) {
  const text = cleanText(value, 2048);
  return /^https:\/\/[^\s]+$/i.test(text) ? text : "";
}

function safeMetaProfileError(value) {
  return String(value || "META_PROFILE_FAILED").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 120) || "META_PROFILE_FAILED";
}
