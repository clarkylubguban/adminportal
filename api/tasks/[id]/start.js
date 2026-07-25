import { handleStartWork } from "../../_lib/taskRouteHandlers.js";

export { handleStartWork };
export default function handler(request, response) {
  return handleStartWork(request, response);
}
