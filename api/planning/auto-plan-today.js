import { handleAutoPlanToday } from "../_lib/autoPlanToday.js";

export { handleAutoPlanToday };

export default function handler(request, response) {
  return handleAutoPlanToday(request, response);
}
