import { handleN8nTaskDrafts } from "../../_lib/n8nTaskIngestion.js";

export { handleN8nTaskDrafts };

export default function handler(request, response) {
  return handleN8nTaskDrafts(request, response);
}
