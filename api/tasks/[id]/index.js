import { handleTaskDetail } from "../../_lib/taskRouteHandlers.js";

export { handleTaskDetail };
export default function handler(request, response) {
  return handleTaskDetail(request, response);
}
