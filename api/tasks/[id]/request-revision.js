import { handleRequestRevision } from "../../_lib/taskRouteHandlers.js";

export { handleRequestRevision };
export default function handler(request, response) {
  return handleRequestRevision(request, response);
}
