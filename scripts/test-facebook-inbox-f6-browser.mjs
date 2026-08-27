import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile("src/main.js", "utf8");
const service = await readFile("src/services/adminInbox.js", "utf8");
const ingestion = await readFile("api/_lib/metaInboxIngestion.js", "utf8");
const migration = await readFile("supabase/migrations/202608270002_add_facebook_inbox_f6_send_reconciliation.sql", "utf8");

assert.ok(ingestion.includes('import { cleanReplyText } from "./metaSend.js";'), "F6 must reuse canonical reply text cleaning");
assert.ok(ingestion.includes("bodyHash: isEcho ? createReplyBodyHash(body) : null"), "Meta echo events must include canonical body hash");
assert.ok(ingestion.includes("function createReplyBodyHash"), "F6 body hash helper missing");
assert.ok(ingestion.includes("message?.is_echo === true") || ingestion.includes("message.is_echo === true"), "F6 must only hash/send-reconcile Meta echo messages");

assert.ok(service.includes("getInboxSendState"), "F6 service send-state fetch missing");
assert.ok(service.includes('fetch(`/api/inbox/${encodeURIComponent(conversationId)}/send-state`'), "F6 send-state must call safe GET endpoint");
assert.ok(service.includes("normalizeInboxSendState"), "F6 service must normalize send-state response");

assert.ok(main.includes("checkInboxSendStatus"), "F6 check status handler missing");
assert.ok(main.includes("data-inbox-check-send-status"), "F6 CHECK STATUS button hook missing");
assert.ok(main.includes("CHECK STATUS"), "F6 CHECK STATUS label missing");
assert.ok(main.includes("Checking..."), "F6 checking progress label missing");
assert.ok(main.includes("getInboxSendState(adminAuthSession, conversation.id)"), "F6 UI must call safe send-state GET action");
assert.ok(service.includes("Send status uncertain. Check Business Suite before trying again."), "F6 must keep unknown warning copy");
const checkStatusBody = extractFunction(main, "checkInboxSendStatus");
assert.equal(checkStatusBody.includes("sendInboxReply"), false, "CHECK STATUS must not send a reply");

for (const forbidden of ["RETRY SEND", "SEND AGAIN", "FORCE SEND", "MARK SENT", "MARK FAILED"]) {
  assert.equal(main.includes(forbidden), false, `F6 must not add ${forbidden}`);
}

assert.ok(migration.includes("message_echo"), "F6 migration must reconcile only Meta echo messages");
assert.ok(migration.includes("bodyHash"), "F6 migration must require body hash match");
assert.ok(migration.includes("attempt.status = 'unknown'"), "F6 migration must only reconcile unknown attempts");
assert.ok(migration.includes("reconcile_candidate_count = 1"), "F6 migration must require exactly one candidate");
assert.ok(migration.includes("send_reconciled"), "F6 migration must write a reconciliation event");
assert.equal(/delivery|read/.test(migration.match(/if\s+event_type\s+=\s+'message_echo'[\s\S]*?end if;/i)?.[0] || ""), false, "Delivery/read events must not drive reconciliation");
assert.equal(/alter\s+table\s+public\.inbox_outbound_attempts/i.test(migration), false, "F6 must not alter outbound-attempt schema");
assert.equal(/grant\s+select\s+on\s+table\s+public\.inbox_outbound_attempts\s+to\s+authenticated/i.test(migration), false, "F6 must not expose outbound attempts to browsers");
assert.equal(/META_PAGE_ACCESS_TOKEN|PAGE_ACCESS_TOKEN|recipientPsid|body_hash/i.test(main), false, "Browser UI must not expose send internals or secrets");

console.log("PASS Facebook Inbox F6 browser/source acceptance");

function extractFunction(source, name) {
  const start = source.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `${name} function missing`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  throw new Error(`${name} function body not found`);
}
