import assert from "node:assert/strict";
import { createMvpDashboard } from "../src/mvpDashboard.js";

globalThis.window = { location: { search: "" } };

const dashboard = createMvpDashboard();
const now = new Date();
const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const previousKey = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, "0")}`;
const older = new Date(now.getFullYear(), now.getMonth() - 13, 1);
const olderKey = `${older.getFullYear()}-${String(older.getMonth() + 1).padStart(2, "0")}`;

function inquiry(id, createdAt, overrides = {}) {
  return {
    id,
    createdAt,
    customer: overrides.customer || id,
    company: overrides.company || "",
    productDesc: overrides.productDesc || "Admin Polo Uniform",
    service: overrides.service || "Embroidery",
    qty: overrides.qty || "12",
    status: overrides.status || "new",
    quoteStatus: overrides.quoteStatus || "",
    quotePublishedAt: overrides.quotePublishedAt || "",
    followUpDate: overrides.followUpDate || "",
    odooSO: overrides.odooSO || "",
    artworkStatus: overrides.artworkStatus || "approved",
    paymentStatus: overrides.paymentStatus || "confirmed",
    productionStage: overrides.productionStage || "queued",
    dueDate: overrides.dueDate || "",
  };
}

function task(id, status, overrides = {}) {
  return {
    id,
    taskCode: overrides.taskCode || id,
    title: overrides.title || id,
    status,
    submissionDeadline: overrides.submissionDeadline || "",
    scheduledDate: overrides.scheduledDate || "",
  };
}

function render(items, tasks = []) {
  return dashboard.renderOverview({ items, tasks, taskLoadState: "ready", taskRoute: "/workboard", notices: "" });
}

const currentOne = `${currentKey}-08T10:00:00+08:00`;
const currentTwo = `${currentKey}-12T10:00:00+08:00`;
const previousOne = `${previousKey}-09T10:00:00+08:00`;
const olderOne = `${olderKey}-01T10:00:00+08:00`;
const todayIso = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

const html = render([
  inquiry("TRRY-TST-CURRENT-1", currentOne, { customer: "Current A", status: "sent", quoteStatus: "ready", quotePublishedAt: currentOne }),
  inquiry("TRRY-TST-CURRENT-2", currentTwo, { customer: "Current B", status: "won", quoteStatus: "approved", odooSO: "SO-1" }),
  inquiry("TRRY-TST-PREV-1", previousOne, { customer: "Previous", followUpDate: todayIso }),
  inquiry("TRRY-TST-OLD", olderOne, { customer: "Old" }),
  inquiry("TRRY-TST-BAD", "not-a-date", { customer: "Invalid" }),
], [
  task("TASK-REVIEW", "FOR_REVIEW", { title: "Review submitted proof" }),
  task("TASK-REVISION", "NEEDS_REVISION", { title: "Revise artwork" }),
  task("TASK-OVERDUE", "TO_DO", { title: "Overdue task", submissionDeadline: `${yesterday}T12:00:00+08:00` }),
]);

assert.equal((html.match(/overview-chart-point/g) || []).length, 12, "chart renders exactly 12 monthly points");
assert.ok(html.includes(`${new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString("en-US", { month: "short", year: "numeric" })}: 2`), "current month count included");
assert.ok(html.includes(`${new Date(previous.getFullYear(), previous.getMonth(), 1).toLocaleDateString("en-US", { month: "short", year: "numeric" })}: 1`), "previous month count included");
assert.ok(html.includes("100% increase vs previous month"), "increase comparison rendered");
assert.ok(html.indexOf("Current B") < html.indexOf("Current A"), "recent inquiries sort by creation date descending");
assert.ok(html.includes('data-mvp-route="/inquiries?inquiry=TRRY-TST-CURRENT-2"'), "recent inquiry route targets drawer route");
assert.ok(html.includes('class="quote-status-badge quote-status-badge--approved"'), "recent inquiries reuse Phase 2 quote badge helper");
assert.ok(html.includes("WAITING FOR REVIEW"), "task waiting for review appears as priority item");
assert.ok(html.includes("NEEDS REVISION"), "needs revision task appears as priority item");
assert.ok(html.includes("Customer follow-up due today"), "follow-up due today appears");
assert.ok(html.includes("Operational Alerts"), "operational alerts section renders");

const decrease = render([
  inquiry("CURRENT", currentOne),
  inquiry("PREV-A", previousOne),
  inquiry("PREV-B", `${previousKey}-10T10:00:00+08:00`),
]);
assert.ok(decrease.includes("50% decrease vs previous month"), "decrease comparison rendered");

const previousZero = render([inquiry("CURRENT", currentOne)]);
assert.ok(previousZero.includes("New activity vs previous month"), "previous-zero comparison avoids misleading infinity");

const noValid = render([inquiry("BAD", "invalid")]);
assert.ok(noValid.includes("Monthly history unavailable"), "invalid timestamps are excluded without assigning today");

const allZeroVisible = render([inquiry("OLD", olderOne)]);
assert.ok(allZeroVisible.includes("No inquiries in the latest 12 months"), "valid older timestamps produce empty visible chart state");
assert.ok(allZeroVisible.includes("No change from previous month"), "both-zero comparison rendered");

const yearBoundary = render([
  inquiry("DEC", `${now.getFullYear() - 1}-12-31T23:30:00+08:00`),
  inquiry("JAN", `${now.getFullYear()}-01-01T00:15:00+08:00`),
]);
assert.ok(yearBoundary.includes(`Dec ${now.getFullYear() - 1}: 1`), "December bucket preserved across year boundary");
assert.ok(yearBoundary.includes(`Jan ${now.getFullYear()}: 1`), "January bucket preserved across year boundary");

console.log("PASS Overview dashboard render, aggregation, comparison, and priority fixtures");