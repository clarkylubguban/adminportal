import { handleMyTasks } from "./_lib/taskRouteHandlers.js";

export { handleMyTasks };
export default function handler(request, response) {
  return handleMyTasks(request, response);
}
