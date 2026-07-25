import { handleTaskHistory } from "../../_lib/taskRouteHandlers.js";

export { handleTaskHistory };
export default function handler(request, response) {
  return handleTaskHistory(request, response);
}
