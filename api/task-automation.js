import { handleAutoPlanToday } from "./_lib/autoPlanToday.js";
import { handleN8nTaskDrafts } from "./_lib/n8nTaskIngestion.js";

export { handleAutoPlanToday, handleN8nTaskDrafts };

export default function handler(request, response) {
  const pathname = new URL(request.url || "/", "http://localhost").pathname;
  if (pathname === "/api/integrations/n8n/task-drafts") return handleN8nTaskDrafts(request, response);
  return handleAutoPlanToday(request, response);
}
