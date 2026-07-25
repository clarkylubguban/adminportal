import { handleReopen } from "../../_lib/taskRouteHandlers.js";

export { handleReopen };
export default function handler(request, response) {
  return handleReopen(request, response);
}
