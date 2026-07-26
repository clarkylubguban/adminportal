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
  { pattern: /^\/api\/tasks\/[^/]+\/history\/?$/, handler: handleTaskHistory },
  { pattern: /^\/api\/tasks\/[^/]+\/time-entries\/?$/, handler: handleTaskTimeEntries },
  { pattern: /^\/api\/tasks\/[^/]+\/draft\/?$/, handler: handleUpdateDraft },
  { pattern: /^\/api\/tasks\/[^/]+\/assign\/?$/, handler: handleAssign },
  { pattern: /^\/api\/tasks\/[^/]+\/approve-draft\/?$/, handler: handleApproveDraft },
  { pattern: /^\/api\/tasks\/[^/]+\/start\/?$/, handler: handleStartWork },
  { pattern: /^\/api\/tasks\/[^/]+\/submit\/?$/, handler: handleSubmit },
  { pattern: /^\/api\/tasks\/[^/]+\/submit-without-time\/?$/, handler: handleSubmitWithoutTime },
  { pattern: /^\/api\/tasks\/[^/]+\/request-revision\/?$/, handler: handleRequestRevision },
  { pattern: /^\/api\/tasks\/[^/]+\/start-revision\/?$/, handler: handleStartRevision },
  { pattern: /^\/api\/tasks\/[^/]+\/approve\/?$/, handler: handleApproveWork },
  { pattern: /^\/api\/tasks\/[^/]+\/cancel\/?$/, handler: handleCancel },
  { pattern: /^\/api\/tasks\/[^/]+\/reopen\/?$/, handler: handleReopen },
  { pattern: /^\/api\/tasks\/[^/]+\/archive\/?$/, handler: handleArchive },
  { pattern: /^\/api\/tasks\/[^/]+\/time-entries\/[^/]+\/correct\/?$/, handler: handleCorrectTimeEntry },
];

export { ROUTES as taskRouteDispatchTable };

export default function handler(request, response) {
  const { pathname } = new URL(request.url ?? "/", `http://${request.headers?.host || "localhost"}`);
  const route = ROUTES.find((entry) => entry.pattern.test(pathname));
  if (!route) {
    return sendJson(response, 404, {
      ok: false,
      error: { code: "NOT_FOUND", message: "Task API route not found." },
    });
  }
  return route.handler(request, response);
}