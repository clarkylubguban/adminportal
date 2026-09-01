import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [main, service, styles] = await Promise.all([
  readFile("src/main.js", "utf8"),
  readFile("src/services/tasks.js", "utf8"),
  readFile("src/styles.css", "utf8"),
]);

for (const text of [
  "AUTO PLAN TODAY",
  "Quick Direction",
  "Create unassigned AI marketing and daily content drafts",
  "requestAutoPlanToday",
  "canUseAutoPlanTodayUi",
  "VITE_ENABLE_AUTO_PLAN_TODAY",
  "OPEN DRAFT VIEW",
]) {
  assert.ok(main.includes(text) || service.includes(text), `missing UI contract text: ${text}`);
}

assert.ok(main.includes("adminUser?.role === \"owner\""), "Auto Plan UI must be Owner-only");
assert.ok(main.includes("workboardFilterStatus = \"draft\""), "Auto Plan success must transition to Draft view");
assert.ok(service.includes("/api/planning/auto-plan-today"), "Auto Plan service route missing");
assert.ok(styles.includes(".auto-plan-panel"), "Auto Plan panel styles missing");
assert.ok(styles.includes("@media (max-width: 980px)"), "responsive Workboard breakpoint missing");

console.log("PASS Auto Plan Today static UI wiring");
