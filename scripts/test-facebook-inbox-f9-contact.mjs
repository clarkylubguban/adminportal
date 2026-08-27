import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { handleInboxAction } from "../api/_lib/inboxActions.js";
import { updateInboxContact } from "../src/services/adminInbox.js";

const state = {
  contact: {
    id: "contact-1",
    display_name: "Clark Lubguban",
    primary_phone: null,
    primary_email: null,
    company_name: null,
  },
  conversation: {
    id: "013a937a-c902-4f00-9356-2d132618730d",
    channel_identity_id: "identity-1",
    state: "needs_reply",
    owner_user_id: null,
    reply_window_expires_at: "2026-08-28T01:00:00Z",
  },
  identity: {
    id: "identity-1",
    contact_id: "contact-1",
    external_user_id: "PSID-SECRET",
    profile_picture_url: "https://example.invalid/profile.jpg",
  },
  messagesChanged: 0,
  conversationChanged: 0,
  identityChanged: 0,
};

async function main() {
let response = await callUpdate({
  displayName: " Clark   Lubguban ",
  primaryPhone: " 0917 000 1111 ",
  primaryEmail: " clark@example.com ",
  companyName: " TRRY   Apparel ",
});
assert.equal(response.statusCode, 200, "supported contact save must succeed");
assert.deepEqual(response.body.contact, {
  displayName: "Clark Lubguban",
  primaryPhone: "0917 000 1111",
  primaryEmail: "clark@example.com",
  companyName: "TRRY Apparel",
});
assert.equal(state.contact.display_name, "Clark Lubguban", "existing name must be preserved when saved");
assert.equal(state.contact.primary_phone, "0917 000 1111", "phone must save to inbox_contacts.primary_phone");
assert.equal(state.contact.primary_email, "clark@example.com", "email must save to inbox_contacts.primary_email");
assert.equal(state.contact.company_name, "TRRY Apparel", "company must save to inbox_contacts.company_name");

response = await callUpdate({ displayName: "  Clark L.  " });
assert.equal(response.statusCode, 200, "admin display name edit must succeed");
assert.equal(response.body.contact.displayName, "Clark L.", "admin-edited display name must return safely");
assert.equal(state.contact.display_name, "Clark L.", "admin-edited display name must become contact authority");

response = await callUpdate({ displayName: "Clark L.", address: "Unsupported" });
assert.equal(response.statusCode, 400, "unsupported address fields must be rejected");
assert.equal(response.body.error, "UNSUPPORTED_CONTACT_FIELD");
assert.equal(state.contact.address, undefined, "unsupported fields must not be written to schema");

response = await callUpdate({ displayName: "Clark L." }, { allowInbox: false });
assert.equal(response.statusCode, 403, "user without Inbox access must be rejected");

assert.equal(state.messagesChanged, 0, "Messenger messages must not change during contact save");
assert.equal(state.conversationChanged, 0, "conversation state/owner/reply window must not change during contact save");
assert.equal(state.identityChanged, 0, "identity PSID/profile data must not change during contact save");
assert.equal(state.identity.external_user_id, "PSID-SECRET", "PSID must remain untouched");
assert.equal(state.identity.profile_picture_url, "https://example.invalid/profile.jpg", "F8 profile photo must remain untouched");

const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, options) => {
  calls.push({ url, options });
  return {
    ok: true,
    json: async () => ({
      ok: true,
      contact: {
        displayName: "Clark L.",
        primaryPhone: "0917 000 1111",
        primaryEmail: "clark@example.com",
        companyName: "TRRY Apparel",
      },
    }),
  };
};
try {
  const result = await updateInboxContact({ access_token: "session-token" }, state.conversation.id, {
    displayName: "Clark L.",
    primaryPhone: "0917 000 1111",
    primaryEmail: "clark@example.com",
    companyName: "TRRY Apparel",
  });
  assert.equal(calls[0].url, `/api/inbox/${encodeURIComponent(state.conversation.id)}/update-contact`, "client wrapper must post to update-contact");
  assert.equal(calls[0].options.headers.Authorization, "Bearer session-token", "client wrapper must use bearer auth");
  assert.equal(result.displayName, "Clark L.", "client wrapper must return safe contact fields");
  assert.equal(JSON.stringify(result).includes("PSID"), false, "client wrapper response must not expose identity data");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("PASS Facebook Inbox F9.2 supported contact persistence contract");
}

async function callUpdate(body, options = {}) {
  const req = new EventEmitter();
  req.url = `/api/inbox/${encodeURIComponent(state.conversation.id)}/update-contact`;
  req.method = "POST";
  req.headers = { authorization: "Bearer good-token" };
  req.body = body;
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = JSON.parse(value); },
  };
  await handleInboxAction(req, res, { supabase: createSupabase(options) });
  return res;
}

function createSupabase({ allowInbox = true } = {}) {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: "admin-user-1", email: "owner@example.com" } }, error: null }),
    },
    from(table) {
      return new Query(table, allowInbox);
    },
  };
}

class Query {
  constructor(table, allowInbox) {
    this.table = table;
    this.allowInbox = allowInbox;
    this.filters = {};
    this.updateValues = null;
  }

  select() { return this; }
  eq(column, value) { this.filters[column] = value; return this; }
  is() { return this; }
  lte() { return this; }
  gt() { return this; }
  limit() { return this; }
  update(values) {
    this.updateValues = values;
    return this;
  }

  async maybeSingle() {
    if (this.table === "admin_users") {
      return { data: { id: "admin-row-1", user_id: "admin-user-1", email: "owner@example.com", role: "owner", access_role_key: "owner_admin", is_active: true }, error: null };
    }
    if (this.table === "admin_role_module_permissions") {
      return { data: { can_access: this.allowInbox }, error: null };
    }
    if (this.table === "inbox_conversations") {
      return { data: { ...state.conversation }, error: null };
    }
    if (this.table === "inbox_channel_identities") {
      return { data: { id: state.identity.id, contact_id: state.identity.contact_id }, error: null };
    }
    if (this.table === "inbox_contacts") {
      Object.assign(state.contact, this.updateValues);
      return { data: { ...state.contact }, error: null };
    }
    return { data: null, error: null };
  }

  then(resolve) {
    if (this.table === "admin_temporary_module_grants") return resolve({ data: [], error: null });
    return resolve({ data: [], error: null });
  }
}

await main();
