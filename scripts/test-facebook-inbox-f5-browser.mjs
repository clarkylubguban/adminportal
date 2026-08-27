import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile("src/main.js", "utf8");
const service = await readFile("src/services/adminInbox.js", "utf8");
const actions = await readFile("api/_lib/inboxActions.js", "utf8");
const migration = await readFile("supabase/migrations/202608270001_add_facebook_inbox_f5_inquiry_bridge.sql", "utf8");

assert.ok(service.includes("convertInboxConversationToInquiry"), "F5 service function missing");
assert.ok(service.includes('postInboxAction(authSession, conversationId, "convert-to-inquiry"'), "F5 service must POST convert action");

assert.ok(actions.includes('"convert-to-inquiry"'), "F5 API action route missing");
assert.ok(actions.includes("hasAdminActionPermission(supabase, actor, \"inbox_convert_to_inquiry\")"), "F5 API must check protected action permission");
assert.ok(actions.includes("convert_inbox_conversation_to_inquiry"), "F5 API must call conversion RPC");

assert.ok(main.includes("inbox_convert_to_inquiry"), "Inbox UI must load convert action permission");
assert.ok(main.includes("convertSelectedInboxConversationToInquiry"), "Convert click handler missing");
assert.ok(main.includes("data-inbox-convert-to-inquiry"), "Convert button data hook missing");
assert.ok(main.includes("CONVERT INQUIRY"), "Pre-conversion button label missing");
assert.ok(main.includes("CONVERTING..."), "Conversion progress label missing");
assert.ok(main.includes("VIEW INQUIRY"), "Post-conversion view action missing");
assert.ok(main.includes("data-inbox-view-inquiry"), "View Inquiry data hook missing");
assert.ok(main.includes("openInboxInquiry"), "View Inquiry handler missing");
assert.ok(main.includes('navigateTo("/inquiries")'), "View Inquiry must open canonical Inquiry surface");
assert.ok(main.includes('inboxActiveView = "converted"'), "Successful conversion should keep the converted conversation visible");
assert.equal(main.includes('title="Available in F5"'), false, "F5 must replace the disabled placeholder");

assert.ok(migration.includes("create or replace function public.convert_inbox_conversation_to_inquiry"), "F5 conversion RPC missing");
assert.ok(migration.includes("insert into public.ops_inquiries"), "F5 RPC must create canonical Inquiry records");
assert.ok(migration.includes("insert into public.inbox_inquiry_links"), "F5 RPC must link Inbox conversation to Inquiry");
assert.ok(migration.includes("set state = 'converted'"), "F5 RPC must mark conversation converted");
assert.equal(/insert\s+into\s+public\.orders/i.test(migration), false, "F5 must not create Orders");
assert.equal(/work_chat_messages/i.test(migration), false, "F5 must not reuse Work Chat messages");

console.log("PASS Facebook Inbox F5 browser/source acceptance");
