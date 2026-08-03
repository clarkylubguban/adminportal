import { handleTaskCalendar } from "./_lib/taskRouteHandlers.js";

export { handleTaskCalendar };
export default function handler(request, response) {
  return handleTaskCalendar(request, response);
}
