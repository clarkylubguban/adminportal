import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildTaskCalendar, toManilaDateKey } from "../api/_lib/taskCalendarProjection.js";

const source = await readFile("src/main.js", "utf8");
const styles = await readFile("src/styles.css", "utf8");
const service = await readFile("src/services/tasks.js", "utf8");

assert.ok(source.includes('"/calendar": "Calendar"'), "Calendar route missing");
assert.ok(source.includes("canViewCalendarRoute"), "Calendar feature gate missing");
assert.ok(source.includes("VITE_ENABLE_CALENDAR"), "Calendar flag missing");
assert.ok(source.includes("renderCalendarPage"), "Calendar page renderer missing");
assert.ok(source.includes('return "All day"'), "date-only Calendar fields must render as all-day");
assert.ok(source.includes("data-calendar-prev"), "previous month control missing");
assert.ok(source.includes("data-calendar-next"), "next month control missing");
assert.ok(source.includes("data-calendar-today"), "Today control missing");
assert.ok(source.includes("calendar-icon-button"), "compact Calendar icon button missing");
assert.ok(source.includes("calendar-legend"), "Calendar legend missing");
assert.ok(source.includes("calendar-auth-required"), "Calendar auth-required state missing");
assert.ok(source.includes("data-calendar-login-again"), "Calendar login-again action missing");
assert.ok(source.includes("Tasks without canonical dates"), "Calendar empty canonical-date explanation missing");
assert.ok(source.includes("shortTaskTitle"), "Calendar task title shortening missing");
assert.ok(source.includes("calendarAssigneeFilter"), "assignee filter state missing");
assert.ok(source.includes("calendarSourceFilter"), "source filter state missing");
assert.ok(source.includes("calendarStatusFilter"), "status filter state missing");
assert.ok(source.includes("Read-only Calendar projection"), "read-only summary missing");
assert.ok(!source.includes("data-calendar-create"), "Calendar create control must not exist");
assert.ok(!source.includes("data-calendar-reschedule"), "Calendar reschedule control must not exist");
assert.ok(service.includes("/api/task-calendar"), "Calendar client service endpoint missing");
assert.ok(styles.includes(".calendar-grid"), "Calendar grid styles missing");
assert.ok(styles.includes("grid-template-columns: minmax(0, 1fr)"), "Calendar layout must use a single full-width column");
assert.ok(styles.includes(".calendar-icon-button svg"), "Calendar navigation SVG dimensions missing");
assert.ok(styles.includes("max-width: 16px"), "Calendar navigation SVG max width missing");
assert.ok(styles.includes("@media (max-width: 640px)"), "Calendar mobile styles missing");
assert.ok(!styles.includes("order: -1"), "Agenda must not be moved above the month grid on mobile");
assert.ok(source.includes("calendar-agenda-meta"), "Agenda metadata layout missing");
assert.ok(source.includes("<b>Status</b>"), "Agenda status field missing");
assert.ok(source.includes("<b>Source</b>"), "Agenda source field missing");
assert.ok(source.includes("<b>Assignee</b>"), "Agenda assignee field missing");

assert.equal(toManilaDateKey("2028-02-29T15:59:00.000Z"), "2028-02-29", "leap-day Manila placement failed");
assert.equal(toManilaDateKey("2028-02-29T16:00:00.000Z"), "2028-03-01", "midnight Manila boundary failed");
assert.equal(toManilaDateKey("2026-12-31T16:30:00.000Z"), "2027-01-01", "year boundary Manila placement failed");

const task = {
  id: "10000000-0000-4000-8000-000000000001",
  taskCode: "CAL-001",
  title: "Synthetic calendar task",
  sourceType: "MANUAL",
  status: "TO_DO",
  priority: "HIGH",
  assignedUserId: "95000000-0000-4000-8000-000000000010",
  assignedUser: { displayName: "Synthetic Staff", role: "staff", isActive: true },
  scheduledDate: "2026-08-01",
  submissionDeadline: "2026-08-01T15:30:00.000Z",
  approvalDeadline: "2026-08-02T16:00:00.000Z",
  completedAt: null,
};
const projected = buildTaskCalendar([task], { from: "2026-08-01", to: "2026-08-03" }, new Date("2026-08-03T00:00:00.000Z"));
assert.deepEqual(projected.events.map((event) => event.projectionType), ["SCHEDULED START", "TASK DEADLINE", "REVIEW DEADLINE"]);
assert.equal(new Set(projected.events.map((event) => event.key)).size, 3, "projection keys must be deterministic and distinct");
assert.equal(projected.events.find((event) => event.projectionType === "REVIEW DEADLINE").dateKey, "2026-08-03", "review deadline Manila date failed");

const done = buildTaskCalendar([{ ...task, status: "DONE", completedAt: "2026-08-01T01:00:00.000Z" }], { from: "2026-08-01", to: "2026-08-01" }, new Date("2026-08-04T00:00:00.000Z"));
assert.equal(done.events.find((event) => event.projectionType === "COMPLETED").overdue, false, "completion must never be overdue");
assert.equal(done.events.every((event) => event.overdue === false), true, "DONE projections must not be actively overdue");

const noDates = buildTaskCalendar([{ ...task, scheduledDate: null, submissionDeadline: null, approvalDeadline: null, completedAt: null }], { from: "2026-08-01", to: "2026-08-31" }, new Date("2026-08-04T00:00:00.000Z"));
assert.equal(noDates.events.length, 0, "tasks without canonical dates must not become fake Calendar events");

process.stdout.write("PASS Calendar UI contracts and Asia/Manila projection rules\n");
