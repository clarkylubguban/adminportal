import { handleMyTasks, handleTaskCalendar } from "./_lib/taskRouteHandlers.js";
import { handleOverviewWebsiteAnalytics } from "../server/overviewWebsiteAnalytics.js";

export { handleMyTasks, handleTaskCalendar };

export default function handler(request, response) {
  const url = new URL(request.url || "/", "http://localhost");
  if (url.searchParams.get("view") === "website-analytics") return handleOverviewWebsiteAnalytics(request, response);
  if (url.pathname === "/api/task-calendar") return handleTaskCalendar(request, response);
  return handleMyTasks(request, response);
}
