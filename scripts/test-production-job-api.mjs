import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  canonicalProductionStage,
  createProductionJobHandler,
  getProductionReadiness,
  nextProductionStage,
  normalizeProductionJob,
} from "../api/_lib/productionJob.js";

const ids = {
  owner: "83000000-0000-4000-8000-000000000001",
  admin: "83000000-0000-4000-8000-000000000002",
  staff: "83000000-0000-4000-8000-000000000003",
  otherStaff: "83000000-0000-4000-8000-000000000004",
  inactive: "83000000-0000-4000-8000-000000000005",
};
const jobId = "QA-PRODUCTION-DRAWER-PHASE-8D2";
const actors = {
  owner: profile(ids.owner, "Synthetic Owner", "owner"),
  admin: profile(ids.admin, "Synthetic Admin", "admin"),
  staff: profile(ids.staff, "Synthetic Staff", "staff"),
  other: profile(ids.otherStaff, "Synthetic Other Staff", "staff"),
  inactive: { ...profile(ids.inactive, "Synthetic Inactive", "staff"), is_active: false },
};
const displayProfiles = Object.values(actors);

for (const role of ["owner", "admin", "staff"]) {
  const harness = createHarness(baseJob(), role);
  const result = await call(harness.handler, { id: jobId, token: role });
  assert.equal(result.status, 200, `${role} read succeeds`);
  assert.equal(result.body.job.assignedStaff, "Synthetic Staff");
  assert.equal(result.body.job.owner, "Synthetic Owner");
  assert.equal(result.body.job.validNextStage, "printing");
  assertSafeProjection(result.body.job);
}

{
  const harness = createHarness(baseJob(), "owner");
  assert.equal((await call(harness.handler, { id: jobId })).status, 401);
  assert.equal((await call(harness.handler, { id: jobId, token: "invalid" })).status, 401);
  assert.equal((await call(harness.handler, { id: jobId, token: "inactive" })).status, 403);
  assert.equal((await call(harness.handler, { id: "MISSING", token: "owner" })).status, 404);
  const nonWon = createHarness({ ...baseJob(), status: "approved" }, "owner");
  const result = await call(nonWon.handler, { id: jobId, token: "owner" });
  assert.equal(result.status, 404);
  assert.equal(result.body.error.code, "PRODUCTION_JOB_NOT_CONFIRMED");
}

assert.equal(canonicalProductionStage("qc_finishing"), "qc");
assert.equal(canonicalProductionStage("ready_for_fulfillment"), "ready");
assert.equal(nextProductionStage({ ...baseJob(), product: "DTF Printing" }), "printing");
assert.equal(nextProductionStage({ ...baseJob(), product: "Embroidery" }), "embroidery");
assert.equal(nextProductionStage({ ...baseJob(), product: "Screen Printing" }), "screen_printing");
assert.equal(nextProductionStage({ ...baseJob(), product: "Custom Other Work" }), "");
assert.equal(nextProductionStage({ ...baseJob(), production_stage: "printing" }), "qc");
assert.equal(nextProductionStage({ ...baseJob(), production_stage: "embroidery" }), "qc");
assert.equal(nextProductionStage({ ...baseJob(), production_stage: "screen_printing" }), "qc");
assert.equal(nextProductionStage({ ...baseJob(), production_stage: "in_production" }), "qc");
assert.equal(nextProductionStage({ ...baseJob(), production_stage: "qc" }), "ready");
assert.equal(nextProductionStage({ ...baseJob(), production_stage: "ready" }), "completed");
assert.equal(nextProductionStage({ ...baseJob(), production_stage: "completed" }), "");

