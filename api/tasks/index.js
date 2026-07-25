import { handleTaskCollection } from "../_lib/taskRouteHandlers.js";

export { handleTaskCollection };
export default function handler(request, response) {
  return handleTaskCollection(request, response);
}
