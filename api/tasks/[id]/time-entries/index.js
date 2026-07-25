import { handleTaskTimeEntries } from "../../../_lib/taskRouteHandlers.js";

export { handleTaskTimeEntries };
export default function handler(request, response) {
  return handleTaskTimeEntries(request, response);
}
