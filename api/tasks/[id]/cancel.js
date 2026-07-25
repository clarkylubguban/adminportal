import { handleCancel } from "../../_lib/taskRouteHandlers.js";

export { handleCancel };
export default function handler(request, response) {
  return handleCancel(request, response);
}