for (const [label, patch, missing] of [
  ["product", { product: "", product_desc: "" }, "Product or service complete"],
  ["quantity", { quantity: "0", size_breakdown: "" }, "Quantity complete"],
  ["due date", { due_date: null }, "Due date set"],
  ["artwork", { artwork_status: "submitted" }, "Artwork approved"],
  ["assignee", { assigned_user_id: null, assigned_staff: null }, "Staff assigned"],
  ["blocker", { blocked_reason: "Materials unavailable" }, "No blocker"],
]) {
  const row = { ...baseJob(), ...patch };
  const readiness = getProductionReadiness(row);
  assert.equal(readiness.ready, false, `${label} blocks readiness`);
  assert.ok(readiness.missing.includes(missing), `${label} missing label`);
  const harness = createHarness(row, "owner");
  const result = await patchJob(harness.handler, row, "owner", {
    action: "advance_production_stage",
    nextStage: "printing",
  });
  assert.equal(result.status, 400, `${label} blocks queued start`);
  assert.equal(result.body.error.code, row.blocked_reason ? "PRODUCTION_BLOCKED" : "PRODUCTION_NOT_READY");
}

for (const paymentPatch of [
  { payment_status: "required", payment_verified_amount: null, payment_confirmed_amount: null },
  { payment_status: "pay_at_shop", payment_type: "shop", payment_verified_amount: null, payment_confirmed_amount: null },
  { payment_status: "partially_paid", payment_verified_amount: 1200, payment_confirmed_amount: 1200 },
]) {
  const row = { ...baseJob(), ...paymentPatch };
  assert.equal(getProductionReadiness(row).ready, false, "full payment is a readiness gate");
  assert.ok(getProductionReadiness(row).missing.includes("Full payment confirmed"));
  const harness = createHarness(row, "owner");
  const result = await patchJob(harness.handler, row, "owner", {
    action: "advance_production_stage",
    nextStage: "printing",
  });
  assert.equal(result.status, 400, "incomplete payment blocks start");
  assert.equal(result.body.error.code, "PRODUCTION_NOT_READY");
}

for (const role of ["owner", "admin"]) {
  const row = baseJob();
  const harness = createHarness(row, role);
  const result = await patchJob(harness.handler, row, role, {
    action: "assign_production_staff",
    assignedUserId: ids.otherStaff,
  });
  assert.equal(result.status, 200, `${role} assignment succeeds`);
  assert.equal(result.body.job.assignedStaff, "Synthetic Other Staff");
}

{
  const row = baseJob();
  const staffHarness = createHarness(row, "staff");
  const assignment = await patchJob(staffHarness.handler, row, "staff", {
    action: "assign_production_staff",
    assignedUserId: ids.otherStaff,
  });
  assert.equal(assignment.status, 403, "Staff assignment denied");

  const assignedNoteHarness = createHarness(row, "staff");
  const assignedNote = await patchJob(assignedNoteHarness.handler, row, "staff", {
    action: "update_production_note",
    productionNote: "Assigned Staff note",
  });
  assert.equal(assignedNote.status, 200, "assigned Staff note succeeds");
  assert.equal(assignedNote.body.job.productionNote, "Assigned Staff note");

  const unassignedRow = { ...row, assigned_user_id: ids.otherStaff, assigned_staff: "Synthetic Other Staff" };
  const unassignedHarness = createHarness(unassignedRow, "staff");
  const unassignedNote = await patchJob(unassignedHarness.handler, unassignedRow, "staff", {
    action: "update_production_note",
    productionNote: "Denied",
  });
  assert.equal(unassignedNote.status, 403, "unassigned Staff note denied");

  const assignedStageHarness = createHarness(row, "staff");
  const assignedStage = await patchJob(assignedStageHarness.handler, row, "staff", {
    action: "advance_production_stage",
    nextStage: "printing",
  });
  assert.equal(assignedStage.status, 200, "assigned Staff stage action succeeds");

  const unassignedStageHarness = createHarness(unassignedRow, "staff");
  const unassignedStage = await patchJob(unassignedStageHarness.handler, unassignedRow, "staff", {
    action: "advance_production_stage",
    nextStage: "printing",
  });
  assert.equal(unassignedStage.status, 403, "unassigned Staff stage action denied");

  const blocked = { ...row, blocked_reason: "Manager blocker" };
  const clearHarness = createHarness(blocked, "staff");
  const clear = await patchJob(clearHarness.handler, blocked, "staff", {
    action: "clear_production_blocker",
  });
  assert.equal(clear.status, 403, "Staff blocker clear denied");
}

