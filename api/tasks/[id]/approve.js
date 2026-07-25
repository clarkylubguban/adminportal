import { handleApproveWork } from "../../_lib/taskRouteHandlers.js";

export { handleApproveWork };
export default function handler(request, response) {
  return handleApproveWork(request, response);
}
