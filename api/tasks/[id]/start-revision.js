import { handleStartRevision } from "../../_lib/taskRouteHandlers.js";

export { handleStartRevision };
export default function handler(request, response) {
  return handleStartRevision(request, response);
}