for (const transition of [
  ["printing", "qc"],
  ["embroidery", "qc"],
  ["screen_printing", "qc"],
  ["in_production", "qc"],
  ["qc", "ready"],
  ["ready", "completed"],
]) {
  const [current, next] = transition;
  const row = { ...baseJob(), production_stage: current };
  const harness = createHarness(row, "owner");
  const result = await patchJob(harness.handler, row, "owner", {
    action: "advance_production_stage",
    nextStage: next,
  });
  assert.equal(result.status, 200, `${current} moves to ${next}`);
  assert.equal(result.body.job.stage, next);
}

{
  const row = { ...baseJob(), production_stage: "printing" };
  for (const invalid of ["ready", "queued", "printing"]) {
    const harness = createHarness(row, "owner");
    const result = await patchJob(harness.handler, row, "owner", {
      action: "advance_production_stage",
      nextStage: invalid,
    });
    assert.equal(result.status, 400, `${invalid} is rejected from printing`);
    assert.equal(result.body.error.code, "PRODUCTION_TRANSITION_INVALID");
  }
}

{
  const row = baseJob();
  const harness = createHarness(row, "owner");
  const body = command(row, {
    action: "advance_production_stage",
    nextStage: "printing",
  });
  const first = await call(harness.handler, { id: jobId, token: "owner", method: "PATCH", body });
  assert.equal(first.status, 200);
  const duplicate = await call(harness.handler, { id: jobId, token: "owner", method: "PATCH", body });
  assert.equal(duplicate.status, 409, "duplicate transition is stale");
  assert.equal(duplicate.body.error.code, "PRODUCTION_STALE");
}

{
  const row = baseJob();
  const harness = createHarness(row, "owner");
  const stale = await call(harness.handler, {
    id: jobId,
    token: "owner",
    method: "PATCH",
    body: {
      action: "advance_production_stage",
      nextStage: "printing",
      expectedCurrentStage: "queued",
      expectedUpdatedAt: "2026-07-29T23:00:00Z",
    },
  });
  assert.equal(stale.status, 409);
}

