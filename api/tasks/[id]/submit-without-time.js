import { handleSubmitWithoutTime } from "../../_lib/taskRouteHandlers.js";

export { handleSubmitWithoutTime };
export default function handler(request, response) {
  return handleSubmitWithoutTime(request, response);
}
