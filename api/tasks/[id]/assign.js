import { handleAssign } from "../../_lib/taskRouteHandlers.js";

export { handleAssign };
export default function handler(request, response) {
  return handleAssign(request, response);
}
