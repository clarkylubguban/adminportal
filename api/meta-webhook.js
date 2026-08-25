import { handleMetaWebhook } from "./_lib/metaWebhook.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function metaWebhook(request, response) {
  return handleMetaWebhook(request, response);
}
