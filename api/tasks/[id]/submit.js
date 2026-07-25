import { handleSubmit } from "../../_lib/taskRouteHandlers.js";

export { handleSubmit };
export default function handler(request, response) {
  return handleSubmit(request, response);
}
