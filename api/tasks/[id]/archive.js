import { handleArchive } from "../../_lib/taskRouteHandlers.js";

export { handleArchive };
export default function handler(request, response) {
  return handleArchive(request, response);
}
