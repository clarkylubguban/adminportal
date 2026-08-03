import { handleMyTasks, handleTaskCalendar } from "./_lib/taskRouteHandlers.js";

export { handleMyTasks, handleTaskCalendar };

export default function handler(request, response) {
  const pathname = new URL(request.url || "/", "http://localhost").pathname;
  if (pathname === "/api/task-calendar") return handleTaskCalendar(request, response);
  return handleMyTasks(request, response);
}
