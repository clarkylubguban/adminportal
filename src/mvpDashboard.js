const QUOTE_STAGES = {
  new: "NEW INQUIRY",
  sent: "QUOTE SENT",
  approved: "APPROVED",
  lost: "LOST",
};

const INQUIRY_QUEUES = [
  ["new", "NEW INQUIRY"],
  ["sent", "QUOTE SENT"],
  ["follow_due", "FOLLOW-UP DUE"],
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
    inquiry: { search: "", stage: "all", owner: "all", service: "all", due: "all", page: 1 },
    order: { search: "", status: "all", payment: "all", artwork: "all", due: "all", production: "all", owner: "all", page: 1, pageSize: 5 },
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

  const artworkLabel = (item) => {
    const value = key(item.artworkStatus);
    if (value === "approved") return "Artwork Approved";
    if (value === "approval_required") return "Customer Review";
    if (["submitted", "under_review", "revision_requested"].includes(value)) return "Internal Review";
    return "No Artwork";
  };

  const paymentLabel = (item) => {
    const value = key(item.paymentStatus);
    if (["confirmed", "paid", "full_payment_confirmed"].includes(value)) return "Paid";
    if (["down_payment_confirmed", "partially_paid"].includes(value)) return "Partially Paid";
    if (["proof_submitted", "under_review"].includes(value)) return "For Verification";
    if (value === "correction_required") return "Correction Required";
    if (["pay_at_shop", "payment_pending_at_shop"].includes(value)) return "Pay at Shop";
    if (["required", "awaiting_payment"].includes(value)) return "Payment Required";
    return "Not Yet Requested";
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
    if (Number(item.quotedAmount || item.amountDue) > 0 && !paymentSatisfiesProductionGate(item)) return "Payment requirement not completed";
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
  const hasAssignedStaff = (item) => Boolean(
    (item.assignedUserId && findAssignmentUser(item.assignedUserId)) ||
    activeLegacyMatch(item.assignedStaff || item.assigned)
  );
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

  function renderOverview({ items, notices = "" }) {
    const rows = Array.isArray(items) ? items : [];
    const inquiries = rows.filter((item) => !confirmed(item));
    const orders = rows.filter(confirmed);
    const pipeline = countBy(Object.keys(QUOTE_STAGES), inquiries, quoteStage);
    const productionJobs = orders.filter(isReleasedToProduction);
    const production = countBy(PRODUCTION_STAGES.map(([value]) => value), productionJobs, productionStage);
    const inProgress = ACTIVE_STAGES.reduce((sum, value) => sum + production[value], 0);
    const followUpsDue = inquiries.filter(isFollowUpDue).length;
    const awaitingPayment = orders.filter((item) => ["Payment Required", "Pay at Shop", "Correction Required"].includes(paymentLabel(item))).length;
    const paymentProofs = orders.filter((item) => paymentLabel(item) === "For Verification").length;
    const blockedOrders = orders.filter((item) => blockedReason(item)).length;
    const overdueProduction = productionJobs.filter((item) => due(item).key === "overdue").length;
    const priorities = buildPriorities(orders, inquiries);
    const bottlenecks = buildBottlenecks({ inquiries, orders, productionJobs, pipeline });

    return `<main class="mvp-page ops-board-page mvp-overview-page">
      ${pageTitle("Overview", "What needs attention today", new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }))}
      ${notices}
      ${metricSection("Attention Snapshot", [
        metric("Needs Quote", pipeline.new, "/inquiries?stage=new", "Inquiries", pipeline.new ? "warning" : ""),
        metric("Follow-up Due", followUpsDue, "/inquiries?stage=follow_due", "Inquiries", followUpsDue ? "warning" : ""),
        metric("Confirmed Orders", orders.length, "/orders", "Orders"),
        metric("Awaiting Payment", awaitingPayment, "/orders?payment=awaiting", "Orders", awaitingPayment ? "warning" : ""),
        metric("Payment Review", paymentProofs, "/orders", "Orders", paymentProofs ? "warning" : ""),
        metric("Blocked Release", blockedOrders, "/orders", "Orders", blockedOrders ? "danger" : ""),
        metric("Released Jobs", productionJobs.length, "/production", "Production"),
        metric("Overdue Jobs", overdueProduction, "/production?due=overdue", "Production", overdueProduction ? "danger" : ""),
      ], "attention")}
      <section class="mvp-overview-grid phase3">
        <div class="mvp-section mvp-priority-section"><div class="mvp-section-title"><h2>Today's Priorities</h2><span>${priorities.length}</span></div><div class="mvp-priority-list">${priorities.length ? priorities.map(priorityRow).join("") : empty("NO PRIORITIES REQUIRE ATTENTION")}</div></div>
        <div class="mvp-side-stack">
          ${bottleneckSection(bottlenecks)}
          ${moduleEntrySection({ inquiries: inquiries.length, orders: orders.length, productionJobs: productionJobs.length, inProgress })}
        </div>
      </section>
    </main>`;
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
      else if (paymentLabel(item) === "For Verification") rows.push(priority(item, "Payment proof submitted / verify payment", "Needs review", `/orders?order=${encodeURIComponent(item.id)}`, "warning"));
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
      bottleneck("Payment waiting", awaitingPayment, "Confirmed orders still need payment completion.", "/orders?payment=awaiting", awaitingPayment ? "warning" : ""),
      bottleneck("Payment proof review", paymentProofs, "Receipts or payment proof need owner review.", "/orders", paymentProofs ? "warning" : ""),
      bottleneck("Artwork attention", artworkAttention, "Artwork is missing, pending, or needs revision on open orders.", "/orders", artworkAttention ? "warning" : ""),
      bottleneck("Blocked release", blockedRelease, "Production release requirements are not fully satisfied.", "/orders", blockedRelease ? "danger" : ""),
      bottleneck("Overdue production", overdueProduction, "Released production jobs are past due.", "/production?due=overdue", overdueProduction ? "danger" : ""),
    ].filter((item) => item.count > 0).slice(0, 5);
  }

  function bottleneck(title, count, detail, route, tone = "") {
    return { title, count, detail, route, tone };
  }

  function bottleneckSection(items) {
    return `<section class="mvp-section mvp-bottleneck-section"><div class="mvp-section-title"><h2>Bottlenecks</h2><span>${items.length}</span></div><div class="mvp-bottleneck-list">${items.length ? items.map(bottleneckRow).join("") : empty("NO CURRENT BOTTLENECKS")}</div></section>`;
  }

  function bottleneckRow(item) {
    return `<button type="button" class="mvp-bottleneck-row ${html(item.tone)}" data-mvp-route="${html(item.route)}"><span><strong>${html(item.title)}</strong><small>${html(item.detail)}</small></span><b>${item.count}</b></button>`;
  }

  function moduleEntrySection(counts) {
    return `<section class="mvp-section mvp-module-entry-section"><div class="mvp-section-title"><h2>Open Next</h2></div><div class="mvp-module-links">
      ${moduleEntry("Inquiries", counts.inquiries, "Quotation and follow-up pipeline", "/inquiries")}
      ${moduleEntry("Orders", counts.orders, "Payment, artwork, and release readiness", "/orders")}
      ${moduleEntry("Production", counts.productionJobs, `${counts.inProgress} actively in production`, "/production")}
    </div></section>`;
  }

  function moduleEntry(label, count, detail, route) {
    return `<button type="button" class="mvp-module-link" data-mvp-route="${html(route)}"><span><strong>${html(label)}</strong><small>${html(detail)}</small></span><b>${count}</b></button>`;
  }
  return { state, renderOverview, renderInquiries, renderOrders, renderProduction, bind, helpers: { confirmed, productionStage, stageLabel, findOrderByIdentity, matchesOrderIdentity } };
  function renderInquiries({ items, notices = "", renderQuote, renderOdoo, renderArtwork }) {
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
    const pageSize = 5;
    const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
    const currentPage = Math.min(Math.max(Number(state.inquiry.page) || 1, 1), pageCount);
    state.inquiry.page = currentPage;
    const visibleRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    return `<main class="mvp-page ops-board-page mvp-inquiries-page">
      ${inquiryDashboardHeader(inquiries.length)}
      <p class="mvp-rule mvp-rule-hidden">NO QUOTATION / NO WORK</p>
      ${inquiryKpiStrip(inquiries, stageFilter)}
      ${filterBar("inquiry", items, ["owner", "service", "due"])}
      ${notices}
      ${inquiryTable(visibleRows, rows.length, currentPage, pageCount, pageSize)}${inquiryDrawer(selected, renderQuote, renderOdoo, renderArtwork)}
    </main>`;
  }

  function inquiryDashboardHeader(total) {
    return `<header class="mvp-inquiry-dashboard-header">
      <div class="mvp-inquiry-header-copy">
        <nav class="mvp-breadcrumbs" aria-label="Breadcrumb"><span>Home</span><i aria-hidden="true">&gt;</i><b>Inquiries</b></nav>
        <h1>Inquiry Pipeline</h1>
        <p>Track new inquiries, quotation progress, follow-ups, and approvals.</p>
      </div>
      <div class="mvp-inquiry-header-actions">
        <strong>${total} Total ${total === 1 ? "Inquiry" : "Inquiries"}</strong>
        <button class="mvp-inquiry-new-action" type="button" disabled title="New inquiry intake remains in the existing Ops intake workflow."><span aria-hidden="true">+</span> New Inquiry</button>
      </div>
    </header>`;
  }

  function inquiryKpiStrip(items, stageFilter) {
    const counts = Object.fromEntries(INQUIRY_QUEUES.map(([value]) => [value, value === "follow_due" ? items.filter(isFollowUpDue).length : items.filter((item) => quoteStage(item) === value).length]));
    const today = todayIso();
    const newToday = items.filter((item) => quoteStage(item) === "new" && String(item.createdAt || item.created_at || "").slice(0, 10) === today).length;
    const overdueFollowUps = items.filter((item) => isFollowUpDue(item) && inquiryDue(item) === "overdue").length;
    const notes = {
      new: newToday ? `+${newToday} today` : "Needs quotation",
      sent: `${counts.sent} awaiting response`,
      follow_due: overdueFollowUps ? `${overdueFollowUps} overdue` : "Due today",
      approved: "Ready for order",
      lost: "Needs review",
    };
    return `<section class="mvp-stage-cards mvp-inquiry-kpi-strip" aria-label="Inquiry KPIs">${INQUIRY_QUEUES.map(([value, label]) => `<button type="button" data-mvp-stage="${value}" class="mvp-inquiry-kpi ${stageFilter === value ? "active" : ""} ${value}"><span class="mvp-inquiry-kpi-icon" aria-hidden="true">${inquiryKpiIcon(value)}</span><span class="mvp-inquiry-kpi-copy"><small>${html(inquiryKpiLabel(label))}</small><strong>${counts[value]}</strong><em>${html(notes[value])}</em></span></button>`).join("")}</section>`;
  }

  function inquiryKpiIcon(value) {
    const icons = { new: "□", sent: "↗", follow_due: "◴", approved: "✓", lost: "×" };
    return icons[value] || "□";
  }

  function inquiryTable(items, total, currentPage, pageCount, pageSize) {
    const headers = ["Code", "Customer", "Item", "Request", "Service", "Qty", "Quote Status", "Follow-up", "Owner", "Action"];
    const desktopRows = items.map((item) => {
      const stage = quoteStage(item);
      return row("inquiry", item.id, [
        copyButton(item.id, item.id, "inquiry code"),
        customerCell(item),
        itemCell(item),
        requestCell(item),
        cell(serviceDisplay(item)),
        quantityCell(item),
        status(QUOTE_STAGES[stage], stage),
        followUpCell(item),
        cell(owner(item)),
        inquiryActionCell(item),
      ]);
    });
    const mobileCards = items.map((item) => inquiryMobileCard(item, quoteStage(item))).join("");
    return `${table("inquiry", headers, desktopRows, "NO INQUIRIES MATCH THIS FILTER", inquiryPagination(total, currentPage, pageCount, pageSize))}<section class="mvp-inquiry-card-list" aria-label="Inquiries">${mobileCards || empty("NO INQUIRIES MATCH THIS FILTER")}</section>`;
  }

  function inquiryDrawer(item, renderQuote, renderOdoo, renderArtwork) {
    if (!item) return "";
    const stage = quoteStage(item);
    const action = inquiryPrimaryAction(item, stage);
    const activeTab = ["details", "request", "quotation", "artwork", "history"].includes(state.inquiryTab) ? state.inquiryTab : stage === "approved" ? "quotation" : "details";
    const workflowPanel = state.inquiryActionId === item.id && action.kind !== "quote" && action.kind !== "create_order" ? inquiryWorkflowPanel(item, action, renderQuote, renderOdoo) : "";
    return drawer("inquiry locked", item, QUOTE_STAGES[stage], `
      <section class="mvp-inquiry-locked-shell">
        ${inquiryLockedHeader(item, stage)}
        ${inquiryTabs(activeTab)}
        ${inquiryTabPanels(item, activeTab, renderQuote, renderArtwork)}
        ${workflowPanel}
        ${inquiryMoreDetails(item)}
      </section>
    `, inquiryActionBar(item, action));
  }

  function inquiryLockedHeader(item, stage) {
    const stamp = inquiryTimestamp(item);
    return `<div class="mvp-inquiry-locked-header"><div class="mvp-inquiry-header-top"><span class="mvp-inquiry-status-pill ${stage}">${html(QUOTE_STAGES[stage])}</span></div><div class="mvp-inquiry-number-row"><h2>${html(item.id)}</h2>${copyButton("COPY", item.id, "inquiry number")}</div><strong class="mvp-inquiry-customer">${html(item.customer || "Unnamed customer")}</strong><div class="mvp-inquiry-meta"><span>${html(item.contact || "No contact")}</span><i></i><span>${html(stamp.date)}</span><i></i><span>via ${html(sourceLabel(item))}</span></div></div>`;
  }

  function inquiryCompactSummary(item, stage) {
    const follow = followUpSummary(item);
    const quote = quotationSummary(item, stage);
    return `<section class="mvp-inquiry-compact-summary" aria-label="Inquiry summary">
      ${summaryItem("Request", itemDisplay(item), serviceDisplay(item))}
      ${summaryItem("Quantity", item.sizeBreakdown || item.qty || "Not set", fulfillment(item))}
      ${summaryItem("Quote", quote.title, quote.sub)}
      ${summaryItem("Assignee", owner(item), assignmentSubtitle(item))}
      ${summaryItem("Follow-up", follow.title, follow.sub)}
    </section>`;
  }

  function summaryItem(label, title, subtitle = "") {
    return `<article class="mvp-inquiry-summary-item"><span>${html(label)}</span><b>${html(title || "Not set")}</b>${subtitle ? `<small>${html(subtitle)}</small>` : ""}</article>`;
  }

  function inquiryNextActionPanel(item, action) {
    const reason = inquiryActionReason(item, action);
    return `<section class="mvp-inquiry-next-panel"><div><span>NEXT ACTION</span><strong>${html(action.label)}</strong><small>${html(reason)}</small></div><b>${html(action.hint)}</b></section>`;
  }

  function inquiryTabs(activeTab) {
    const tabs = [["details", "Details"], ["request", "Request"], ["quotation", "Quotation"], ["artwork", "Artwork"], ["history", "History"]];
    return `<nav class="mvp-inquiry-tabs" aria-label="Inquiry drawer tabs">${tabs.map(([id, label]) => `<button type="button" data-mvp-inquiry-tab="${id}" class="${activeTab === id ? "active" : ""}" aria-selected="${activeTab === id ? "true" : "false"}">${html(label)}</button>`).join("")}</nav>`;
  }

  function inquiryTabPanels(item, activeTab, renderQuote, renderArtwork) {
    const panels = [
      ["details", inquiryDetailsTab(item)],
      ["request", inquiryRequestTab(item)],
      ["quotation", inquiryQuotationTab(item, renderQuote)],
      ["artwork", inquiryArtworkTab(item, renderArtwork)],
      ["history", inquiryHistoryTab(item)],
    ];
    return `<div class="mvp-inquiry-tab-panels">${panels.map(([id, content]) => `<section class="mvp-inquiry-tab-panel" data-mvp-inquiry-panel="${id}" ${activeTab === id ? "" : "hidden"}>${content}</section>`).join("")}</div>`;
  }

  function inquiryRequestTab(item) {
    return `<div class="mvp-inquiry-core-content"><h3>CUSTOMER REQUEST</h3><div class="mvp-inquiry-detail-list">${detailLine("Product", itemDisplay(item))}${detailLine("Print Method", serviceDisplay(item))}${detailLine("Quantity", item.sizeBreakdown || item.qty || "Not specified")}${detailLine("Fulfillment", fulfillment(item))}${detailLine("Requested date", requestDateLabel(item))}</div><section class="mvp-inquiry-note-card"><span>CUSTOMER NOTES</span><p>${html(customerNotes(item) || "No customer notes.")}</p></section>${detailLine("Reference Files", referenceFilesLabel(item))}</div>`;
  }

  function inquiryArtworkTab(item, renderArtwork) {
    return `<div class="mvp-inquiry-core-content"><h3>ARTWORK</h3>${artworkPreviewCard(item, renderArtwork)}<div class="mvp-inquiry-detail-list">${detailLine("Approval status", artworkApprovalLabel(item))}</div><section class="mvp-inquiry-note-card"><span>Designer Notes</span><p>${html(item.designerNotes || "No designer notes.")}</p></section></div>`;
  }

  function inquiryQuotationTab(item, renderQuote) {
    const quote = quotationSummary(item, quoteStage(item));
    const creatingQuote = state.inquiryActionId === item.id && inquiryPrimaryAction(item, quoteStage(item)).kind === "quote";
    if (creatingQuote) return inquiryQuotationForm(item);
    if (isNoQuoteYet(item)) return inquiryQuotationEmptyState();

    const rows = quotationRows(item);
    const subtotal = quotationSubtotal(rows);
    const quoted = amount(item.quotedAmount);
    const total = amount(item.quotedAmount);
    const hasCapturedAmount = quoted > 0 || total > 0;
    const meta = [
      item.quotePublishedAt ? `Sent ${shortDate(item.quotePublishedAt)}` : "",
      item.quoteValidUntil ? `Valid until ${shortDate(item.quoteValidUntil)}` : "",
    ].filter(Boolean).join(" · ");
    const body = hasCapturedAmount
      ? `<div class="mvp-quotation-table" role="table" aria-label="Quotation details"><div class="mvp-quotation-head" role="row"><span>Item</span><span>Qty</span><span>Unit</span><span>Amount</span></div>${rows.map((row) => `<div class="mvp-quotation-row" role="row"><div><b>${html(row.item)}</b>${row.note ? `<small>${html(row.note)}</small>` : ""}</div><span>${html(row.qty)}</span><span>${html(row.unit)}</span><span>${html(row.amount)}</span></div>`).join("")}<div class="mvp-quotation-total"><span>Subtotal</span><b>${money(subtotal || quoted || total)}</b><strong>Quoted Amount</strong><strong>${money(total || quoted || subtotal)}</strong></div></div>`
      : `<p class="mvp-quotation-legacy">This record is marked ${html(quote.title)} but its quotation amount was not captured in the stored fields. No price has been invented.</p>`;
    const actions = typeof renderQuote === "function" && quoteStage(item) !== "approved" && !hasExistingOrder(item)
      ? `<details class="mvp-quotation-actions"><summary>Allowed quotation actions</summary>${renderQuote(item)}</details>`
      : "";
    const orderState = item.orderCreationError ? `<p class="mvp-inline-error">${html(item.orderCreationError)}</p>` : "";
    return `<article class="mvp-quotation-panel"><header><div><span>Quotation</span><h3>${html(item.quoteCode || item.quoteReference || `QT-${item.id}`)}</h3>${meta ? `<p>${html(meta)}</p>` : ""}</div><mark>${html(quote.sub || quote.title)}</mark></header>${body}<div class="mvp-quotation-foot"><div><span>Customer approval</span><p>${html(quoteApprovalLabel(item))}</p></div><div><span>Order conversion</span><p>${html(nativeOrderReference(item) ? `Native Order ${nativeOrderReference(item)}` : hasExistingOrder(item) ? `Historical Order ${orderReference(item)}` : "Ready to create native TRRY Order")}</p></div></div>${item.quoteNotes ? `<p class="mvp-quotation-note">${html(item.quoteNotes)}</p>` : ""}${orderState}${actions}</article>`;
  }

  function inquiryQuotationEmptyState() {
    return `<article class="mvp-quotation-empty-state">
      <div class="mvp-quotation-empty-icon" aria-hidden="true"></div>
      <strong>No quotation yet</strong>
      <p>Create a quotation using the customer's request before sending a price.</p>
    </article>`;
  }

  function inquiryQuotationForm(item) {
    const quoted = amount(item.quotedAmount);
    const total = amount(item.amountDue || item.quotedAmount);
    const totalLabel = money(total || quoted);
    return `<article class="mvp-quotation-create-card ops-stage-section" data-mvp-quote-create="${html(item.id)}">
      <div class="ops-quote-editor mvp-quotation-create-form">
        <h3>CREATE QUOTATION</h3>
        <div class="mvp-quotation-create-grid">
          <label><span>Quoted Amount</span><input data-ops-customer-field="quotedAmount" inputmode="decimal" type="text" value="${html(item.quotedAmount ?? "")}" placeholder="0.00" /></label>
          <label><span>Valid Until</span><input data-ops-customer-field="quoteValidUntil" type="date" value="${html(item.quoteValidUntil || "")}" /></label>
          <label class="wide"><span>Quote Breakdown</span><textarea data-ops-customer-field="quoteBreakdown" rows="4" placeholder="Optional product, quantity, and pricing details">${html(item.quoteBreakdown || "")}</textarea></label>
          <label class="wide"><span>Quote Note</span><textarea data-ops-customer-field="quoteNotes" rows="4" placeholder="Add note for the customer">${html(item.quoteNotes || "")}</textarea></label>
        </div>
        <div class="mvp-quotation-total-display"><span>Quoted Total</span><strong>${html(totalLabel)}</strong></div>
        <div class="mvp-quotation-create-actions">
          <button class="mvp-action-secondary" data-ops-customer-action="save_quote_draft" data-ops-customer-id="${html(item.id)}" type="button">Save Draft</button>
          <button class="mvp-action-primary" data-ops-customer-action="publish_quote" data-ops-customer-id="${html(item.id)}" type="button"><span>Publish Quote</span></button>
        </div>
      </div>
    </article>`;
  }

  function inquiryHistoryTab(item) {
    const rows = inquiryHistory(item);
    return `<div class="mvp-inquiry-core-content"><h3>HISTORY</h3><ol class="mvp-inquiry-history">${rows.length ? rows.map((row) => `<li><strong>${html(row.title)}</strong><span>${html(row.meta)}</span></li>`).join("") : `<li><strong>No inquiry history available</strong><span>No stored events were found.</span></li>`}</ol></div>`;
  }

  function inquiryDetailsTab(item) {
    const stage = quoteStage(item);
    const follow = followUpSummary(item);
    const quote = quotationSummary(item, stage);
    return `<div class="mvp-inquiry-core-content">
      <section class="mvp-inquiry-request-summary"><span>Request</span><strong>${html(item.customer || "Unnamed customer")}</strong><p>${html(serviceDisplay(item))}</p></section>
      <section class="mvp-inquiry-figma-cards" aria-label="Inquiry summary cards">
        <article><span>Quantity</span><strong>${html(item.sizeBreakdown || item.qty || "Not set")}</strong><small>${html(fulfillment(item))}</small></article>
        <article><span>Quote</span><strong>${html(quote.title)}</strong><small>${html(quote.sub)}</small></article>
      </section>
      <h3>DETAILS</h3>
      <div class="mvp-inquiry-detail-list">${detailLine("Assignee", owner(item))}${detailLine("Follow-up", follow.title)}${detailLine("Priority", priorityLabel(item))}${detailLine("Internal note", item.internalNote || item.next || "Not set", true)}${detailLine("Last update", lastUpdateLabel(item))}</div>
    </div>`;
  }

  function customerCommunication(item) {
    const link = customerLink(item);
    const message = "We'll continue assisting you here on Messenger.\n\nIf no one has replied yet,\nyou may also check your inquiry progress using the customer link.";
    return `<section class="mvp-customer-comm"><h3>Conversation</h3><div class="mvp-comm-row"><span>Customer Link</span><div class="mvp-comm-value"><strong>${html(link)}</strong>${copyButton("Copy", link, "customer link")}</div></div><p>${html(message)}</p><div class="mvp-comm-actions"><button type="button" data-mvp-copy="${html(message)}"><span>Copy Customer Message</span></button><button type="button" data-mvp-open-messenger>Open Messenger</button></div><label class="mvp-comm-check"><input type="checkbox" /> <span>Mark message as sent</span></label></section>`;
  }

  function inquirySecondaryActions(item) {
    const link = customerLink(item);
    return [
      `<button type="button" data-mvp-copy="${html(item.id)}">Copy Inquiry Number</button>`,
      link ? `<button type="button" data-mvp-copy="${html(link)}">Copy Customer Link</button>` : "",
      `<button type="button" data-mvp-open-messenger>Open Messenger</button>`,
    ].filter(Boolean);
  }

  function inquiryActionBar(item, action) {
    const primaryHook = action.route
      ? `data-mvp-route="${html(action.route)}"`
      : action.kind === "create_order"
        ? `data-mvp-create-order="${html(item.id)}"`
        : `data-mvp-primary-action="${html(item.id)}"`;
    const secondaryActions = inquirySecondaryActions(item);
    const moreMenu = secondaryActions.length
      ? `<div class="mvp-more-wrap"><button type="button" class="mvp-action-secondary" data-mvp-more-toggle aria-expanded="false">More Actions</button><div class="mvp-more-menu" hidden>${secondaryActions.join("")}</div></div>`
      : "";
    return `<div class="mvp-inquiry-action-bar"><button type="button" class="mvp-action-primary" ${primaryHook} data-mvp-primary-kind="${html(action.kind || "")}" ${action.disabled ? "disabled" : ""}><span>${html(action.label)}</span><small>${html(action.hint)}</small></button>${moreMenu}</div>`;
  }

  function inquiryWorkflowPanel(item, action, renderQuote, renderOdoo) {
    if (action.kind === "quote" && typeof renderQuote === "function") return `<section class="mvp-workflow-panel">${renderQuote(item).replace(/<details class="ops-quote-editor"(?! open)/, '<details class="ops-quote-editor" open')}</section>`;
    if (action.kind === "so" && typeof renderOdoo === "function") return `<section class="mvp-workflow-panel">${renderOdoo(item)}</section>`;
    if (action.route) return `<section class="mvp-workflow-panel"><button class="mvp-primary-action" type="button" data-mvp-route="${html(action.route)}">${html(action.label)}</button></section>`;
    return `<section class="mvp-workflow-panel"><p>${html(action.hint)}</p></section>`;
  }

  function inquiryPrimaryAction(item, stage) {
    const nativeRef = nativeOrderReference(item) || item.nativeOrderId;
    if (nativeRef) return { kind: "order", label: "View Order", hint: "Native TRRY Order", route: `/orders?order=${encodeURIComponent(nativeRef)}` };
    if ((confirmed(item) || hasExistingOrder(item)) && productionStage(item) === "completed") return { kind: "production", label: "View Production", hint: "Read only", route: `/production?order=${encodeURIComponent(item.id)}` };
    if (confirmed(item) || hasExistingOrder(item)) return { kind: "order", label: "View Order", hint: "Historical order", route: `/orders?order=${encodeURIComponent(orderReference(item) || item.id)}` };
    if (stage === "sent") return { kind: "wait", label: "Waiting for Approval", hint: "Quote sent", disabled: true };
    if (stage === "approved") return { kind: "create_order", label: item.orderCreationState === "loading" ? "Creating Order" : "Create Order", hint: "Native TRRY Order", disabled: item.orderCreationState === "loading" };
    if (isQuoteDraft(item)) return { kind: "quote", label: "Edit Quotation", hint: "Send quote when ready" };
    if (stage === "new") return { kind: "quote", label: "Create Quotation", hint: "Next step" };
    return { kind: "quote", label: "Create Quotation", hint: "Next step" };
  }

  function inquiryActionReason(item, action) {
    if (action.disabled) return action.hint || "No action is currently available.";
    if (action.kind === "quote") return customerNotes(item) || item.next || "Prepare quote from the request details.";
    if (action.kind === "create_order") return "Customer has approved the quote; create the native TRRY Order when ready.";
    if (action.kind === "order") return "Order already exists; payment, readiness, and production release stay in the Orders workflow.";
    if (action.kind === "production") return "Converted inquiry is available in Production.";
    return item.next || action.hint || "Review the inquiry.";
  }

  function inquiryMoreDetails(item) {
    return `<details class="mvp-inquiry-more-details"><summary>More Details</summary><div class="mvp-inquiry-more-content">${customerCommunication(item)}${detailLine("Internal Status", internalStatus(item))}${detailLine("Quotation Notes", item.quoteNotes || "No quotation notes.", true)}${detailLine("Production Notes", item.productionNote || item.internalNote || "No production notes.", true)}${detailLine("Internal Communication", item.next || "Review inquiry", true)}${detailLine("Customer Message", customerNotes(item) || "No customer message provided.", true)}${internalInquirySection(item)}</div></details>`;
  }

  function detailLine(label, value, multiline = false) {
    return `<div class="mvp-inquiry-detail-line ${multiline ? "wide" : ""}"><span>${html(label)}</span><strong>${html(value || "Not set")}</strong></div>`;
  }

  function artworkPreviewLine(item, renderArtwork) {
    return `<div class="mvp-inquiry-detail-line wide"><span>Artwork Preview</span><strong>${html(artworkState(item))}</strong>${typeof renderArtwork === "function" ? renderArtwork(item) : ""}</div>`;
  }

  function artworkPreviewCard(item, renderArtwork) {
    const hasArtwork = Boolean(item.artworkUrl) || ["submitted", "under_review", "approval_required", "approved", "revision_requested"].includes(key(item.artworkStatus));
    return `<section class="mvp-inquiry-artwork-preview ${hasArtwork ? "has-artwork" : "empty"}"><strong>Artwork Preview</strong><span>${html(hasArtwork ? "Final mockup / uploaded design" : "No customer artwork file or supported URL is saved for this inquiry.")}</span>${typeof renderArtwork === "function" ? renderArtwork(item) : ""}</section>`;
  }

  function artworkApprovalLabel(item) {
    if (item.artworkApprovedAt) return `Approved ${dateTime(item.artworkApprovedAt)}`;
    const value = key(item.artworkStatus);
    if (value === "approval_required") return "Pending customer approval";
    if (value === "revision_requested") return "Revision requested";
    if (["submitted", "under_review"].includes(value)) return "Pending internal review";
    if (value === "approved") return "Approved";
    return "Pending";
  }

  function requestDateLabel(item) {
    return item.dueDate ? shortDate(item.dueDate) : "Not set";
  }

  function referenceFilesLabel(item) {
    if (item.artworkUrl) return "Artwork file saved";
    if (["submitted", "under_review", "approval_required", "approved", "revision_requested"].includes(key(item.artworkStatus))) return artworkState(item);
    return "No reference files proven";
  }

  function priorityLabel(item) {
    const value = String(item.priority || "").trim();
    return value ? value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ") : "Normal";
  }

  function lastUpdateLabel(item) {
    return item.updatedAt ? shortDate(item.updatedAt) : inquiryTimestamp(item).date;
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

  function customerInitials(item) {
    return String(item.customer || "Customer").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "C";
  }

  function ownerInitials(item) {
    const value = owner(item);
    return ["Unassigned", "Inactive user (historical)"].includes(value) ? "" : value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("");
  }

  function assignmentSubtitle(item) {
    const value = owner(item);
    if (value.includes(" - ")) return value.split(" - ").slice(1).join(" - ");
    return value === "Unassigned" ? "No owner" : "Assigned owner";
  }

  function serviceChips(item) {
    const values = serviceDisplay(item).split(/,|\+|\//).map((value) => value.trim()).filter(Boolean);
    return values.length ? values.map((value) => `<em>${html(value)}</em>`).join("") : "Not set";
  }

  function followUpSummary(item) {
    if (!item.followUpDate) return { title: "Not set", sub: "No follow-up" };
    return { title: followUpLabel(item), sub: shortDate(item.followUpDate) };
  }

  function quotationSummary(item, stage) {
    const amount = Number(item.quotedAmount) > 0 ? money(item.quotedAmount) : "Not Created";
    if (amount === "Not Created" && stage === "sent") return { title: "Legacy Quote Sent", sub: "Amount not captured" };
    if (amount === "Not Created" && stage === "approved") return { title: "Legacy Approved Quote", sub: hasExistingOrder(item) ? `Order ${orderReference(item)}` : "Amount not captured" };
    if (stage === "approved") return { title: amount, sub: "Approved" };
    if (stage === "sent") return { title: amount, sub: "Quote Sent" };
    if (item.quoteStatus === "draft" || amount !== "Not Created") return { title: amount, sub: item.quotePublishedAt ? "Quote Sent" : "Draft" };
    return { title: "Not Created", sub: "Unquoted" };
  }

  function isQuoteDraft(item) {
    const quote = key(item.quoteStatus);
    return !item.quotePublishedAt && !hasExistingOrder(item) && (quote === "draft" || amount(item.quotedAmount) > 0 || amount(item.amountDue) > 0 || Boolean(String(item.quoteBreakdown || "").trim()));
  }

  function isNoQuoteYet(item) {
    return !item.quotePublishedAt
      && !hasExistingOrder(item)
      && !["draft", "pending", "ready", "approved"].includes(key(item.quoteStatus))
      && amount(item.quotedAmount) === 0
      && amount(item.amountDue) === 0
      && !String(item.quoteBreakdown || "").trim()
      && !String(item.quoteNotes || "").trim();
  }

  function quotationRows(item) {
    const parsed = parseQuotationBreakdown(item.quoteBreakdown, item);
    if (parsed.length) return parsed;
    const total = amount(item.quotedAmount);
    if (!total) return [];
    return [{
      item: itemDisplay(item),
      note: serviceDisplay(item) !== "-" ? serviceDisplay(item) : "",
      qty: item.qty || item.sizeBreakdown || "-",
      unit: unitPriceDisplay(total, item.qty),
      amount: money(total),
      rawAmount: total,
    }];
  }

  function parseQuotationBreakdown(value, item) {
    const lines = String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return lines.map((line) => {
      const parts = line.split(/\s*(?:\||,)\s*/).filter(Boolean);
      const amountText = [...parts].reverse().find((part) => /(?:₱|PHP|amount)/i.test(part) && parseMoney(part) > 0);
      const rawAmount = amountText ? parseMoney(amountText) : 0;
      const qty = parts.find((part) => /\b\d+\s*(?:pcs?|pieces?|shirts?|sets?)\b/i.test(part)) || item.qty || "-";
      const unitText = parts.find((part) => part !== amountText && /(?:₱|PHP|unit)/i.test(part) && parseMoney(part) > 0);
      const itemText = parts.find((part) => ![amountText, unitText, qty].includes(part)) || line.replace(amountText || "", "").trim() || itemDisplay(item);
      return {
        item: itemText,
        note: parts.length > 3 ? parts.filter((part) => ![itemText, amountText, unitText, qty].includes(part)).join(" · ") : "",
        qty,
        unit: unitText ? money(parseMoney(unitText)) : unitPriceDisplay(rawAmount, qty),
        amount: rawAmount ? money(rawAmount) : "-",
        rawAmount,
      };
    });
  }

  function parseMoney(value) {
    const text = String(value || "").replace(/[^\d.-]/g, "");
    const number = Number(text);
    return Number.isFinite(number) ? number : 0;
  }

  function quotationSubtotal(rows) {
    return rows.reduce((total, row) => total + amount(row.rawAmount), 0);
  }

  function unitPriceDisplay(total, qtyValue) {
    const qty = Number(String(qtyValue || "").replace(/[^\d.]/g, ""));
    return qty > 0 && total > 0 ? money(Math.round((total / qty) * 100) / 100) : "-";
  }

  function quoteApprovalLabel(item) {
    const stage = quoteStage(item);
    if (stage === "approved") return "Approved";
    if (stage === "sent") return "Awaiting customer response";
    if (isQuoteDraft(item)) return "Draft not sent";
    return "Not requested";
  }

  function statusSubtitle(item, stage) {
    if (stage === "new") return "Unquoted";
    if (stage === "sent") return "Waiting approval";
    if (stage === "approved") return item.odooSO ? "SO created" : "Needs SO";
    return item.status || "Review";
  }

  function internalStatus(item) {
    if (item.odooSO) return "Sales Order Created";
    if (quoteStage(item) === "sent") return "Pending Approval";
    if (quoteStage(item) === "new") return "Pending Quotation";
    return QUOTE_STAGES[quoteStage(item)];
  }

  function customerLink(item) {
    return `trryapparel.com/inquiry/${encodeURIComponent(item.id)}`;
  }

  function inquiryHistory(item) {
    const rows = [];
    if (item.updatedAt) rows.push({ title: "Last Updated", meta: dateTime(item.updatedAt) });
    if (item.quotePublishedAt) rows.push({ title: "Quote Sent", meta: dateTime(item.quotePublishedAt) });
    if (item.quoteApprovedAt) rows.push({ title: "Customer Approved", meta: dateTime(item.quoteApprovedAt) });
    if (item.odooSO) rows.push({ title: "SO Created", meta: item.odooSO });
    rows.push({ title: "Inquiry Created", meta: inquiryTimestamp(item).date });
    return rows;
  }

  function renderOrders({ items, notices = "", schemaNotice = "", renderPayment, renderTracking }) {
    const orders = items.filter(confirmed);
    const stageQuery = query("stage");
    const paymentQuery = query("payment");
    const statusQuery = query("status");
    const orderQuery = query("order");
    const search = state.order.search.toLowerCase();
    const rows = orders.filter((item) => {
      const stage = productionStage(item);
      const readiness = readinessState(item);
      const payment = paymentState(item);
      const dueState = due(item);
      if (stageQuery && stage !== stageQuery) return false;
      if (paymentQuery === "awaiting" && payment.key !== "awaiting") return false;
      const activeStatus = statusQuery || state.order.status;
      if (activeStatus !== "all" && !orderStatusMatches(item, activeStatus)) return false;
      if (state.order.payment !== "all" && payment.key !== state.order.payment && payment.label !== state.order.payment) return false;
      if (state.order.artwork !== "all" && readiness.artworkKey !== state.order.artwork) return false;
      if (state.order.due !== "all" && dueState.key !== state.order.due) return false;
      if (state.order.production !== "all" && stage !== state.order.production) return false;
      if (state.order.owner !== "all" && (item.assignedUserId || "") !== state.order.owner) return false;
      return !search || [orderReference(item), sourceInquiryReference(item), item.id, item.nativeOrderId, item.customer, item.contact, item.service, product(item), item.odooSO, orderOwner(item)].join(" ").toLowerCase().includes(search);
    });
    const selected = findOrderByIdentity(orders, state.orderId || orderQuery);
    const pageSize = Number(state.order.pageSize) || 5;
    const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
    const currentPage = Math.min(Math.max(1, Number(state.order.page) || 1), pageCount);
    if (state.order.page !== currentPage) state.order.page = currentPage;
    const visibleRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    return `<main class="mvp-page ops-board-page mvp-orders-page mvp-orders-dashboard-page">
      ${ordersDashboardHeader(orders)}
      <p class="mvp-rule mvp-orders-safety-copy">NO CONFIRMED ORDER / DO NOT PRINT</p>
      ${notices}${schemaNotice}
      ${ordersDashboardMetrics(orders)}
      ${ordersStatusTabs(orders, statusQuery || state.order.status)}
      ${ordersDashboardFilterBar(orders)}
      ${ordersDashboardTable(visibleRows, rows.length, currentPage, pageCount, pageSize)}
      ${orderCards(visibleRows)}
      ${orderDrawer(selected, renderPayment, renderTracking)}
    </main>`;
  }

  function orderMetrics(orders) {
    return `<div class="mvp-metrics orders">${metric("Active Orders", orders.filter((item) => !isOrderClosed(item)).length, "/orders", "Confirmed")}${metric("Action Required", orders.filter(orderActionRequired).length, "/orders?due=today", "Work queue", "warning")}${metric("Ready for Production", orders.filter(readyForProduction).length, "/orders?stage=queued", "Gate clear", "lime")}${metric("Overdue", orders.filter((item) => due(item).key === "overdue").length, "/orders?due=overdue", "Orders", "danger")}${metric("Completed", orders.filter((item) => productionStage(item) === "completed").length, "/orders?stage=completed", "Closed")}</div>`;
  }

  function ordersDashboardHeader(orders) {
    return `<header class="mvp-orders-dashboard-header"><div><nav aria-label="Breadcrumb"><span>Home</span><i aria-hidden="true">&rsaquo;</i><strong>Orders</strong></nav><h1>Orders</h1><p>Track payment, release readiness, production progress, and fulfillment.</p></div><aside><strong>${orders.length}</strong><span>Total Orders</span><small>Created from approved inquiries</small></aside></header>`;
  }

  function ordersDashboardMetrics(orders) {
    const rows = [
      ["Awaiting Payment", orders.filter((item) => paymentState(item).key === "awaiting").length, `${orders.filter((item) => paymentState(item).key === "awaiting" && due(item).key === "overdue").length} overdue`, "warning"],
      ["Payment Review", orders.filter((item) => paymentState(item).key === "verification").length, "Proofs submitted", "payment"],
      ["Ready to Release", orders.filter(readyForProduction).length, "Paid and verified", "ready"],
      ["In Production", orders.filter((item) => ACTIVE_STAGES.includes(productionStage(item)) || productionStage(item) === "qc").length, "Active jobs", "active"],
      ["Blocked", orders.filter((item) => productionBlocker(item)).length, "Needs attention", "danger"],
    ];
    return `<section class="mvp-orders-kpis" aria-label="Orders summary">${rows.map(([label, value, hint, tone]) => `<article class="${html(tone)}"><span>${html(label)}</span><strong>${value}</strong><small>${html(hint)}</small></article>`).join("")}</section>`;
  }

  function ordersStatusTabs(orders, activeStatus) {
    const tabs = [
      ["all", "All Orders", orders.length],
      ["needs_action", "Needs Action", orders.filter(orderActionRequired).length],
      ["awaiting_payment", "Awaiting Payment", orders.filter((item) => orderStatusMatches(item, "awaiting_payment")).length],
      ["payment_review", "Payment Review", orders.filter((item) => orderStatusMatches(item, "payment_review")).length],
      ["ready_release", "Ready to Release", orders.filter((item) => orderStatusMatches(item, "ready_release")).length],
      ["in_production", "In Production", orders.filter((item) => orderStatusMatches(item, "in_production")).length],
      ["fulfillment", "Fulfillment", orders.filter((item) => orderStatusMatches(item, "fulfillment")).length],
    ];
    return `<nav class="mvp-orders-status-tabs" aria-label="Order status views">${tabs.map(([value, label, count]) => `<button type="button" data-mvp-order-status="${html(value)}" class="${activeStatus === value ? "active" : ""}" aria-current="${activeStatus === value ? "page" : "false"}">${html(label)} <span>${count}</span></button>`).join("")}</nav>`;
  }

  function ordersDashboardFilterBar(orders) {
    const values = state.order;
    return `<section class="mvp-orders-filter-bar" aria-label="Order filters">
      <label class="mvp-search"><span aria-hidden="true">&#8981;</span><input type="search" data-mvp-filter="order:search" value="${html(values.search)}" placeholder="Search order, customer, item..." /><kbd>Ctrl K</kbd></label>
      ${select("order", "payment", "All Payment States", [["awaiting", "Awaiting Payment"], ["verification", "Payment Review"], ["shop", "Pay at Shop"], ["partial", "Partially Paid"], ["paid", "Paid"], ["correction", "Correction Required"], ["not_set", "Not Set"]], values.payment)}
      ${select("order", "owner", "All Owners", assignmentFilterOptions(), values.owner, true)}
      ${select("order", "due", "All Due Dates", [["overdue", "Overdue"], ["today", "Due today"], ["week", "This week"], ["future", "Future"], ["none", "No date"]], values.due)}
      <button class="mvp-reset-filters" type="button" data-mvp-reset-filters="order"><span aria-hidden="true">&#8634;</span> Reset Filters</button>
    </section>`;
  }

  function ordersDashboardTable(items, total, currentPage, pageCount, pageSize) {
    const headers = ["ORDER", "CUSTOMER", "SUMMARY", "AMOUNT", "PAYMENT", "PRODUCTION", "DUE", "OWNER", "NEXT ACTION", "ACTION"];
    return `<section class="mvp-orders-table-wrap"><div class="mvp-orders-table" role="table" aria-label="Orders dashboard"><div class="mvp-orders-table-head" role="row">${headers.map((header) => `<span role="columnheader">${header}</span>`).join("")}</div><div role="rowgroup">${items.length ? items.map(orderDashboardRow).join("") : empty("NO ORDERS MATCH THIS FILTER")}</div></div>${ordersPagination(total, currentPage, pageCount, pageSize)}</section>`;
  }

  function orderDashboardRow(item) {
    const dueState = due(item);
    const payment = paymentState(item);
    const production = productionDisplay(item);
    const dueParts = dueCellParts(dueState, item);
    const action = orderDashboardAction(item);
    return `<div class="mvp-orders-table-row" data-mvp-open="order" data-mvp-id="${html(item.id)}" role="row" tabindex="0">
      ${orderIdentityCell(item)}
      ${twoLineCell(item.customer || "Unnamed customer", item.contact || "No contact", "customer")}
      ${twoLineCell(orderSummaryPrimary(item), orderSummarySecondary(item), "summary")}
      <span class="amount">${html(money(amount(item.quotedAmount || item.amountDue)))}</span>
      ${status(orderPaymentDashboardLabel(item), payment.tone)}
      ${status(orderProductionDashboardLabel(item), orderProductionDashboardTone(item, production))}
      ${twoLineCell(dueParts.primary, dueParts.secondary, `due ${dueState.key}`)}
      <span class="owner">${html(orderOwner(item))}</span>
      ${status(orderNextAction(item), orderNextActionTone(item))}
      <span class="mvp-orders-row-action"><button type="button" data-mvp-open="order" data-mvp-id="${html(item.id)}">${html(action)} <i aria-hidden="true">&rsaquo;</i></button><button type="button" data-mvp-open="order" data-mvp-id="${html(item.id)}" aria-label="More actions for ${html(orderReference(item))}">&ctdot;</button></span>
    </div>`;
  }

  function orderIdentityCell(item) {
    const source = item.sourceType === "native" || sourceInquiryReference(item) !== "Not linked" ? "FROM INQUIRY" : "LEGACY ORDER";
    return `<span class="order-identity">${copyButton(orderReference(item), orderReference(item), "order reference")}<small>${html(source)}</small></span>`;
  }

  function twoLineCell(primary, secondary, className = "") {
    return `<span class="mvp-two-line ${html(className)}"><strong>${html(primary || "-")}</strong><small>${html(secondary || "-")}</small></span>`;
  }

  function orderSummaryPrimary(item) {
    const itemText = itemDisplay(item);
    const qtyText = String(item.qty || "").trim();
    if (!qtyText || itemText.toLowerCase().includes(qtyText.toLowerCase())) return itemText;
    return `${itemText} x ${qtyText}`;
  }

  function orderSummarySecondary(item) {
    return [serviceDisplay(item), fulfillment(item)].filter((value) => value && value !== "-" && value !== "Not set").join(" / ") || product(item);
  }

  function orderPaymentDashboardLabel(item) {
    const payment = paymentState(item);
    if (payment.key === "awaiting") return "Balance due";
    if (payment.key === "verification") return "For verification";
    if (payment.key === "paid") return "Verified";
    if (payment.key === "partial") return `${money(Math.max(amount(item.amountDue || item.quotedAmount) - amount(item.paymentVerifiedAmount || item.paymentConfirmedAmount), 0))} balance`;
    if (payment.key === "shop") return "Pay at shop";
    return toTitleCase(payment.label.replace(/_/g, " "));
  }

  function orderProductionDashboardLabel(item) {
    const production = productionDisplay(item);
    if (productionBlocker(item)) return "BLOCKED";
    if (productionStage(item) === "queued") return readyForProduction(item) ? "READY" : "NOT READY";
    if (["printing", "embroidery", "screen_printing"].includes(production.key)) return "IN PRODUCTION";
    return production.label;
  }

  function orderProductionDashboardTone(item, production) {
    if (productionBlocker(item)) return "overdue";
    if (productionStage(item) === "queued") return readyForProduction(item) ? "ready" : "queued";
    return production.tone;
  }

  function dueCellParts(dueState, item) {
    if (!item.dueDate) return { primary: "No date", secondary: "-" };
    const date = new Date(`${item.dueDate}T00:00:00`);
    const primary = Number.isNaN(date.getTime()) ? "No date" : date.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
    const secondary = dueState.label.includes(" / ") ? dueState.label.split(" / ").pop() : dueState.key === "future" ? "Upcoming" : dueState.label;
    return { primary, secondary };
  }

  function orderNextAction(item) {
    const payment = paymentState(item);
    if (productionBlocker(item)) return "RESOLVE BLOCKER";
    if (payment.key === "verification") return "REVIEW PAYMENT";
    if (payment.key !== "paid") return "AWAITING PAYMENT";
    if (readyForProduction(item)) return "READY TO RELEASE";
    if (ACTIVE_STAGES.includes(productionStage(item)) || productionStage(item) === "qc") return "UPDATE PRODUCTION";
    if (["ready", "completed"].includes(productionStage(item))) return "FULFILLMENT";
    return "REVIEW ORDER";
  }

  function orderNextActionTone(item) {
    const action = orderNextAction(item);
    if (action === "RESOLVE BLOCKER") return "overdue";
    if (["AWAITING PAYMENT", "REVIEW PAYMENT"].includes(action)) return "payment";
    if (action === "READY TO RELEASE") return "ready";
    if (action === "FULFILLMENT") return "completed";
    return "queued";
  }

  function orderDashboardAction(item) {
    const action = orderNextAction(item);
    if (action === "RESOLVE BLOCKER") return "Resolve";
    if (action === "REVIEW PAYMENT") return "Review";
    if (action === "READY TO RELEASE") return "Release";
    if (action === "UPDATE PRODUCTION") return "Update";
    if (action === "FULFILLMENT") return "Open";
    return "Open";
  }

  function orderStatusMatches(item, statusValue) {
    if (statusValue === "all") return true;
    if (statusValue === "needs_action") return orderActionRequired(item);
    if (statusValue === "awaiting_payment") return paymentState(item).key === "awaiting";
    if (statusValue === "payment_review") return paymentState(item).key === "verification";
    if (statusValue === "ready_release") return readyForProduction(item);
    if (statusValue === "in_production") return ACTIVE_STAGES.includes(productionStage(item)) || productionStage(item) === "qc";
    if (statusValue === "fulfillment") return ["ready", "completed"].includes(productionStage(item));
    return true;
  }

  function ordersPagination(total, currentPage, pageCount, pageSize) {
    if (!total) return `<footer class="mvp-orders-pagination"><span>Showing 0 orders</span></footer>`;
    const start = (currentPage - 1) * pageSize + 1;
    const end = Math.min(total, currentPage * pageSize);
    const pages = Array.from({ length: pageCount }, (_, index) => index + 1).slice(0, 5);
    return `<footer class="mvp-orders-pagination"><span>Showing ${start} to ${end} of ${total} ${total === 1 ? "order" : "orders"}</span><nav aria-label="Orders pagination"><button type="button" data-mvp-order-page="${Math.max(1, currentPage - 1)}" ${currentPage === 1 ? "disabled" : ""}>&lsaquo;</button>${pages.map((page) => `<button type="button" data-mvp-order-page="${page}" class="${page === currentPage ? "active" : ""}" aria-current="${page === currentPage ? "page" : "false"}">${page}</button>`).join("")}<button type="button" data-mvp-order-page="${Math.min(pageCount, currentPage + 1)}" ${currentPage === pageCount ? "disabled" : ""}>&rsaquo;</button><small>${pageSize} / page</small></nav></footer>`;
  }

  function ordersTable(items) {
    return table("orders", ["Order", "Customer", "Item", "Qty", "Readiness", "Payment", "Due Date", "Production", "Owner"], items.map((item) => {
      const dueState = due(item);
      const readiness = readinessState(item);
      const payment = paymentState(item);
      const production = productionDisplay(item);
      return row("order", item.id, [
        copyButton(orderReference(item), orderReference(item), "order reference"),
        strong(item.customer || "Unnamed customer"),
        cell(itemDisplay(item)),
        cell(item.qty || "-"),
        readinessCell(readiness),
        status(payment.label, payment.tone),
        `<span class="mvp-due ${dueState.key}" title="${html(dueState.label)}">${html(dueShortLabel(dueState, item))}</span>`,
        productionCell(production),
        cell(orderOwner(item)),
      ]);
    }), "NO ORDERS MATCH THIS FILTER");
  }

  function orderCards(items) {
    return `<section class="mvp-order-card-list">${items.length ? items.map(orderMobileCard).join("") : empty("NO ORDERS MATCH THIS FILTER")}</section>`;
  }

  function orderMobileCard(item) {
    const readiness = readinessState(item);
    const payment = paymentState(item);
    const production = productionDisplay(item);
    const dueState = due(item);
    const action = orderActionRequired(item) ? `<span class="mvp-order-action-required">ACTION REQUIRED</span>` : "";
    return `<article class="mvp-order-mobile-card" data-mvp-open="order" data-mvp-id="${html(item.id)}" role="button" tabindex="0"><div class="mvp-order-mobile-header"><div>${copyButton(orderReference(item), orderReference(item), "order reference")}<strong>${html(item.customer || "Unnamed customer")}</strong></div>${status(production.label, production.tone)}</div><div class="mvp-order-mobile-summary"><strong>${html(itemDisplay(item))} ${String.fromCharCode(183)} ${html(item.qty || "-")}</strong><span>${html(readiness.summary)}</span>${status(payment.label, payment.tone)}</div><div class="mvp-order-mobile-meta"><span>Due: ${html(dueShortLabel(dueState, item))}</span><span>Owner: ${html(orderOwner(item))}</span>${action}</div></article>`;
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
      ${detailSection("Overview", [["Order Reference", orderReference(item)], ["Source Inquiry", sourceInquiryReference(item)], ["Odoo SO", item.odooSO || "Not set"], ["Customer", item.customer], ["Item", itemDisplay(item)], ["Quantity", item.sizeBreakdown || item.qty], ["Confirmed", dateTime(item.quoteApprovedAt || item.updatedAt)], ["Due Date", dueShortLabel(due(item), item)]])}
      ${detailSection("Readiness", [["Production Readiness", readyForProduction(item) ? "READY" : "NOT READY FOR PRODUCTION"], ["Missing Requirements", gate.length ? gate.join(", ") : "None"], ["Artwork Status", readiness.artwork], ["Artwork Approval", item.artworkApprovedAt ? dateTime(item.artworkApprovedAt) : "Not approved"], ["Revision Requirement", key(item.artworkStatus) === "revision_requested" ? "Revision needed" : "None"], ["Payment Readiness", payment.label], ["Current Blocker", gate.length ? gate.join(", ") : "None"]])}
      ${orderPaymentSummary(item)}
      ${typeof renderPayment === "function" ? renderPayment(item) : ""}
      ${detailSection("Fulfillment", [["Method", fulfillment(item)], ["Customer Tracking", tracking(item)], ["Contact", item.contact || "Not set"]])}
      ${detailSection("Production Handoff", [["Release State", stage === "queued" ? (readyForProduction(item) ? "READY" : `BLOCKED: ${gate.join(", ") || "requirements incomplete"}`) : "Released to production"], ["Current Production", production.label], ["Assigned Production Staff", assigned(item)], ["Production Link", canOpenProduction ? "Available" : "Not available"], ["Current Blocker", gate.length ? gate.join(", ") : "None"]])}
      ${detailSection("Internal", [["Order Owner", orderOwner(item)], ["Internal Note", item.productionNote || item.internalNote || "Not set"], ["Last Update", dateTime(item.updatedAt)]])}
      ${typeof renderTracking === "function" ? renderTracking(item) : ""}
    `, action);
  }  function orderReference(item) {
    return String(item.orderCode || item.orderReference || item.reference || item.code || item.odooSO || humanReadableId(item.id) || "Local order").trim();
  }

  function nativeOrderReference(item) {
    return String(item.nativeOrderReference || item.nativeOrder?.orderReference || "").trim();
  }

  function findOrderByIdentity(items, value) {
    const rows = Array.isArray(items) ? items : [];
    const nativeMatch = rows.find((item) => item?.sourceType === "native" && matchesOrderIdentity(item, value));
    return nativeMatch || rows.find((item) => matchesOrderIdentity(item, value)) || null;
  }

  function matchesOrderIdentity(item, value) {
    const target = identity(value);
    if (!target) return false;
    return [
      item?.nativeOrderId,
      item?.orderReference,
      item?.id,
      item?.sourceInquiryId,
      item?.sourceInquiryReference,
      item?.orderCode,
      item?.reference,
      item?.code,
      item?.odooSO,
    ].some((candidate) => identity(candidate) === target);
  }

  function identity(value) {
    return String(value || "").trim().toLowerCase();
  }

  function hasExistingOrder(item) {
    return Boolean(String(item.orderCode || item.orderReference || item.reference || item.code || item.odooSO || "").trim());
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

  function paymentSatisfiesProductionGate(item) {
    const value = key(item.paymentStatus);
    const total = amount(item.quotedAmount || item.amountDue);
    const verified = amount(item.paymentVerifiedAmount || item.paymentConfirmedAmount);
    if (["confirmed", "paid", "full_payment_confirmed"].includes(value)) return total > 0 && verified >= total;
    return false;
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
    if (["confirmed", "paid", "full_payment_confirmed"].includes(value)) return { key: "paid", label: "PAID", tone: "completed" };
    if (["down_payment_confirmed", "partially_paid"].includes(value)) return { key: "partial", label: "PARTIALLY PAID", tone: "payment" };
    if (["pay_at_shop", "payment_pending_at_shop"].includes(value)) return { key: "shop", label: "PAY AT SHOP", tone: "payment" };
    if (["correction_required"].includes(value)) return { key: "correction", label: "CORRECTION REQUIRED", tone: "overdue" };
    if (["proof_submitted", "under_review"].includes(value)) return { key: "verification", label: "FOR VERIFICATION", tone: "payment" };
    if (["50_dp", "50%_dp", "half_down", "half_deposit"].includes(value) || key(item.paymentLabel) === "50%_dp" || key(item.paymentLabel) === "50_dp") return { key: "deposit", label: paidAmount && dueAmount && paidAmount * 2 === dueAmount ? "50% DP" : "PARTIAL", tone: "payment" };
    if (["partial", "deposit", "down_payment"].includes(value)) return { key: "partial", label: "PARTIAL", tone: "payment" };
    if (["required", "awaiting_payment", "unpaid"].includes(value)) return { key: "awaiting", label: "UNPAID", tone: "overdue" };
    if (paidAmount > 0 && dueAmount > paidAmount) return { key: "partial", label: "PARTIAL", tone: "payment" };
    return { key: "not_set", label: "NOT SET", tone: "queued" };
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
    if (stage === "queued") {
      const gate = productionGate(item);
      if (gate.length) return { key: "blocked", label: "BLOCKED", tone: "overdue", detail: gate.join(", ") };
      return { key: stage, label: "READY", tone: "ready" };
    }
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
    return Boolean(blockedReason(item) || dueState.key === "today" || dueState.key === "overdue" || orderArtworkKey(item) !== "approved" || paymentState(item).key !== "paid");
  }

  function readyForProduction(item) {
    return Boolean(productionStage(item) === "queued" && product(item) && product(item) !== "Not set" && item.service && item.qty && item.dueDate && orderArtworkKey(item) === "approved" && hasAssignedStaff(item) && paymentSatisfiesProductionGate(item) && !blockedReason(item));
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
      if (state.production.stage !== "all" && stage !== state.production.stage) return false;
      if (state.production.staff !== "all" && (item.assignedUserId || "") !== state.production.staff) return false;
      if (state.production.method !== "all" && method !== state.production.method) return false;
      if (state.production.due !== "all" && dueState.key !== state.production.due) return false;
      if (state.production.blocker === "blocked" && !blocker) return false;
      if (state.production.blocker === "clear" && blocker) return false;
      return !search || [jobReference(item), orderReference(item), sourceInquiryReference(item), item.customer, method, itemDisplay(item), product(item), assigned(item)].join(" ").toLowerCase().includes(search);
    });
    const selectedId = state.productionId || query("order");
    const selected = findOrderByIdentity(productionJobs, selectedId) || findOrderByIdentity(orders, selectedId);
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
    return `<main class="mvp-page ops-board-page mvp-production-page">${pageTitle("Production", "PRODUCTION", `${rows.length} jobs`)}<p class="mvp-rule">RELEASED ORDERS ONLY</p>${notices}${schemaNotice}
      <div class="mvp-metrics production">${metric("ACTIVE JOBS", counts.active, "/production", "Released")}${metric("UNASSIGNED", counts.unassigned, "/production?staff=Not%20Yet%20Assigned", "Needs staff", "warning")}${metric("DUE TODAY", counts.today, "/production?due=today", "Today", "lime")}${metric("OVERDUE", counts.overdue, "/production?due=overdue", "Past due", "danger")}${metric("BLOCKED", counts.blocked, "/production?blocker=blocked", "Has blocker", "warning")}${metric("READY", counts.ready, "/production?stage=ready", "Fulfillment")}${metric("COMPLETED", counts.completed, "/production?stage=completed", "Closed")}</div>
      ${filterBar("production", productionJobs, ["staff", "method", "stage", "due", "blocker"])}${productionTable(rows, productionJobs.length)}${productionCards(rows, productionJobs.length)}${productionDrawer(selected)}
    </main>`;
  }

  function productionTable(items, totalJobs = 0) {
    const emptyLabel = totalJobs ? "NO PRODUCTION JOBS MATCH THESE FILTERS" : "NO RELEASED PRODUCTION JOBS";
    const emptyText = totalJobs ? "" : `<small>Orders will appear here after they pass the current release requirements.</small>`;
    if (!items.length) return productionEmptyTable(emptyLabel, totalJobs);
    return table("production", ["Job", "Customer", "Item", "Method", "Qty", "Current Stage", "Assigned", "Due Date", "Blocker", "Fulfillment"], items.map((item) => {
      const stage = productionStage(item);
      const blocker = productionBlocker(item);
      const dueState = due(item);
      return row("production", item.id, [
        copyButton(jobReference(item), jobReference(item), "job reference"),
        strong(item.customer || "Unnamed customer"),
        cell(itemDisplay(item)),
        cell(productionMethod(item)),
        cell(quantityDisplay(item)),
        status(stageLabel(stage), stage),
        cell(assigned(item) === "Not Yet Assigned" ? "Unassigned" : assigned(item)),
        `<span class="mvp-due ${dueState.key}" title="${html(dueState.label)}">${html(dueShortLabel(dueState, item))}</span>`,
        `<span class="mvp-blocker-cell" title="${html(blocker || "Not blocked")}">${html(blocker || "Not blocked")}</span>`,
        cell(fulfillment(item).toUpperCase()),
      ]);
    }), `${emptyLabel}${emptyText}`);
  }

  function productionCards(items, totalJobs = 0) {
    const emptyLabel = totalJobs ? "NO PRODUCTION JOBS MATCH THESE FILTERS" : "NO RELEASED PRODUCTION JOBS";
    const emptyText = totalJobs ? "" : `<small>Orders will appear here after they pass the current release requirements.</small>`;
    return `<section class="mvp-production-card-list">${items.length ? items.map(productionMobileCard).join("") : `<p class="mvp-empty">${html(emptyLabel)}${emptyText}</p>`}</section>`;
  }

  function productionEmptyTable(label, totalJobs) {
    const support = totalJobs ? "" : `<small>Orders will appear here after they pass the current release requirements.</small>`;
    return `<section class="mvp-table-wrap"><div class="mvp-table production" role="table"><div class="mvp-table-head" role="row">${["Job", "Customer", "Item", "Method", "Qty", "Current Stage", "Assigned", "Due Date", "Blocker", "Fulfillment"].map((header) => `<span role="columnheader">${header}</span>`).join("")}</div><div role="rowgroup"><p class="mvp-empty">${html(label)}${support}</p></div></div></section>`;
  }

  function productionMobileCard(item) {
    const stage = productionStage(item);
    const dueState = due(item);
    const blocker = productionBlocker(item);
    const ready = stage === "ready" ? productionDisplay(item).label : "";
    return `<article class="mvp-production-mobile-card" data-mvp-open="production" data-mvp-id="${html(item.id)}" role="button" tabindex="0"><div class="mvp-production-mobile-header"><div>${copyButton(jobReference(item), jobReference(item), "job reference")}<strong>${html(item.customer || "Unnamed customer")}</strong></div>${status(stageLabel(stage), stage)}</div><div class="mvp-production-mobile-job"><strong>${html(itemDisplay(item))}</strong><span>${html(productionMethod(item))} ${String.fromCharCode(183)} ${html(quantityDisplay(item))}</span></div><div class="mvp-production-mobile-ops"><span>Assigned: ${html(assigned(item) === "Not Yet Assigned" ? "Unassigned" : assigned(item))}</span><span>Due: ${html(dueShortLabel(dueState, item))}</span><span>Blocker: ${html(blocker || "Not blocked")}</span><span>Fulfillment: ${html(ready || fulfillment(item).toUpperCase())}</span></div></article>`;
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
        <label><span>Production Blocker</span><select data-mvp-production-blocked="${html(item.id)}" ${editorEnabled ? "" : "disabled"}><option value="">Not blocked</option>${["No artwork", "Awaiting customer artwork approval", "Payment requirement not completed", "Materials unavailable"].map((reason) => `<option ${item.blockedReason === reason ? "selected" : ""}>${reason}</option>`).join("")}</select></label><label class="wide"><span>Internal Production Note</span><textarea data-mvp-production-note="${html(item.id)}" ${editorEnabled ? "" : "disabled"}>${html(item.productionNote || "")}</textarea></label>
      </div><button class="mvp-secondary-action" type="button" data-mvp-save-production="${html(item.id)}" ${editorEnabled ? "" : "disabled"}>Save Assignment &amp; Note</button>${blocker ? `<p class="mvp-blocked">BLOCKER: ${html(blocker)}</p>` : ""}</section>
      ${detailSection("Release Context", [["Artwork Status", artworkLabel(item)], ["Artwork Approval", item.artworkApprovedAt ? dateTime(item.artworkApprovedAt) : "Not approved"], ["Payment Status", paymentState(item).label], ["Odoo SO", item.odooSO || "Not set"], ["Source Order", orderReference(item)], ["Released", released ? dateTime(item.productionUpdatedAt || item.updatedAt) : "Not released"]])}
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
    if (!hasAssignedStaff(item)) missing.push("assigned staff");
    if (Number(item.quotedAmount || item.amountDue) > 0 && !paymentSatisfiesProductionGate(item)) missing.push("payment");
    if (item.blockedReason) missing.push(item.blockedReason);
    return missing;
  }

  function bind({ root = document, rerender, navigate, copy, createOrder, saveProduction, confirmPayment, saveInquiryFollowUp, handleInquiryFollowUpOutcome }) {
    bindInquiryMoreDismiss(root);
    root.querySelectorAll("[data-mvp-route]").forEach((button) => button.addEventListener("click", () => { closeInquiryMoreMenus(root); navigate(button.dataset.mvpRoute); rerender(); }));
    root.querySelectorAll("[data-mvp-stage]").forEach((button) => button.addEventListener("click", () => { state.inquiry.stage = button.dataset.mvpStage; state.inquiry.page = 1; clearQuery(); rerender(); }));
    root.querySelectorAll("[data-mvp-filter]").forEach((field) => {
      const [scope, name] = field.dataset.mvpFilter.split(":");
      field.addEventListener(field.type === "search" ? "input" : "change", () => { state[scope][name] = field.value; if (state[scope]?.page !== undefined) state[scope].page = 1; clearQuery(); rerender(); if (field.type === "search") focusAtEnd(field.dataset.mvpFilter); });
    });
    root.querySelectorAll("[data-mvp-order-status]").forEach((button) => button.addEventListener("click", () => {
      state.order.status = button.dataset.mvpOrderStatus || "all";
      state.order.page = 1;
      clearQuery();
      rerender();
    }));
    root.querySelectorAll("[data-mvp-reset-filters]").forEach((button) => button.addEventListener("click", () => {
      const scope = button.dataset.mvpResetFilters;
      if (!state[scope]) return;
      Object.keys(state[scope]).forEach((keyName) => { state[scope][keyName] = keyName === "page" ? 1 : keyName === "pageSize" ? 5 : "all"; });
      if (state[scope].search !== undefined) state[scope].search = "";
      clearQuery();
      rerender();
    }));
    root.querySelectorAll("[data-mvp-page]").forEach((button) => button.addEventListener("click", () => {
      const page = Number(button.dataset.mvpPage);
      if (!Number.isFinite(page)) return;
      state.inquiry.page = page;
      rerender();
    }));
    root.querySelectorAll("[data-mvp-order-page]").forEach((button) => button.addEventListener("click", () => {
      const page = Number(button.dataset.mvpOrderPage);
      if (!Number.isFinite(page)) return;
      state.order.page = page;
      rerender();
    }));
    root.querySelectorAll("[data-mvp-open]").forEach((element) => {
      const open = () => { state.returnFocus = { type: element.dataset.mvpOpen, id: element.dataset.mvpId }; state[`${element.dataset.mvpOpen}Id`] = element.dataset.mvpId; if (element.dataset.mvpOpen === "inquiry") { state.inquiryTab = null; state.inquiryActionId = null; state.inquiryMoreOpen = false; } rerender(); requestAnimationFrame(() => root.querySelector(".mvp-drawer [data-mvp-close]")?.focus()); };
      element.addEventListener("click", (event) => { if (event.target.closest("[data-mvp-copy]")) return; event.stopPropagation(); open(); });
      element.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); open(); } });
    });
    root.querySelectorAll("[data-mvp-close]").forEach((button) => button.addEventListener("click", () => { const restore = state.returnFocus; state.inquiryId = null; state.orderId = null; state.productionId = null; state.returnFocus = null; clearQuery(); rerender(); requestAnimationFrame(() => { if (restore) root.querySelector(`[data-mvp-open="${restore.type}"][data-mvp-id="${CSS.escape(restore.id)}"]`)?.focus(); }); }));
    root.querySelectorAll("[data-mvp-copy]").forEach((button) => button.addEventListener("click", async (event) => { event.stopPropagation(); await copy(button.dataset.mvpCopy); closeInquiryMoreMenus(root); button.dataset.copied = "true"; const label = button.querySelector("small"); if (label) label.textContent = "Copied"; window.setTimeout(() => { button.dataset.copied = "false"; const nextLabel = button.querySelector("small"); if (nextLabel) nextLabel.textContent = "Copy"; }, 1300); }));
    root.querySelectorAll("[data-mvp-create-order]").forEach((button) => button.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (button.disabled) return;
      state.inquiryTab = "quotation";
      state.inquiryActionId = null;
      button.disabled = true;
      await createOrder?.(button.dataset.mvpCreateOrder);
      rerender();
    }));
    root.querySelectorAll("[data-mvp-inquiry-tab]").forEach((button) => button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      switchInquiryTab(root, button.dataset.mvpInquiryTab);
    }));
    root.querySelectorAll("[data-mvp-primary-action]").forEach((button) => button.addEventListener("click", (event) => { event.stopPropagation(); if (button.disabled) return; state.inquiryActionId = state.inquiryActionId === button.dataset.mvpPrimaryAction ? null : button.dataset.mvpPrimaryAction; if (button.dataset.mvpPrimaryKind === "quote") state.inquiryTab = "quotation"; state.inquiryMoreOpen = false; rerender(); }));
    root.querySelectorAll("[data-mvp-more-toggle]").forEach((button) => button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const menu = button.closest(".mvp-more-wrap")?.querySelector(".mvp-more-menu");
      const shouldOpen = menu ? menu.hidden : false;
      closeInquiryMoreMenus(root);
      if (menu && shouldOpen) {
        menu.hidden = false;
        button.setAttribute("aria-expanded", "true");
      }
    }));
    root.querySelectorAll("[data-mvp-open-messenger]").forEach((button) => button.addEventListener("click", (event) => { event.stopPropagation(); closeInquiryMoreMenus(root); window.open("https://www.messenger.com/", "_blank", "noopener,noreferrer"); }));
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
    root.querySelectorAll('[data-mvp-record-follow]').forEach((button) => button.addEventListener('click', async () => {
      if (button.disabled) return;
      const id = button.dataset.mvpRecordFollow;
      const outcome = root.querySelector(`[data-mvp-follow-outcome="${CSS.escape(id)}"]`)?.value || '';
      const reschedule = root.querySelector(`[data-mvp-follow-reschedule="${CSS.escape(id)}"]`)?.value || null;
      const message = root.querySelector(`[data-mvp-follow-message="${CSS.escape(id)}"]`);
      if (!outcome) { if (message) message.textContent = 'Select a follow-up result.'; return; }
      if (["no_response", "customer_considering"].includes(outcome) && !reschedule) { if (message) message.textContent = 'Choose a new follow-up date for this result.'; return; }
      button.disabled = true;
      button.textContent = 'Saving...';
      if (["no_response", "customer_considering"].includes(outcome)) await saveInquiryFollowUp?.(id, { followUpDate: reschedule });
      else await handleInquiryFollowUpOutcome?.(id, outcome);
      rerender();
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
    root.querySelectorAll("[data-mvp-confirm-payment]").forEach((button) => button.addEventListener("click", async () => {
      if (button.disabled) return;
      const id = button.dataset.mvpConfirmPayment;
      const form = button.closest("[data-mvp-payment-confirmation]");
      const message = form?.querySelector("[data-mvp-payment-message]");
      const amountReceived = form?.querySelector(`[data-mvp-payment-field="amountReceived"]`)?.value || "";
      const paymentSource = form?.querySelector(`[data-mvp-payment-field="paymentSource"]`)?.value || "";
      const referenceNumber = form?.querySelector(`[data-mvp-payment-field="referenceNumber"]`)?.value || "";
      const internalNote = form?.querySelector(`[data-mvp-payment-field="internalNote"]`)?.value || "";
      if (message) message.textContent = "Saving payment confirmation...";
      button.disabled = true;
      button.textContent = "Confirming...";
      await confirmPayment?.(id, { amountReceived, paymentSource, referenceNumber, internalNote });
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

  function switchInquiryTab(root, nextTab) {
    const allowed = ["details", "request", "quotation", "artwork", "history"];
    if (!allowed.includes(nextTab)) return;
    const drawerBody = root.querySelector(".mvp-drawer.inquiry.locked .mvp-drawer-body");
    const scrollTop = drawerBody?.scrollTop || 0;
    state.inquiryTab = nextTab;
    state.inquiryMoreOpen = false;
    root.querySelectorAll("[data-mvp-inquiry-tab]").forEach((button) => {
      const active = button.dataset.mvpInquiryTab === nextTab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    root.querySelectorAll("[data-mvp-inquiry-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.mvpInquiryPanel !== nextTab;
    });
    closeInquiryMoreMenus(root);
    if (drawerBody) drawerBody.scrollTop = scrollTop;
  }

  function bindInquiryMoreDismiss(root) {
    if (root.__mvpInquiryMoreDismissBound) return;
    root.__mvpInquiryMoreDismissBound = true;
    root.addEventListener("click", (event) => {
      if (!event.target.closest(".mvp-more-wrap")) closeInquiryMoreMenus(root);
    });
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeInquiryMoreMenus(root);
    });
  }

  function closeInquiryMoreMenus(root) {
    root.querySelectorAll(".mvp-more-menu").forEach((menu) => { menu.hidden = true; });
    root.querySelectorAll("[data-mvp-more-toggle]").forEach((button) => button.setAttribute("aria-expanded", "false"));
  }

  function filterBar(scope, items, fields) {
    const values = state[scope];
    const services = [...new Set(items.map((item) => item.service).filter(Boolean))].sort();
    const people = assignmentFilterOptions();
    const controls = [`<label class="mvp-search"><span aria-hidden="true">⌕</span><input type="search" data-mvp-filter="${scope}:search" value="${html(values.search)}" placeholder="Search code, customer, product..." /><kbd>⌘ K</kbd></label>`];
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
    if (scope === "inquiry") controls.push(`<button class="mvp-reset-filters" type="button" data-mvp-reset-filters="inquiry"><span aria-hidden="true">↺</span> Reset Filters</button>`);
    return `<section class="mvp-filter-bar">${controls.join("")}</section>`;
  }

  function select(scope, name, allLabel, options, value, includeUnassigned = false) {
    const rows = options.map((option) => Array.isArray(option) ? option : [option, option]);
    if (includeUnassigned) rows.push([scope === "production" ? "Not Yet Assigned" : "Unassigned", "Unassigned"]);
    return `<select data-mvp-filter="${scope}:${name}"><option value="all">${allLabel}</option>${rows.map(([keyValue, label]) => `<option value="${html(keyValue)}" ${value === keyValue ? "selected" : ""}>${html(label)}</option>`).join("")}</select>`;
  }

  function table(type, headers, rows, emptyLabel, footer = "") {
    return `<section class="mvp-table-wrap"><div class="mvp-table ${type}" role="table"><div class="mvp-table-head" role="row">${headers.map((header) => `<span role="columnheader">${html(header)}${type === "inquiry" && header !== "Action" ? `<i aria-hidden="true">&#8597;</i>` : ""}</span>`).join("")}</div><div role="rowgroup">${rows.length ? rows.join("") : empty(emptyLabel)}</div></div>${footer}</section>`;
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
  function inquiryMobileCard(item, stage) {
    const serviceQty = `${serviceDisplay(item)} ${String.fromCharCode(183)} ${item.qty || "-"}`;
    const requestSummary = `${fulfillment(item).toUpperCase()} ${String.fromCharCode(183)} ${artworkState(item)}`;
    return `<article class="mvp-inquiry-mobile-card" data-mvp-open="inquiry" data-mvp-id="${html(item.id)}" role="button" tabindex="0"><div class="mvp-inquiry-mobile-header"><div>${copyButton(item.id, item.id, "inquiry code")}<strong>${html(item.customer || "Unnamed customer")}</strong></div>${status(QUOTE_STAGES[stage], stage)}</div><div class="mvp-inquiry-mobile-request"><strong>${html(itemDisplay(item))}</strong><span>${html(serviceQty)}</span><span>${html(requestSummary)}</span><b>${html(quoteAmount(item))}</b></div><div class="mvp-inquiry-mobile-meta"><span>Follow-up: ${html(followUpLabel(item))}</span><span>Owner: ${html(owner(item))}</span></div></article>`;
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
  function customerCell(item) {
    const phone = String(item.contact || "").trim();
    return `<span class="mvp-customer-cell" title="${html(item.customer || "Unnamed customer")}"><strong>${html(item.customer || "Unnamed customer")}</strong><small>${html(phone || "No contact")}</small></span>`;
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
    return `<span class="mvp-request-cell" title="${html(summary)} / ${html(customerNotes(item) || "No notes")}"><strong>${html(summary)}</strong><small>${html(customerNotes(item) || "No notes")}</small></span>`;
  }
  function quantityCell(item) {
    const qty = String(item.qty || "").trim() || displayDash();
    const secondary = String(item.sizeBreakdown || "").trim();
    return `<span class="mvp-qty-cell" title="${html([qty, secondary].filter(Boolean).join(" / "))}"><strong>${html(qty)}</strong>${secondary ? `<small>${html(secondary)}</small>` : ""}</span>`;
  }
  function inquiryActionCell(item) {
    return `<span class="mvp-inquiry-action-cell"><button type="button" data-mvp-open="inquiry" data-mvp-id="${html(item.id)}">Open <i aria-hidden="true">&rsaquo;</i></button></span>`;
  }
  function inquiryPagination(total, currentPage, pageCount, pageSize) {
    if (!total) return `<footer class="mvp-inquiry-pagination"><span>Showing 0 inquiries</span></footer>`;
    const start = (currentPage - 1) * pageSize + 1;
    const end = Math.min(total, currentPage * pageSize);
    const pages = Array.from({ length: pageCount }, (_, index) => index + 1).slice(0, 5);
    return `<footer class="mvp-inquiry-pagination"><span>Showing ${start} to ${end} of ${total} ${total === 1 ? "inquiry" : "inquiries"}</span><nav aria-label="Inquiry pagination"><button type="button" data-mvp-page="${Math.max(1, currentPage - 1)}" ${currentPage === 1 ? "disabled" : ""}>‹</button>${pages.map((page) => `<button type="button" data-mvp-page="${page}" class="${page === currentPage ? "active" : ""}" aria-current="${page === currentPage ? "page" : "false"}">${page}</button>`).join("")}<button type="button" data-mvp-page="${Math.min(pageCount, currentPage + 1)}" ${currentPage === pageCount ? "disabled" : ""}>›</button><small>${pageSize} / page</small></nav></footer>`;
  }
  function toTitleCase(value) {
    return String(value || "").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
  function inquiryKpiLabel(value) {
    return toTitleCase(value).replace("Follow-Up", "Follow-up");
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
  function internalInquirySection(item) {
    const ownerDisabled = assignmentControlsDisabled();
    const ownerHelp = assignmentNotice();
    const dueActive = isFollowUpDue(item);
    return `<section class="mvp-drawer-section mvp-internal-section"><h3>Internal</h3><div class="mvp-internal-controls">
      <label><span>Owner</span><select data-mvp-inquiry-owner="${html(item.id)}" ${ownerDisabled ? "disabled" : ""}>${assignmentSelectOptions(item.ownerUserId, item.owner || item.ownerId, "Unassigned")}</select>${ownerHelp}</label>
      <label><span>Next Follow-up</span><input data-mvp-follow-date-input="${html(item.id)}" type="date" value="${html(item.followUpDate || "")}" /></label>
      <div class="mvp-follow-presets"><button type="button" data-mvp-follow-preset="${html(item.id)}" data-mvp-follow-days="0">Today</button><button type="button" data-mvp-follow-preset="${html(item.id)}" data-mvp-follow-days="1">Tomorrow</button><button type="button" data-mvp-follow-preset="${html(item.id)}" data-mvp-follow-days="3">+3 Days</button></div>
      <div class="mvp-follow-actions"><button class="mvp-secondary-action" type="button" data-mvp-save-follow="${html(item.id)}">Save Owner & Date</button><button class="mvp-ghost-action" type="button" data-mvp-clear-follow="${html(item.id)}">Clear Follow-up</button></div>
    </div>${dueActive ? recordFollowUpBox(item) : ""}<div class="mvp-detail-grid"><div><span>Priority</span><strong>${html(item.priority || "Normal")}</strong></div><div><span>Internal Note</span><strong>${html(item.productionNote || item.internalNote || "Not set")}</strong></div><div><span>Last Update</span><strong>${html(dateTime(item.updatedAt))}</strong></div></div></section>`;
  }
  function recordFollowUpBox(item) {
    return `<details class="mvp-record-follow" open><summary>RECORD FOLLOW-UP</summary><div><label><span>Result</span><select data-mvp-follow-outcome="${html(item.id)}"><option value="">Select result</option><option value="no_response">NO RESPONSE</option><option value="customer_considering">CUSTOMER CONSIDERING</option><option value="quotation_approved">QUOTATION APPROVED</option><option value="not_proceeding">NOT PROCEEDING</option><option value="converted_to_order">CONVERTED TO ORDER</option></select></label><label><span>New follow-up date</span><input data-mvp-follow-reschedule="${html(item.id)}" type="date" /></label><button class="mvp-primary-action" type="button" data-mvp-record-follow="${html(item.id)}">Record Result & Reschedule</button><p class="mvp-inline-note" data-mvp-follow-message="${html(item.id)}">No Response and Customer Considering require a new date. Approval, Lost, and conversion use the existing protected workflow actions.</p></div></details>`;
  }  function copyButton(label, value, aria) { return `<button class="mvp-copy" type="button" data-mvp-copy="${html(value)}" aria-label="Copy ${html(aria)} ${html(label)}"><span>${html(label)}</span><small>Copy</small></button>`; }
  function strong(value) { return `<strong title="${html(value)}">${html(value)}</strong>`; }
  function cell(value) { return `<span title="${html(value)}">${html(value)}</span>`; }
  function status(label, tone) { return `<b class="mvp-status ${tone}" title="${html(label)}">${html(label)}</b>`; }
  function empty(label) { return `<p class="mvp-empty">${html(label)}</p>`; }
  function stationFor(item) { const value = String(item.service || "").toLowerCase(); return value.includes("embro") ? "embroidery" : value.includes("screen") ? "screen_printing" : "printing"; }
  function inquiryDue(item) { if (!item.followUpDate) return "none"; const date = new Date(`${item.followUpDate}T00:00:00`); const today = new Date(`${todayIso()}T00:00:00`); if (date < today) return "overdue"; if (+date === +today) return "today"; return "week"; }
  function fulfillment(item) { const value = key(item.fulfillmentMethod); return value === "pickup" ? "Pickup" : value === "delivery" ? "Delivery" : "Not set"; }
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
