import { handleAutoPlanToday } from "./_lib/autoPlanToday.js";
import { handleInboxAction } from "./_lib/inboxActions.js";
import { handleMetaWebhook } from "./_lib/metaWebhook.js";
import { handleN8nTaskDrafts } from "./_lib/n8nTaskIngestion.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

export { handleAutoPlanToday, handleInboxAction, handleMetaWebhook, handleN8nTaskDrafts };

export default function handler(request, response, dependencies = {}) {
  const pathname = new URL(request.url || "/", "http://localhost").pathname;
  if (pathname === "/api/inbox/capability" || pathname.startsWith("/api/inbox/")) return handleInboxAction(request, response, dependencies);
  if (pathname === "/api/integrations/meta/webhook") return handleMetaWebhook(request, response, dependencies);
  if (pathname === "/api/integrations/n8n/task-drafts") return handleN8nTaskDrafts(request, response, dependencies);
  return handleAutoPlanToday(request, response, dependencies);
}