{
  const row = { ...baseJob(), production_stage: "completed" };
  const harness = createHarness(row, "owner");
  const result = await patchJob(harness.handler, row, "owner", {
    action: "update_production_note",
    productionNote: "Not allowed",
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, "PRODUCTION_COMPLETED_LOCKED");
  const normalized = normalizeProductionJob(row, displayProfiles, actors.owner);
  assert.equal(normalized.validNextStage, "");
  assert.equal(normalized.permissions.completedReadOnly, true);
  assert.equal(normalized.permissions.canUpdateNote, false);
}

{
  const row = { ...baseJob(), product: "Generic Sewing", product_desc: "Custom work" };
  const harness = createHarness(row, "owner");
  const result = await patchJob(harness.handler, row, "owner", {
    action: "advance_production_stage",
    nextStage: "in_production",
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, "PRODUCTION_START_UNSUPPORTED");
}

const source = await readFile("api/_lib/productionJob.js", "utf8");
const selectBlock = source.match(/const JOB_SELECT = \[([\s\S]*?)\]\.join/)?.[1] || "";
assert.doesNotMatch(selectBlock, /odoo_so/i, "production projection has no Odoo dependency");
assert.doesNotMatch(selectBlock, /token|password|email/i);
const vercelConfig = JSON.parse(await readFile("vercel.json", "utf8"));
assert.ok(
  vercelConfig.rewrites.some((rewrite) => rewrite.source === "/api/production/:id"
    && rewrite.destination === "/api/inquiries/:id/workflow?_opsAction=production-job"),
  "public Production API route shares the existing workflow function",
);

process.stdout.write("PASS Production Job API roles, readiness, transitions, stale protection, and projection\n");

function createHarness(initialJob, defaultRole) {
  let stored = structuredClone(initialJob);
  const handler = createProductionJobHandler({
    createClient: () => ({}),
    getAuthUser: async (_client, token) => {
      const actor = actors[token];
      return actor ? { id: actor.user_id } : null;
    },
    getPortalProfile: async (_client, userId) =>
      Object.values(actors).find((actor) => actor.user_id === userId) || null,
    getJob: async (_client, reference) => reference === jobId ? structuredClone(stored) : null,
    getDisplayProfiles: async () => displayProfiles,
    validateAssignment: async (_client, targetId, caller) => {
      if (!["owner", "admin"].includes(caller.role)) return null;
      const target = Object.values(actors).find((actor) => actor.user_id === targetId && actor.is_active);
      return target ? {
        userId: target.user_id,
        displayName: target.display_name,
        role: target.role,
      } : null;
    },
    updateJob: async (_client, reference, updates, current) => {
      if (
        reference !== jobId
        || stored.production_stage !== current.production_stage
        || stored.production_updated_at !== current.production_updated_at
      ) return null;
      stored = { ...stored, ...updates };
      return structuredClone(stored);
    },
    now: () => "2026-07-30T02:00:00.000Z",
  });
  return { handler, defaultRole, get stored() { return stored; } };
}

function baseJob() {
  return {
    id: jobId,
    customer_name: "QA PRODUCTION DRAWER PHASE 8D2",
    company: "Synthetic QA",
    product: "DTF Printing",
    product_desc: "QA Shirt",
    quantity: "12",
    size_breakdown: "S 4 / M 4 / L 4",
    status: "won",
    next_action: "Prepare production handoff",
    due_date: "2026-08-10",
    fulfillment_method: "pickup",
    quoted_amount: 2400,
    quote_status: "approved",
    artwork_status: "approved",
    artwork_url: `${jobId}/qa-artwork.png`,
    artwork_approved_at: "2026-07-29T03:00:00Z",
    payment_status: "paid",
    payment_type: "full",
    payment_verified_amount: 2400,
    payment_confirmed_amount: 2400,
    owner_id: null,
    owner_user_id: ids.owner,
    assigned_staff: "Synthetic Staff",
    assigned_user_id: ids.staff,
    production_stage: "queued",
    production_note: "Synthetic production note",
    production_updated_at: "2026-07-30T01:00:00Z",
    blocked_reason: null,
    created_at: "2026-07-29T00:00:00Z",
  };
}

function profile(userId, displayName, role) {
  return {
    user_id: userId,
    display_name: displayName,
    role,
    is_active: true,
  };
}

function command(row, body) {
  return {
    ...body,
    expectedCurrentStage: canonicalProductionStage(row.production_stage),
    expectedUpdatedAt: row.production_updated_at
      ? new Date(row.production_updated_at).toISOString()
      : null,
  };
}

async function patchJob(handler, row, token, body) {
  return call(handler, {
    id: jobId,
    token,
    method: "PATCH",
    body: command(row, body),
  });
}

async function call(target, {
  id,
  token = "",
  method = "GET",
  body = undefined,
}) {
  const request = {
    method,
    query: { id },
    url: `/api/production/${encodeURIComponent(id)}`,
    headers: token
      ? { authorization: `Bearer ${token}`, host: "localhost" }
      : { host: "localhost" },
    ...(body ? { body } : {}),
  };
  const response = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(value) {
      this.value = value;
    },
  };
  await target(request, response);
  return {
    status: response.statusCode,
    body: JSON.parse(response.value),
  };
}

function assertSafeProjection(value) {
  const json = JSON.stringify(value);
  for (const forbidden of [
    ...Object.values(ids),
    "access_token",
    "refresh_token",
    "signedUrl",
    "odoo",
    "encrypted_password",
  ]) {
    assert.equal(json.includes(forbidden), false, `safe projection excludes ${forbidden}`);
  }
  for (const key of Object.keys(value)) {
    assert.doesNotMatch(key, /userId|auth|token|email/i, `safe top-level key: ${key}`);
  }
}
