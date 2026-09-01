import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const root = process.cwd();
const port = Number(process.env.PRODUCTION_DASHBOARD_BROWSER_PORT || 58248);
const remotePort = port + 100;
const edgePath = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const server = createServer(handleRequest);
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const browser = spawn(edgePath, [
  "--headless=new",
  `--remote-debugging-port=${remotePort}`,
  `--user-data-dir=${join(tmpdir(), `trry-production-dashboard-edge-${Date.now()}`)}`,
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "about:blank",
], { stdio: "ignore" });

let cdp;
try {
  const wsUrl = await waitForBrowser(remotePort);
  cdp = await createCdp(wsUrl);
  const page = await newPage(remotePort);
  await cdp.send("Target.attachToTarget", { targetId: page.id, flatten: true }).then((result) => cdp.sessionId = result.sessionId);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");

  for (const viewport of [
    { width: 1600, height: 1000 },
    { width: 1024, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: viewport.width < 600 });
    await navigate(cdp, `http://127.0.0.1:${port}/qa-production-dashboard.html`);
    await waitForText(cdp, "Track released jobs from queue");
    const result = await evaluate(cdp, `(() => {
      const page = document.querySelector(".mvp-production-dashboard-page");
      const table = document.querySelector(".mvp-production-table-wrap");
      const cards = document.querySelector(".mvp-production-card-list");
      const firstRow = document.querySelector(".mvp-production-table-row");
      const headers = [...document.querySelectorAll(".mvp-production-table-head span")].map((node) => node.textContent.trim().replace(/\\s+↕$/, "")).join("|");
      const activeJobs = document.querySelector(".mvp-production-dashboard-header aside strong")?.textContent.trim() || "";
      const footerText = document.querySelector(".mvp-production-pagination")?.innerText || "";
      const rowRects = [...document.querySelectorAll(".mvp-production-table-row")].map((node) => node.getBoundingClientRect());
      const rowsDoNotOverlap = rowRects.every((rect, index) => index === 0 || rect.top >= rowRects[index - 1].bottom - 1);
      const headerCells = [...document.querySelectorAll(".mvp-production-table-head > span")].map((node) => node.getBoundingClientRect());
      const rowCells = [...firstRow?.children || []].map((node) => node.getBoundingClientRect());
      const stagePills = [...document.querySelectorAll(".mvp-production-table-row .stage-cell .mvp-status")];
      const stageLabels = stagePills.map((node) => node.textContent.trim()).join("|");
      const stageMetrics = stagePills.map((node) => node.textContent.trim() + ":" + node.clientWidth + "/" + node.scrollWidth + "/" + Math.round(node.getBoundingClientRect().width)).join("|");
      const stagePillsReadable = stagePills.every((node) => node.scrollWidth <= node.clientWidth + 1);
      const tableRowsText = [...document.querySelectorAll(".mvp-production-table-row")].map((node) => node.innerText).join("\\n");
      const firstRowText = firstRow?.innerText || "";
      const dueSecondaryTexts = [...document.querySelectorAll(".mvp-production-table-row .due small")].map((node) => node.textContent.trim());
      const actionButton = firstRow?.querySelector(".mvp-production-row-action button:first-child")?.getBoundingClientRect();
      const moreButton = firstRow?.querySelector(".mvp-production-row-action button:last-child")?.getBoundingClientRect();
      const fontInfo = (selector) => {
        const node = document.querySelector(selector);
        if (!node) return { size: "", weight: "", family: "" };
        const style = getComputedStyle(node);
        return { size: style.fontSize, weight: style.fontWeight, family: style.fontFamily };
      };
      const mobileCards = [...document.querySelectorAll(".mvp-production-mobile-card")].map((node) => node.getBoundingClientRect());
      const nav = document.querySelector(".mobile-bottom-nav");
      const navTop = nav?.getBoundingClientRect().top || window.innerHeight;
      const lastCardBottom = mobileCards.length ? Math.max(...mobileCards.map((item) => item.bottom)) : 0;
      return {
        hasShell: Boolean(page),
        headers,
        tableVisible: table ? getComputedStyle(table).display !== "none" : false,
        cardsVisible: cards ? getComputedStyle(cards).display !== "none" : false,
        hasReleasedNative: document.body.innerText.includes("TRRY-ORD-QUEUED77"),
        hasUnreleasedReady: document.body.innerText.includes("TRRY-ORD-READY77"),
        hasReadyToRelease: document.body.innerText.includes("READY TO RELEASE"),
        hasPaymentAction: /Confirm Payment|Pay Online|Pay at Shop|Messenger/i.test(document.body.innerText),
        rowCanOpen: Boolean(firstRow?.dataset.mvpOpen === "production"),
        activeJobs,
        footerText,
        visibleRowCount: document.querySelectorAll(".mvp-production-table-row").length,
        visibleCardCount: document.querySelectorAll(".mvp-production-mobile-card").length,
        rowsDoNotOverlap,
        rowHeight: Math.round(rowRects[0]?.height || 0),
        jobWidth: Math.round(rowCells[0]?.width || 0),
        customerWidth: Math.round(rowCells[1]?.width || 0),
        summaryWidth: Math.round(rowCells[2]?.width || 0),
        stageHeight: Math.round(stagePills[0]?.getBoundingClientRect().height || 0),
        actionButtonHeight: Math.round(actionButton?.height || 0),
        actionButtonWidth: Math.round(actionButton?.width || 0),
        moreButtonWidth: Math.round(moreButton?.width || 0),
        typography: {
          header: fontInfo(".mvp-production-table-head span"),
          job: fontInfo(".mvp-production-table-row .job-identity .mvp-copy span"),
          customer: fontInfo(".mvp-production-table-row .customer"),
          summary: fontInfo(".mvp-production-table-row .summary"),
          method: fontInfo(".mvp-production-table-row .method"),
          due: fontInfo(".mvp-production-table-row .due strong"),
          staff: fontInfo(".mvp-production-table-row .staff"),
          stage: fontInfo(".mvp-production-table-row .stage-cell .mvp-status"),
          action: fontInfo(".mvp-production-row-action button:first-child"),
        },
        headerAligned: headerCells.length === rowCells.length && headerCells.every((cell, index) => Math.abs(Math.round(cell.left) - Math.round(rowCells[index].left)) <= 2 && Math.abs(Math.round(cell.width) - Math.round(rowCells[index].width)) <= 2),
        firstRowText,
        tableRowsText,
        hasMaterialsHeader: headers.includes("MATERIALS"),
        hasArtworkHeader: headers.includes("ARTWORK"),
        hasFromOrderSecondary: tableRowsText.includes("FROM ORDER"),
        hasPhoneSecondary: /0917|\\+639/.test(tableRowsText),
        hasMethodSecondary: tableRowsText.includes("DTF / PICKUP"),
        dueSecondaryTexts,
        hasRedundantDueSecondary: dueSecondaryTexts.some((text) => ["COMPLETED", "UPCOMING", "TODAY"].includes(text)),
        hasOverdue: dueSecondaryTexts.includes("OVERDUE"),
        staffReadable: tableRowsText.includes("Inactive user") || tableRowsText.includes("James"),
        stageLabels,
        stageMetrics,
        stagePillsReadable,
        mobileClearance: window.innerWidth > 768 || !mobileCards.length || lastCardBottom <= navTop - 8 || document.documentElement.scrollHeight > window.innerHeight,
        bodyOverflowX: document.documentElement.scrollWidth > window.innerWidth + 2,
      };
    })()`);
    assert.equal(result.hasShell, true, `Production dashboard shell renders at ${viewport.width}`);
    assert.equal(result.headers, "JOB|CUSTOMER|SUMMARY|METHOD|DUE|STAFF|STAGE|ACTION", `simplified production column order at ${viewport.width}`);
    assert.equal(result.hasMaterialsHeader, false, `Materials column removed at ${viewport.width}`);
    assert.equal(result.hasArtworkHeader, false, `Artwork column removed at ${viewport.width}`);
    assert.equal(result.hasReleasedNative, true, `released native order reference visible at ${viewport.width}`);
    assert.equal(result.hasUnreleasedReady, false, `unreleased ready order hidden at ${viewport.width}`);
    assert.equal(result.hasReadyToRelease, false, `Production does not show READY TO RELEASE at ${viewport.width}`);
    assert.equal(result.hasPaymentAction, false, `Production has no payment action at ${viewport.width}`);
    assert.equal(result.rowCanOpen, true, `production row opens existing drawer at ${viewport.width}`);
    assert.equal(result.bodyOverflowX, false, `production dashboard has no page horizontal overflow at ${viewport.width}`);
    assert.equal(result.activeJobs, "6", `fixture active job count excludes completed jobs at ${viewport.width}`);
    assert.match(result.footerText, /Showing 1 to 5 of 6 jobs/, `fixture footer count matches released jobs at ${viewport.width}`);
    if (viewport.width > 768) assert.equal(result.tableVisible, true, `desktop/tablet table visible at ${viewport.width}`);
    if (viewport.width > 768) assert.equal(result.visibleRowCount, 5, `desktop production page shows first five fixture rows at ${viewport.width}`);
    if (viewport.width > 768) assert.equal(result.rowsDoNotOverlap, true, `desktop production fixture rows do not overlap at ${viewport.width}`);
    if (viewport.width > 768) assert.ok(result.rowHeight >= 56 && result.rowHeight <= 64, `desktop production row height is compact at ${viewport.width}: ${JSON.stringify(result)}`);
    if (viewport.width > 768) assert.ok(result.jobWidth >= 170, `desktop JOB width is readable at ${viewport.width}: ${JSON.stringify(result)}`);
    if (viewport.width > 768) assert.ok(result.customerWidth >= 190, `desktop CUSTOMER width is readable at ${viewport.width}: ${JSON.stringify(result)}`);
    if (viewport.width > 768) assert.ok(result.summaryWidth >= 260, `desktop SUMMARY width is useful at ${viewport.width}: ${JSON.stringify(result)}`);
    if (viewport.width > 768) assert.equal(result.hasFromOrderSecondary, false, `FROM ORDER secondary line removed at ${viewport.width}: ${JSON.stringify(result)}`);
    if (viewport.width > 768) assert.equal(result.hasPhoneSecondary, false, `Customer phone secondary line removed at ${viewport.width}: ${JSON.stringify(result)}`);
    if (viewport.width > 768) assert.equal(result.hasMethodSecondary, false, `Method secondary line removed at ${viewport.width}: ${JSON.stringify(result)}`);
    if (viewport.width > 768) assert.equal(result.hasRedundantDueSecondary, false, `redundant Due secondary states removed at ${viewport.width}: ${JSON.stringify(result)}`);
    if (viewport.width > 768) assert.equal(result.hasOverdue, true, `OVERDUE emphasis remains at ${viewport.width}: ${JSON.stringify(result)}`);
    if (viewport.width > 768) assert.equal(result.staffReadable, true, `Staff display is readable at ${viewport.width}: ${JSON.stringify(result)}`);
    if (viewport.width > 768) assert.ok(result.stageHeight >= 26 && result.stageHeight <= 32, `Stage pill is compact at ${viewport.width}: ${JSON.stringify(result)}`);
    if (viewport.width > 768) assert.ok(result.actionButtonHeight >= 36 && result.actionButtonHeight <= 40, `row action is compact at ${viewport.width}: ${JSON.stringify(result)}`);
    if (viewport.width > 768) assert.ok(result.actionButtonWidth <= 76 && result.moreButtonWidth <= 36, `row action controls do not dominate at ${viewport.width}: ${JSON.stringify(result)}`);
    if (viewport.width > 768) assert.equal(result.headerAligned, true, `header and row columns align at ${viewport.width}: ${JSON.stringify(result)}`);
    if (viewport.width > 768) assert.ok(fontPx(result.typography.header.size) >= 11 && fontPx(result.typography.header.size) <= 12, `header typography is compact at ${viewport.width}: ${JSON.stringify(result.typography)}`);
    if (viewport.width > 768) assert.equal(fontPx(result.typography.job.size), 14, `job typography is 14px at ${viewport.width}: ${JSON.stringify(result.typography)}`);
    if (viewport.width > 768) assert.equal(fontPx(result.typography.customer.size), 14, `customer typography is 14px at ${viewport.width}: ${JSON.stringify(result.typography)}`);
    if (viewport.width > 768) assert.equal(fontPx(result.typography.summary.size), 14, `summary typography is 14px at ${viewport.width}: ${JSON.stringify(result.typography)}`);
    if (viewport.width > 768) assert.equal(fontPx(result.typography.method.size), 14, `method typography is 14px at ${viewport.width}: ${JSON.stringify(result.typography)}`);
    if (viewport.width > 768) assert.equal(fontPx(result.typography.due.size), 14, `due typography is 14px at ${viewport.width}: ${JSON.stringify(result.typography)}`);
    if (viewport.width > 768) assert.equal(fontPx(result.typography.staff.size), 14, `staff typography is 14px at ${viewport.width}: ${JSON.stringify(result.typography)}`);
    if (viewport.width > 768) assert.ok(fontPx(result.typography.stage.size) >= 11 && fontPx(result.typography.stage.size) <= 12, `stage typography is compact at ${viewport.width}: ${JSON.stringify(result.typography)}`);
    if (viewport.width > 768) assert.ok(fontPx(result.typography.action.size) >= 13 && fontPx(result.typography.action.size) <= 14, `action typography is compact at ${viewport.width}: ${JSON.stringify(result.typography)}`);
    if (viewport.width > 768) assert.match(result.stageLabels, /IN PRODUCTION|QUALITY CHECK|READY|BLOCKED|COMPLETED/, `desktop production stage labels render at ${viewport.width}`);
    if (viewport.width > 768) assert.equal(result.stagePillsReadable, true, `desktop production stage pills are not clipped at ${viewport.width}: ${result.stageMetrics}`);
    if (viewport.width <= 768) assert.equal(result.cardsVisible, true, `mobile cards visible at ${viewport.width}`);
    if (viewport.width <= 768) assert.equal(result.visibleCardCount, 5, `mobile production card count matches first page at ${viewport.width}`);
    if (viewport.width <= 768) assert.equal(result.mobileClearance, true, `mobile production final card can scroll above bottom navigation at ${viewport.width}`);
  }

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate(cdp, `http://127.0.0.1:${port}/qa-production-dashboard.html`);
  await waitForText(cdp, "TRRY-ORD-QUEUED77");
  await evaluate(cdp, `document.querySelector(".mvp-production-table-row")?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))`);
  const drawer = await evaluate(cdp, `(() => ({
    productionId: window.__dashboard?.state?.productionId || "",
    hasDrawer: Boolean(document.querySelector(".mvp-drawer.production")),
    text: document.querySelector(".mvp-drawer.production")?.innerText || ""
  }))()`);
  assert.equal(drawer.productionId, "TRY-QUEUED-077", "production row sets selected production id");
  assert.equal(drawer.hasDrawer, true, "existing Production drawer opens from new dashboard row");
  assert.ok(drawer.text.includes("TRRY-ORD-QUEUED77"), "drawer preserves linked Order identity");

  for (const viewport of [
    { width: 1600, height: 1000 },
    { width: 1024, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: viewport.width < 600 });
    await navigate(cdp, `http://127.0.0.1:${port}/qa-production-dashboard.html?order=TRRY-ORD-START77`);
    await waitForText(cdp, "IN PRODUCTION");
    await delay(300);
    const startedDrawer = await evaluate(cdp, `(() => {
      const drawer = document.querySelector(".mvp-production-drawer.in-progress");
      const rect = drawer?.getBoundingClientRect();
      const tabs = [...document.querySelectorAll("[data-mvp-production-tab]")].map((button) => button.textContent.trim()).join("|");
      return {
        hasDrawer: Boolean(drawer),
        width: Math.round(rect?.width || 0),
        rightOverflow: rect ? Math.ceil(rect.right - window.innerWidth) : 0,
        tabs,
        text: drawer?.innerText || "",
        hasQcAction: Boolean(drawer?.querySelector('[data-mvp-advance][data-mvp-next="qc"]')),
        hasPaymentAction: /Confirm Payment|Pay Online|Pay at Shop|Messenger/i.test(drawer?.innerText || ""),
        surface: drawer ? getComputedStyle(drawer).backgroundColor : "",
        bodySurface: drawer ? getComputedStyle(drawer.querySelector(".mvp-production-drawer-body")).backgroundColor : "",
        footerVisible: Math.round(drawer?.querySelector(".mvp-production-drawer-footer")?.getBoundingClientRect().bottom || 0) <= window.innerHeight + 1,
        pageOverflowX: document.documentElement.scrollWidth > window.innerWidth + 2
      };
    })()`);
    assert.equal(startedDrawer.hasDrawer, true, `IN PRODUCTION drawer renders at ${viewport.width}`);
    assert.ok(startedDrawer.width <= Math.min(390, viewport.width), `drawer width is viewport-safe at ${viewport.width}`);
    assert.ok(startedDrawer.rightOverflow <= 1, `drawer avoids horizontal overflow at ${viewport.width}`);
    assert.equal(startedDrawer.tabs, "Overview|Workflow|Assignment|History", `tab order matches Production drawer boundary at ${viewport.width}`);
    assert.equal(startedDrawer.hasQcAction, true, `started drawer exposes QC action at ${viewport.width}`);
    assert.equal(startedDrawer.hasPaymentAction, false, `started drawer has no payment/Messenger action at ${viewport.width}`);
    assert.equal(startedDrawer.surface, "rgb(255, 255, 255)", `started drawer surface is opaque at ${viewport.width}`);
    assert.notEqual(startedDrawer.bodySurface, "rgba(0, 0, 0, 0)", `started drawer body has opaque panel surface at ${viewport.width}`);
    assert.equal(startedDrawer.footerVisible, true, `started drawer footer is reachable at ${viewport.width}`);
    assert.equal(startedDrawer.pageOverflowX, false, `started drawer does not create page overflow at ${viewport.width}`);

    await evaluate(cdp, `document.querySelector('[data-mvp-production-tab="workflow"]').click()`);
    await waitForText(cdp, "Released to Production");
    const workflowText = await evaluate(cdp, `document.querySelector(".mvp-production-drawer.in-progress")?.innerText || ""`);
    assert.ok(workflowText.includes("Production started") || workflowText.includes("Current Stage"), `workflow tab distinguishes release/start at ${viewport.width}`);
  }

  for (const viewport of [
    { width: 1600, height: 1000 },
    { width: 1024, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: viewport.width < 600 });
    await navigate(cdp, `http://127.0.0.1:${port}/qa-production-dashboard.html?order=TRRY-ORD-QC77`);
    await waitForText(cdp, "QUALITY CHECK");
    await delay(300);
    const qcDrawer = await evaluate(cdp, `(() => {
      const drawer = document.querySelector(".mvp-production-drawer.quality-check");
      const rect = drawer?.getBoundingClientRect();
      const tabs = [...document.querySelectorAll("[data-mvp-production-tab]")].map((button) => button.textContent.trim()).join("|");
      return {
        hasDrawer: Boolean(drawer),
        width: Math.round(rect?.width || 0),
        rightOverflow: rect ? Math.ceil(rect.right - window.innerWidth) : 0,
        tabs,
        text: drawer?.innerText || "",
        hasReadyAction: Boolean(drawer?.querySelector('[data-mvp-advance][data-mvp-next="ready"]')),
        hasPaymentAction: /Confirm Payment|Pay Online|Pay at Shop|Messenger/i.test(drawer?.innerText || ""),
        surface: drawer ? getComputedStyle(drawer).backgroundColor : "",
        bodySurface: drawer ? getComputedStyle(drawer.querySelector(".mvp-production-drawer-body")).backgroundColor : "",
        footerVisible: Math.round(drawer?.querySelector(".mvp-production-drawer-footer")?.getBoundingClientRect().bottom || 0) <= window.innerHeight + 1,
        pageOverflowX: document.documentElement.scrollWidth > window.innerWidth + 2
      };
    })()`);
    assert.equal(qcDrawer.hasDrawer, true, `QUALITY CHECK drawer renders at ${viewport.width}`);
    assert.ok(qcDrawer.width <= Math.min(390, viewport.width), `QC drawer width is viewport-safe at ${viewport.width}`);
    assert.ok(qcDrawer.rightOverflow <= 1, `QC drawer avoids horizontal overflow at ${viewport.width}`);
    assert.equal(qcDrawer.tabs, "Overview|Workflow|Assignment|History", `QC tab order matches Production drawer boundary at ${viewport.width}`);
    assert.equal(qcDrawer.hasReadyAction, true, `QC drawer exposes Complete QC action at ${viewport.width}`);
    assert.equal(qcDrawer.hasPaymentAction, false, `QC drawer has no payment/Messenger action at ${viewport.width}`);
    assert.equal(qcDrawer.surface, "rgb(255, 255, 255)", `QC drawer surface is opaque at ${viewport.width}`);
    assert.notEqual(qcDrawer.bodySurface, "rgba(0, 0, 0, 0)", `QC drawer body has opaque panel surface at ${viewport.width}`);
    assert.equal(qcDrawer.footerVisible, true, `QC drawer footer is reachable at ${viewport.width}`);
    assert.equal(qcDrawer.pageOverflowX, false, `QC drawer does not create page overflow at ${viewport.width}`);
    assert.ok(qcDrawer.text.includes("QC Started") || qcDrawer.text.includes("Quality Check"), `QC drawer shows QC metadata at ${viewport.width}`);

    await evaluate(cdp, `document.querySelector('[data-mvp-production-tab="assignment"]').dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))`);
    await waitFor(cdp, `Boolean(document.querySelector('[data-mvp-qc-note="TRY-QC-077"]'))`);
    await evaluate(cdp, `(() => {
      const note = document.querySelector('[data-mvp-qc-note="TRY-QC-077"]');
      note.value = "Browser QC note saved.";
      document.querySelector('[data-mvp-save-qc-note="TRY-QC-077"]').click();
    })()`);
    await waitFor(cdp, `window.__rows.find((item) => item.id === "TRY-QC-077")?.qcNote === "Browser QC note saved."`);
    const noteState = await evaluate(cdp, `(() => {
      const row = window.__rows.find((item) => item.id === "TRY-QC-077");
      return { qcNote: row.qcNote, productionNote: row.productionNote, stage: row.productionStage };
    })()`);
    assert.equal(noteState.qcNote, "Browser QC note saved.", `QC note persisted in local read model at ${viewport.width}`);
    assert.equal(noteState.productionNote, "Production note stays.", `production_note unchanged by QC note at ${viewport.width}`);
    assert.equal(noteState.stage, "qc", `QC note does not advance stage at ${viewport.width}`);

    await evaluate(cdp, `document.querySelector('[data-mvp-production-tab="overview"]').dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))`);
    await waitFor(cdp, `Boolean(document.querySelector('[data-mvp-advance][data-mvp-next="ready"]'))`);
    await evaluate(cdp, `document.querySelector('[data-mvp-advance][data-mvp-next="ready"]').click()`);
    await waitForText(cdp, "READY FOR FULFILLMENT");
    const completeState = await evaluate(cdp, `(() => {
      const row = window.__rows.find((item) => item.id === "TRY-QC-077");
      return { stage: row.productionStage, completedAt: row.qcCompletedAt, completedBy: row.qcCompletedBy };
    })()`);
    assert.equal(completeState.stage, "ready", `Complete QC moves to ready at ${viewport.width}`);
    assert.ok(completeState.completedAt, `Complete QC persists completion timestamp at ${viewport.width}`);
    assert.equal(completeState.completedBy, "staff-rachelle", `Complete QC persists completion actor at ${viewport.width}`);
  }

  await navigate(cdp, `http://127.0.0.1:${port}/qa-production-dashboard.html?order=TRRY-ORD-QCFAIL`);
  await waitForText(cdp, "QUALITY CHECK");
  await evaluate(cdp, `document.querySelector('[data-mvp-advance][data-mvp-next="ready"]').click()`);
  await delay(300);
  const failedCompletion = await evaluate(cdp, `(() => {
    const row = window.__rows.find((item) => item.id === "TRY-QC-FAIL");
    return { stage: row.productionStage, completedAt: row.qcCompletedAt || "", text: document.querySelector(".mvp-production-drawer")?.innerText || "" };
  })()`);
  assert.equal(failedCompletion.stage, "qc", "failed QC completion leaves row in QC");
  assert.equal(failedCompletion.completedAt, "", "failed QC completion does not fake completion metadata");

  await navigate(cdp, `http://127.0.0.1:${port}/qa-production-dashboard.html?order=TRRY-ORD-QCBLOCK`);
  await waitForText(cdp, "Print defect requires owner review");
  const blockedQc = await evaluate(cdp, `Boolean(document.querySelector('[data-mvp-advance][data-mvp-next="ready"][disabled]'))`);
  assert.equal(blockedQc, true, "blocked QC completion is disabled in browser");

  await evaluate(cdp, `document.querySelector('[data-mvp-production-status="blocked"]').click()`);
  await waitForText(cdp, "TRRY-ORD-BLOCK77");
  const blockedFilter = await evaluate(cdp, `[...document.querySelectorAll(".mvp-production-table-row, .mvp-production-mobile-card")].map((node) => node.innerText).join("\\n")`);
  assert.ok(blockedFilter.includes("TRRY-ORD-BLOCK77"), "blocked tab filters explicit native blocker");
  assert.ok(!blockedFilter.includes("TRRY-ORD-QUEUED77"), "blocked tab excludes clear queued job");

  await navigate(cdp, `http://127.0.0.1:${port}/qa-production-dashboard.html`);
  await evaluate(cdp, `(() => {
    const input = document.querySelector('[data-mvp-filter="production:search"]');
    input.value = "QC Customer";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitForText(cdp, "TRRY-ORD-QC77");
  const searched = await evaluate(cdp, `[...document.querySelectorAll(".mvp-production-table-row, .mvp-production-mobile-card")].map((node) => node.innerText).join("\\n")`);
  assert.ok(searched.includes("TRRY-ORD-QC77"), "search filters by customer");
  assert.ok(!searched.includes("TRRY-ORD-QUEUED77"), "search excludes unrelated jobs");

  console.log("PASS Production dashboard browser layout, responsive table/card behavior, filters, drawer reachability, and release boundary");
} finally {
  cdp?.close();
  browser.kill();
  await new Promise((resolve) => server.close(resolve));
}

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (url.pathname === "/qa-production-dashboard.html") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(qaHtml());
      return;
    }
    if (url.pathname === "/src/env.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      response.end('window.TRRY_ADMIN_ENV = {"VITE_USE_SUPABASE_DATA":"false"};\n');
      return;
    }
    const appRoutes = new Set(["/", "/inquiries", "/orders", "/production"]);
    const requestedPath = appRoutes.has(url.pathname) ? "/index.html" : url.pathname;
    const filePath = normalize(join(root, requestedPath));
    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" }[extname(filePath)] || "text/plain";
    response.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
    response.end(await readFile(filePath));
  } catch (error) {
    if (!response.headersSent) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.destroy(error);
  }
}

function qaHtml() {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /><link rel="stylesheet" href="/src/styles.css" /></head><body><main id="app"></main><script type="module">
    import { createMvpDashboard } from "/src/mvpDashboard.js";
    const app = document.getElementById("app");
    const team = [
      { userId: "owner-james", displayName: "James", email: "james@trry.test", role: "owner" },
      { userId: "staff-rachelle", displayName: "Rachelle", email: "rachelle@trry.test", role: "staff" }
    ];
    const base = { status: "won", quoteStatus: "approved", artworkStatus: "approved", fulfillmentMethod: "pickup", service: "Embroidery", qty: "12 pcs", dueDate: "2026-08-09", quotedAmount: 850, amountDue: 850, paymentStatus: "paid", paymentVerifiedAmount: 850, assignedUserId: "owner-james", productDesc: "Premium Tshirt", contact: "0917-000-0000", productionUpdatedAt: "2026-08-08T08:00:00.000Z" };
    let rows = [
      { ...base, id: "TRY-READY-077", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000000770", sourceInquiryId: "TRY-READY-077", orderReference: "TRRY-ORD-READY77", customer: "Order Ready", productionStage: "queued" },
      { ...base, id: "TRY-QUEUED-077", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000000771", sourceInquiryId: "TRY-QUEUED-077", sourceInquiryReference: "TRY-QUEUED-077", orderReference: "TRRY-ORD-QUEUED77", customer: "Queued Customer", productionStage: "embroidery" },
      { ...base, id: "TRY-START-077", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000000773", sourceInquiryId: "TRY-START-077", sourceInquiryReference: "TRY-START-077", orderReference: "TRRY-ORD-START77", customer: "Started Customer", productionStage: "screen_printing", productionStartedAt: "2026-08-08T08:15:00.000Z", productionStartedBy: "staff-rachelle", assignedUserId: "staff-rachelle" },
      { ...base, id: "TRY-QC-077", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000000772", sourceInquiryId: "TRY-QC-077", orderReference: "TRRY-ORD-QC77", customer: "QC Customer", service: "DTF", productionStage: "qc", assignedUserId: "staff-rachelle", productionNote: "Production note stays.", productionStartedAt: "2026-08-08T08:15:00.000Z", productionStartedBy: "staff-rachelle", qcStartedAt: "2026-08-08T09:00:00.000Z", qcStartedBy: "staff-rachelle", qcNote: "Initial QC note." },
      { ...base, id: "TRY-QC-FAIL", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000000774", sourceInquiryId: "TRY-QC-FAIL", orderReference: "TRRY-ORD-QCFAIL", customer: "QC Fail Customer", service: "DTF", productionStage: "qc", assignedUserId: "staff-rachelle", productionStartedAt: "2026-08-08T08:15:00.000Z", productionStartedBy: "staff-rachelle", qcStartedAt: "2026-08-08T09:00:00.000Z", qcStartedBy: "staff-rachelle" },
      { ...base, id: "TRY-QC-BLOCK", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000000775", sourceInquiryId: "TRY-QC-BLOCK", orderReference: "TRRY-ORD-QCBLOCK", customer: "QC Block Customer", service: "DTF", productionStage: "qc", assignedUserId: "staff-rachelle", productionStartedAt: "2026-08-08T08:15:00.000Z", productionStartedBy: "staff-rachelle", qcStartedAt: "2026-08-08T09:00:00.000Z", qcStartedBy: "staff-rachelle", blockedReason: "Print defect requires owner review" },
      { ...base, id: "TRY-BLOCK-077", sourceType: "native", nativeOrderId: "96000000-0000-4000-8000-000000000776", sourceInquiryId: "TRY-BLOCK-077", orderReference: "TRRY-ORD-BLOCK77", customer: "Blocked Customer", productionStage: "embroidery", blockedReason: "Thread color missing" },
      { ...base, id: "TRY-LEGACY-077", sourceType: "legacy", orderReference: "TRRY-LEGACY-BLOCK77", odooSO: "SO-BLOCK77", customer: "Legacy Read Only", productionStage: "embroidery", blockedReason: "Historical only" }
    ];
    const dashboard = createMvpDashboard({ getAssignmentContext: () => ({ users: team, loadState: "success", error: "" }) });
    window.__dashboard = dashboard;
    window.__rows = rows;
    function render() {
      app.innerHTML = dashboard.renderProduction({ items: rows });
      document.body.classList.toggle("mvp-drawer-open", Boolean(document.querySelector(".mvp-drawer")));
      dashboard.bind({ root: app, rerender: render, navigate: () => {}, copy: async () => {}, saveProduction: async (id, changes) => {
        if (id === "TRY-QC-FAIL" && changes.productionStage === "ready") return { ok: false, error: "Synthetic failure" };
        const now = "2026-08-08T09:45:00.000Z";
        rows = rows.map((item) => {
          if (item.id !== id) return item;
          if (Object.prototype.hasOwnProperty.call(changes, "qcNote")) return { ...item, qcNote: changes.qcNote, productionUpdatedAt: now };
          const next = { ...item };
          if (changes.startProduction) {
            next.productionStartedAt = next.productionStartedAt || now;
            next.productionStartedBy = next.productionStartedBy || "staff-rachelle";
          }
          if (changes.productionStage) {
            next.productionStage = changes.productionStage;
            if (changes.productionStage === "qc") {
              next.qcStartedAt = next.qcStartedAt || now;
              next.qcStartedBy = next.qcStartedBy || "staff-rachelle";
            }
            if (changes.productionStage === "ready") {
              next.qcCompletedAt = next.qcCompletedAt || now;
              next.qcCompletedBy = next.qcCompletedBy || "staff-rachelle";
            }
          }
          if (Object.prototype.hasOwnProperty.call(changes, "productionNote")) next.productionNote = changes.productionNote;
          if (Object.prototype.hasOwnProperty.call(changes, "assignedUserId")) next.assignedUserId = changes.assignedUserId;
          if (Object.prototype.hasOwnProperty.call(changes, "blockedReason")) next.blockedReason = changes.blockedReason;
          next.productionUpdatedAt = now;
          return next;
        });
        window.__rows = rows;
        return rows.find((item) => item.id === id);
      } });
    }
    render();
  </script></body></html>`;
}

async function waitForBrowser(portValue) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${portValue}/json/version`);
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch {
      await delay(250);
    }
  }
  throw new Error("Browser CDP endpoint did not start.");
}

async function newPage(portValue) {
  const response = await fetch(`http://127.0.0.1:${portValue}/json/new?about:blank`, { method: "PUT" });
  if (!response.ok) throw new Error("Unable to create browser page.");
  return response.json();
}

async function createCdp(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result || {});
    }
  });
  return {
    sessionId: "",
    send(method, params = {}) {
      const message = { id: ++id, method, params };
      if (this.sessionId && !method.startsWith("Target.")) message.sessionId = this.sessionId;
      socket.send(JSON.stringify(message));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() {
      for (const { reject } of pending.values()) reject(new Error("CDP connection closed."));
      pending.clear();
      socket.close();
    },
  };
}

async function navigate(cdp, url) {
  await cdp.send("Page.navigate", { url });
  await waitFor(cdp, `document.readyState === "complete"`);
}

async function waitForText(cdp, text) {
  const escaped = JSON.stringify(text);
  await waitFor(cdp, `document.body && document.body.innerText.includes(${escaped})`);
}

async function waitFor(cdp, expression) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await evaluate(cdp, expression);
    if (result) return;
    await delay(125);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Evaluation failed");
  return result.result?.value;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fontPx(value) {
  return Number.parseFloat(String(value || "").replace("px", ""));
}
