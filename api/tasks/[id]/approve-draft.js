import { handleApproveDraft } from "../../_lib/taskRouteHandlers.js";

export { handleApproveDraft };
export default function handler(request, response) {
  return handleApproveDraft(request, response);
}
