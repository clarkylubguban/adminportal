import { handleUpdateDraft } from "../../_lib/taskRouteHandlers.js";

export { handleUpdateDraft };
export default function handler(request, response) {
  return handleUpdateDraft(request, response);
}
