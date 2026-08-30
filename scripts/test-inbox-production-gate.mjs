import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [main, opsBoard, build, envExample, packageJson] = await Promise.all([
  readFile("src/main.js", "utf8"),
  readFile("src/services/opsBoard.js", "utf8"),
  readFile("scripts/build.mjs", "utf8"),
  readFile(".env.example", "utf8"),
  readFile("package.json", "utf8").then(JSON.parse),
]);

assert.equal(
  packageJson.scripts["test:inbox-production-gate"],
  "node scripts/test-inbox-production-gate.mjs",
  "Production Inbox gate test must be registered"
);
assert.ok(
  build.includes('VITE_ENABLE_INBOX: process.env.VITE_ENABLE_INBOX ?? env.VITE_ENABLE_INBOX ?? "false"'),
  "Inbox must default off when the deployment environment does not explicitly enable it"
);
assert.ok(envExample.includes("VITE_ENABLE_INBOX=false"), "The public Inbox flag must be documented as disabled by default");
assert.ok(
  main.includes('function isInboxUiEnabled()')
    && main.includes('isFeatureFlagEnabled("VITE_ENABLE_INBOX", "VITE_INBOX_ENABLED")'),
  "Inbox visibility must use the deployment feature flag"
);
assert.ok(
  main.includes('inboxAccessState = isInboxUiEnabled() ? await getInboxAccessState(session) : "denied"'),
  "Disabled deployments must not query Inbox access tables during authentication"
);
assert.ok(
  main.includes('includeInboxLineage: isInboxUiEnabled()'),
  "Disabled deployments must not enrich inquiries from Inbox lineage tables"
);
assert.ok(
  opsBoard.includes("{ includeInboxLineage = true } = {}")
    && opsBoard.includes("const inquiries = includeInboxLineage")
    && opsBoard.includes(": mappedInquiries;"),
  "Ops inquiries must support bypassing Inbox lineage reads"
);
assert.ok(
  main.includes('return isInboxUiEnabled() && adminAuthStatus === "approved" && inboxAccessState === "allowed"'),
  "Inbox routes and navigation must require the deployment flag"
);
assert.equal(
  (main.match(/canViewInboxRoute\(\) \? \[\{ label: "Inbox"/g) || []).length,
  2,
  "Desktop and mobile Inbox navigation must both use the route gate"
);
assert.ok(
  main.includes('if (path === "/inbox" && !canViewInboxRoute()) return defaultRoutePath')
    && main.includes('if (routePath === "/inbox" && !canViewInboxRoute()) return defaultRoutePath'),
  "Direct Inbox routes must fall back when Inbox is disabled"
);

console.log("PASS production Inbox feature gate");
