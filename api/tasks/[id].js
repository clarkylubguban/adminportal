import { sendJson } from "../_lib/adminAccess.js";
import {
  handleApproveDraft,
  handleApproveWork,
  handleArchive,
  handleAssign,
  handleCancel,
  handleCorrectTimeEntry,
  handleReopen,
  handleRequestRevision,
  handleStartRevision,
  handleStartWork,
  handleSubmit,
  handleSubmitWithoutTime,
  handleTaskDetail,
  handleTaskHistory,
  handleTaskTimeEntries,
  handleUpdateDraft,
} from "../_lib/taskRouteHandlers.js";

const ROUTES = [
  { pattern: /^\/api\/tasks\/[^/]+\/?$/, handler: handleTaskDetail },
  { pattern: /^\/api\/tasks\/[^/]+\/history\/?$/, action: "history", handler: handleTaskHistory },
  { pattern: /^\/api\/tasks\/[^/]+\/time-entries\/?$/, action: "time-entries", handler: handleTaskTimeEntries },
  { pattern: /^\/api\/tasks\/[^/]+\/draft\/?$/, action: "draft", handler: handleUpdateDraft },
  { pattern: /^\/api\/tasks\/[^/]+\/assign\/?$/, action: "assign", handler: handleAssign },
  { pattern: /^\/api\/tasks\/[^/]+\/approve-draft\/?$/, action: "approve-draft", handler: handleApproveDraft },
  { pattern: /^\/api\/tasks\/[^/]+\/start\/?$/, action: "start", handler: handleStartWork },
  { pattern: /^\/api\/tasks\/[^/]+\/submit\/?$/, action: "submit", handler: handleSubmit },
  { pattern: /^\/api\/tasks\/[^/]+\/submit-without-time\/?$/, action: "submit-without-time", handler: handleSubmitWithoutTime },
  { pattern: /^\/api\/tasks\/[^/]+\/request-revision\/?$/, action: "request-revision", handler: handleRequestRevision },
  { pattern: /^\/api\/tasks\/[^/]+\/start-revision\/?$/, action: "start-revision", handler: handleStartRevision },
  { pattern: /^\/api\/tasks\/[^/]+\/approve\/?$/, action: "approve", handler: handleApproveWork },
  { pattern: /^\/api\/tasks\/[^/]+\/cancel\/?$/, action: "cancel", handler: handleCancel },
  { pattern: /^\/api\/tasks\/[^/]+\/reopen\/?$/, action: "reopen", handler: handleReopen },
  { pattern: /^\/api\/tasks\/[^/]+\/archive\/?$/, action: "archive", handler: handleArchive },
  { pattern: /^\/api\/tasks\/[^/]+\/time-entries\/[^/]+\/correct\/?$/, action: "time-entry-correct", handler: handleCorrectTimeEntry },
];

const ROUTES_BY_ACTION = new Map(ROUTES.filter((route) => route.action).map((route) => [route.action, route]));

export { ROUTES as taskRouteDispatchTable };

export default function handler(request, response) {
  const url = new URL(request.url ?? "/", `http://${request.headers?.host || "localhost"}`);
  const rewriteAction = getQueryValue(request, url, "_taskAction");
  const route = rewriteAction ? ROUTES_BY_ACTION.get(rewriteAction) : ROUTES.find((entry) => entry.pattern.test(url.pathname));

  if (!route) {
    return sendJson(response, 404, {
      ok: false,
      error: { code: "NOT_FOUND", message: "Task API route not found." },
    });
  }

  if (rewriteAction) {
    return withRoutingParamsRemoved(request, url, () => route.handler(request, response));
  }

  return route.handler(request, response);
}

function getQueryValue(request, url, key) {
  const raw = request.query?.[key] ?? url.searchParams.get(key);
  return Array.isArray(raw) ? raw[0] : raw;
}

function withRoutingParamsRemoved(request, url, callback) {
  const originalUrl = request.url;
  const hadQuery = Object.prototype.hasOwnProperty.call(request, "query");
  const originalQuery = request.query;
  const query = { ...Object.fromEntries(url.searchParams.entries()), ...(request.query || {}) };
  delete query._taskAction;

  const cleanUrl = new URL(url);
  cleanUrl.searchParams.delete("_taskAction");

  request.url = `${cleanUrl.pathname}${cleanUrl.search}`;
  request.query = query;

  return Promise.resolve(callback()).finally(() => {
    request.url = originalUrl;
    if (hadQuery) request.query = originalQuery;
    else delete request.query;
  });
}
