import { handleCorrectTimeEntry } from "../../../../_lib/taskRouteHandlers.js";

export { handleCorrectTimeEntry };
export default function handler(request, response) {
  return handleCorrectTimeEntry(request, response);
}
