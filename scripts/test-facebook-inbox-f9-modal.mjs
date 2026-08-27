import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await read("src/main.js");
const styles = await read("src/styles.css");

const customerModal = extractFunctionSource("renderInboxCustomerDetailsModal");
const notesModal = extractFunctionSource("renderInboxNotesModal");
const followUpModal = extractFunctionSource("renderInboxFollowUpModal");
const detailPanel = extractFunctionSource("renderInboxDetailPanel");

assert.ok(customerModal.includes("inbox-modal-scrim"), "Customer Details must use a dimmed modal scrim");
assert.ok(customerModal.includes("inbox-centered-modal inbox-customer-details-modal"), "Customer Details must use the centered modal container");
assert.ok(customerModal.includes("DETAILS") && customerModal.includes("Customer Details"), "Customer Details modal header must match Figma language");
assert.ok(customerModal.includes("Facebook Messenger"), "Customer Details modal must retain Messenger context");
assert.ok(customerModal.includes("Customer Name"), "Customer Details modal must show customer name");
assert.ok(customerModal.includes("Mobile Number"), "Customer Details modal must show mobile number");
assert.ok(customerModal.includes("Email"), "Customer Details modal must show email");
assert.ok(customerModal.includes("Company"), "Customer Details modal must show company");
assert.equal(customerModal.includes('renderInboxModalField("Address"'), false, "Address must be deferred until schema support exists");
assert.equal(customerModal.includes('renderInboxModalField("City"'), false, "City must be deferred until schema support exists");
assert.equal(customerModal.includes('renderInboxModalField("State"'), false, "State must be deferred until schema support exists");
assert.equal(customerModal.includes('renderInboxModalField("ZIP / Postal Code"'), false, "ZIP must be deferred until schema support exists");
assert.ok(customerModal.includes("Facebook Profile"), "Customer Details modal must summarize F8 profile data");
assert.ok(customerModal.includes("Linked Records"), "Customer Details modal must keep linked records compact");
assert.ok(customerModal.includes("data-inbox-save-customer-details") && customerModal.includes("SAVING..."), "Save Details must persist supported contact fields");
assert.equal(/PSID|externalUserId|META_PAGE_ACCESS_TOKEN|META_APP_SECRET|service_role|Bearer/.test(customerModal), false, "Customer Details modal must not expose PSIDs or secrets");

assert.ok(notesModal.includes("inbox-centered-modal small"), "Notes must use a small centered modal");
assert.ok(notesModal.includes("data-inbox-note-draft") && notesModal.includes("data-inbox-add-note"), "Notes modal must preserve F4 note action hooks");
assert.ok(followUpModal.includes("inbox-centered-modal small"), "Follow-up must use a small centered modal");
assert.ok(followUpModal.includes("data-inbox-follow-up-draft") && followUpModal.includes("data-inbox-follow-up-reason") && followUpModal.includes("data-inbox-follow-up"), "Follow-up modal must preserve F4 follow-up hooks");

assert.ok(detailPanel.includes("VIEW CUSTOMER DETAILS"), "Right summary panel must expose Customer Details action");
assert.ok(detailPanel.includes("ADD NOTE / VIEW NOTES"), "Right summary panel must not permanently render the full notes form");
assert.equal(detailPanel.includes("<h2>Customer Details</h2>"), false, "Right panel must not permanently render the old Customer Details card");
assert.equal(detailPanel.includes("<h2>Customer Details</h2>") && detailPanel.includes("primaryPhone"), false, "Right panel must not permanently stack full contact fields");

assert.ok(styles.includes(".inbox-modal-scrim"), "Modal scrim CSS missing");
assert.ok(styles.includes("position: fixed"), "Modal scrim must be fixed, not a drawer");
assert.ok(styles.includes("max-width: 520px"), "Customer Details modal should be approximately 520px wide");
assert.ok(styles.includes("max-height: calc(100dvh - 24px)"), "Customer Details modal must keep header/footer reachable");
assert.ok(styles.includes(".inbox-modal-footer"), "Modal footer action placement missing");
assert.ok(styles.includes("background: #9eff05"), "Modal primary action must use lime product language");
assert.equal(/side-sheet|drawer|translateX|right:\s*0/.test(styles.match(/\.inbox-modal-scrim[\s\S]*?@media \(min-width: 1200px\)/)?.[0] || ""), false, "Customer Details must not be implemented as a drawer or side sheet");

console.log("PASS Facebook Inbox F9.1 centered modal contract");

function extractFunctionSource(name) {
  let start = main.indexOf(`function ${name}`);
  if (start === -1) start = main.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `${name} function missing`);
  const signature = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\([\\s\\S]*?\\)\\s*\\{`, "m");
  const match = signature.exec(main.slice(start));
  assert.ok(match, `${name} function signature not found`);
  const open = start + match[0].length - 1;
  let depth = 0;
  for (let index = open; index < main.length; index += 1) {
    if (main[index] === "{") depth += 1;
    if (main[index] === "}") {
      depth -= 1;
      if (depth === 0) return main.slice(start, index + 1);
    }
  }
  throw new Error(`${name} function body not found`);
}

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}
