import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const profile = await read("api/_lib/metaProfileEnrichment.js");
const ingestion = await read("api/_lib/metaInboxIngestion.js");
const inboxActions = await read("api/_lib/inboxActions.js");
const adminInbox = await read("src/services/adminInbox.js");
const f5Migration = await read("supabase/migrations/202608270001_add_facebook_inbox_f5_inquiry_bridge.sql");
const pkg = JSON.parse(await read("package.json"));
const migrations = await readdir(new URL("../supabase/migrations/", import.meta.url));

assert.ok(pkg.scripts["test:facebook-inbox-f8-profile"], "F8 profile test script must be registered");
assert.ok(pkg.scripts["test:facebook-inbox-f8-browser"], "F8.1 browser/source test script must be registered");
assert.ok(pkg.scripts["test:facebook-inbox-f8-db"], "F8 DB contract test script must be registered");
assert.equal(
  migrations.some((file) => /facebook_inbox_f8/i.test(file)),
  false,
  "F8 must not add a Supabase migration when existing display/profile fields are sufficient"
);

assert.ok(profile.includes("META_PAGE_ACCESS_TOKEN"), "profile lookup must use the existing server-side Page access token");
assert.ok(profile.includes("META_GRAPH_API_VERSION"), "profile lookup must use existing Graph version configuration");
assert.equal(profile.includes("VITE_META"), false, "Meta secrets must not use VITE/browser environment variables");
assert.ok(profile.includes("AbortController"), "profile lookup must have a bounded timeout");
assert.ok(profile.includes("inflightLookups"), "profile lookup should dedupe concurrent lookups");
assert.ok(profile.includes("last_attempt_at"), "profile enrichment metadata must record safe retry state");
assert.ok(profile.includes("safeMetaProfileError"), "profile failures must sanitize Meta error codes");
assert.ok(ingestion.includes("safe_error_code"), "profile failures must persist only safe error codes");
assert.ok(profile.includes('"first_name,last_name,name,profile_pic"'), "profile lookup must request supported profile name and picture fields");

assert.ok(ingestion.includes("enrichMetaProfilesForEvents"), "webhook ingestion must enrich missing Meta profiles server-side");
assert.ok(ingestion.includes("persistMetaProfileEnrichment"), "successful/failure profile enrichment state must persist after ingestion");
assert.ok(ingestion.includes("customerDisplayName"), "profile display name must flow through the canonical ingestion event contract");
assert.ok(ingestion.includes("profile_picture_url"), "profile picture URL must update the existing identity field");
assert.ok(ingestion.includes("inbox_contacts"), "contact display name must use the existing inbox_contacts table");

assert.ok(inboxActions.includes('"refresh-profile"'), "F8 must provide a controlled server-side profile refresh action");
assert.ok(inboxActions.includes("canAccessInbox"), "profile refresh must preserve Inbox permission checks");
assert.ok(inboxActions.includes("refreshMetaProfileForConversation"), "profile refresh must run server-side enrichment");
assert.equal(inboxActions.includes("external_user_id") && inboxActions.includes("sendJson(response, 200"), false, "profile refresh response must not expose PSID");

assert.ok(adminInbox.includes("refreshInboxFacebookProfile"), "Inbox service must export authenticated profile refresh wrapper");
assert.ok(adminInbox.includes('postInboxAction(authSession, conversationId, "refresh-profile", { force })'), "Inbox service wrapper must use existing postInboxAction pattern");
assert.ok(adminInbox.includes("formatInboxCustomerName({ identity, contact })"), "Inbox read model must keep using canonical identity/contact names");
assert.ok(adminInbox.includes("safeText(contact?.display_name) || safeText(identity?.display_name) || \"Facebook customer\""), "Inbox fallback priority must remain contact > identity > fallback");
assert.ok(f5Migration.includes("coalesce(nullif(btrim(contact_row.display_name), ''), nullif(btrim(identity_row.display_name), ''), 'Facebook customer')"), "F5 conversion must naturally use enriched contact/identity names");

assert.equal(profile.includes("META_APP_SECRET"), false, "profile helper must not touch the webhook app secret");
assert.equal(profile.includes("console.log"), false, "profile helper must not log PSID or token data");
assert.equal(profile.includes("console.error"), false, "profile helper must not log secret-bearing Meta responses");

process.stdout.write("PASS Facebook Inbox F8 DB/source profile enrichment contract\n");

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}
