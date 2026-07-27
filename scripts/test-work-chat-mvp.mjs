import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const files = {
  migration: "supabase/migrations/202607260003_work_chat_mvp.sql",
  api: "api/work-chat.js",
  service: "src/services/workChat.js",
  main: "src/main.js",
  css: "src/styles.css",
  vercel: "vercel.json",
  localDev: "scripts/local-dev.mjs",
};

const contents = Object.fromEntries(await Promise.all(
  Object.entries(files).map(async ([key, file]) => [key, await readFile(file, "utf8")])
));

assertIncludes(contents.migration, [
  "create table if not exists public.work_chat_channels",
  "create table if not exists public.work_chat_messages",
  "create table if not exists public.work_chat_mentions",
  "create table if not exists public.work_chat_channel_reads",
  "create table if not exists public.work_chat_attachments",
  "create table if not exists public.work_chat_prepared_attachments",
  "'work-chat-files'",
  "public = false",
  "work_chat_send_message",
  "work_chat_mark_read",
  "alter publication supabase_realtime add table public.work_chat_messages",
  "revoke all on function public.work_chat_send_message",
  "grant execute on function public.work_chat_send_message(uuid, uuid, text, uuid[], uuid[]) to service_role",
  "('general', 'STANDARD', 'GENERAL')",
  "('front-desk', 'STANDARD', 'FRONT DESK')",
  "('production', 'STANDARD', 'PRODUCTION')",
]);

assertIncludes(contents.api, [
  "GET", "POST", "work_chat_send_message", "work_chat_mark_read",
  "createSignedUploadUrl", "createSignedUrl", "listMentionMessages",
  "Message text or attachment is required", "Confirmed order was not found",
]);

assertIncludes(contents.service, [
  "subscribeToWorkChatMessages", "postgres_changes", "uploadToSignedUrl",
  "prepareWorkChatAttachment", "openWorkChatAttachment",
]);

assertIncludes(contents.main, [
  "renderWorkChatShell", "WORK CHAT", "renderWorkChatMentionsButton",
  "Open Order Thread", "resetWorkChatState", "initializeWorkChat",
  "data-work-chat-open-order-thread", "data-work-chat-mentions",
]);

assertIncludes(contents.css, [
  ".work-chat-launcher", ".work-chat-drawer", "width: min(400px, 100vw)",
  "@media (max-width: 768px)", ".work-chat-source",
]);

const vercel = JSON.parse(contents.vercel);
for (const source of [
  "/api/work-chat/bootstrap",
  "/api/work-chat/channels/:channelId/messages",
  "/api/work-chat/channels/:channelId/read",
  "/api/work-chat/order-threads",
  "/api/work-chat/attachments/prepare",
  "/api/work-chat/attachments/:attachmentId/url",
  "/api/admin-users/:id",
]) {
  if (!vercel.rewrites.some((rewrite) => rewrite.source === source)) {
    throw new Error(`Missing Vercel rewrite: ${source}`);
  }
}

assertIncludes(contents.localDev, ["../api/work-chat.js", "../api/admin-users.js"]);

const functionFiles = await listDeployableApiFiles("api");
if (functionFiles.length !== 12) {
  throw new Error(`Expected 12 deployable Vercel functions, found ${functionFiles.length}: ${functionFiles.join(", ")}`);
}

console.log("Work Chat MVP static verification passed.");

function assertIncludes(text, needles) {
  for (const needle of needles) {
    if (!text.includes(needle)) throw new Error(`Missing expected text: ${needle}`);
  }
}

async function listDeployableApiFiles(dir) {
  const entries = await readdir(dir);
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry);
    const info = await stat(path);
    if (info.isDirectory()) {
      if (entry === "_lib") continue;
      files.push(...await listDeployableApiFiles(path));
    } else if (entry.endsWith(".js")) {
      files.push(path.replace(/\\/g, "/"));
    }
  }
  return files.sort();
}