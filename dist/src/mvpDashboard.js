const QUOTE_STAGES = {
  new: "NEW INQUIRY",
  sent: "QUOTE SENT",
  approved: "APPROVED",
  lost: "LOST",
};

const QUOTE_DISPLAY_STATUSES = {
  needs_quote: "NEEDS QUOTE",
  quote_sent: "QUOTE SENT",
  follow_up: "FOLLOW-UP",
  approved: "APPROVED",
  lost: "LOST",
};

const INQUIRY_QUEUES = [
  ["all", "NEW"],
  ["new", "NEEDS QUOTE"],
  ["sent", "QUOTE SENT"],
  ["follow_due", "FOLLOW-UP"],
  ["approved", "APPROVED"],
  ["lost", "LOST"],
];

const PRODUCTION_STAGES = [
  ["queued", "Queued"],
  ["printing", "Printing"],
  ["embroidery", "Embroidery"],
  ["screen_printing", "Screen Printing"],
  ["qc", "QC"],
  ["ready", "Ready"],
  ["completed", "Completed"],
];

const ACTIVE_STAGES = ["printing", "embroidery", "screen_printing", "qc"];

export function createMvpDashboard({ getAssignmentContext = () => ({ users: [], loadState: "idle", error: "" }) } = {}) {
  const state = {
    inquiryId: null,
    orderId: null,
    productionId: null,
    returnFocus: null,
    inquiry: { search: "", stage: "all", owner: "all", service: "all", due: "all" },
    order: { search: "", payment: "all", artwork: "all", due: "all", production: "all", owner: "all" },
    production: { search: "", staff: "all", method: "all", stage: "all", due: "all", blocker: "all" },
    inquiryTab: "details",
    inquiryActionId: null,
    inquiryMoreOpen: false,
  };

  const quoteStage = (item) => {
    const status = key(item.status);
    const quote = key(item.quoteStatus);
    if (["lost", "cancelled", "canceled"].includes(status)) return "lost";
    if (status === "won" || quote === "approved") return "approved";
    if (item.quotePublishedAt || status === "sent" || status === "followup" || quote === "ready") return "sent";
    return "new";
  };

  const resolveQuoteDisplayStatus = (item) => {
    const workflowStage = quoteStage(item);
    if (workflowStage === "lost") return "lost";
    if (workflowStage === "approved") return "approved";
    if (workflowStage === "sent" && String(item.followUpDate || "").trim()) return "follow_up";
    if (workflowStage === "sent") return "quote_sent";
    return "needs_quote";
  };

  const artworkLabel = (item) => {
    const value = key(item.artworkStatus);
    if (value === "approved") return "Artwork Approved";
    if (value === "approval_required") return "Customer Review";
    if (["submitted", "under_review", "revision_requested"].includes(value)) return "Internal Review";
    return "No Artwork";
  };

  const paymentLabel = (item) => {
    const value = key(item.paymentStatus);
    if (key(item.paymentType) === "shop" && ["confirmed", "paid", "full_payment_confirmed"].includes(value)) return "Paid at Shop";
    if (["confirmed", "paid", "full_payment_confirmed"].includes(value)) return "Paid";
    if (["down_payment_confirmed", "partially_paid"].includes(value)) return "Partially Paid";
    if (value === "proof_submitted") return "Receipt Submitted";
    if (value === "under_review") return "Payment Review";
    if (["pay_at_shop", "payment_pending_at_shop"].includes(value)) return "Pay at Shop";
    return "Unpaid";
  };
  const productionStage = (item) => {
    const value = key(item.productionStage);
    if (PRODUCTION_STAGES.some(([stage]) => stage === value)) return value;
    if (value === "qc_finishing") return "qc";
    if (value === "ready_for_fulfillment") return "ready";
    if (value === "in_production") return stationFor(item);
    return "queued";
  };

  const confirmed = (item) => {
    const status = key(item.status);
    if (["lost", "cancelled", "canceled"].includes(status)) return false;
    return status === "won" && key(item.quoteStatus) === "approved";
  };

  const blockedReason = (item) => {
    if (productionStage(item) !== "queued") return "";
    if (item.blockedReason) return item.blockedReason;
    const artwork = artworkLabel(item);
    if (artwork === "No Artwork") return "No artwork";
    if (artwork !== "Artwork Approved") return "Awaiting customer artwork approval";
    return "";
  };

  const due = (item) => {
    if (productionStage(item) === "completed") return { key: "completed", label: "Completed" };
    if (!item.dueDate) return { key: "none", label: "No date" };
    const date = new Date(`${item.dueDate}T00:00:00`);
    const today = new Date(`${todayIso()}T00:00:00`);
    const days = Math.round((date - today) / 86400000);
    const label = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    if (days < 0) return { key: "overdue", label: `${label} / Overdue` };
    if (days === 0) return { key: "today", label: `${label} / Due today` };
    if (days <= 7) return { key: "week", label: `${label} / ${days} day${days === 1 ? "" : "s"} left` };
    return { key: "future", label };
  };

  const product = (item) => item.productDesc || messageValue(item.message, ["Product", "Garment", "Item", "Inquiry / Product"]) || item.service || "Not set";
  const assignmentContext = () => {
    const context = getAssignmentContext() || {};
    const users = Array.isArray(context.users) ? context.users : [];
    return { users, loadState: context.loadState || "idle", error: context.error || "" };
  };
  const assignmentUsers = () => assignmentContext().users;
  const findAssignmentUser = (userId) => assignmentUsers().find((user) => user.userId === userId);
  const assignmentName = (user) => user ? `${user.displayName || user.email} - ${roleLabel(user.role)}` : "";
  const activeLegacyMatch = (value) => assignmentUsers().find((user) => sameAssignmentLabel(value, user.displayName) || sameAssignmentLabel(value, user.email));
  const owner = (item) => assignmentDisplay({ userId: item.ownerUserId, legacy: item.owner || item.ownerId, empty: "Unassigned" });
  const assigned = (item) => assignmentDisplay({ userId: item.assignedUserId, legacy: item.assignedStaff || item.assigned, empty: "Not Yet Assigned" });
  const stageLabel = (value) => PRODUCTION_STAGES.find(([stage]) => stage === value)?.[1] || "Queued";
  const query = (name) => new URLSearchParams(window.location.search).get(name) || "";

  function assignmentDisplay({ userId, legacy, empty }) {
    if (userId) return assignmentName(findAssignmentUser(userId)) || "Inactive user (historical)";
    const legacyText = String(legacy || "").trim();
    if (!legacyText) return empty;
    return assignmentName(activeLegacyMatch(legacyText)) || "Inactive user (historical)";
  }

  function assignmentSelectOptions(currentUserId, legacyValue, emptyLabel) {
    const context = assignmentContext();
    if (context.loadState === "loading") return `<option value="">Loading team members...</option>`;
    const rows = [[emptyLabel, ""]];
    const currentUser = currentUserId ? findAssignmentUser(currentUserId) : activeLegacyMatch(legacyValue);
    const legacyText = String(legacyValue || "").trim();
    if ((currentUserId || legacyText) && !currentUser) rows.push(["Inactive user (historical)", "__legacy__"]);
    assignmentUsers().forEach((user) => rows.push([assignmentName(user), user.userId]));
    return rows.map(([label, value]) => `<option value="${html(value)}" ${currentUser?.userId === value || (!currentUser && value === "__legacy__") ? "selected" : ""}>${html(label)}</option>`).join("");
  }

  function assignmentNotice() {
    const context = assignmentContext();
    if (context.loadState === "error") return `<p class="mvp-inline-error">${html(context.error || "Unable to load team members.")}</p>`;
    if (context.loadState === "loading") return `<p class="mvp-inline-note">Loading team members...</p>`;
    if (!assignmentUsers().length) return `<p class="mvp-inline-error">No active admin users are available for assignment.</p>`;
    return "";
  }

  function assignmentControlsDisabled() {
    const context = assignmentContext();
    return context.loadState === "loading" || context.loadState === "error" || !assignmentUsers().length;
  }

  function assignmentFilterOptions() {
    return assignmentUsers().map((user) => [user.userId, assignmentName(user)]);
  }

  function sameAssignmentLabel(a, b) {
    return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  }

  function roleLabel(role) {
    const text = String(role || "").trim().toLowerCase();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Staff";
  }

  function renderOverview({ items, tasks = [], taskLoadState = "idle", taskError = "", taskRoute = "/workboard", notices = "" }) {
    const rows = Array.isArray(items) ? items : [];
    const taskRows = Array.isArray(tasks) ? tasks : [];
    const inquiries = rows.filter((item) => !confirmed(item));
    const orders = rows.filter(confirmed);
    const pipeline = countBy(Object.keys(QUOTE_STAGES), inquiries, quoteStage);
    const productionJobs = orders.filter(isReleasedToProduction);
    const production = countBy(PRODUCTION_STAGES.map(([value]) => value), productionJobs, productionStage);
    const inProgress = ACTIVE_STAGES.reduce((sum, value) => sum + production[value], 0);
    const monthlySeries = buildMonthlyInquirySeries(rows, 12);
    const recentInquiries = getRecentInquiries(rows, 6);
    const priorities = buildOverviewPriorities({ inquiries, tasks: taskRows, taskLoadState, taskError, taskRoute });
    const alerts = buildOperationalAlerts({ inquiries, orders, productionJobs, pipeline });

    return `<main class="mvp-page ops-board-page mvp-overview-page overview-dashboard-page">
      ${pageTitle("Overview", "OVERVIEW", new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }))}
      ${notices}
      ${renderOverviewCoreSummary({ rows, inquiries, orders, pipeline, productionJobs, inProgress })}
      <section class="overview-main-grid">
        ${renderMonthlyInquiryPanel(monthlySeries)}
        ${renderMonthlyComparisonPanel(monthlySeries)}
      </section>
      <section class="overview-secondary-grid">
        ${renderRecentInquiries(recentInquiries)}
        ${renderOverviewPriorities(priorities, taskLoadState, taskError)}
      </section>
      ${renderOperationalAlerts(alerts)}
      ${moduleEntrySection({ inquiries: inquiries.length, orders: orders.length, productionJobs: productionJobs.length, inProgress })}
    </main>`;
  }

  function renderOverviewCoreSummary({ rows, inquiries, orders, pipeline, productionJobs, inProgress }) {
    const currentMonthCount = countInquiriesThisMonth(rows);
    const followUpsDue = inquiries.filter(isFollowUpDue).length;
    const activeOrders = orders.filter((item) => !isOrderClosed(item)).length;
    const cards = [
      overviewSummaryCard("INQUIRIES THIS MONTH", currentMonthCount, "Created this calendar month", "/inquiries"),
      overviewSummaryCard("NEEDS QUOTE", pipeline.new || 0, "Matches the Needs Quote queue", "/inquiries?stage=new", pipeline.new ? "warning" : ""),
      overviewSummaryCard("FOLLOW-UP DUE", followUpsDue, "Due today or overdue", "/inquiries?stage=follow_due", followUpsDue ? "warning" : ""),
      overviewSummaryCard("ACTIVE ORDERS", activeOrders, "Confirmed and still open", "/orders"),
      overviewSummaryCard("IN PRODUCTION", inProgress, `${productionJobs.length} released job${productionJobs.length === 1 ? "" : "s"}`, "/production"),
    ];
    return `<section class="overview-core-summary" aria-labelledby="overview-core-summary-title"><div class="mvp-section-title"><h2 id="overview-core-summary-title">Core Summary</h2></div><div class="overview-summary-cards">${cards.join("")}</div></section>`;
  }

  function overviewSummaryCard(label, value, detail, route, tone = "") {
    const routeAttr = route ? ` data-mvp-route="${html(route)}"` : "";
    return `<button class="overview-summary-card ${html(tone)}" type="button"${routeAttr}><span>${html(label)}</span><strong>${html(value)}</strong><small>${html(detail)}</small></button>`;
  }

  function countInquiriesThisMonth(items) {
    const now = new Date();
    const keyValue = monthKey(now.getFullYear(), now.getMonth() + 1);
    return items.filter((item) => getInquiryCreatedMonthKey(item) === keyValue).length;
  }

  function buildMonthlyInquirySeries(items, monthCount = 12, now = new Date()) {
    const safeCount = Math.max(1, Number(monthCount) || 12);
    const current = new Date(now.getFullYear(), now.getMonth(), 1);
    const months = Array.from({ length: safeCount }, (_, index) => {
      const date = new Date(current.getFullYear(), current.getMonth() - (safeCount - 1 - index), 1);
      const keyValue = monthKey(date.getFullYear(), date.getMonth() + 1);
      return {
        key: keyValue,
        label: date.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
        shortLabel: date.toLocaleDateString("en-US", { month: "short" }),
        count: 0,
        current: index === safeCount - 1,
      };
    });
    const visible = new Map(months.map((month) => [month.key, month]));
    let validTimestampCount = 0;
    for (const item of items) {
      const keyValue = getInquiryCreatedMonthKey(item);
      if (!keyValue) continue;
      validTimestampCount += 1;
      const bucket = visible.get(keyValue);
      if (bucket) bucket.count += 1;
    }
    return { months, validTimestampCount, visibleTotal: months.reduce((sum, month) => sum + month.count, 0) };
  }

  function getInquiryCreatedMonthKey(item) {
    const parsed = getInquiryCreatedDate(item);
    return parsed ? monthKey(parsed.year, parsed.month) : "";
  }

  function getInquiryCreatedDate(item) {
    const raw = String(item?.createdAt || item?.created_at || "").trim();
    if (!raw) return null;
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return { year, month, day, date };
  }

  function monthKey(year, month) {
    return `${year}-${String(month).padStart(2, "0")}`;
  }

  function renderMonthlyInquiryPanel(series) {
    return `<section class="overview-chart-panel" aria-labelledby="overview-chart-title"><div class="overview-panel-header"><div><h2 id="overview-chart-title">Monthly Inquiries</h2><p>Latest 12 calendar months by inquiry creation date.</p></div></div>${renderMonthlyInquiryChart(series)}</section>`;
  }

  function renderMonthlyInquiryChart(series) {
    if (!series.validTimestampCount) return `<div class="overview-chart-empty"><strong>Monthly history unavailable</strong><span>Inquiry creation timestamps are missing, so no trend is shown.</span></div>`;
    if (!series.visibleTotal) return `<div class="overview-chart-empty"><strong>No inquiries in the latest 12 months</strong><span>Older records are excluded from this chart.</span></div>`;
    const months = series.months;
    const width = 760;
    const height = 250;
    const pad = { left: 42, right: 18, top: 26, bottom: 42 };
    const max = Math.max(1, ...months.map((month) => month.count));
    const usableWidth = width - pad.left - pad.right;
    const usableHeight = height - pad.top - pad.bottom;
    const xFor = (index) => pad.left + (months.length === 1 ? usableWidth / 2 : (usableWidth * index) / (months.length - 1));
    const yFor = (value) => pad.top + usableHeight - (usableHeight * value) / max;
    const points = months.map((month, index) => ({ ...month, x: xFor(index), y: yFor(month.count) }));
    const path = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
    const grid = [0, Math.ceil(max / 2), max].filter((value, index, all) => all.indexOf(value) === index);
    const pointNodes = points.map((point) => `<g class="overview-chart-point ${point.current ? "current" : ""}" tabindex="0" role="listitem" aria-label="${html(point.label)}: ${point.count} inquiries"><title>${html(point.label)}: ${point.count} ${point.count === 1 ? "inquiry" : "inquiries"}</title><circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4.5"></circle><text x="${point.x.toFixed(1)}" y="${Math.max(14, point.y - 10).toFixed(1)}">${point.count}</text></g>`).join("");
    const labels = points.map((point, index) => `<text class="overview-chart-month ${point.current ? "current" : ""}" x="${point.x.toFixed(1)}" y="226">${html(index % 2 === 0 || point.current ? point.shortLabel : "")}</text>`).join("");
    const gridNodes = grid.map((value) => { const y = yFor(value); return `<g><line x1="${pad.left}" x2="${width - pad.right}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"></line><text x="12" y="${(y + 4).toFixed(1)}">${value}</text></g>`; }).join("");
    return `<div class="overview-chart-wrap"><svg class="overview-inquiry-chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="overview-chart-svg-title overview-chart-svg-desc" preserveAspectRatio="xMidYMid meet"><title id="overview-chart-svg-title">Monthly inquiry volume</title><desc id="overview-chart-svg-desc">Line chart showing inquiry counts for the latest 12 calendar months, ending with the current month.</desc><g class="overview-chart-grid">${gridNodes}</g><path class="overview-chart-line" d="${path}" fill="none"></path><g role="list">${pointNodes}</g><g>${labels}</g></svg><p class="overview-chart-sr">${html(months.map((month) => `${month.label}: ${month.count}`).join("; "))}</p></div>`;
  }

  function renderMonthlyComparisonPanel(series) {
    const current = series.months.at(-1) || { label: "Current month", count: 0 };
    const previous = series.months.at(-2) || { label: "Previous month", count: 0 };
    const comparison = monthlyComparisonText(current.count, previous.count);
    return `<section class="overview-month-compare" aria-labelledby="overview-month-compare-title"><span>Current Month</span><h2 id="overview-month-compare-title">${html(current.count)}</h2><strong>${html(current.label)}</strong><p>${html(comparison)}</p></section>`;
  }

  function monthlyComparisonText(current, previous) {
    if (previous > 0) {
      const change = Math.round(((current - previous) / previous) * 100);
      if (change > 0) return `${change}% increase vs previous month`;
      if (change < 0) return `${Math.abs(change)}% decrease vs previous month`;
      return "No change from previous month";
    }
    if (current > 0) return "New activity vs previous month";
    return "No change from previous month";
  }

  function getRecentInquiries(items, limit = 6) {
    return items
      .map((item) => ({ item, created: getInquiryCreatedDate(item) }))
      .filter((row) => row.created)
      .sort((a, b) => b.created.date - a.created.date)
      .slice(0, limit)
      .map((row) => row.item);
  }

  function renderRecentInquiries(items) {
    return `<section class="overview-list-section overview-recent-inquiries" aria-labelledby="overview-recent-title"><div class="overview-panel-header"><div><h2 id="overview-recent-title">Recent Inquiries</h2><p>Latest records by creation date.</p></div><button type="button" data-mvp-route="/inquiries">Open</button></div><div class="overview-compact-list">${items.length ? items.map(recentInquiryRow).join("") : empty("No inquiries recorded yet.")}</div></section>`;
  }

  function recentInquiryRow(item) {
    const created = getInquiryCreatedDate(item);
    const qty = item.qty && item.qty !== "-" ? `Qty ${item.qty}` : "";
    return `<button class="overview-inquiry-row" type="button" data-mvp-route="/inquiries?inquiry=${encodeURIComponent(item.id)}"><span><strong>${html(item.customer || item.company || "Unnamed customer")}</strong><small>${html([itemDisplay(item), serviceDisplay(item), qty].filter((value) => value && value !== "-").join(" / ") || "Inquiry")}</small></span>${quoteStatusBadge(item)}<code>${html(item.id)}</code><time>${html(created ? created.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Date unavailable")}</time></button>`;
  }

  function buildOverviewPriorities({ inquiries, tasks, taskLoadState, taskError, taskRoute }) {
    const rows = [];
    const today = new Date(`${todayIso()}T00:00:00`);
    inquiries.forEach((item) => {
      if (!isFollowUpDue(item)) return;
      const follow = new Date(`${item.followUpDate}T00:00:00`);
      const overdue = Number.isFinite(follow.getTime()) && follow < today;
      rows.push({ kind: "FOLLOW-UP", title: item.customer || item.company || "Unnamed customer", reason: overdue ? "Overdue customer follow-up" : "Customer follow-up due today", when: overdue ? `Since ${shortDate(item.followUpDate)}` : "Today", route: `/inquiries?inquiry=${encodeURIComponent(item.id)}`, tone: overdue ? "danger" : "warning", weight: overdue ? 0 : 40 });
    });
    if (["ready", "loading"].includes(taskLoadState)) {
      tasks.forEach((task) => {
        const status = String(task.status || "");
        if (status === "FOR_REVIEW") rows.push(taskPriority(task, "Task waiting for review", "WAITING FOR REVIEW", taskRoute, "warning", 10));
        else if (status === "NEEDS_REVISION") rows.push(taskPriority(task, "Task needs revision", "NEEDS REVISION", taskRoute, "danger", 20));
        else if (["TO_DO", "IN_PROGRESS"].includes(status) && isTaskItemOverdue(task)) rows.push(taskPriority(task, "Active task is overdue", formatTaskDueText(task), taskRoute, "danger", 30));
        else if (["TO_DO", "IN_PROGRESS"].includes(status) && isTaskItemDueToday(task)) rows.push(taskPriority(task, "Task due today", "Today", taskRoute, "warning", 50));
      });
    }
    return rows.sort((a, b) => a.weight - b.weight).slice(0, 6).map((item) => ({ ...item, taskError }));
  }

  function taskPriority(task, reason, when, taskRoute, tone, weight) {
    return { kind: "TASK", title: task.title || task.taskCode || "Task", reason, when, route: taskRoute || "/workboard", code: task.taskCode || "TASK", tone, weight };
  }

  function renderOverviewPriorities(items, taskLoadState, taskError) {
    const taskNotice = taskLoadState === "loading" ? `<p class="overview-inline-note">Loading task attention items...</p>` : taskLoadState === "error" || taskLoadState === "forbidden" ? `<p class="overview-inline-warning">Task attention unavailable: ${html(taskError || "Unable to load tasks.")}</p>` : "";
    return `<section class="overview-list-section overview-priority-section" aria-labelledby="overview-priority-title"><div class="overview-panel-header"><div><h2 id="overview-priority-title">Important Tasks and Follow-ups</h2><p>Attention Needed</p></div></div>${taskNotice}<div class="overview-compact-list">${items.length ? items.map(overviewPriorityRow).join("") : empty("No priority tasks or follow-ups.")}</div></section>`;
  }

  function overviewPriorityRow(item) {
    return `<button class="overview-priority-row ${html(item.tone)}" type="button" data-mvp-route="${html(item.route)}"><b>${html(item.kind)}</b><span><strong>${html(item.title)}</strong><small>${html(item.code ? `${item.code} / ${item.reason}` : item.reason)}</small></span><time>${html(item.when)}</time></button>`;
  }

  function isTaskItemOverdue(task) {
    const dueAt = Date.parse(task.submissionDeadline || "");
    return Number.isFinite(dueAt) && dueAt < new Date(`${todayIso()}T00:00:00`).getTime() && !["DONE", "CANCELLED"].includes(task.status);
  }

  function isTaskItemDueToday(task) {
    const raw = task.submissionDeadline || task.scheduledDate || "";
    const date = Date.parse(raw);
    if (!Number.isFinite(date)) return false;
    const start = new Date(`${todayIso()}T00:00:00`).getTime();
    return date >= start && date < start + 86400000;
  }

  function formatTaskDueText(task) {
    const raw = task.submissionDeadline || task.scheduledDate || "";
    if (!raw) return "No date";
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? "No date" : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function buildOperationalAlerts({ inquiries, orders, productionJobs, pipeline }) {
    const today = new Date(`${todayIso()}T00:00:00`);
    const overdueFollowUps = inquiries.filter((item) => {
      if (!isFollowUpDue(item)) return false;
      const follow = new Date(`${item.followUpDate}T00:00:00`);
      return Number.isFinite(follow.getTime()) && follow < today;
    }).length;
    const quoteBacklog = pipeline.new || 0;
    const paymentProofs = orders.filter((item) => paymentLabel(item) === "For Verification").length;
    const artworkAttention = orders.filter((item) => !isOrderClosed(item) && ["revision", "pending", "not_set"].includes(orderArtworkKey(item))).length;
    const blockedRelease = orders.filter((item) => blockedReason(item)).length;
    const overdueProduction = productionJobs.filter((item) => due(item).key === "overdue").length;
    return [
      operationalAlert("Blocked order release", blockedRelease, "Production release requirements are incomplete.", "/orders", "danger", 0),
      operationalAlert("Overdue follow-ups", overdueFollowUps, "Customer follow-ups are past their scheduled date.", "/inquiries?stage=follow_due", "danger", 10),
      operationalAlert("Overdue production", overdueProduction, "Released production jobs are past due.", "/production?due=overdue", "danger", 20),
      operationalAlert("Payment proof for verification", paymentProofs, "Receipts or payment proof need owner review.", "/orders", "warning", 30),
      operationalAlert("Quotation backlog", quoteBacklog, "New inquiries still need quotation action.", "/inquiries?stage=new", "warning", 40),
      operationalAlert("Artwork attention", artworkAttention, "Artwork is missing, pending, or needs revision on open orders.", "/orders", "warning", 50),
    ].filter((item) => item.count > 0).sort((a, b) => a.weight - b.weight).slice(0, 5);
  }

  function operationalAlert(title, count, detail, route, tone, weight) {
    return { title, count, detail, route, tone, weight };
  }

  function renderOperationalAlerts(alerts) {
    return `<section class="overview-alerts-section" aria-labelledby="overview-alerts-title"><div class="overview-panel-header"><div><h2 id="overview-alerts-title">Operational Alerts</h2><p>Aggregate conditions that need attention.</p></div></div><div class="overview-alert-list">${alerts.length ? alerts.map(operationalAlertRow).join("") : `<p class="overview-healthy-state"><strong>Operational alerts are clear.</strong><span>No current blockers or overdue aggregate conditions.</span></p>`}</div></section>`;
  }

  function operationalAlertRow(item) {
    return `<button class="overview-alert-row ${html(item.tone)}" type="button" data-mvp-route="${html(item.route)}"><span><strong>${html(item.title)}</strong><small>${html(item.detail)}</small></span><b>${html(item.count)}</b></button>`;
  }
  function buildPriorities(orders, inquiries) {
    const rows = [];
    orders.forEach((item) => {
      const dueState = due(item);
      const blocked = blockedReason(item);
      if (dueState.key === "overdue" || blocked) {
        const route = isReleasedToProduction(item) ? `/production?order=${encodeURIComponent(item.id)}` : `/orders?order=${encodeURIComponent(item.id)}`;
        rows.push(priority(item, blocked ? `Blocked: ${blocked}` : "Order is overdue", dueState.label, route, dueState.key === "overdue" ? "danger" : "warning"));
      }
      else if (paymentLabel(item) === "For Verification") rows.push(priority(item, "Payment proof submitted / parked for later review", "Parked", `/orders?order=${encodeURIComponent(item.id)}`, "warning"));
      else if (dueState.key === "today" || productionStage(item) === "ready") rows.push(priority(item, productionStage(item) === "ready" ? "Ready for release" : "Due today", dueState.label, `/orders?order=${encodeURIComponent(item.id)}`, ""));
    });
    inquiries.forEach((item) => {
      if (!isFollowUpDue(item)) return;
      const follow = new Date(`${item.followUpDate}T00:00:00`);
      const today = new Date(`${todayIso()}T00:00:00`);
      rows.push(priority(item, "Customer follow-up due", follow < today ? `Since ${shortDate(item.followUpDate)}` : "Today", `/inquiries?inquiry=${encodeURIComponent(item.id)}`, follow < today ? "danger" : "warning"));
    });
    return rows.slice(0, 6);
  }


  function buildBottlenecks({ inquiries, orders, productionJobs, pipeline }) {
    const today = new Date(`${todayIso()}T00:00:00`);
    const overdueFollowUps = inquiries.filter((item) => {
      if (!isFollowUpDue(item)) return false;
      const follow = new Date(`${item.followUpDate}T00:00:00`);
      return Number.isFinite(follow.getTime()) && follow < today;
    }).length;
    const quoteBacklog = pipeline.new || 0;
    const awaitingPayment = orders.filter((item) => ["Payment Required", "Pay at Shop", "Correction Required"].includes(paymentLabel(item))).length;
    const paymentProofs = orders.filter((item) => paymentLabel(item) === "For Verification").length;
    const artworkAttention = orders.filter((item) => !isOrderClosed(item) && ["revision", "pending", "not_set"].includes(orderArtworkKey(item))).length;
    const blockedRelease = orders.filter((item) => blockedReason(item)).length;
    const overdueProduction = productionJobs.filter((item) => due(item).key === "overdue").length;

    return [
      bottleneck("Overdue follow-ups", overdueFollowUps, "Customer follow-ups are past their scheduled date.", "/inquiries?stage=follow_due", "danger"),
      bottleneck("Quotation queue", quoteBacklog, "New inquiries still need quotation action.", "/inquiries?stage=new", quoteBacklog ? "warning" : ""),
      bottleneck("Payment parked", awaitingPayment, "Payment workflow is parked for this release.", "/orders?payment=awaiting", awaitingPayment ? "warning" : ""),
      bottleneck("Payment proof parked", paymentProofs, "Receipts or payment proof stay visible but do not block production.", "/orders", paymentProofs ? "warning" : ""),
      bottleneck("Artwork attention", artworkAttention, "Artwork is missing, pending, or needs revision on open orders.", "/orders", artworkAttention ? "warning" : ""),
      bottleneck("Blocked release", blockedRelease, "Production release requirements are not fully satisfied.", "/orders", blockedRelease ? "danger" : ""),
      bottleneck("Overdue production", overdueProduction, "Released production jobs are past due.", "/production?due=overdue", overdueProduction ? "danger" : ""),
    ].filter((item) => item.count > 0).slice(0, 5);
  }

  function bottleneck(title, count, detail, route, tone = "") {
    return { title, count, detail, route, tone };
  }

  function bottleneckSection(items) {
    return `<section class="mvp-section mvp-bottleneck-section"><div class="mvp-section-title"><h2>Blocked / Waiting</h2><span>${items.length}</span></div><div class="mvp-bottleneck-list">${items.length ? items.map(bottleneckRow).join("") : empty("No current blockers.")}</div></section>`;
  }

  function bottleneckRow(item) {
    return `<button type="button" class="mvp-bottleneck-row ${html(item.tone)}" data-mvp-route="${html(item.route)}"><span><strong>${html(item.title)}</strong><small>${html(item.detail)}</small></span><b>${item.count}</b></button>`;
  }

  function moduleEntrySection(counts) {
    return `<section class="mvp-section mvp-module-entry-section"><div class="mvp-section-title"><h2>Active Operations</h2></div><div class="mvp-module-links">
      ${moduleEntry("Inquiries", counts.inquiries, "Quotation and follow-up pipeline", "/inquiries")}
      ${moduleEntry("Orders", counts.orders, "Payment, artwork, and release readiness", "/orders")}
      ${moduleEntry("Production", counts.productionJobs, `${counts.inProgress} actively in production`, "/production")}
    </div></section>`;
  }

  function moduleEntry(label, count, detail, route) {
    return `<button type="button" class="mvp-module-link" data-mvp-route="${html(route)}"><span><strong>${html(label)}</strong><small>${html(detail)}</small></span><b>${count}</b></button>`;
  }
  return { state, renderOverview, renderInquiries, renderOrders, renderProduction, bind, helpers: { confirmed, productionStage, stageLabel } };
  function renderInquiries({ items, notices = "", renderQuote, renderOrder, renderArtwork, renderPayment }) {
    const inquiries = items.filter((item) => !confirmed(item));
    const stageFilter = query("stage") || state.inquiry.stage;
    const search = state.inquiry.search.toLowerCase();
    const rows = inquiries.filter((item) => {
      const stage = quoteStage(item);
      if (stageFilter === "active_quote" && stage !== "sent") return false;
      if (stageFilter === "follow_due" && !isFollowUpDue(item)) return false;
      if (!["all", "active_quote", "follow_due"].includes(stageFilter) && stage !== stageFilter) return false;
      if (state.inquiry.owner !== "all" && (item.ownerUserId || "") !== state.inquiry.owner) return false;
      if (state.inquiry.service !== "all" && item.service !== state.inquiry.service) return false;
      if (state.inquiry.due !== "all" && inquiryDue(item) !== state.inquiry.due) return false;
      return !search || [item.id, item.customer, item.contact, item.service, product(item)].join(" ").toLowerCase().includes(search);
    });
    const selected = inquiries.find((item) => item.id === (state.inquiryId || query("inquiry")));
    return `<main class="mvp-page ops-board-page mvp-inquiries-page">
      ${pageTitle("Inquiries", "INQUIRIES", `${rows.length} shown / ${inquiries.length} total`)}
      ${notices}
      <div class="mvp-stage-cards">${INQUIRY_QUEUES.map(([value, label]) => `<button type="button" data-mvp-stage="${value}" class="${stageFilter === value ? "active" : ""}"><span>${label}</span><strong>${inquiryStageCount(value, inquiries)}</strong></button>`).join("")}</div>
      ${filterBar("inquiry", items, ["owner", "service", "due"])}
      ${inquiryTable(rows)}${inquiryDrawer(selected, renderQuote, renderOrder, renderArtwork, renderPayment)}
    </main>`;
  }

  function inquiryTable(items) {
    const headers = ["Code", "Customer", "Inquiry", "Service", "Quantity", "Quote Status", "Follow-up", "Owner"];
    const desktopRows = items.map((item) => row("inquiry", item.id, [
      copyButton(item.id, item.id, "inquiry code"),
      customerCell(item),
      inquirySummaryCell(item),
      cell(serviceDisplay(item)),
      cell(item.qty || displayDash()),
      quoteStatusBadge(item),
      followUpCell(item),
      cell(owner(item)),
    ]));
    const mobileCards = items.map((item) => inquiryMobileCard(item)).join("");
    return `${table("inquiry", headers, desktopRows, "No inquiries found.")}<section class="mvp-inquiry-card-list" aria-label="Inquiries">${mobileCards || empty("No inquiries found.")}</section>`;
  }

  function inquiryDrawer(item, renderQuote, renderOrder, renderArtwork, renderPayment) {
    if (!item) return "";
    const stage = quoteStage(item);
    const action = inquiryPrimaryAction(item, stage, renderOrder);
    const activeTab = ["details", "request", "notes", "history"].includes(state.inquiryTab) ? state.inquiryTab : "details";
    const workflowPanel = state.inquiryActionId === item.id ? inquiryWorkflowPanel(item, action, renderQuote, renderOrder) : "";
    return drawer("inquiry locked", item, QUOTE_STAGES[stage], `
      <section class="mvp-inquiry-locked-shell">
         ${inquiryLockedHeader(item, stage)}
         ${inquiryTabs(activeTab)}
         ${inquiryTabPanels(item, activeTab, stage, renderArtwork)}
         ${typeof renderPayment === "function" ? renderPayment(item) : ""}
         ${workflowPanel}
      </section>
    `, inquiryActionBar(item, action));
  }

  function inquiryLockedHeader(item, stage) {
    const company = String(item.company || "").trim();
    return `<div class="mvp-inquiry-locked-header">${quoteStatusBadge(item)}<div class="mvp-inquiry-customer-row"><h2>${html(item.customer || "Unnamed customer")}</h2>${company ? `<small>${html(company)}</small>` : ""}</div><div class="mvp-inquiry-number-row"><span>Inquiry Reference</span>${copyButton(item.id, item.id, "inquiry number")}</div><div class="mvp-inquiry-meta">${contactActionButton(item)}</div></div>`;
  }

  function inquirySummaryCards(item, stage) {
    const follow = followUpSummary(item);
    const quote = quotationSummary(item, stage);
    return `<div class="mvp-inquiry-summary-grid">${summaryCard("Customer", "", item.customer || "Unnamed customer", item.contact || "No phone")}${summaryCard("Service", "", serviceChips(item), "")}${summaryCard("Quantity", "", item.sizeBreakdown || item.qty || "Not set", "")}${summaryCard("Assigned To", "", owner(item), assignmentSubtitle(item))}${summaryCard("Follow-up", "", follow.title, follow.sub, "wide")}${summaryCard("Quotation", "", quote.title, quote.sub, "wide")}</div>`;
  }

  function summaryCard(label, badge, title, subtitle, className = "") {
    const badgeHtml = badge ? `<b>${html(badge)}</b>` : "";
    return `<article class="mvp-inquiry-summary-card ${className}"><span>${html(label)}</span><div>${badgeHtml}<strong>${title}</strong>${subtitle ? `<small>${html(subtitle)}</small>` : ""}</div></article>`;
  }

  function inquiryTabs(activeTab) {
    const tabs = [["details", "Details"], ["request", "Request"], ["notes", "Notes"], ["history", "History"]];
    return `<nav class="mvp-inquiry-tabs" aria-label="Inquiry drawer tabs">${tabs.map(([id, label]) => `<button type="button" data-mvp-inquiry-tab="${id}" class="${activeTab === id ? "active" : ""}">${html(label)}</button>`).join("")}</nav>`;
  }

  function inquiryTabPanels(item, activeTab, stage, renderArtwork) {
    const panels = [
      ["details", inquiryDetailsTab(item)],
      ["request", inquiryRequestTab(item, renderArtwork)],
      ["notes", inquiryNotesTab(item)],
      ["history", inquiryHistoryTab(item)],
    ];
    return panels.map(([id, content]) => `<div class="mvp-inquiry-tab-panel" data-mvp-inquiry-panel="${id}" ${activeTab === id ? "" : "hidden"}>${content}</div>`).join("");
  }

  function inquiryDetailsTab(item) {
    return `<div class="mvp-inquiry-detail-list">${inquiryDetailSection("CUSTOMER INFORMATION", `${detailLine("Contact", contactDisplay(item))}${item.company ? detailLine("Company", item.company) : ""}`)}${inquiryDetailSection("INQUIRY CONTEXT", `${detailLine("Inquiry Reference", item.id)}${detailLine("Needed Date", item.dueDate ? shortDate(item.dueDate) : "Not set")}${detailLine("Internal Status", internalStatus(item))}`)}${inquiryDetailSection("NEXT ACTION", detailLine("Current Next Action", item.next || "Review inquiry", true))}${inquiryFollowUpSection(item)}</div>`;
  }

  function inquiryRequestTab(item, renderArtwork) {
    return `<div class="mvp-inquiry-detail-list">${inquiryDetailSection("REQUEST DETAILS", `${detailLine("Item / Garment", itemDisplay(item))}${detailLine("Service", serviceDisplay(item))}${detailLine("Color", messageValue(item.message, ["Color", "Colour"]) || "Not specified")}${detailLine("Size", item.sizeBreakdown || messageValue(item.message, ["Size", "Sizes"]) || "Not specified")}${detailLine("Quantity", item.qty || "Not set")}${detailLine("Placement", messageValue(item.message, ["Placement", "Print Placement", "Logo Placement"]) || "Not specified")}`)}${inquiryDetailSection("PRODUCTION REQUIREMENTS", detailLine("Requirements", messageValue(item.message, ["Requirements", "Production Requirements", "Other Requirements"]) || "Not specified", true))}${artworkPreviewLine(item, renderArtwork)}</div>`;
  }

  function inquiryNotesTab(item) {
    return `<div class="mvp-inquiry-detail-list">${customerMessageSection(item)}${followUpUpdatesSection(item)}${inquiryDetailSection("STAFF NOTES", `${detailLine("Designer Notes", item.designerNotes || "No designer notes.", true)}${detailLine("Quotation Notes", item.quoteNotes || "No quotation notes.", true)}${detailLine("Internal Note", item.productionNote || item.internalNote || "No internal note.", true)}`)}</div>`;
  }

  function inquiryHistoryTab(item) {
    return `<ol class="mvp-inquiry-history">${inquiryHistory(item).map((row) => `<li><strong>${html(row.title)}</strong><span>${html(row.meta)}</span>${row.note ? `<p>${html(row.note)}</p>` : ""}${row.next ? `<small>${html(row.next)}</small>` : ""}</li>`).join("")}</ol>`;
  }

  function inquiryActionBar(item, action) {
    return `<div class="mvp-inquiry-action-bar"><button type="button" class="mvp-action-secondary" data-mvp-inquiry-tab="notes">Edit Inquiry</button><div class="mvp-more-wrap"><button type="button" class="mvp-action-secondary" data-mvp-more-toggle>More</button>${state.inquiryMoreOpen ? `<div class="mvp-more-menu"><button type="button" data-mvp-inquiry-tab="request">View Request</button><button type="button" data-mvp-inquiry-tab="history">View History</button></div>` : ""}</div><button type="button" class="mvp-action-primary" data-mvp-primary-action="${html(item.id)}" ${action.disabled ? "disabled" : ""}><span>${html(action.label)}</span><small>${html(action.hint)}</small></button></div>`;
  }

  function inquiryWorkflowPanel(item, action, renderQuote, renderOrder) {
    if (action.kind === "quote" && typeof renderQuote === "function") return `<section class="mvp-workflow-panel">${renderQuote(item).replace(/<details class="ops-quote-editor"(?! open)/, '<details class="ops-quote-editor" open')}</section>`;
    if (action.kind === "order" && typeof renderOrder === "function") return `<section class="mvp-workflow-panel">${renderOrder(item)}</section>`;
    if (action.route) return `<section class="mvp-workflow-panel"><button class="mvp-primary-action" type="button" data-mvp-route="${html(action.route)}">${html(action.label)}</button></section>`;
    return `<section class="mvp-workflow-panel"><p>${html(action.hint)}</p></section>`;
  }

  function inquiryPrimaryAction(item, stage, renderOrder) {
    if (stage === "new") return { kind: "quote", label: "Create Quotation", hint: "Next step" };
    if (stage === "sent") return { kind: "wait", label: "Waiting for Approval", hint: "Quote sent", disabled: true };
    if (stage === "approved" && !confirmed(item)) return { kind: "order", label: "Create Order", hint: "Next step", disabled: typeof renderOrder !== "function" };
    if (stage === "approved" && confirmed(item)) return { kind: "release", label: "Release to Production", hint: "Next step", route: `/orders?order=${encodeURIComponent(item.id)}` };
    if (confirmed(item)) return { kind: "production", label: "View Production", hint: "Open job", route: `/production?order=${encodeURIComponent(item.id)}` };
    return { kind: "quote", label: "Create Quotation", hint: "Next step" };
  }

  function detailLine(label, value, multiline = false) {
    return `<div class="mvp-inquiry-detail-line ${multiline ? "wide" : ""}"><span>${html(label)}</span><strong>${html(value || "Not set")}</strong></div>`;
  }
  function inquiryDetailSection(title, rows) {
    return `<section class="mvp-inquiry-detail-section"><h3>${html(title)}</h3><div class="mvp-inquiry-detail-grid">${rows}</div></section>`;
  }

  function followUpUpdatesSection(item) {
    const events = Array.isArray(item.followUpEvents) ? item.followUpEvents : [];
    return `<section class="mvp-follow-up-updates"><h3>FOLLOW-UP UPDATES</h3>${events.length ? events.map((event) => `<article><strong>${html(followUpOutcomeLabel(event.outcome))}</strong><span>${html(event.createdByName || "Staff")} / ${html(dateTime(event.createdAt))}</span><p>${html(event.note || "No note saved.")}</p>${event.nextFollowUpDate ? `<small>Next scheduled follow-up: ${html(shortDate(event.nextFollowUpDate))}</small>` : ""}</article>`).join("") : `<p>No follow-up updates recorded.</p>`}</section>`;
  }
  function customerMessageSection(item) {
    return `<section class="mvp-customer-message-section"><h3>CUSTOMER MESSAGE</h3><p>${html(customerNotes(item) || "No customer message provided.")}</p></section>`;
  }

  function artworkPreviewLine(item, renderArtwork) {
    return `<section class="mvp-inquiry-artwork-preview"><div class="mvp-artwork-preview-box"><span>ARTWORK / REFERENCE</span><strong>${html(artworkState(item))}</strong></div><p>${html(artworkFilenameSummary(item))}</p>${typeof renderArtwork === "function" ? renderArtwork(item) : ""}</section>`;
  }

  function artworkFilenameSummary(item) {
    const explicit = String(item.artworkFilename || item.artworkFileName || item.fileName || "").trim();
    if (explicit) return explicit;
    const url = String(item.artworkUrl || "").trim();
    if (!url) return "No filename saved";
    try {
      const parsed = new URL(url, window.location.origin);
      const name = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "").trim();
      return name || "Artwork link saved";
    } catch {
      return url.split("/").filter(Boolean).pop() || "Artwork link saved";
    }
  }
  function inquiryTimestamp(item) {
    const raw = item.createdAt || item.created_at || item.quoteSentAt || item.updatedAt || new Date().toISOString();
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return { date: shortDate(todayIso()), time: "Time not set" };
    return { date: date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), time: date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) };
  }

  function sourceLabel(item) {
    const source = String(item.channel || item.source || "Website").trim();
    if (/fb|facebook/i.test(source)) return "Facebook";
    if (/walk/i.test(source)) return "Walk-in";
    if (/phone/i.test(source)) return "Phone";
    if (/portal|website|web/i.test(source)) return "Website";
    return source || "Website";
  }

  function assignmentSubtitle(item) {
    const value = owner(item);
    if (value.includes(" - ")) return value.split(" - ").slice(1).join(" - ");
    return value === "Unassigned" ? "" : "Assigned owner";
  }

  function serviceChips(item) {
    const values = serviceDisplay(item).split(/,|\+|\//).map((value) => value.trim()).filter(Boolean);
    return values.length ? values.map((value) => `<em>${html(value)}</em>`).join("") : "Not set";
  }

  function followUpSummary(item) {
    if (!item.followUpDate) return { title: "Not set", sub: "" };
    return { title: followUpLabel(item), sub: shortDate(item.followUpDate) };
  }

  function quotationSummary(item, stage) {
    const amount = Number(item.quotedAmount) > 0 ? money(item.quotedAmount) : "Not Created";
    if (stage === "approved") return { title: amount, sub: "Approved" };
    if (stage === "sent") return { title: amount, sub: "" };
    if (item.quoteStatus === "draft" || amount !== "Not Created") return { title: amount, sub: item.quotePublishedAt ? "" : "Draft" };
    return { title: "Not Created", sub: "Unquoted" };
  }

  function statusSubtitle(item, stage) {
    if (stage === "new") return "Unquoted";
    if (stage === "sent") return "Waiting approval";
    if (stage === "approved") return confirmed(item) ? "Order created" : "Ready to convert";
    return item.status || "Review";
  }

  function internalStatus(item) {
    if (confirmed(item)) return "Order Created";
    if (quoteStage(item) === "sent") return "Pending Approval";
    if (quoteStage(item) === "new") return "Pending Quotation";
    return QUOTE_STAGES[quoteStage(item)];
  }

  function customerLink(item) {
    return `trryapparel.com/inquiry/${encodeURIComponent(item.id)}`;
  }

  function contactDisplay(item) {
    const contact = String(item.contact || "").trim();
    if (!contact) return "Not set";
    return validContactUrl(contact) ? "Saved contact link" : contact;
  }

  function contactActionButton(item) {
    const contact = String(item.contact || "").trim();
    if (!contact) return `<span class="mvp-contact-unavailable">Contact not set</span>`;
    const url = validContactUrl(contact);
    if (url) return `<button class="mvp-contact-action" type="button" data-mvp-contact-url="${html(url)}">OPEN CONTACT</button>`;
    return `<button class="mvp-contact-action" type="button" data-mvp-open-messenger="${html(item.id)}">OPEN CONTACT</button>`;
  }

  function validContactUrl(value) {
    try {
      const url = new URL(String(value || "").trim());
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  function inquiryHistory(item) {
    const rows = [];
    if (item.updatedAt) rows.push({ title: "Last Updated", meta: dateTime(item.updatedAt) });
    (Array.isArray(item.followUpEvents) ? item.followUpEvents : []).forEach((event) => {
      rows.push({
        title: `Follow-up: ${followUpOutcomeLabel(event.outcome)}`,
        meta: `${event.createdByName || "Staff"} / ${dateTime(event.createdAt)}`,
        note: event.note || "No note saved.",
        next: event.nextFollowUpDate ? `Next scheduled follow-up: ${shortDate(event.nextFollowUpDate)}` : "",
      });
    });
    if (item.quotePublishedAt) rows.push({ title: "Quote Sent", meta: dateTime(item.quotePublishedAt) });
    if (item.quoteApprovedAt) rows.push({ title: "Customer Approved", meta: dateTime(item.quoteApprovedAt) });
    if (confirmed(item)) rows.push({ title: "Order Created", meta: orderReference(item) });
    rows.push({ title: "Inquiry Created", meta: inquiryTimestamp(item).date });
    return rows;
  }

  function followUpOutcomeLabel(outcome) {
    const value = key(outcome);
    if (value === "no_response") return "No response";
    if (value === "customer_considering") return "Customer considering";
    if (value === "customer_replied_action_needed") return "Customer replied / action needed";
    return "Follow-up update";
  }
  function renderOrders({ items, notices = "", schemaNotice = "", renderPayment, renderTracking }) {
    const orders = items.filter(confirmed);
    const stageQuery = query("stage");
    const paymentQuery = query("payment");
    const orderQuery = query("order");
    const search = state.order.search.toLowerCase();
    const rows = orders.filter((item) => {
      const stage = productionStage(item);
      const readiness = readinessState(item);
      const payment = paymentState(item);
      const dueState = due(item);
      if (stageQuery && stage !== stageQuery) return false;
      if (paymentQuery === "awaiting" && payment.key !== "awaiting") return false;
      if (state.order.payment !== "all" && payment.label !== state.order.payment) return false;
      if (state.order.artwork !== "all" && readiness.artworkKey !== state.order.artwork) return false;
      if (state.order.due !== "all" && dueState.key !== state.order.due) return false;
      if (state.order.production !== "all" && stage !== state.order.production) return false;
      if (state.order.owner !== "all" && (item.assignedUserId || "") !== state.order.owner) return false;
      return !search || [orderReference(item), sourceInquiryReference(item), item.id, item.customer, item.contact, item.service, product(item), item.odooSO, orderOwner(item)].join(" ").toLowerCase().includes(search);
    });
    const selected = orders.find((item) => item.id === (state.orderId || orderQuery));
    return `<main class="mvp-page ops-board-page mvp-orders-page">${pageTitle("Orders", "ORDERS", `${rows.length} shown / ${orders.length} total`)}${notices}${schemaNotice}
      ${orderMetrics(orders)}${filterBar("order", items, ["payment", "artwork", "due", "production", "owner"])}${ordersTable(rows)}${orderCards(rows)}${orderDrawer(selected, renderPayment, renderTracking)}
    </main>`;
  }

  function orderMetrics(orders) {
    return `<div class="mvp-metrics orders">${metric("Active Orders", orders.filter((item) => !isOrderClosed(item)).length, "/orders", "Confirmed")}${metric("Action Required", orders.filter(orderActionRequired).length, "/orders?due=today", "Work queue", "warning")}${metric("Ready for Production", orders.filter(readyForProduction).length, "/orders?stage=queued", "Gate clear", "lime")}${metric("Overdue", orders.filter((item) => due(item).key === "overdue").length, "/orders?due=overdue", "Orders", "danger")}${metric("Completed", orders.filter((item) => productionStage(item) === "completed").length, "/orders?stage=completed", "Closed")}</div>`;
  }

  function ordersTable(items) {
    return table("orders", ["Order", "Customer", "Item / Service", "Quantity", "Payment", "Production", "Due Date", "Owner"], items.map((item) => {
      const dueState = due(item);
      const payment = paymentState(item);
      const production = productionDisplay(item);
      return row("order", item.id, [
        orderReferenceCell(item),
        orderCustomerCell(item),
        orderItemCell(item),
        cell(quantityDisplay(item)),
        status(payment.label, payment.tone),
        status(production.label, production.tone),
        `<span class="mvp-due ${dueState.key}" title="${html(dueState.label)}">${html(dueShortLabel(dueState, item))}</span>`,
        cell(orderOwner(item)),
      ]);
    }), "No orders found.");
  }

  function orderCards(items) {
    return `<section class="mvp-order-card-list">${items.length ? items.map(orderMobileCard).join("") : empty("No orders found.")}</section>`;
  }

  function orderMobileCard(item) {
    const payment = paymentState(item);
    const production = productionDisplay(item);
    const dueState = due(item);
    return `<article class="mvp-order-mobile-card" data-mvp-open="order" data-mvp-id="${html(item.id)}" role="button" tabindex="0"><div class="mvp-order-mobile-header"><div><strong>${html(item.customer || "Unnamed customer")}</strong><small>${html(orderReference(item))}</small></div><b class="mvp-mobile-open">OPEN</b></div><div class="mvp-order-mobile-summary"><strong>${html(itemDisplay(item))}</strong><span>${html([serviceDisplay(item), quantityDisplay(item)].filter(Boolean).join(" / "))}</span></div><div class="mvp-order-mobile-statuses">${status(payment.label, payment.tone)}${status(production.label, production.tone)}</div><div class="mvp-order-mobile-meta"><span>Due: ${html(dueShortLabel(dueState, item))}</span><span>Owner: ${html(orderOwner(item))}</span></div></article>`;
  }

  function orderReferenceCell(item) {
    return `<span class="mvp-order-ref-cell"><strong>${html(orderReference(item))}</strong>${sourceInquiryReference(item) !== "Not linked" ? `<small>${html(sourceInquiryReference(item))}</small>` : ""}</span>`;
  }

  function orderCustomerCell(item) {
    const phone = String(item.contact || "").trim();
    return `<span class="mvp-order-customer-cell"><strong>${html(item.customer || "Unnamed customer")}</strong>${phone ? `<small>${html(phone)}</small>` : ""}</span>`;
  }

  function orderItemCell(item) {
    const service = serviceDisplay(item);
    return `<span class="mvp-order-item-cell"><strong>${html(itemDisplay(item))}</strong>${service && service !== "-" ? `<small>${html(service)}</small>` : ""}</span>`;
  }

  function orderDrawer(item, renderPayment, renderTracking) {
    if (!item) return "";
    const stage = productionStage(item);
    const readiness = readinessState(item);
    const payment = paymentState(item);
    const production = productionDisplay(item);
    const block = blockedReason(item);
    const gate = productionGate(item);
    const canOpenProduction = true;
    const action = orderFooterAction(item, gate);
    return drawer("order", item, production.label, `
      ${detailSection("Overview", [["Order Reference", orderReference(item)], ["Source Inquiry", sourceInquiryReference(item)], ["Historical SO", item.odooSO || "Not set"], ["Customer", item.customer], ["Item", itemDisplay(item)], ["Quantity", item.sizeBreakdown || item.qty], ["Confirmed", dateTime(item.quoteApprovedAt || item.updatedAt)], ["Due Date", dueShortLabel(due(item), item)]])}
      ${detailSection("Readiness", [["Artwork Status", readiness.artwork], ["Artwork Approval", item.artworkApprovedAt ? dateTime(item.artworkApprovedAt) : "Not approved"], ["Revision Requirement", key(item.artworkStatus) === "revision_requested" ? "Revision needed" : "None"], ["Payment Readiness", payment.label], ["Blocked Reason", block || "None"]])}
      ${orderPaymentSummary(item)}
      ${detailSection("Fulfillment", [["Method", fulfillment(item)], ["Customer Tracking", tracking(item)], ["Contact", item.contact || "Not set"]])}
      ${detailSection("Production Handoff", [["Release State", stage === "queued" ? (readyForProduction(item) ? "Ready for production" : gate.length ? `Blocked: ${gate.join(", ")}` : "Not released") : "Released to production"], ["Current Production", production.label], ["Assigned Production Staff", assigned(item)], ["Production Link", canOpenProduction ? "Available" : "Not available"], ["Blocked Reason", block || "None"]])}
      ${detailSection("Internal", [["Order Owner", orderOwner(item)], ["Internal Note", item.productionNote || item.internalNote || "Not set"], ["Last Update", dateTime(item.updatedAt)]])}
      ${typeof renderTracking === "function" ? renderTracking(item) : ""}
    `, action);
  }  function orderReference(item) {
    return String(item.orderCode || item.orderReference || item.reference || item.code || item.odooSO || humanReadableId(item.id) || "Local order").trim();
  }

  function sourceInquiryReference(item) {
    const explicit = String(item.sourceInquiryReference || item.sourceInquiryId || item.inquiryReference || item.inquiryId || item.convertedFrom || "").trim();
    if (explicit) return explicit;
    const orderRef = orderReference(item);
    const readableId = humanReadableId(item.id);
    if (readableId && readableId !== orderRef && readableId !== item.odooSO) return readableId;
    return "Not linked";
  }

  function humanReadableId(value) {
    const text = String(value || "").trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? "" : text;
  }

  function isReleasedToProduction(item) {
    if (!confirmed(item)) return false;
    const status = key(item.status);
    if (["lost", "cancelled", "canceled"].includes(status)) return false;
    const stage = productionStage(item);
    if ([...ACTIVE_STAGES, "qc", "ready", "completed"].includes(stage)) return true;
    if (stage !== "queued") return false;
    return readyForProduction(item);
  }
  function orderFooterAction(item, gate) {
    const stage = productionStage(item);
    if (stage === "completed") return `<button class="mvp-secondary-action" data-mvp-route="/production?order=${encodeURIComponent(item.id)}" type="button">View Details</button>`;
    if (stage !== "queued") return `<button class="mvp-primary-action" data-mvp-route="/production?order=${encodeURIComponent(item.id)}" type="button">Open Production &rarr;</button>`;
    if (readyForProduction(item)) return `<button class="mvp-primary-action" data-mvp-route="/production?order=${encodeURIComponent(item.id)}" type="button">Release to Production</button>`;
    return `<button class="mvp-secondary-action" type="button" disabled title="${html(gate.join(", ") || "Order requirements are incomplete")}">View Requirements</button>`;
  }
  function readinessState(item) {
    const artworkKey = orderArtworkKey(item);
    const artwork = artworkKey === "approved" ? "ART APPROVED" : artworkKey === "revision" ? "REVISION NEEDED" : artworkKey === "pending" ? "ART PENDING" : "NOT SET";
    const fulfill = fulfillment(item).toUpperCase();
    return { artwork, artworkKey, fulfillment: fulfill, summary: `${artwork} ${String.fromCharCode(183)} ${fulfill}` };
  }

  function orderArtworkKey(item) {
    const value = key(item.artworkStatus);
    if (value === "approved") return "approved";
    if (value === "revision_requested") return "revision";
    if (item.artworkUrl || ["submitted", "under_review", "approval_required"].includes(value)) return "pending";
    return "not_set";
  }

  function paymentState(item) {
    const value = key(item.paymentStatus);
    const dueAmount = amount(item.amountDue || item.quotedAmount);
    const paidAmount = amount(item.paymentVerifiedAmount || item.paymentConfirmedAmount);
    if (key(item.paymentType) === "shop" && ["confirmed", "paid", "full_payment_confirmed"].includes(value)) return { key: "paid_shop", label: "PAID AT SHOP", tone: "completed" };
    if (["confirmed", "paid", "full_payment_confirmed"].includes(value)) return { key: "paid", label: "PAID", tone: "completed" };
    if (["down_payment_confirmed", "partially_paid"].includes(value)) return { key: "partial", label: "PARTIALLY PAID", tone: "ready" };
    if (["pay_at_shop", "payment_pending_at_shop"].includes(value)) return { key: "shop", label: "PAY AT SHOP", tone: "payment" };
    if (value === "proof_submitted") return { key: "receipt", label: "RECEIPT SUBMITTED", tone: "payment" };
    if (value === "under_review") return { key: "review", label: "PAYMENT REVIEW", tone: "payment" };
    if (["correction_required"].includes(value)) return { key: "review", label: "PAYMENT REVIEW", tone: "overdue" };
    if (["50_dp", "50%_dp", "half_down", "half_deposit"].includes(value) || key(item.paymentLabel) === "50%_dp" || key(item.paymentLabel) === "50_dp") return { key: "partial", label: "PARTIALLY PAID", tone: "payment" };
    if (["partial", "deposit", "down_payment"].includes(value)) return { key: "partial", label: "PARTIALLY PAID", tone: "payment" };
    if (["required", "awaiting_payment", "unpaid"].includes(value)) return { key: "awaiting", label: "UNPAID", tone: "overdue" };
    if (paidAmount > 0 && dueAmount > paidAmount) return { key: "partial", label: "PARTIALLY PAID", tone: "payment" };
    return { key: "awaiting", label: "UNPAID", tone: "queued" };
  }

  function orderPaymentSummary(item) {
    const total = amount(item.quotedAmount);
    const dueAmount = amount(item.amountDue || item.quotedAmount);
    const selected = amount(item.paymentSelectedAmount);
    const paid = amount(item.paymentVerifiedAmount || item.paymentConfirmedAmount);
    const balance = Math.max(total - paid, 0);
    const payment = paymentState(item);
    return detailSection("Payment", [["Payment State", payment.label], ["Payment Method", paymentMethodLabel(item.paymentMethod)], ["Payment Type", paymentTypeLabel(item.paymentType)], ["Selected Amount", selected ? money(selected) : "Not selected"], ["Reference", item.paymentReference || "Not set"], ["Customer Note", item.paymentCustomerNote || "Not set"], ["Quote Total", money(total)], ["Amount Due", money(dueAmount)], ["Amount Verified", money(paid)], ["Balance", money(balance)], ["Verified At", dateTime(item.paymentVerifiedAt || item.paymentConfirmedAt)]]);
  }
  function productionDisplay(item) {
    const stage = productionStage(item);
    const block = blockedReason(item);
    if (block && stage === "queued") return { key: "blocked", label: "BLOCKED", tone: "overdue", detail: block };
    if (stage === "queued") return { key: stage, label: readyForProduction(item) ? "READY" : "NOT RELEASED", tone: readyForProduction(item) ? "ready" : "queued" };
    if (stage === "qc") return { key: stage, label: "QC", tone: stage };
    if (stage === "ready") return { key: stage, label: fulfillment(item) === "Delivery" ? "READY FOR DELIVERY" : "READY FOR PICKUP", tone: "ready" };
    if (stage === "completed") return { key: stage, label: "COMPLETED", tone: "completed" };
    return { key: stage, label: stage === "screen_printing" ? "SCREEN PRINTING" : stage === "embroidery" ? "EMBROIDERY" : "IN PRODUCTION", tone: stage };
  }

  function orderOwner(item) {
    return item.orderOwner || item.assignedStaff || item.assigned || "Unassigned";
  }

  function isOrderClosed(item) {
    const status = key(item.status);
    return productionStage(item) === "completed" || ["lost", "cancelled", "canceled"].includes(status);
  }

  function orderActionRequired(item) {
    if (isOrderClosed(item)) return false;
    const dueState = due(item);
    return Boolean(blockedReason(item) || dueState.key === "today" || dueState.key === "overdue" || orderArtworkKey(item) !== "approved");
  }

  function readyForProduction(item) {
    return Boolean(productionStage(item) === "queued" && product(item) && product(item) !== "Not set" && item.service && item.qty && item.dueDate && orderArtworkKey(item) === "approved" && !["Unassigned", "Not Yet Assigned"].includes(assigned(item)) && !blockedReason(item));
  }

  function readinessCell(readiness) {
    return `<span class="mvp-readiness-cell" title="${html(readiness.summary)}"><strong>${html(readiness.artwork)}</strong><small>${html(readiness.fulfillment)}</small></span>`;
  }

  function productionCell(production) {
    return `<span class="mvp-production-state"><b>${html(production.label)}</b>${production.detail ? `<small>${html(production.detail)}</small>` : ""}</span>`;
  }

  function jobReference(item) {
    return orderReference(item);
  }

  function productionMethod(item) {
    return serviceDisplay(item) === "-" ? "Not set" : serviceDisplay(item);
  }

  function productionMethods(items) {
    return [...new Set(items.map(productionMethod).filter((value) => value && value !== "Not set"))].sort();
  }

  function quantityDisplay(item) {
    return item.sizeBreakdown || item.qty || "-";
  }

  function productionBlocker(item) {
    return item.blockedReason || "";
  }

  function productionFooterAction(item, next, fieldsReady, gate) {
    const stage = productionStage(item);
    const disabled = !fieldsReady || gate.length || !next;
    const label = !next ? "Completed" : stage === "qc" ? "MARK READY" : stage === "ready" ? "MARK COMPLETED" : `MOVE TO ${stageLabel(next).toUpperCase()}`;
    return `<section class="mvp-production-action"><span>NOW: ${html(stageLabel(stage))}</span><strong>${next ? `NEXT: ${html(stageLabel(next))}` : "PRODUCTION COMPLETE"}</strong>${next ? `<button type="button" data-mvp-advance="${html(item.id)}" data-mvp-next="${next}" ${disabled ? "disabled" : ""}>${label}</button>` : `<button type="button" disabled>Completed</button>`}${gate.length ? `<small>Resolve before advancing: ${html(gate.join(", "))}</small>` : ""}</section>`;
  }
  function dueShortLabel(dueState, item) {
    if (dueState.key === "overdue") return "OVERDUE";
    if (dueState.key === "today") return "TODAY";
    if (dueState.key === "completed") return "COMPLETED";
    if (!item.dueDate) return "NO DATE";
    const date = new Date(`${item.dueDate}T00:00:00`);
    return Number.isNaN(date.getTime()) ? "NO DATE" : date.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
  }
  function renderProduction({ items, notices = "", schemaNotice = "" }) {
    const orders = items.filter(confirmed);
    const productionJobs = orders.filter(isReleasedToProduction);
    const stageQuery = query("stage");
    const dueQuery = query("due");
    const staffQuery = query("staff");
    const methodQuery = query("method");
    const blockerQuery = query("blocker");
    const search = state.production.search.toLowerCase();
    const rows = productionJobs.filter((item) => {
      const stage = productionStage(item);
      const blocker = productionBlocker(item);
      const method = productionMethod(item);
      const dueState = due(item);
      if (stageQuery === "in_progress" && !ACTIVE_STAGES.includes(stage)) return false;
      if (stageQuery && stageQuery !== "in_progress" && stage !== stageQuery) return false;
      if (dueQuery && dueState.key !== dueQuery) return false;
      if (staffQuery && assigned(item) !== staffQuery) return false;
      if (methodQuery && method !== methodQuery) return false;
      if (blockerQuery === "blocked" && !blocker) return false;
      if (blockerQuery === "clear" && blocker) return false;
      if (state.production.stage === "in_progress" && !ACTIVE_STAGES.includes(stage)) return false;
      if (state.production.stage !== "all" && state.production.stage !== "in_progress" && stage !== state.production.stage) return false;
      if (state.production.staff !== "all" && (item.assignedUserId || "") !== state.production.staff) return false;
      if (state.production.method !== "all" && method !== state.production.method) return false;
      if (state.production.due !== "all" && dueState.key !== state.production.due) return false;
      if (state.production.blocker === "blocked" && !blocker) return false;
      if (state.production.blocker === "clear" && blocker) return false;
      return !search || [jobReference(item), orderReference(item), sourceInquiryReference(item), item.customer, method, itemDisplay(item), product(item), assigned(item)].join(" ").toLowerCase().includes(search);
    });
    const selectedId = state.productionId || query("order");
    const selected = productionJobs.find((item) => item.id === selectedId) || orders.find((item) => item.id === selectedId);
    const activeJobs = productionJobs.filter((item) => !isOrderClosed(item));
    const counts = {
      active: activeJobs.length,
      unassigned: activeJobs.filter((item) => ["Not Yet Assigned", "Unassigned"].includes(assigned(item))).length,
      today: productionJobs.filter((item) => productionStage(item) !== "completed" && due(item).key === "today").length,
      overdue: productionJobs.filter((item) => productionStage(item) !== "completed" && due(item).key === "overdue").length,
      blocked: productionJobs.filter((item) => productionBlocker(item)).length,
      ready: productionJobs.filter((item) => productionStage(item) === "ready").length,
      completed: productionJobs.filter((item) => productionStage(item) === "completed").length,
    };
    return `<main class="mvp-page ops-board-page mvp-production-page">${pageTitle("Production", "PRODUCTION", `${rows.length} shown / ${productionJobs.length} total`)}${notices}${schemaNotice}
      <div class="mvp-metrics production">${metric("ACTIVE JOBS", counts.active, "/production", "Released")}${metric("UNASSIGNED", counts.unassigned, "/production?staff=Not%20Yet%20Assigned", "Needs staff", "warning")}${metric("DUE TODAY", counts.today, "/production?due=today", "Today", "lime")}${metric("OVERDUE", counts.overdue, "/production?due=overdue", "Past due", "danger")}${metric("BLOCKED", counts.blocked, "/production?blocker=blocked", "Has blocker", "warning")}${metric("READY", counts.ready, "/production?stage=ready", "Fulfillment")}${metric("COMPLETED", counts.completed, "/production?stage=completed", "Closed")}</div>
      ${productionStageTabs(productionJobs, stageQuery)}${filterBar("production", productionJobs, ["staff", "method", "due", "blocker"])}${productionTable(rows, productionJobs.length)}${productionCards(rows, productionJobs.length)}${productionDrawer(selected)}
    </main>`;
  }


  function productionStageTabs(items, stageQuery = "") {
    const active = stageQuery || state.production.stage;
    const tabs = [
      ["all", "All", items.length],
      ["queued", "Queue", items.filter((item) => productionStage(item) === "queued").length],
      ["in_progress", "In Progress", items.filter((item) => ACTIVE_STAGES.includes(productionStage(item))).length],
      ["qc", "Quality Check", items.filter((item) => productionStage(item) === "qc").length],
      ["ready", "Ready", items.filter((item) => productionStage(item) === "ready").length],
      ["completed", "Completed", items.filter((item) => productionStage(item) === "completed").length],
    ];
    return `<nav class="mvp-production-stage-tabs" aria-label="Production status filters">${tabs.map(([value, label, count]) => `<button type="button" data-mvp-production-stage="${html(value)}" class="${active === value || (!active && value === "all") ? "active" : ""}"><span>${html(label)}</span><strong>${count}</strong></button>`).join("")}</nav>`;
  }
  function productionTable(items, totalJobs = 0) {
    if (!items.length) return productionEmptyTable(totalJobs);
    return table("production", ["Order / Job", "Customer", "Service / Item", "Quantity", "Assigned To", "Production Stage", "Due Date", "Blocked / Attention"], items.map((item) => {
      const stage = productionStage(item);
      const blocker = productionBlocker(item);
      const dueState = due(item);
      return row("production", item.id, [
        productionReferenceCell(item),
        productionCustomerCell(item),
        productionItemCell(item),
        cell(quantityDisplay(item)),
        cell(assigned(item) === "Not Yet Assigned" ? "Unassigned" : assigned(item)),
        status(stageLabel(stage), stage),
        `<span class="mvp-due ${dueState.key}" title="${html(dueState.label)}">${html(dueShortLabel(dueState, item))}</span>`,
        productionAttentionCell(blocker),
      ]);
    }), "No production jobs found.");
  }

  function productionCards(items, totalJobs = 0) {
    return `<section class="mvp-production-card-list">${items.length ? items.map(productionMobileCard).join("") : empty("No production jobs found.")}</section>`;
  }

  function productionEmptyTable(totalJobs) {
    return `<section class="mvp-table-wrap"><div class="mvp-table production" role="table"><div class="mvp-table-head" role="row">${["Order / Job", "Customer", "Service / Item", "Quantity", "Assigned To", "Production Stage", "Due Date", "Blocked / Attention"].map((header) => `<span role="columnheader">${header}</span>`).join("")}</div><div role="rowgroup"><p class="mvp-empty">No production jobs found.</p></div></div></section>`;
  }

  function productionMobileCard(item) {
    const stage = productionStage(item);
    const dueState = due(item);
    const blocker = productionBlocker(item);
    return `<article class="mvp-production-mobile-card" data-mvp-open="production" data-mvp-id="${html(item.id)}" role="button" tabindex="0"><div class="mvp-production-mobile-header"><div><strong>${html(item.customer || "Unnamed customer")}</strong><small>${html(jobReference(item))}</small></div><b class="mvp-mobile-open">OPEN</b></div><div class="mvp-production-mobile-job"><strong>${html(itemDisplay(item))}</strong><span>${html([productionMethod(item), quantityDisplay(item)].filter(Boolean).join(" / "))}</span></div><div class="mvp-production-mobile-statuses">${status(stageLabel(stage), stage)}<span class="mvp-due ${dueState.key}">${html(dueShortLabel(dueState, item))}</span></div><div class="mvp-production-mobile-ops"><span>Assigned: ${html(assigned(item) === "Not Yet Assigned" ? "Unassigned" : assigned(item))}</span>${blocker ? `<span class="mvp-mobile-blocker">Blocked: ${html(blocker)}</span>` : ""}</div></article>`;
  }

  function productionReferenceCell(item) {
    const orderRef = orderReference(item);
    const jobRef = jobReference(item);
    return `<span class="mvp-production-ref-cell"><strong>${html(jobRef)}</strong>${orderRef !== jobRef ? `<small>${html(orderRef)}</small>` : ""}</span>`;
  }

  function productionCustomerCell(item) {
    const contact = String(item.contact || "").trim();
    return `<span class="mvp-production-customer-cell"><strong>${html(item.customer || "Unnamed customer")}</strong>${contact ? `<small>${html(contact)}</small>` : ""}</span>`;
  }

  function productionItemCell(item) {
    const method = productionMethod(item);
    return `<span class="mvp-production-item-cell"><strong>${html(itemDisplay(item))}</strong>${method && method !== "Not set" ? `<small>${html(method)}</small>` : ""}</span>`;
  }

  function productionAttentionCell(blocker) {
    return `<span class="mvp-blocker-cell" title="${html(blocker || "Not blocked")}">${blocker ? `<b>BLOCKED</b><small>${html(blocker)}</small>` : "Clear"}</span>`;
  }

  function productionDrawer(item) {
    if (!item) return "";
    const released = isReleasedToProduction(item);
    const stage = productionStage(item);
    const next = released ? nextStage(item) : "";
    const gate = released ? productionAdvanceGate(item) : [];
    const fieldsReady = !item.requiresProductionMigration;
    const editorLocked = !released || ["ready", "completed"].includes(stage);
    const editorEnabled = fieldsReady && !editorLocked;
    const assignmentHelp = assignmentNotice();
    const assignmentDisabled = assignmentControlsDisabled();
    const blocker = productionBlocker(item);
    const footer = released ? productionFooterAction(item, next, fieldsReady, gate) : `<section class="mvp-production-action"><span>Not released to Production</span><strong>Return to Orders</strong><button class="mvp-secondary-action" type="button" data-mvp-route="/orders?order=${encodeURIComponent(item.id)}">Open Order</button></section>`;
    return drawer("production", item, released ? stageLabel(stage) : "Not released", `
      ${detailSection("Job", [["Job Reference", jobReference(item)], ["Item", itemDisplay(item)], ["Method", productionMethod(item)], ["Quantity", quantityDisplay(item)], ["Due Date", dueShortLabel(due(item), item)], ["Order Reference", orderReference(item) === jobReference(item) ? "Same as job" : orderReference(item)], ["Current Production Status", released ? stageLabel(stage) : "Not released"]])}
      <section class="mvp-drawer-section"><h3>Production</h3>${released ? "" : `<p class="mvp-inline-note">This confirmed order has not passed the current release requirements and is read-only here.</p>`}${fieldsReady ? "" : `<p class="mvp-inline-error">DATABASE FIELDS NOT READY. Apply the pending migration before saving.</p>`}${editorLocked && released ? `<p class="mvp-inline-note">${stage === "ready" ? "READY IS OPEN FOR FULFILLMENT. PRODUCTION DETAILS ARE LOCKED." : stage === "completed" ? "COMPLETED PRODUCTION DETAILS ARE LOCKED." : "PRODUCTION DETAILS ARE READ ONLY."}</p>` : ""}<div class="mvp-production-editor">
        <label><span>Assigned Staff</span><select data-mvp-production-staff="${html(item.id)}" ${editorEnabled && !assignmentDisabled ? "" : "disabled"}>${assignmentSelectOptions(item.assignedUserId, item.assignedStaff || item.assigned, "Unassigned")}</select>${assignmentHelp}</label>
        <label><span>Current Stage</span><strong>${stageLabel(stage)}</strong></label>
        <label><span>Next Stage</span><strong>${next ? stageLabel(next) : stage === "completed" ? "Completed" : released ? "None" : "Not available"}</strong></label>
        <label><span>Production Blocker</span><select data-mvp-production-blocked="${html(item.id)}" ${editorEnabled ? "" : "disabled"}><option value="">Not blocked</option>${["No artwork", "Awaiting customer artwork approval", "Materials unavailable"].map((reason) => `<option ${item.blockedReason === reason ? "selected" : ""}>${reason}</option>`).join("")}</select></label><label class="wide"><span>Internal Production Note</span><textarea data-mvp-production-note="${html(item.id)}" ${editorEnabled ? "" : "disabled"}>${html(item.productionNote || "")}</textarea></label>
      </div><button class="mvp-secondary-action" type="button" data-mvp-save-production="${html(item.id)}" ${editorEnabled ? "" : "disabled"}>Save Assignment &amp; Note</button>${blocker ? `<p class="mvp-blocked">BLOCKER: ${html(blocker)}</p>` : ""}</section>
      ${detailSection("Release Context", [["Artwork Status", artworkLabel(item)], ["Artwork Approval", item.artworkApprovedAt ? dateTime(item.artworkApprovedAt) : "Not approved"], ["Payment Status", paymentState(item).label], ["Historical SO", item.odooSO || "Not set"], ["Source Order", orderReference(item)], ["Released", released ? dateTime(item.productionUpdatedAt || item.updatedAt) : "Not released"]])}
      ${detailSection("Fulfillment", [["Method", fulfillment(item)], ["Customer Tracking", stage === "ready" || tracking(item) !== "Not set" ? tracking(item) : "Not set"], ["Readiness", stage === "ready" ? productionDisplay(item).label : "Not ready"]])}
    `, footer);
  }
  function nextStage(item) {
    const stage = productionStage(item);
    if (stage === "queued") return stationFor(item);
    if (["printing", "embroidery", "screen_printing"].includes(stage)) return "qc";
    if (stage === "qc") return "ready";
    if (stage === "ready") return "completed";
    return "";
  }

  function productionAdvanceGate(item) {
    const blocker = productionBlocker(item);
    if (blocker) return [blocker];
    return productionStage(item) === "queued" ? productionGate(item) : [];
  }

  function productionGate(item) {
    const missing = [];
    if (!product(item) || product(item) === "Not set") missing.push("product");
    if (!item.service || !item.qty) missing.push("service and quantity");
    if (!item.dueDate) missing.push("due date");
    if (artworkLabel(item) !== "Artwork Approved") missing.push("artwork approval");
    if (["Not Yet Assigned", "Unassigned"].includes(assigned(item))) missing.push("assigned staff");
    if (item.blockedReason && !missing.length) missing.push(item.blockedReason);
    return missing;
  }

  function bind({ root = document, rerender, navigate, copy, saveProduction, saveInquiryFollowUp, saveInquiryFollowUpEvent }) {
    root.querySelectorAll("[data-mvp-route]").forEach((button) => button.addEventListener("click", () => { navigate(button.dataset.mvpRoute); rerender(); }));
    root.querySelectorAll("[data-mvp-stage]").forEach((button) => button.addEventListener("click", () => { state.inquiry.stage = button.dataset.mvpStage; clearQuery(); rerender(); }));
    root.querySelectorAll("[data-mvp-production-stage]").forEach((button) => button.addEventListener("click", () => { state.production.stage = button.dataset.mvpProductionStage; clearQuery(); rerender(); }));
    root.querySelectorAll("[data-mvp-filter]").forEach((field) => {
      const [scope, name] = field.dataset.mvpFilter.split(":");
      field.addEventListener(field.type === "search" ? "input" : "change", () => { state[scope][name] = field.value; clearQuery(); rerender(); if (field.type === "search") focusAtEnd(field.dataset.mvpFilter); });
    });
    root.querySelectorAll("[data-mvp-open]").forEach((element) => {
      const open = () => { state.returnFocus = { type: element.dataset.mvpOpen, id: element.dataset.mvpId }; state[`${element.dataset.mvpOpen}Id`] = element.dataset.mvpId; if (element.dataset.mvpOpen === "inquiry") { state.inquiryTab = "details"; state.inquiryActionId = null; state.inquiryMoreOpen = false; state.inquiryFollowUpRecordId = null; } rerender(); requestAnimationFrame(() => root.querySelector(".mvp-drawer [data-mvp-close]")?.focus()); };
      element.addEventListener("click", (event) => { if (event.target.closest("[data-mvp-copy]")) return; event.stopPropagation(); open(); });
      element.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); open(); } });
    });
    root.querySelectorAll("[data-mvp-close]").forEach((button) => button.addEventListener("click", () => { const restore = state.returnFocus; state.inquiryId = null; state.orderId = null; state.productionId = null; state.returnFocus = null; clearQuery(); rerender(); requestAnimationFrame(() => { if (restore) root.querySelector(`[data-mvp-open="${restore.type}"][data-mvp-id="${CSS.escape(restore.id)}"]`)?.focus(); }); }));
    root.querySelectorAll("[data-mvp-copy]").forEach((button) => button.addEventListener("click", async (event) => { event.stopPropagation(); await copy(button.dataset.mvpCopy); button.dataset.copied = "true"; const label = button.querySelector("small"); if (label) label.textContent = "Copied"; window.setTimeout(() => { button.dataset.copied = "false"; const nextLabel = button.querySelector("small"); if (nextLabel) nextLabel.textContent = "Copy"; }, 1300); }));
    root.querySelectorAll("[data-mvp-inquiry-tab]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      const tab = button.dataset.mvpInquiryTab;
      if (!["details", "request", "notes", "history"].includes(tab)) return;
      state.inquiryTab = tab;
      state.inquiryMoreOpen = false;
      const drawer = button.closest(".mvp-drawer");
      const shell = button.closest(".mvp-inquiry-locked-shell") || drawer?.querySelector(".mvp-inquiry-locked-shell");
      drawer?.querySelector(".mvp-more-menu")?.remove();
      shell?.querySelectorAll("[data-mvp-inquiry-tab]").forEach((tabButton) => tabButton.classList.toggle("active", tabButton.dataset.mvpInquiryTab === tab));
      shell?.querySelectorAll("[data-mvp-inquiry-panel]").forEach((panel) => { panel.hidden = panel.dataset.mvpInquiryPanel !== tab; });
    }));
    root.querySelectorAll("[data-mvp-primary-action]").forEach((button) => button.addEventListener("click", (event) => { event.stopPropagation(); if (button.disabled) return; state.inquiryActionId = state.inquiryActionId === button.dataset.mvpPrimaryAction ? null : button.dataset.mvpPrimaryAction; state.inquiryMoreOpen = false; rerender(); }));
    root.querySelectorAll("[data-mvp-more-toggle]").forEach((button) => button.addEventListener("click", (event) => { event.stopPropagation(); state.inquiryMoreOpen = !state.inquiryMoreOpen; rerender(); }));
    root.querySelectorAll("[data-mvp-open-messenger]").forEach((button) => button.addEventListener("click", (event) => { event.stopPropagation(); window.open("https://www.messenger.com/", "_blank", "noopener,noreferrer"); }));
    root.querySelectorAll("[data-mvp-contact-url]").forEach((button) => button.addEventListener("click", (event) => { event.stopPropagation(); window.open(button.dataset.mvpContactUrl, "_blank", "noopener,noreferrer"); }));
    root.querySelectorAll('[data-mvp-note-toggle]').forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); const wrap = button.closest('.mvp-note-wrap'); const expanded = wrap?.classList.toggle('expanded'); button.textContent = expanded ? 'SHOW LESS' : 'SHOW FULL NOTE'; }));
    root.querySelectorAll('[data-mvp-follow-preset]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      const id = button.dataset.mvpFollowPreset;
      const input = root.querySelector(`[data-mvp-follow-date-input="${CSS.escape(id)}"]`);
      const days = Number(button.dataset.mvpFollowDays || 0);
      const date = new Date();
      date.setDate(date.getDate() + (Number.isFinite(days) ? days : 0));
      if (input) input.value = date.toISOString().slice(0, 10);
    }));
    root.querySelectorAll('[data-mvp-save-follow]').forEach((button) => button.addEventListener('click', async () => {
      if (button.disabled) return;
      const id = button.dataset.mvpSaveFollow;
      const ownerValue = root.querySelector(`[data-mvp-inquiry-owner="${CSS.escape(id)}"]`)?.value || "";
      const followUpDate = root.querySelector(`[data-mvp-follow-date-input="${CSS.escape(id)}"]`)?.value || null;
      button.disabled = true;
      button.textContent = 'Saving...';
      await saveInquiryFollowUp?.(id, { ownerUserId: ownerValue === "__legacy__" ? undefined : ownerValue || null, followUpDate });
      rerender();
    }));
    root.querySelectorAll('[data-mvp-clear-follow]').forEach((button) => button.addEventListener('click', async () => {
      if (button.disabled) return;
      const id = button.dataset.mvpClearFollow;
      const ownerValue = root.querySelector(`[data-mvp-inquiry-owner="${CSS.escape(id)}"]`)?.value || "";
      button.disabled = true;
      button.textContent = 'Clearing...';
      await saveInquiryFollowUp?.(id, { ownerUserId: ownerValue === "__legacy__" ? undefined : ownerValue || null, followUpDate: null });
      rerender();
    }));
    root.querySelectorAll('[data-mvp-open-follow-record]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      const id = button.dataset.mvpOpenFollowRecord;
      state.inquiryFollowUpRecordId = state.inquiryFollowUpRecordId === id ? null : id;
      rerender();
    }));
    root.querySelectorAll('[data-mvp-record-follow]').forEach((button) => button.addEventListener('click', async () => {
      if (button.disabled) return;
      const id = button.dataset.mvpRecordFollow;
      const outcome = root.querySelector(`[data-mvp-follow-outcome="${CSS.escape(id)}"]`)?.value || '';
      const note = root.querySelector(`[data-mvp-follow-note="${CSS.escape(id)}"]`)?.value.trim() || '';
      const nextFollowUpDate = root.querySelector(`[data-mvp-follow-reschedule="${CSS.escape(id)}"]`)?.value || null;
      const message = root.querySelector(`[data-mvp-follow-message="${CSS.escape(id)}"]`);
      const requiresDate = ["no_response", "customer_considering"].includes(outcome);
      if (!outcome) { if (message) message.textContent = 'Select a follow-up result.'; return; }
      if (!note) { if (message) message.textContent = 'Add a staff-only follow-up note before saving.'; return; }
      if (requiresDate && !nextFollowUpDate) { if (message) message.textContent = 'Choose a new follow-up date for this result.'; return; }
      button.disabled = true;
      button.textContent = 'Saving...';
      try {
        await saveInquiryFollowUpEvent?.(id, { outcome, note, nextFollowUpDate });
        state.inquiryFollowUpRecordId = null;
        rerender();
      } catch (error) {
        if (message) message.textContent = error.message || 'Unable to save follow-up update.';
        button.disabled = false;
        button.textContent = 'SAVE FOLLOW-UP UPDATE';
      }
    }));
    root.querySelectorAll("[data-mvp-save-production]").forEach((button) => button.addEventListener("click", async () => {
      if (button.disabled) return;
      const id = button.dataset.mvpSaveProduction;
      const staff = root.querySelector(`[data-mvp-production-staff="${CSS.escape(id)}"]`)?.value || null;
      const note = root.querySelector(`[data-mvp-production-note="${CSS.escape(id)}"]`)?.value.trim() || null;
      const blocked = root.querySelector(`[data-mvp-production-blocked="${CSS.escape(id)}"]`)?.value || null;
      button.disabled = true; button.textContent = "Saving...";
      await saveProduction(id, { assignedUserId: staff === "__legacy__" ? null : staff, productionNote: note, blockedReason: blocked });
      rerender();
    }));
    root.querySelectorAll("[data-mvp-advance]").forEach((button) => button.addEventListener("click", async () => {
      if (button.disabled) return;
      const id = button.dataset.mvpAdvance;
      const staff = root.querySelector(`[data-mvp-production-staff="${CSS.escape(id)}"]`)?.value || null;
      const note = root.querySelector(`[data-mvp-production-note="${CSS.escape(id)}"]`)?.value.trim() || null;
      const blocked = root.querySelector(`[data-mvp-production-blocked="${CSS.escape(id)}"]`)?.value || null;
      button.disabled = true; button.textContent = "Saving...";
      await saveProduction(id, { productionStage: button.dataset.mvpNext, assignedUserId: staff === "__legacy__" ? null : staff, productionNote: note, blockedReason: blocked });
      rerender();
    }));
  }
  function filterBar(scope, items, fields) {
    const values = state[scope];
    const services = [...new Set(items.map((item) => item.service).filter(Boolean))].sort();
    const people = assignmentFilterOptions();
    const placeholder = scope === "inquiry" ? "Search inquiries by code, customer, or product..." : scope === "order" ? "Search order, customer, or reference..." : scope === "production" ? "Search order, customer, service, or assignee" : "Search code, customer, product...";
    const controls = [`<label class="mvp-search"><span aria-hidden="true">?</span><input type="search" data-mvp-filter="${scope}:search" value="${html(values.search)}" placeholder="${html(placeholder)}" /></label>`];
    if (fields.includes("owner")) controls.push(select(scope, "owner", "All Owners", people, values.owner, true));
    if (fields.includes("staff")) controls.push(select(scope, "staff", "All Staff", people, values.staff, true));
    if (fields.includes("method")) controls.push(select(scope, "method", "All Methods", productionMethods(items), values.method));
    if (fields.includes("service")) controls.push(select(scope, "service", "All Services", services, values.service));
    if (fields.includes("stage")) controls.push(select(scope, "stage", "All Stages", PRODUCTION_STAGES, values.stage));
    if (fields.includes("production")) controls.push(select(scope, "production", "All Production", PRODUCTION_STAGES, values.production));
    if (fields.includes("artwork")) controls.push(select(scope, "artwork", "All Artwork", [["approved", "Art approved"], ["pending", "Art pending"], ["revision", "Revision needed"], ["not_set", "Not set"]], values.artwork));
    if (fields.includes("payment")) controls.push(select(scope, "payment", "All Payments", scope === "order" ? ["NOT SET", "UNPAID", "FOR VERIFICATION", "PARTIAL", "50% DP", "PAID"] : ["Not Yet Requested", "Payment Required", "Pay at Shop", "Correction Required", "For Verification", "Down Payment Confirmed", "Paid"], values.payment));
    if (fields.includes("fulfillment")) controls.push(select(scope, "fulfillment", "All Fulfillment", [["pickup", "Pickup"], ["delivery", "Delivery"]], values.fulfillment));
    if (fields.includes("blocker")) controls.push(select(scope, "blocker", "All Blockers", [["blocked", "Blocked"], ["clear", "Not blocked"]], values.blocker));
    if (fields.includes("due")) controls.push(select(scope, "due", scope === "inquiry" ? "All Follow-up" : "All Dates", [["overdue", "Overdue"], ["today", "Due today"], ["week", "This week"]], values.due));
    return `<section class="mvp-filter-bar">${controls.join("")}</section>`;
  }

  function select(scope, name, allLabel, options, value, includeUnassigned = false) {
    const rows = options.map((option) => Array.isArray(option) ? option : [option, option]);
    if (includeUnassigned) rows.push([scope === "production" ? "Not Yet Assigned" : "Unassigned", "Unassigned"]);
    return `<select data-mvp-filter="${scope}:${name}"><option value="all">${allLabel}</option>${rows.map(([keyValue, label]) => `<option value="${html(keyValue)}" ${value === keyValue ? "selected" : ""}>${html(label)}</option>`).join("")}</select>`;
  }

  function table(type, headers, rows, emptyLabel) {
    return `<section class="mvp-table-wrap"><div class="mvp-table ${type}" role="table"><div class="mvp-table-head" role="row">${headers.map((header) => `<span role="columnheader">${header}</span>`).join("")}</div><div role="rowgroup">${rows.length ? rows.join("") : empty(emptyLabel)}</div></div></section>`;
  }

  function row(type, id, cells) {
    return `<div class="mvp-table-row" data-mvp-open="${type}" data-mvp-id="${html(id)}" role="row" tabindex="0">${cells.join("")}</div>`;
  }

  function drawer(type, item, statusLabel, body, footer = "") {
    const drawerCode = type === "order" ? orderReference(item) : type === "production" ? jobReference(item) : item.id;
    if (String(type).includes("locked")) return `<button class="mvp-drawer-backdrop" data-mvp-close type="button" aria-label="Close details"></button><aside class="mvp-drawer ${type}" aria-label="${type} details"><button class="mvp-locked-close" type="button" data-mvp-close aria-label="Close details">X</button><div class="mvp-drawer-body">${body}</div><footer class="mvp-drawer-footer">${footer}</footer></aside>`;
    return `<button class="mvp-drawer-backdrop" data-mvp-close type="button" aria-label="Close details"></button><aside class="mvp-drawer ${type}" aria-label="${type} details"><header><div><code>${html(drawerCode)}</code><h2>${html(item.customer || item.company || "Details")}</h2><mark>${html(statusLabel)}</mark></div><button type="button" data-mvp-close aria-label="Close details">X</button></header><div class="mvp-drawer-body">${body}</div><footer class="mvp-drawer-footer">${footer}</footer></aside>`;
  }

  function detailSection(title, rows, note = "") {
    return `<section class="mvp-drawer-section"><h3>${html(title)}</h3><div class="mvp-detail-grid">${rows.map(([label, value]) => `<div><span>${html(label)}</span><strong>${html(value || "Not set")}</strong></div>`).join("")}</div>${noteBlock(note)}</section>`;
  }

  function noteBlock(note = "") {
    const text = String(note || "").trim();
    if (!text) return "";
    const canExpand = text.length > 160 || text.split(/\r?\n/).length > 3;
    return `<div class="mvp-note-wrap ${canExpand ? "is-clamped" : ""}"><p class="mvp-customer-message">${html(text)}</p>${canExpand ? `<button class="mvp-note-toggle" data-mvp-note-toggle type="button">SHOW FULL NOTE</button>` : ""}</div>`;
  }

  function pageTitle(kicker, title, meta) {
    return `<header class="mvp-page-title"><div><span>${html(kicker)}</span><h1>${html(title)}</h1></div><strong>${html(meta)}</strong></header>`;
  }

  function metricSection(title, metrics, className) {
    return `<section class="mvp-section"><div class="mvp-section-title"><h2>${title}</h2></div><div class="mvp-metrics ${className}">${metrics.join("")}</div></section>`;
  }

  function metric(label, value, route, hint = "", tone = "") {
    return `<button class="mvp-metric ${tone}" type="button" data-mvp-route="${html(route)}"><span>${html(label)}</span><strong>${value}</strong><small>${html(hint)}</small></button>`;
  }

  function snapshot(orders, production, inProgress) {
    return `<section class="mvp-section"><div class="mvp-section-title"><h2>Production Snapshot</h2><button data-mvp-route="/production" type="button">Open &rarr;</button></div><div class="mvp-snapshot"><span>Queued <b>${production.queued}</b></span><span>Blocked <b>${orders.filter((item) => blockedReason(item)).length}</b></span><span>In Progress <b>${inProgress}</b></span><span>Ready <b>${production.ready}</b></span><span>Completed <b>${production.completed}</b></span></div></section>`;
  }

  function staffWorkload(orders) {
    const rows = assignmentUsers().map((user) => ({ staff: assignmentName(user), count: orders.filter((item) => item.assignedUserId === user.userId && !["ready", "completed"].includes(productionStage(item))).length, overdue: orders.filter((item) => item.assignedUserId === user.userId && due(item).key === "overdue").length })).filter((row) => row.count || row.overdue);
    return `<section class="mvp-section"><div class="mvp-section-title"><h2>Staff Workload</h2></div><div class="mvp-workload">${rows.length ? rows.map((row) => `<span><i>${row.staff.slice(0, 2).toUpperCase()}</i><strong>${html(row.staff)}</strong><b>${row.count} active${row.overdue ? ` / ${row.overdue} overdue` : ""}</b></span>`).join("") : empty("NO STAFF ASSIGNMENTS YET")}</div></section>`;
  }

  function priority(item, reason, when, route, tone) { return { code: item.id, customer: item.customer || "Unnamed", reason, when, route, tone }; }
  function priorityRow(item) { return `<button type="button" data-mvp-route="${html(item.route)}"><code>${html(item.code)}</code><strong>${html(item.customer)}</strong><span>${html(item.reason)}</span><b class="${item.tone}">${html(item.when)}</b><i>View</i></button>`; }
  function countBy(keys, items, getter) { return Object.fromEntries(keys.map((value) => [value, items.filter((item) => getter(item) === value).length])); }
  function inquiryMobileCard(item) {
    const qty = item.qty ? `Qty ${item.qty}` : "";
    const ownerText = owner(item);
    const follow = followUpLabel(item);
    return `<article class="mvp-inquiry-mobile-card" data-mvp-open="inquiry" data-mvp-id="${html(item.id)}" role="button" tabindex="0"><div class="mvp-inquiry-mobile-header"><div><strong>${html(item.customer || "Unnamed customer")}</strong><small>${html(item.id)}</small></div>${quoteStatusBadge(item)}</div><div class="mvp-inquiry-mobile-request"><strong>${html(itemDisplay(item))}</strong><span>${html([serviceDisplay(item), qty].filter(Boolean).join(" / "))}</span></div><div class="mvp-inquiry-mobile-meta"><span>${html(follow === displayDash() ? ownerText : `Follow-up: ${follow}`)}</span><b class="mvp-mobile-open">OPEN</b></div></article>`;
  }

  function customerCell(item) {
    const phone = String(item.contact || "").trim();
    return `<span class="mvp-customer-cell"><strong>${html(item.customer || "Unnamed customer")}</strong>${phone ? `<small>${html(phone)}</small>` : ""}</span>`;
  }

  function inquirySummaryCell(item) {
    const meta = [fulfillment(item), artworkState(item), quoteAmount(item)].filter((value) => value && value !== displayDash()).join(" / ");
    return `<span class="mvp-inquiry-summary-cell"><strong>${html(itemDisplay(item))}</strong>${meta ? `<small>${html(meta)}</small>` : ""}</span>`;
  }

  function inquiryStageCount(value, inquiries) {
    if (value === "all") return inquiries.length;
    if (value === "follow_due") return inquiries.filter(isFollowUpDue).length;
    return inquiries.filter((item) => quoteStage(item) === value).length;
  }

  function quoteStatusBadge(item) {
    const statusKey = resolveQuoteDisplayStatus(item);
    const label = QUOTE_DISPLAY_STATUSES[statusKey] || QUOTE_DISPLAY_STATUSES.needs_quote;
    const className = `quote-status-badge quote-status-badge--${statusKey.replace(/_/g, "-")}`;
    return `<span class="${className}" data-quote-status="${html(statusKey)}" title="Quote status: ${html(label)}">${html(label)}</span>`;
  }

  function itemDisplay(item) {
    return normalizeItemForDisplay(cleanCustomerSuppliedLabel(product(item)), serviceDisplay(item));
  }
  function itemSourceLabel(item) {
    return /^customer-supplied\b/i.test(String(product(item) || "")) ? "Customer-owned item" : "Not set";
  }
  function itemCell(item) {
    const source = itemSourceLabel(item);
    return `<span class="mvp-item-cell" title="${html(itemDisplay(item))}"><strong>${html(itemDisplay(item))}</strong>${source === "Customer-owned item" ? "<small>OWN ITEM</small>" : ""}</span>`;
  }
  function cleanCustomerSuppliedLabel(value) {
    return String(value || "Not set").replace(/^customer-supplied\s*/i, "").trim() || "Other";
  }
  function normalizeItemForDisplay(value, service) {
    let text = String(value || "Not set").trim();
    const serviceText = String(service || "").trim();
    if (!text || text === "-") return "Not set";
    if (!serviceText || serviceText === "-") return text;

    const escapePattern = (input) => input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const aliases = serviceText === "DTF" ? ["DTF", "DTF Print", "DTF Printing"] : serviceText === "Embroidery" ? ["Embroidery"] : serviceText === "Screen Printing" ? ["Screen Printing", "Screen Print"] : [serviceText];
    for (const alias of aliases) {
      const pattern = escapePattern(alias);
      text = text
        .replace(new RegExp(`\\s*\\(${pattern}\\)\\s*$`, "i"), "")
        .replace(new RegExp(`\\s*[+/\\-]\\s*${pattern}\\s*$`, "i"), "")
        .replace(new RegExp(`\\s+${pattern}\\s*$`, "i"), "")
        .replace(new RegExp(`^${pattern}\\s*[+/\\-]\\s*`, "i"), "")
        .trim();
    }
    return text || value || "Not set";
  }
  function serviceDisplay(item) {
    const value = String(item.service || "").trim();
    const normalized = value.toLowerCase();
    if (!value || normalized.startsWith("customer-supplied")) return "-";
    if (normalized.includes("embro")) return "Embroidery";
    if (normalized.includes("screen")) return "Screen Printing";
    if (normalized.includes("dtf")) return "DTF";
    return value;
  }
  function requestCell(item) {
    const summary = `${fulfillment(item).toUpperCase()} ${String.fromCharCode(183)} ${artworkState(item)}`;
    return `<span class="mvp-request-cell" title="${html(summary)} / ${html(quoteAmount(item))}"><strong>${html(summary)}</strong><small>${html(quoteAmount(item))}</small></span>`;
  }
  function artworkState(item) {
    const status = key(item.artworkStatus);
    const artworkUrl = String(item.artworkUrl || "").trim();
    const hasSupportedLink = /^https?:\/\/(?:www\.)?(?:canva\.com|drive\.google\.com|dropbox\.com|figma\.com)\//i.test(artworkUrl);
    if (artworkUrl || hasSupportedLink || ["submitted", "under_review", "approved", "approval_required", "revision_requested"].includes(status)) return "ART READY";
    if (["send_later", "later", "art_later"].includes(status)) return "ART LATER";
    if (["none", "no_art", "no_artwork"].includes(status)) return "NO ART";
    return "NOT SET";
  }
  function quoteAmount(item) {
    const number = Number(item.quotedAmount);
    return Number.isFinite(number) && number > 0 ? peso(number) : displayDash();
  }
  function followUpLabel(item) {
    if (!item.followUpDate) return displayDash();
    const state = inquiryDue(item);
    if (state === "today") return "TODAY";
    if (state === "overdue") return "OVERDUE";
    const date = new Date(`${item.followUpDate}T00:00:00`);
    return Number.isNaN(date.getTime()) ? displayDash() : date.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
  }
  function followUpCell(item) {
    return `<span class="mvp-due ${inquiryDue(item)}" title="${html(item.followUpDate ? shortDate(item.followUpDate) : "No active follow-up")}">${html(followUpLabel(item))}</span>`;
  }
  function isFollowUpDue(item) {
    if (!item.followUpDate || confirmed(item)) return false;
    if (["approved", "lost"].includes(quoteStage(item))) return false;
    const follow = new Date(`${item.followUpDate}T00:00:00`);
    const today = new Date(`${todayIso()}T00:00:00`);
    return Number.isFinite(follow.getTime()) && follow <= today;
  }
  function inquiryFollowUpSection(item) {
    const ownerDisabled = assignmentControlsDisabled();
    const ownerHelp = assignmentNotice();
    const canRecord = canRecordFollowUp(item);
    const recordOpen = state.inquiryFollowUpRecordId === item.id;
    const context = [`Priority: ${item.priority || "Normal"}`, item.updatedAt ? `Last update: ${dateTime(item.updatedAt)}` : ""].filter(Boolean).join(" / ");
    return `<section class="mvp-follow-up-section wide"><h3>FOLLOW-UP</h3><div class="mvp-follow-up-controls">
      <label><span>Owner</span><select data-mvp-inquiry-owner="${html(item.id)}" ${ownerDisabled ? "disabled" : ""}>${assignmentSelectOptions(item.ownerUserId, item.owner || item.ownerId, "Unassigned")}</select>${ownerHelp}</label>
      <label><span>Next Follow-up</span><input data-mvp-follow-date-input="${html(item.id)}" type="date" value="${html(item.followUpDate || "")}" /></label>
      <div class="mvp-follow-presets" aria-label="Quick follow-up dates"><button type="button" data-mvp-follow-preset="${html(item.id)}" data-mvp-follow-days="0">Today</button><button type="button" data-mvp-follow-preset="${html(item.id)}" data-mvp-follow-days="1">Tomorrow</button><button type="button" data-mvp-follow-preset="${html(item.id)}" data-mvp-follow-days="3">+3 Days</button></div>
      <p class="mvp-follow-schedule-message" data-mvp-follow-schedule-message="${html(item.id)}"></p>
      <div class="mvp-follow-actions"><button class="mvp-secondary-action" type="button" data-mvp-save-follow="${html(item.id)}">SAVE FOLLOW-UP SCHEDULE</button><button class="mvp-ghost-action" type="button" data-mvp-clear-follow="${html(item.id)}">CLEAR FOLLOW-UP</button></div>
    </div>${context ? `<p class="mvp-follow-context">${html(context)}</p>` : ""}${canRecord ? `<button class="mvp-ghost-action mvp-record-follow-toggle" type="button" data-mvp-open-follow-record="${html(item.id)}">RECORD FOLLOW-UP</button>${recordOpen ? recordFollowUpBox(item) : ""}` : `<p class="mvp-inline-note">Follow-up recording is closed for lost, cancelled, or converted inquiries.</p>`}</section>`;
  }
  function recordFollowUpBox(item) {
    return `<div class="mvp-record-follow" data-mvp-follow-record-panel="${html(item.id)}"><label><span>Result</span><select data-mvp-follow-outcome="${html(item.id)}"><option value="">Select result</option><option value="no_response">No response</option><option value="customer_considering">Customer considering</option><option value="customer_replied_action_needed">Customer replied / action needed</option></select></label><label><span>Follow-up Note</span><textarea data-mvp-follow-note="${html(item.id)}" rows="3" placeholder="Example: Customer requested another day to decide."></textarea><small>Staff only - not visible to the customer.</small></label><label><span>Next Follow-up Date</span><input data-mvp-follow-reschedule="${html(item.id)}" type="date" /></label><button class="mvp-primary-action" type="button" data-mvp-record-follow="${html(item.id)}">SAVE FOLLOW-UP UPDATE</button><p class="mvp-inline-note" data-mvp-follow-message="${html(item.id)}">No response and Customer considering require a new date.</p></div>`;
  }  function copyButton(label, value, aria) { return `<button class="mvp-copy" type="button" data-mvp-copy="${html(value)}" aria-label="Copy ${html(aria)} ${html(label)}"><span>${html(label)}</span><small>Copy</small></button>`; }
  function strong(value) { return `<strong title="${html(value)}">${html(value)}</strong>`; }
  function cell(value) { return `<span title="${html(value)}">${html(value)}</span>`; }
  function status(label, tone) { return `<b class="mvp-status ${tone}" title="${html(label)}">${html(label)}</b>`; }
  function empty(label) { return `<p class="mvp-empty">${html(label)}</p>`; }
  function stationFor(item) { const value = String(item.service || "").toLowerCase(); return value.includes("embro") ? "embroidery" : value.includes("screen") ? "screen_printing" : "printing"; }
  function inquiryDue(item) { if (!item.followUpDate) return "none"; const date = new Date(`${item.followUpDate}T00:00:00`); const today = new Date(`${todayIso()}T00:00:00`); if (date < today) return "overdue"; if (+date === +today) return "today"; return "week"; }
  function canRecordFollowUp(item) {
    const status = key(item.status);
    if (["lost", "cancelled", "canceled", "won"].includes(status)) return false;
    if (confirmed(item)) return false;
    return true;
  }  function fulfillment(item) { const value = key(item.fulfillmentMethod); return value === "pickup" ? "Pickup" : value === "delivery" ? "Delivery" : "Not set"; }
  function tracking(item) { const labels = { ready_for_pickup: "Ready for Pickup", out_for_delivery: "Out for Delivery", delivered: "Delivered", completed: "Completed" }; return labels[key(item.trackingSubstatus)] || "Not set"; }
  function paymentSummary(item) { const total = amount(item.quotedAmount); const selected = amount(item.paymentSelectedAmount); const paid = amount(item.paymentVerifiedAmount || item.paymentConfirmedAmount); const balance = Math.max(total - paid, 0); return detailSection("Payment", [["Status", paymentLabel(item)], ["Method", paymentMethodLabel(item.paymentMethod)], ["Type", paymentTypeLabel(item.paymentType)], ["Selected Amount", selected ? money(selected) : "Not selected"], ["Reference", item.paymentReference || "Not set"], ["Customer Note", item.paymentCustomerNote || "Not set"], ["Total Amount", money(total)], ["Amount Verified", money(paid)], ["Balance", money(balance)]]); }
  function paymentTypeLabel(value) { const text = key(value); if (text === "down_payment") return "50% Down Payment"; if (text === "full") return "Full Payment"; if (text === "shop") return "Pay at Shop"; return "Not selected"; }
  function paymentMethodLabel(value) { const text = key(value); if (text === "online") return "Pay Online"; if (text === "cash") return "Cash at Shop"; if (text === "gcash") return "GCash"; if (text === "bank_transfer") return "Bank Transfer"; if (text === "card") return "Card"; if (text === "other") return "Other"; return "Not selected"; }
  function amount(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : 0; }
  function messageValue(message, labels) { for (const label of labels) { const match = String(message || "").match(new RegExp(`^${label}:\\s*(.+)$`, "im")); if (match?.[1]?.trim()) return match[1].trim(); } return ""; }
  function customerNotes(item) {
    const direct = String(item.notes || item.customerNotes || "").trim();
    if (direct) return direct;
    const match = String(item.message || "").match(/^Notes:\s*([\s\S]*?)(?=\nCustomer-side submitted at:\s|$)/m);
    const extracted = match?.[1]?.trim() || "";
    return extracted && extracted.toLowerCase() !== "none" ? extracted : "";
  }
  function shortDate(value) { if (!value) return "-"; const date = new Date(`${String(value).slice(0, 10)}T00:00:00`); return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  function dateTime(value) { if (!value) return "Not set"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "Not set" : date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }); }
  function money(value) { const number = Number(value); return Number.isFinite(number) ? peso(number) : "Not set"; }
  function peso(value) { const number = Number(value); return Number.isFinite(number) ? `${String.fromCharCode(8369)}${formatAmountNumber(number)}` : displayDash(); }
  function formatAmountNumber(number) { return Number.isInteger(number) ? number.toLocaleString("en-US") : number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function displayDash() { return String.fromCharCode(8212); }
  function key(value) { return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_"); }
  function todayIso() { return new Date().toISOString().slice(0, 10); }
  function clearQuery() { if (window.location.search) window.history.replaceState({}, "", window.location.pathname); }
  function focusAtEnd(filter) { requestAnimationFrame(() => { const field = document.querySelector(`[data-mvp-filter="${filter}"]`); field?.focus(); field?.setSelectionRange?.(field.value.length, field.value.length); }); }
  function html(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]); }
}
