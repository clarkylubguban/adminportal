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
const FIRST_PRODUCTION_STATIONS = ["printing", "embroidery", "screen_printing"];

export function createMvpDashboard({ getAssignmentContext = () => ({ users: [], loadState: "idle", error: "" }) } = {}) {
  const state = {
    inquiryId: null,
    orderId: null,
    productionId: null,
    returnFocus: null,
    inquiry: { search: "", stage: "all", owner: "all", service: "all", due: "all", page: 1 },
    order: { search: "", status: "all", payment: "all", artwork: "all", due: "all", production: "all", owner: "all", page: 1, pageSize: 5 },
    production: { search: "", status: "all", staff: "all", method: "all", stage: "all", due: "all", blocker: "all", page: 1, pageSize: 5 },
    orderTab: "overview",
    orderReleaseId: null,
    orderReleaseError: "",
    productionTab: "overview",
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

  const hasNativeOrderAuthority = (item) => item?.sourceType === "native" && Boolean(item.nativeOrderId || item.orderReference || item.sourceInquiryId);

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
    const gate = productionGate(item);
    const activeTab = orderDrawerTabs().some((tab) => tab.key === state.orderTab) ? state.orderTab : "overview";
    const body = {
      overview: orderDrawerOverview(item),
      requirements: orderDrawerRequirements(item, gate),
      payment: orderDrawerPayment(item, renderPayment),
      fulfillment: orderDrawerFulfillment(item, renderTracking),
      history: orderDrawerHistory(item),
    }[activeTab];
    return `<button class="mvp-drawer-backdrop" data-mvp-close type="button" aria-label="Close details"></button><aside class="mvp-drawer order mvp-order-drawer" aria-label="Order details">
      ${orderDrawerHeader(item)}
      ${orderDrawerTabRow(activeTab)}
      <div class="mvp-drawer-body mvp-order-drawer-body">${body}</div>
      <footer class="mvp-drawer-footer mvp-order-drawer-footer">${orderDrawerFooter(item, gate, activeTab)}</footer>
    </aside>`;
  }

  function orderDrawerHeader(item) {
    const statusState = orderOperationalState(item);
    const reference = orderReference(item);
    const meta = [item.contact, shortDate(item.quoteApprovedAt || item.updatedAt), item.source || "Source not set"].filter(Boolean).join(" / ");
    return `<header class="mvp-order-drawer-header"><div class="mvp-order-header-top"><mark class="${html(statusState.tone)}">${html(statusState.label)}</mark><button type="button" data-mvp-close aria-label="Close details">X</button></div><div class="mvp-order-code-row"><code>${html(reference)}</code>${copyButton("COPY", reference, "order reference")}</div><h2>${html(item.customer || "Unnamed customer")}</h2><p>${html(meta || "No contact/date/source")}</p></header>`;
  }

  function orderDrawerTabs() {
    return [
      ["overview", "Overview"],
      ["requirements", "Requirements"],
      ["payment", "Payment"],
      ["fulfillment", "Fulfillment"],
      ["history", "History"],
    ].map(([keyValue, label]) => ({ key: keyValue, label }));
  }

  function orderDrawerTabRow(activeTab) {
    return `<nav class="mvp-order-drawer-tabs" aria-label="Order drawer tabs">${orderDrawerTabs().map((tab) => `<button type="button" data-mvp-order-tab="${tab.key}" class="${activeTab === tab.key ? "active" : ""}" aria-selected="${activeTab === tab.key ? "true" : "false"}">${html(tab.label)}</button>`).join("")}</nav>`;
  }

  function orderDrawerOverview(item) {
    return `<section class="mvp-order-panel"><h3>ORDER SUMMARY</h3><div class="mvp-order-detail-list">
      ${detailLine("Product", itemDisplay(item))}
      ${detailLine("Quantity", item.sizeBreakdown || item.qty || "Not set")}
      ${detailLine("Sizes", item.sizeBreakdown || "Not set")}
      ${detailLine("Color", item.color || item.garmentColor || messageValue(item.message, ["Color", "Garment Color"]) || "Not set")}
      ${detailLine("Due Date", dueShortLabel(due(item), item))}
      ${detailLine("Assigned Staff", assigned(item))}
      ${detailLine("Fulfillment", fulfillment(item))}
      ${detailLine("Artwork", artworkLabel(item))}
      ${detailLine("Payment", orderPaymentReadinessSummary(item))}
    </div></section>`;
  }

  function orderDrawerRequirements(item, gate) {
    return `<section class="mvp-order-panel"><h3>PRODUCTION REQUIREMENTS</h3><div class="mvp-order-requirements">${orderRequirementRows(item, gate).map(requirementRow).join("")}</div><p class="mvp-inline-note">Derived from existing Order readiness rules. No persisted checklist is created.</p></section>`;
  }

  function orderRequirementRows(item, gate) {
    return [
      { label: "Product and quantity", ok: Boolean(product(item) && product(item) !== "Not set" && item.service && item.qty), mapsTo: "product/service/qty" },
      { label: "Due date", ok: Boolean(item.dueDate), mapsTo: "dueDate" },
      { label: "Artwork approved", ok: orderArtworkKey(item) === "approved", mapsTo: "artworkStatus" },
      { label: "Assigned production staff", ok: hasAssignedStaff(item), mapsTo: "assignedUserId/assignedStaff" },
      { label: "Payment requirement", ok: paymentSatisfiesProductionGate(item), mapsTo: "paymentStatus + verified/confirmed amount" },
      { label: "No revision or explicit blocker", ok: key(item.artworkStatus) !== "revision_requested" && !productionBlocker(item), mapsTo: "artworkStatus + blockedReason" },
    ].map((row) => ({ ...row, blocking: gate.some((entry) => row.mapsTo.toLowerCase().includes(String(entry).split(" ")[0])) || (!row.ok && row.label === "Payment requirement") || (!row.ok && productionBlocker(item)) }));
  }

  function requirementRow(row) {
    return `<div class="${row.ok ? "pass" : "fail"}"><span aria-hidden="true">${row.ok ? "✓" : "×"}</span><strong>${html(row.label)}</strong><small>${html(row.ok ? "Ready" : "Needs attention")} / ${html(row.mapsTo)}</small></div>`;
  }

  function orderDrawerPayment(item, renderPayment) {
    const paymentForm = typeof renderPayment === "function" ? renderPayment(item) : "";
    return `<section class="mvp-order-panel"><h3>PAYMENT SUMMARY</h3><div class="mvp-order-detail-list">
      ${detailLine("Payment State", orderPaymentDashboardLabel(item))}
      ${detailLine("Payment Method", paymentMethodLabel(item.paymentMethod))}
      ${detailLine("Payment Type", paymentTypeLabel(item.paymentType))}
      ${detailLine("Quote Total", money(amount(item.quotedAmount)))}
      ${detailLine("Confirmed Amount", money(amount(item.paymentVerifiedAmount || item.paymentConfirmedAmount)))}
      ${detailLine("Amount Due", money(amount(item.amountDue || item.quotedAmount)))}
      ${detailLine("Balance", money(orderPaymentBalance(item)))}
      ${detailLine("Reference", item.paymentReference || "Not set")}
      ${detailLine("Verified Date", dateTime(item.paymentVerifiedAt || item.paymentConfirmedAt))}
    </div></section>${paymentForm}`;
  }

  function orderDrawerFulfillment(item, renderTracking) {
    const trackingForm = typeof renderTracking === "function" ? renderTracking(item) : "";
    return `<section class="mvp-order-panel"><h3>FULFILLMENT</h3><div class="mvp-order-detail-list">
      ${detailLine("Method", fulfillment(item))}
      ${detailLine("Customer Tracking", tracking(item))}
      ${detailLine("Contact", item.contact || "Not set")}
      ${detailLine("Address", item.deliveryAddress || item.address || messageValue(item.message, ["Delivery Address", "Address"]) || "Not set")}
      ${detailLine("Sub-status", tracking(item))}
      ${detailLine("Customer Note", item.trackingNote || customerNotes(item) || "Not set")}
    </div><p class="mvp-inline-note">Order-owned customer fulfillment data only. Production packing/QC handoff remains in Production.</p></section>${trackingForm ? `<section class="mvp-order-panel readonly"><h3>TRACKING CONTRACT</h3><p class="mvp-inline-note">Customer tracking writes remain on the existing inquiry bridge outside this drawer phase.</p></section>` : ""}`;
  }

  function orderDrawerHistory(item) {
    const rows = orderHistoryRows(item);
    return `<section class="mvp-order-panel"><h3>HISTORY</h3><div class="mvp-order-history">${rows.map((row) => `<article><i aria-hidden="true"></i><strong>${html(row.title)}</strong><span>${html(row.when)}</span><small>${html(row.source)}</small></article>`).join("")}</div></section>`;
  }

  function orderHistoryRows(item) {
    const rows = [];
    if (Array.isArray(item.paymentHistory)) item.paymentHistory.forEach((entry) => rows.push({ title: `Payment confirmed${entry.amount ? ` ${money(entry.amount)}` : ""}`, when: dateTime(entry.confirmedAt), source: "Persisted payment_history" }));
    if (item.paymentConfirmedAt || item.paymentVerifiedAt) rows.push({ title: "Payment confirmed", when: dateTime(item.paymentConfirmedAt || item.paymentVerifiedAt), source: "Derived from payment fields" });
    if (item.productionUpdatedAt && productionStage(item) !== "queued") rows.push({ title: "Released to production", when: dateTime(item.productionUpdatedAt), source: "Derived from production fields" });
    if (item.productionStartedAt) rows.push({ title: "Production started", when: dateTime(item.productionStartedAt), source: "Persisted production start fields" });
    if (item.quoteApprovedAt) rows.push({ title: "Quotation approved", when: dateTime(item.quoteApprovedAt), source: "Derived from quote approval" });
    if (item.orderCreatedAt || item.createdAt || item.updatedAt) rows.push({ title: "Order created", when: dateTime(item.orderCreatedAt || item.createdAt || item.updatedAt), source: sourceInquiryReference(item) !== "Not linked" ? `Derived from source inquiry ${sourceInquiryReference(item)}` : "Derived from order data" });
    if (!rows.length) rows.push({ title: "No history events available", when: "Not set", source: "No persisted event rows found" });
    return rows;
  }

  function orderDrawerFooter(item, gate, activeTab) {
    const statusState = orderOperationalState(item);
    if (["awaiting_payment", "payment_review"].includes(statusState.key)) return `<button class="mvp-primary-action" type="button" data-mvp-order-tab="payment">${statusState.key === "payment_review" ? "Review Payment" : "Confirm Payment"}</button><button class="mvp-secondary-action" type="button" data-mvp-order-tab="requirements">Requirements</button>`;
    if (statusState.key === "blocked") return `<button class="mvp-secondary-action" type="button" data-mvp-order-tab="requirements">Review Blocker</button><button class="mvp-secondary-action" type="button" disabled title="${html(productionBlocker(item) || gate.join(", "))}">Resolve Blocker</button>`;
    if (statusState.key === "ready_to_release") return orderReleaseFooter(item, gate);
    if (statusState.key === "released") return orderFooterAction(item, gate);
    return `<button class="mvp-secondary-action" type="button" data-mvp-order-tab="${activeTab === "requirements" ? "overview" : "requirements"}">${activeTab === "requirements" ? "View Overview" : "View Requirements"}</button>`;
  }

  function orderReleaseFooter(item, gate) {
    const next = nextStage(item);
    const disabled = state.orderReleaseId === item.id || gate.length || !next;
    const error = state.orderReleaseError ? `<small class="mvp-inline-error">${html(state.orderReleaseError)}</small>` : "";
    return `<button class="mvp-primary-action" type="button" data-mvp-release-order="${html(item.id)}" data-mvp-next="${html(next)}" ${disabled ? "disabled" : ""}>${state.orderReleaseId === item.id ? "RELEASING..." : "RELEASE TO PRODUCTION"}</button><button class="mvp-secondary-action" type="button" data-mvp-order-tab="requirements">Requirements</button>${gate.length ? `<small title="${html(gate.join(", "))}">Resolve before release: ${html(gate.join(", "))}</small>` : ""}${error}`;
  }

  function orderOperationalState(item) {
    const payment = paymentState(item);
    const stage = productionStage(item);
    if (productionBlocker(item)) return { key: "blocked", label: "BLOCKED", tone: "overdue" };
    if (payment.key === "verification") return { key: "payment_review", label: "PAYMENT REVIEW", tone: "payment" };
    if (payment.key !== "paid") return { key: "awaiting_payment", label: "AWAITING PAYMENT", tone: "payment" };
    if (stage === "queued" && readyForProduction(item)) return { key: "ready_to_release", label: "READY TO RELEASE", tone: "ready" };
    if (stage === "queued") return { key: "not_ready", label: "NOT READY", tone: "queued" };
    if (["ready", "completed"].includes(stage)) return { key: "released", label: productionDisplay(item).label, tone: "completed" };
    return { key: "released", label: "QUEUED FOR PRODUCTION", tone: "ready" };
  }

  function orderPaymentBalance(item) {
    return Math.max(amount(item.quotedAmount || item.amountDue) - amount(item.paymentVerifiedAmount || item.paymentConfirmedAmount), 0);
  }

  function orderPaymentReadinessSummary(item) {
    const payment = paymentState(item);
    if (payment.key === "paid") return `Confirmed / ${money(amount(item.paymentVerifiedAmount || item.paymentConfirmedAmount))}`;
    if (payment.key === "verification") return "Payment proof requires admin review";
    return `${orderPaymentDashboardLabel(item)} / ${money(orderPaymentBalance(item))} due`;
  }

  function detailLine(label, value) {
    return `<div><span>${html(label)}</span><strong>${html(value || "Not set")}</strong></div>`;
  }

  function orderReference(item) {
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
    if (!confirmed(item) || !hasNativeOrderAuthority(item)) return false;
    const status = key(item.status);
    if (["lost", "cancelled", "canceled"].includes(status)) return false;
    const stage = productionStage(item);
    if ([...ACTIVE_STAGES, "qc", "ready", "completed"].includes(stage)) return true;
    return false;
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
    if (FIRST_PRODUCTION_STATIONS.includes(stage) && !productionStarted(item)) return { key: "queued", label: "QUEUED FOR PRODUCTION", tone: "queued" };
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
    return Boolean(hasNativeOrderAuthority(item) && productionStage(item) === "queued" && product(item) && product(item) !== "Not set" && item.service && item.qty && item.dueDate && orderArtworkKey(item) === "approved" && hasAssignedStaff(item) && paymentSatisfiesProductionGate(item) && !blockedReason(item));
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

  function productionStartedByLabel(item) {
    const actorId = String(item.productionStartedBy || item.production_started_by || "").trim();
    if (!actorId) return "Not set";
    return assignmentName(findAssignmentUser(actorId)) || actorId;
  }

  function productionMetaLine(item) {
    return [item.contact, item.dueDate ? dateShort(item.dueDate) : "", item.source ? `via ${item.source}` : ""].filter(Boolean).join(" / ");
  }

  function productionFooterAction(item, next, fieldsReady, gate) {
    const stage = productionStage(item);
    if (FIRST_PRODUCTION_STATIONS.includes(stage) && !productionStarted(item)) {
      const disabled = !fieldsReady || gate.length;
      return `<section class="mvp-production-action"><span>NOW: Queued for Production</span><strong>NEXT: In Production</strong><button type="button" data-mvp-start-production="${html(item.id)}" ${disabled ? "disabled" : ""}>START PRODUCTION</button>${gate.length ? `<small>Resolve before starting: ${html(gate.join(", "))}</small>` : ""}</section>`;
    }
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
    const statusQuery = query("status");
    const dueQuery = query("due");
    const staffQuery = query("staff");
    const methodQuery = query("method");
    const blockerQuery = query("blocker");
    const search = state.production.search.toLowerCase();
    const rows = productionJobs.filter((item) => {
      const stateInfo = productionWorkflowState(item);
      const blocker = productionBlocker(item);
      const method = productionMethod(item);
      const dueState = due(item);
      const activeStatus = statusQuery || state.production.status;
      if (activeStatus !== "all" && !productionStatusMatches(item, activeStatus)) return false;
      if (dueQuery && dueState.key !== dueQuery) return false;
      if (staffQuery && assigned(item) !== staffQuery) return false;
      if (methodQuery && method !== methodQuery) return false;
      if (blockerQuery === "blocked" && !blocker) return false;
      if (blockerQuery === "clear" && blocker) return false;
      if (state.production.stage !== "all" && stateInfo.key !== state.production.stage) return false;
      if (state.production.staff !== "all" && (item.assignedUserId || "") !== state.production.staff) return false;
      if (state.production.method !== "all" && method !== state.production.method) return false;
      if (state.production.due !== "all" && dueState.key !== state.production.due) return false;
      if (state.production.blocker === "blocked" && !blocker) return false;
      if (state.production.blocker === "clear" && blocker) return false;
      return !search || [jobReference(item), orderReference(item), sourceInquiryReference(item), item.customer, method, itemDisplay(item), product(item), assigned(item)].join(" ").toLowerCase().includes(search);
    });
    const selectedId = state.productionId || query("order");
    const selected = findOrderByIdentity(productionJobs, selectedId);
    const pageSize = Number(state.production.pageSize) || 5;
    const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
    const currentPage = Math.min(Math.max(1, Number(state.production.page) || 1), pageCount);
    if (state.production.page !== currentPage) state.production.page = currentPage;
    const visibleRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    return `<main class="mvp-page ops-board-page mvp-production-page mvp-production-dashboard-page">
      ${productionDashboardHeader(productionJobs)}
      <p class="mvp-rule">RELEASED ORDERS ONLY</p>${notices}${schemaNotice}
      ${productionDashboardMetrics(productionJobs)}
      ${productionStatusTabs(productionJobs, statusQuery || state.production.status)}
      ${productionDashboardFilterBar(productionJobs)}
      ${productionDashboardTable(visibleRows, rows.length, currentPage, pageCount, pageSize)}
      ${productionCards(visibleRows)}
      ${productionDrawer(selected)}
    </main>`;
  }

  function productionDashboardHeader(jobs) {
    const active = jobs.filter((item) => productionWorkflowState(item).key !== "completed").length;
    return `<header class="mvp-production-dashboard-header"><div><nav aria-label="Breadcrumb"><span>Home</span><i aria-hidden="true">&rsaquo;</i><strong>Production</strong></nav><h1>Production</h1><p>Track released jobs from queue through quality check and pickup or delivery.</p></div><aside><strong>${active}</strong><span>Active Jobs</span><small>Released from confirmed orders</small></aside></header>`;
  }

  function productionDashboardMetrics(jobs) {
    const rows = [
      ["Queued", jobs.filter((item) => productionWorkflowState(item).key === "queued").length, "Ready to schedule", "queued"],
      ["Ready", jobs.filter((item) => productionWorkflowState(item).key === "ready").length, "Ready for fulfillment", "ready"],
      ["In Production", jobs.filter((item) => productionWorkflowState(item).key === "in_production").length, "Active jobs", "active"],
      ["Quality Check", jobs.filter((item) => productionWorkflowState(item).key === "qc").length, "Waiting approval", "qc"],
      ["Blocked", jobs.filter((item) => productionWorkflowState(item).key === "blocked").length, "Needs attention", "danger"],
    ];
    return `<section class="mvp-production-kpis" aria-label="Production summary">${rows.map(([label, value, hint, tone]) => `<article class="${html(tone)}"><span>${html(label)}</span><strong>${value}</strong><small>${html(hint)}</small></article>`).join("")}</section>`;
  }

  function productionStatusTabs(jobs, activeStatus) {
    const tabs = [
      ["all", "All Jobs", jobs.length],
      ["queued", "Queued", jobs.filter((item) => productionStatusMatches(item, "queued")).length],
      ["ready", "Ready", jobs.filter((item) => productionStatusMatches(item, "ready")).length],
      ["in_production", "In Production", jobs.filter((item) => productionStatusMatches(item, "in_production")).length],
      ["qc", "Quality Check", jobs.filter((item) => productionStatusMatches(item, "qc")).length],
      ["pickup_delivery", "Pickup / Delivery", jobs.filter((item) => productionStatusMatches(item, "pickup_delivery")).length],
      ["blocked", "Blocked", jobs.filter((item) => productionStatusMatches(item, "blocked")).length],
    ];
    return `<nav class="mvp-production-status-tabs" aria-label="Production status views">${tabs.map(([value, label, count]) => `<button type="button" data-mvp-production-status="${html(value)}" class="${activeStatus === value ? "active" : ""}" aria-current="${activeStatus === value ? "page" : "false"}">${html(label)} <span>${count}</span></button>`).join("")}</nav>`;
  }

  function productionDashboardFilterBar(jobs) {
    const values = state.production;
    return `<section class="mvp-production-filter-bar" aria-label="Production filters">
      <label class="mvp-search"><span aria-hidden="true">&#8981;</span><input type="search" data-mvp-filter="production:search" value="${html(values.search)}" placeholder="Search job, customer, item..." /><kbd>Ctrl K</kbd></label>
      ${select("production", "method", "All Methods", productionMethodOptions(jobs), values.method)}
      ${select("production", "staff", "All Staff", assignmentFilterOptions(), values.staff, true)}
      ${select("production", "due", "All Dates", [["overdue", "Overdue"], ["today", "Due today"], ["week", "This week"], ["future", "Future"], ["none", "No date"]], values.due)}
      <button class="mvp-reset-filters" type="button" data-mvp-reset-filters="production"><span aria-hidden="true">&#8634;</span> Reset Filters</button>
    </section>`;
  }

  function productionDashboardTable(items, total, currentPage, pageCount, pageSize) {
    const headers = ["JOB", "CUSTOMER", "SUMMARY", "METHOD", "MATERIALS", "ARTWORK", "DUE", "STAFF", "STAGE", "ACTION"];
    const emptyText = total ? "NO PRODUCTION JOBS MATCH THESE FILTERS" : "NO RELEASED PRODUCTION JOBS";
    return `<section class="mvp-production-table-wrap"><div class="mvp-production-table" role="table" aria-label="Production dashboard"><div class="mvp-production-table-head" role="row">${headers.map((header) => `<span role="columnheader">${html(header)} <i aria-hidden="true">&#8597;</i></span>`).join("")}</div><div role="rowgroup">${items.length ? items.map(productionDashboardRow).join("") : empty(emptyText)}</div></div>${productionPagination(total, currentPage, pageCount, pageSize)}</section>`;
  }

  function productionDashboardRow(item) {
    const dueState = due(item);
    const dueParts = dueCellParts(dueState, item);
    const stage = productionWorkflowState(item);
    const materials = productionMaterialsState(item);
    const action = productionDashboardAction(item);
    return `<div class="mvp-production-table-row" data-mvp-open="production" data-mvp-id="${html(item.id)}" role="row" tabindex="0">
      ${productionJobIdentityCell(item)}
      ${twoLineCell(item.customer || "Unnamed customer", item.contact || "No contact", "customer")}
      ${twoLineCell(productionSummaryPrimary(item), productionSummarySecondary(item), "summary")}
      <span class="method">${html(productionMethod(item))}</span>
      <span class="materials ${html(materials.tone)}">${html(materials.label)}</span>
      <span class="artwork ${html(orderArtworkKey(item))}">${html(productionArtworkLabel(item))}</span>
      ${twoLineCell(dueParts.primary, dueParts.secondary, `due ${dueState.key}`)}
      <span class="staff">${html(assigned(item) === "Not Yet Assigned" ? "Unassigned" : assigned(item))}</span>
      ${status(stage.label, stage.tone)}
      <span class="mvp-production-row-action"><button type="button" data-mvp-open="production" data-mvp-id="${html(item.id)}">${html(action)} <i aria-hidden="true">&rsaquo;</i></button><button type="button" data-mvp-open="production" data-mvp-id="${html(item.id)}" aria-label="More actions for ${html(jobReference(item))}">&ctdot;</button></span>
    </div>`;
  }

  function productionCards(items) {
    return `<section class="mvp-production-card-list">${items.length ? items.map(productionMobileCard).join("") : empty("NO PRODUCTION JOBS MATCH THESE FILTERS")}</section>`;
  }

  function productionMobileCard(item) {
    const stage = productionWorkflowState(item);
    const dueState = due(item);
    const materials = productionMaterialsState(item);
    return `<article class="mvp-production-mobile-card" data-mvp-open="production" data-mvp-id="${html(item.id)}" role="button" tabindex="0"><div class="mvp-production-mobile-header"><div>${copyButton(jobReference(item), jobReference(item), "job reference")}<strong>${html(item.customer || "Unnamed customer")}</strong></div>${status(stage.label, stage.tone)}</div><div class="mvp-production-mobile-job"><strong>${html(productionSummaryPrimary(item))}</strong><span>${html(productionMethod(item))} ${String.fromCharCode(183)} ${html(fulfillment(item).toUpperCase())}</span></div><div class="mvp-production-mobile-ops"><span>Staff: ${html(assigned(item) === "Not Yet Assigned" ? "Unassigned" : assigned(item))}</span><span>Due: ${html(dueShortLabel(dueState, item))}</span><span>Materials: ${html(materials.label)}</span><span>Artwork: ${html(productionArtworkLabel(item))}</span></div></article>`;
  }

  function productionJobIdentityCell(item) {
    const source = sourceInquiryReference(item) !== "Not linked" || item.sourceType === "native" ? "FROM ORDER" : "LEGACY ORDER";
    return `<span class="job-identity">${copyButton(jobReference(item), jobReference(item), "job reference")}<small>${html(source)}</small></span>`;
  }

  function productionSummaryPrimary(item) {
    const itemText = itemDisplay(item);
    const qtyText = quantityDisplay(item);
    if (!qtyText || qtyText === "-" || itemText.toLowerCase().includes(qtyText.toLowerCase())) return itemText;
    return `${itemText} x ${qtyText}`;
  }

  function productionSummarySecondary(item) {
    return [productionMethod(item), fulfillment(item)].filter((value) => value && value !== "-" && value !== "Not set").join(" / ") || "Released order";
  }

  function productionMethodOptions(jobs) {
    const values = [...new Set((Array.isArray(jobs) ? jobs : []).map(productionMethod).filter((value) => value && value !== "Not set"))].sort();
    return values.map((value) => [value, value]);
  }

  function productionWorkflowState(item) {
    const stage = productionStage(item);
    if (productionBlocker(item)) return { key: "blocked", label: "BLOCKED", tone: "overdue" };
    if (stage === "completed") return { key: "completed", label: "COMPLETED", tone: "completed" };
    if (stage === "ready") return { key: "ready", label: "READY FOR FULFILLMENT", tone: "ready" };
    if (stage === "qc") return { key: "qc", label: "QUALITY CHECK", tone: "qc" };
    if (FIRST_PRODUCTION_STATIONS.includes(stage) && productionStarted(item)) return { key: "in_production", label: "IN PRODUCTION", tone: "active" };
    if (FIRST_PRODUCTION_STATIONS.includes(stage)) return { key: "queued", label: "QUEUED", tone: "queued" };
    return { key: "queued", label: "QUEUED", tone: "queued" };
  }

  function productionStarted(item) {
    return Boolean(String(item.productionStartedAt || item.production_started_at || "").trim());
  }

  function productionStatusMatches(item, statusValue) {
    if (statusValue === "all") return true;
    const stateInfo = productionWorkflowState(item);
    if (statusValue === "pickup_delivery") return stateInfo.key === "ready";
    return stateInfo.key === statusValue;
  }

  function productionMaterialsState(item) {
    const blocker = productionBlocker(item);
    const explicit = String(item.materialsStatus || item.materialStatus || item.productionMaterialsStatus || "").trim();
    if (explicit) return { label: explicit, tone: key(explicit).includes("missing") || key(explicit).includes("blocked") ? "danger" : "ok" };
    if (/material|thread|stock|fabric|supply/i.test(blocker)) return { label: blocker, tone: "danger" };
    return { label: "Not tracked", tone: "neutral" };
  }

  function productionArtworkLabel(item) {
    const artwork = orderArtworkKey(item);
    if (artwork === "approved") return "APPROVED";
    if (artwork === "revision") return "REVISION";
    if (artwork === "pending") return "PENDING";
    return "NOT SET";
  }

  function productionDashboardAction(item) {
    const stateInfo = productionWorkflowState(item);
    if (stateInfo.key === "blocked") return "Resolve";
    if (stateInfo.key === "queued") return "Start";
    if (stateInfo.key === "qc") return "Inspect";
    if (stateInfo.key === "ready") return "Inspect";
    if (stateInfo.key === "completed") return "View";
    return "Update";
  }

  function productionPagination(total, currentPage, pageCount, pageSize) {
    if (!total) return `<footer class="mvp-production-pagination"><span>Showing 0 jobs</span></footer>`;
    const start = (currentPage - 1) * pageSize + 1;
    const end = Math.min(total, currentPage * pageSize);
    const pages = Array.from({ length: pageCount }, (_, index) => index + 1).slice(0, 5);
    return `<footer class="mvp-production-pagination"><span>Showing ${start} to ${end} of ${total} ${total === 1 ? "job" : "jobs"}</span><nav aria-label="Production pagination"><button type="button" data-mvp-production-page="${Math.max(1, currentPage - 1)}" ${currentPage === 1 ? "disabled" : ""}>&lsaquo;</button>${pages.map((page) => `<button type="button" data-mvp-production-page="${page}" class="${page === currentPage ? "active" : ""}" aria-current="${page === currentPage ? "page" : "false"}">${page}</button>`).join("")}<button type="button" data-mvp-production-page="${Math.min(pageCount, currentPage + 1)}" ${currentPage === pageCount ? "disabled" : ""}>&rsaquo;</button><small>${pageSize} / page</small></nav></footer>`;
  }

  function productionInProgressDrawer(item, next, fieldsReady, gate) {
    const tabs = ["overview", "workflow", "assignment", "fulfillment", "history"];
    const activeTab = tabs.includes(state.productionTab) ? state.productionTab : "overview";
    state.productionTab = activeTab;
    const body = productionInProgressPanel(item, activeTab, fieldsReady);
    return `<button class="mvp-drawer-backdrop" data-mvp-close type="button" aria-label="Close production details"></button><aside class="mvp-drawer production mvp-production-drawer in-progress" aria-label="Production details">
      <header class="mvp-production-drawer-header">
        <div class="mvp-production-header-top"><mark>IN PRODUCTION</mark><button type="button" data-mvp-close aria-label="Close details">X</button></div>
        <div class="mvp-production-code-row">${copyButton(jobReference(item), jobReference(item), "job reference")}</div>
        <h2>${html(item.customer || item.company || "Unnamed customer")}</h2>
        <p>${html(productionMetaLine(item))}</p>
      </header>
      <nav class="mvp-production-drawer-tabs" aria-label="Production drawer tabs">${tabs.map((tab) => `<button type="button" data-mvp-production-tab="${tab}" class="${activeTab === tab ? "active" : ""}" aria-selected="${activeTab === tab ? "true" : "false"}">${html(tabLabel(tab))}</button>`).join("")}</nav>
      <div class="mvp-drawer-body mvp-production-drawer-body">${body}</div>
      <footer class="mvp-drawer-footer mvp-production-drawer-footer">${productionInProgressFooter(item, activeTab, next, fieldsReady, gate)}</footer>
    </aside>`;
  }

  function productionQualityCheckDrawer(item, next, fieldsReady, gate) {
    const tabs = ["overview", "workflow", "assignment", "fulfillment", "history"];
    const activeTab = tabs.includes(state.productionTab) ? state.productionTab : "overview";
    state.productionTab = activeTab;
    const body = productionQualityCheckPanel(item, activeTab, fieldsReady);
    return `<button class="mvp-drawer-backdrop" data-mvp-close type="button" aria-label="Close production details"></button><aside class="mvp-drawer production mvp-production-drawer in-progress quality-check" aria-label="Production details">
      <header class="mvp-production-drawer-header">
        <div class="mvp-production-header-top"><mark>QUALITY CHECK</mark><button type="button" data-mvp-close aria-label="Close details">X</button></div>
        <div class="mvp-production-code-row">${copyButton(jobReference(item), jobReference(item), "job reference")}</div>
        <h2>${html(item.customer || item.company || "Unnamed customer")}</h2>
        <p>${html(productionMetaLine(item))}</p>
      </header>
      <nav class="mvp-production-drawer-tabs" aria-label="Production drawer tabs">${tabs.map((tab) => `<button type="button" data-mvp-production-tab="${tab}" class="${activeTab === tab ? "active" : ""}" aria-selected="${activeTab === tab ? "true" : "false"}">${html(tabLabel(tab))}</button>`).join("")}</nav>
      <div class="mvp-drawer-body mvp-production-drawer-body">${body}</div>
      <footer class="mvp-drawer-footer mvp-production-drawer-footer">${productionQualityCheckFooter(item, activeTab, next, fieldsReady, gate)}</footer>
    </aside>`;
  }

  function productionReadyDrawer(item, next, fieldsReady, gate) {
    const tabs = ["overview", "workflow", "assignment", "fulfillment", "history"];
    const activeTab = tabs.includes(state.productionTab) ? state.productionTab : "overview";
    state.productionTab = activeTab;
    const body = productionReadyPanel(item, activeTab);
    return `<button class="mvp-drawer-backdrop" data-mvp-close type="button" aria-label="Close production details"></button><aside class="mvp-drawer production mvp-production-drawer in-progress ready-fulfillment" aria-label="Production details">
      <header class="mvp-production-drawer-header">
        <div class="mvp-production-header-top"><mark>READY FOR FULFILLMENT</mark><button type="button" data-mvp-close aria-label="Close details">X</button></div>
        <div class="mvp-production-code-row">${copyButton(jobReference(item), jobReference(item), "job reference")}</div>
        <h2>${html(item.customer || item.company || "Unnamed customer")}</h2>
        <p>${html(productionMetaLine(item))}</p>
      </header>
      <nav class="mvp-production-drawer-tabs" aria-label="Production drawer tabs">${tabs.map((tab) => `<button type="button" data-mvp-production-tab="${tab}" class="${activeTab === tab ? "active" : ""}" aria-selected="${activeTab === tab ? "true" : "false"}">${html(tabLabel(tab))}</button>`).join("")}</nav>
      <div class="mvp-drawer-body mvp-production-drawer-body">${body}</div>
      <footer class="mvp-drawer-footer mvp-production-drawer-footer">${productionReadyFooter(item, activeTab, next, fieldsReady, gate)}</footer>
    </aside>`;
  }

  function productionCompletedDrawer(item) {
    const tabs = ["overview", "workflow", "assignment", "fulfillment", "history"];
    const activeTab = tabs.includes(state.productionTab) ? state.productionTab : "overview";
    state.productionTab = activeTab;
    const body = productionCompletedPanel(item, activeTab);
    return `<button class="mvp-drawer-backdrop" data-mvp-close type="button" aria-label="Close production details"></button><aside class="mvp-drawer production mvp-production-drawer in-progress completed-production" aria-label="Production details">
      <header class="mvp-production-drawer-header">
        <div class="mvp-production-header-top"><mark>COMPLETED</mark><button type="button" data-mvp-close aria-label="Close details">X</button></div>
        <div class="mvp-production-code-row">${copyButton(jobReference(item), jobReference(item), "job reference")}</div>
        <h2>${html(item.customer || item.company || "Unnamed customer")}</h2>
        <p>${html(productionMetaLine(item))}</p>
      </header>
      <nav class="mvp-production-drawer-tabs" aria-label="Production drawer tabs">${tabs.map((tab) => `<button type="button" data-mvp-production-tab="${tab}" class="${activeTab === tab ? "active" : ""}" aria-selected="${activeTab === tab ? "true" : "false"}">${html(tabLabel(tab))}</button>`).join("")}</nav>
      <div class="mvp-drawer-body mvp-production-drawer-body">${body}</div>
      <footer class="mvp-drawer-footer mvp-production-drawer-footer">${productionCompletedFooter(item, activeTab)}</footer>
    </aside>`;
  }

  function productionCompletedPanel(item, activeTab) {
    if (activeTab === "workflow") return productionCompletedWorkflow(item);
    if (activeTab === "assignment") return productionCompletedAssignment(item);
    if (activeTab === "fulfillment") return productionCompletedFulfillment(item);
    if (activeTab === "history") return productionCompletedHistory(item);
    return productionCompletedOverview(item);
  }

  function productionReadyPanel(item, activeTab) {
    if (activeTab === "workflow") return productionReadyWorkflow(item);
    if (activeTab === "assignment") return productionReadyAssignment(item);
    if (activeTab === "fulfillment") return productionReadyFulfillment(item);
    if (activeTab === "history") return productionReadyHistory(item);
    return productionReadyOverview(item);
  }

  function productionCompletedOverview(item) {
    const completedAt = item.productionCompletedAt || item.production_completed_at;
    return `<section class="mvp-production-panel"><h3>ORDER SUMMARY</h3><div class="mvp-production-detail-list">
      ${productionDetailLine("Job reference", jobReference(item))}
      ${productionDetailLine("Product", product(item))}
      ${productionDetailLine("Method", productionMethod(item))}
      ${productionDetailLine("Quantity", quantityDisplay(item))}
      ${productionDetailLine("Sizes", item.sizeBreakdown || "Not set")}
      ${productionDetailLine("Color", item.color || item.garmentColor || messageValue(item.message, ["Color", "Garment Color"]) || "Not set")}
      ${productionDetailLine("Due Date", item.dueDate ? dateShort(item.dueDate) : "Not set")}
      ${productionDetailLine("Current Stage", "COMPLETED", "good")}
      ${productionDetailLine("Assigned Staff", assigned(item))}
    </div><h4>Production Handoff Summary</h4><div class="mvp-production-summary-rows">
      ${productionSummaryRow("Artwork Status", productionArtworkLabel(item), item.artworkApprovedAt)}
      ${productionSummaryRow("Payment Status", paymentState(item).label, item.paymentVerifiedAt || item.paymentConfirmedAt)}
      ${productionDetailLine("Released To Production", item.productionUpdatedAt ? dateTime(item.productionUpdatedAt) : "Not set")}
      ${productionSummaryRow("Production Started", dateTime(item.productionStartedAt), productionStartedByLabel(item))}
      ${productionSummaryRow("QC Started", dateTime(item.qcStartedAt), qcActorLabel(item, "started"))}
      ${productionSummaryRow("QC Completed", dateTime(item.qcCompletedAt), qcActorLabel(item, "completed"))}
      ${productionSummaryRow("Production Completed", dateTime(completedAt), productionCompletedByLabel(item))}
      ${productionReadonlyField("Completed By", productionCompletedByLabel(item))}
      ${productionReadonlyField("Completed At", completedAt ? dateTime(completedAt) : "Completion metadata unavailable")}
    </div><article class="mvp-production-info-card ok"><strong>Production completed</strong><span>Production work and internal handoff are complete. Customer pickup, delivery, and final Order closure remain managed from Orders.</span></article></section>`;
  }

  function productionCompletedWorkflow(item) {
    const rows = [
      { title: "Released to Production", state: "completed", when: item.productionUpdatedAt, actor: "Derived from production release" },
      { title: "In Production", state: "completed", when: item.productionStartedAt, actor: productionStartedByLabel(item) },
      { title: "Quality Check", state: "completed", when: item.qcStartedAt, actor: qcActorLabel(item, "started") },
      { title: "Ready for Fulfillment", state: "completed", when: item.qcCompletedAt, actor: qcActorLabel(item, "completed") },
      { title: "Production Completed", state: "current", when: item.productionCompletedAt || item.production_completed_at, actor: productionCompletedByLabel(item) },
    ];
    return `<section class="mvp-production-panel"><h3>PRODUCTION REQUIREMENTS</h3><div class="mvp-production-timeline">${rows.map(productionTimelineEvent).join("")}</div><article class="mvp-production-info-card neutral"><strong>About this stage</strong><span>Production and QC are closed for this job. Final customer fulfillment is handled from the linked Order.</span></article></section>`;
  }

  function productionCompletedAssignment(item) {
    const completedAt = item.productionCompletedAt || item.production_completed_at;
    return `<section class="mvp-production-panel"><h3>ASSIGNMENT &amp; NOTES</h3><div class="mvp-production-readonly-fields">
      ${productionReadonlyField("Assigned Production Staff", assigned(item))}
      ${productionReadonlyField("Production Started By", productionStartedByLabel(item))}
      ${productionReadonlyField("QC Completed By", qcActorLabel(item, "completed"))}
      ${productionReadonlyField("Production Completed By", productionCompletedByLabel(item))}
      ${productionReadonlyField("Production Completed At", completedAt ? dateTime(completedAt) : "Completion metadata unavailable")}
    </div><label class="mvp-production-note-field"><span>Internal Production Note</span><textarea disabled>${html(item.productionNote || "")}</textarea><small>Read only</small></label><label class="mvp-production-note-field"><span>Quality Check Note</span><textarea disabled>${html(item.qcNote || "")}</textarea><small>Read only</small></label><article class="mvp-production-info-card neutral"><strong>Locked</strong><span>Completed production records are read-only here. Reassignment, production notes, QC notes, and stage changes are not available after completion.</span></article></section>`;
  }

  function productionCompletedFulfillment(item) {
    const trackingLabel = tracking(item);
    const visibleStatus = trackingLabel !== "Not set" ? trackingLabel : "Production Completed";
    return `<section class="mvp-production-panel"><h3>FULFILLMENT</h3><div class="mvp-production-readonly-fields">
      ${productionReadonlyField("Method", fulfillment(item))}
      ${productionReadonlyField("Customer Contact", item.contact || "Not set")}
      ${productionReadonlyField("Address", productionFulfillmentAddress(item))}
      ${productionReadonlyField("Customer Tracking", trackingLabel)}
      ${productionReadonlyField("Customer Visible Status", visibleStatus, trackingLabel === "Not set" ? "warning" : "good")}
      ${productionReadonlyField("Customer Note", item.trackingNote || customerNotes(item) || "Not set")}
    </div><article class="mvp-production-info-card neutral"><strong>Order-owned fulfillment</strong><span>Pickup, delivery, customer tracking, and final Order completion are read-only here and remain managed from Orders.</span></article></section>`;
  }

  function productionCompletedHistory(item) {
    const rows = productionHistoryRows(item);
    return `<section class="mvp-production-panel"><h3>HISTORY</h3><div class="mvp-production-history">${rows.map(productionHistoryEvent).join("")}</div></section>`;
  }

  function productionCompletedFooter(item, activeTab) {
    const orderRoute = `/orders?order=${encodeURIComponent(orderReference(item))}`;
    if (activeTab === "fulfillment") return `<button class="mvp-secondary-action" type="button" data-mvp-route="${orderRoute}">View Order Fulfillment</button><button class="mvp-secondary-action" type="button" disabled>More</button>`;
    return `<button class="mvp-primary-action" type="button" data-mvp-route="${orderRoute}">View Order</button><button class="mvp-secondary-action" type="button" disabled>More</button>`;
  }

  function productionQualityCheckPanel(item, activeTab, fieldsReady) {
    if (activeTab === "workflow") return productionQualityCheckWorkflow(item);
    if (activeTab === "assignment") return productionQualityCheckAssignment(item, fieldsReady);
    if (activeTab === "fulfillment") return productionQualityCheckFulfillment(item);
    if (activeTab === "history") return productionQualityCheckHistory(item);
    return productionQualityCheckOverview(item);
  }

  function productionReadyOverview(item) {
    const blocker = productionBlocker(item);
    return `<section class="mvp-production-panel"><h3>ORDER SUMMARY</h3><div class="mvp-production-detail-list">
      ${productionDetailLine("Job reference", jobReference(item))}
      ${productionDetailLine("Product", product(item))}
      ${productionDetailLine("Method", productionMethod(item))}
      ${productionDetailLine("Quantity", quantityDisplay(item))}
      ${productionDetailLine("Sizes", item.sizeBreakdown || "Not set")}
      ${productionDetailLine("Color", item.color || item.garmentColor || messageValue(item.message, ["Color", "Garment Color"]) || "Not set")}
      ${productionDetailLine("Due Date", item.dueDate ? dateShort(item.dueDate) : "Not set")}
      ${productionDetailLine("Current Stage", "READY FOR FULFILLMENT", "good")}
      ${productionDetailLine("Assigned Staff", assigned(item))}
    </div><h4>Release &amp; Payment Summary</h4><div class="mvp-production-summary-rows">
      ${productionSummaryRow("Artwork Status", productionArtworkLabel(item), item.artworkApprovedAt)}
      ${productionSummaryRow("Payment Status", paymentState(item).label, item.paymentVerifiedAt || item.paymentConfirmedAt)}
      ${productionDetailLine("Released To Production", item.productionUpdatedAt ? dateTime(item.productionUpdatedAt) : "Not set")}
      ${productionSummaryRow("Production Started", dateTime(item.productionStartedAt), productionStartedByLabel(item))}
      ${productionSummaryRow("QC Started", dateTime(item.qcStartedAt), qcActorLabel(item, "started"))}
      ${productionSummaryRow("QC Completed", dateTime(item.qcCompletedAt), qcActorLabel(item, "completed"))}
    </div><article class="mvp-production-info-card ${blocker ? "danger" : "ok"}"><strong>${html(blocker ? "Production blocker" : "Production is ready for fulfillment.")}</strong><span>${html(blocker || "Production and quality check are complete. The order is ready for pickup/front counter or delivery handoff.")}</span></article></section>`;
  }

  function productionReadyWorkflow(item) {
    const rows = [
      { title: "Released to Production", state: "completed", when: item.productionUpdatedAt, actor: "Derived from production release" },
      { title: "In Production", state: "completed", when: item.productionStartedAt, actor: productionStartedByLabel(item) },
      { title: "Quality Check", state: "completed", when: item.qcStartedAt, actor: qcActorLabel(item, "started") },
      { title: "Ready for Fulfillment", state: "current", when: item.qcCompletedAt, actor: qcActorLabel(item, "completed") },
      { title: "Completed", state: "pending" },
    ];
    return `<section class="mvp-production-panel"><h3>PRODUCTION REQUIREMENTS</h3><div class="mvp-production-timeline">${rows.map(productionTimelineEvent).join("")}</div><article class="mvp-production-info-card neutral"><strong>About this stage</strong><span>Production has passed quality check and is ready for internal handoff. Customer pickup or delivery completion remains in Orders.</span></article></section>`;
  }

  function productionReadyAssignment(item) {
    return `<section class="mvp-production-panel"><h3>ASSIGNMENT &amp; NOTES</h3><div class="mvp-production-readonly-fields">
      ${productionReadonlyField("Assigned Production Staff", assigned(item))}
      ${productionReadonlyField("Production Started By", productionStartedByLabel(item))}
      ${productionReadonlyField("QC Completed By", qcActorLabel(item, "completed"))}
    </div><label class="mvp-production-note-field"><span>Internal Production Note</span><textarea disabled>${html(item.productionNote || "")}</textarea><small>${html(String(item.productionNote || "").length)} / 500</small></label><label class="mvp-production-note-field"><span>Quality Check Note</span><textarea disabled>${html(item.qcNote || "")}</textarea><small>${html(String(item.qcNote || "").length)} / 500</small></label><article class="mvp-production-info-card neutral"><strong>Locked</strong><span>Production assignment and notes are locked after Quality Check completion.</span></article></section>`;
  }

  function productionReadyFulfillment(item) {
    const trackingLabel = tracking(item);
    const visibleStatus = trackingLabel !== "Not set" ? trackingLabel : "Ready for Fulfillment";
    return `<section class="mvp-production-panel"><h3>FULFILLMENT</h3><div class="mvp-production-readonly-fields">
      ${productionReadonlyField("Method", fulfillment(item))}
      ${productionReadonlyField("Customer Contact", item.contact || "Not set")}
      ${productionReadonlyField("Address", productionFulfillmentAddress(item))}
      ${productionReadonlyField("Customer Tracking", trackingLabel)}
      ${productionReadonlyField("Customer Visible Status", visibleStatus, "good")}
      ${productionReadonlyField("Customer Note", item.trackingNote || customerNotes(item) || "Not set")}
    </div><article class="mvp-production-info-card neutral"><strong>Order-owned fulfillment</strong><span>Pickup, delivery, customer tracking, and customer notes are read-only here and remain managed from Orders.</span></article></section>`;
  }

  function productionReadyHistory(item) {
    const rows = productionHistoryRows(item);
    return `<section class="mvp-production-panel"><h3>HISTORY</h3><div class="mvp-production-history">${rows.map(productionHistoryEvent).join("")}</div></section>`;
  }

  function productionReadyFooter(item, activeTab, next, fieldsReady, gate) {
    if (activeTab === "fulfillment") return `<button class="mvp-secondary-action" type="button" data-mvp-route="/orders?order=${encodeURIComponent(orderReference(item))}">View Order Fulfillment</button><button class="mvp-secondary-action" type="button" disabled>More</button>`;
    if (activeTab === "history") return `<button class="mvp-primary-action" type="button" data-mvp-route="/orders?order=${encodeURIComponent(orderReference(item))}">View Order</button><button class="mvp-secondary-action" type="button" disabled>More</button>`;
    const missingQcCompletion = !item.qcCompletedAt;
    const disabled = !fieldsReady || gate.length || next !== "completed" || missingQcCompletion;
    return `<button class="mvp-primary-action" type="button" data-mvp-advance="${html(item.id)}" data-mvp-next="completed" ${disabled ? "disabled" : ""}>MARK PRODUCTION COMPLETE</button><button class="mvp-secondary-action" type="button" disabled>More</button>${gate.length ? `<small>Resolve before completing Production: ${html(gate.join(", "))}</small>` : missingQcCompletion ? `<small>QC completion metadata is required before Production completion.</small>` : ""}`;
  }

  function productionQualityCheckOverview(item) {
    const blocker = productionBlocker(item);
    return `<section class="mvp-production-panel"><h3>ORDER SUMMARY</h3><div class="mvp-production-detail-list">
      ${productionDetailLine("Job reference", jobReference(item))}
      ${productionDetailLine("Product", product(item))}
      ${productionDetailLine("Method", productionMethod(item))}
      ${productionDetailLine("Quantity", quantityDisplay(item))}
      ${productionDetailLine("Sizes", item.sizeBreakdown || "Not set")}
      ${productionDetailLine("Color", item.color || item.garmentColor || messageValue(item.message, ["Color", "Garment Color"]) || "Not set")}
      ${productionDetailLine("Due Date", item.dueDate ? dateShort(item.dueDate) : "Not set")}
      ${productionDetailLine("Current Stage", "Quality Check", "warning")}
      ${productionDetailLine("Assigned Staff", assigned(item))}
    </div><h4>Release &amp; Payment Summary</h4><div class="mvp-production-summary-rows">
      ${productionSummaryRow("Artwork Status", productionArtworkLabel(item), item.artworkApprovedAt)}
      ${productionSummaryRow("Payment Status", paymentState(item).label, item.paymentVerifiedAt || item.paymentConfirmedAt)}
      ${productionDetailLine("Released To Production", item.productionUpdatedAt ? dateTime(item.productionUpdatedAt) : "Not set")}
      ${productionSummaryRow("Production Started", dateTime(item.productionStartedAt), productionStartedByLabel(item))}
      ${productionSummaryRow("QC Started", dateTime(item.qcStartedAt), qcActorLabel(item, "started"))}
    </div><article class="mvp-production-info-card ${blocker ? "danger" : "ok"}"><strong>${html(blocker ? "Production blocker" : "No production blocker")}</strong><span>${html(blocker || "Every item is in quality check before moving to fulfillment readiness.")}</span></article></section>`;
  }

  function productionQualityCheckWorkflow(item) {
    const rows = [
      { title: "Released to Production", state: "completed", when: item.productionUpdatedAt, actor: "Derived from production release" },
      { title: "In Production", state: "completed", when: item.productionStartedAt, actor: productionStartedByLabel(item) },
      { title: "Quality Check", state: "current", when: item.qcStartedAt, actor: qcActorLabel(item, "started") },
      { title: "Ready for Fulfillment", state: "pending" },
      { title: "Completed", state: "pending" },
    ];
    return `<section class="mvp-production-panel"><h3>PRODUCTION REQUIREMENTS</h3><div class="mvp-production-timeline">${rows.map(productionTimelineEvent).join("")}</div><article class="mvp-production-info-card neutral"><strong>About this stage</strong><span>Every item is inspected for quality, quantity, artwork accuracy, and overall condition before moving to the next stage.</span></article></section>`;
  }

  function productionQualityCheckAssignment(item, fieldsReady) {
    const disabled = !fieldsReady || assignmentControlsDisabled();
    const help = assignmentNotice();
    return `<section class="mvp-production-panel"><h3>ASSIGNMENT &amp; NOTES</h3><div class="mvp-production-assignment-field"><label><span>Assigned Production Staff</span><div class="mvp-production-assignment-row"><select data-mvp-production-staff="${html(item.id)}" ${disabled ? "disabled" : ""}>${assignmentSelectOptions(item.assignedUserId, item.assignedStaff || item.assigned, "Unassigned")}</select><button type="button" data-mvp-save-production="${html(item.id)}" ${disabled ? "disabled" : ""}>Reassign</button></div></label>${help}</div><label class="mvp-production-note-field"><span>Internal Production Note</span><textarea data-mvp-production-note="${html(item.id)}" maxlength="500" ${fieldsReady ? "" : "disabled"}>${html(item.productionNote || "")}</textarea><small>${html(String(item.productionNote || "").length)} / 500</small></label><label class="mvp-production-note-field"><span>Quality Check Note (Optional)</span><textarea data-mvp-qc-note="${html(item.id)}" maxlength="500" ${fieldsReady ? "" : "disabled"}>${html(item.qcNote || "")}</textarea><small>${html(String(item.qcNote || "").length)} / 500</small></label><article class="mvp-production-info-card ok"><strong>Last Updated</strong><span>${html(item.productionUpdatedAt ? `${dateTime(item.productionUpdatedAt)} by ${assigned(item)}` : "No production update recorded.")}</span></article></section>`;
  }

  function productionQualityCheckFulfillment(item) {
    return `<section class="mvp-production-panel"><h3>FULFILLMENT</h3><div class="mvp-production-readonly-fields">
      ${productionReadonlyField("Method", fulfillment(item))}
      ${productionReadonlyField("Customer Tracking", tracking(item))}
      ${productionReadonlyField("Customer Visible Status", "Not Ready", "warning")}
      ${productionReadonlyField("Customer Contact", item.contact || "Not set")}
      ${productionReadonlyField("Customer Note", item.trackingNote || customerNotes(item) || "Not set")}
    </div><article class="mvp-production-info-card neutral"><strong>Status</strong><span>Status will change to Ready for Fulfillment when quality check is completed and items are approved.</span></article></section>`;
  }

  function productionQualityCheckHistory(item) {
    const rows = productionHistoryRows(item);
    return `<section class="mvp-production-panel"><h3>HISTORY</h3><div class="mvp-production-history">${rows.map(productionHistoryEvent).join("")}</div></section>`;
  }

  function productionQualityCheckFooter(item, activeTab, next, fieldsReady, gate) {
    if (activeTab === "assignment") return `<button class="mvp-primary-action" type="button" data-mvp-save-qc-note="${html(item.id)}" ${!fieldsReady ? "disabled" : ""}>Save QC Note</button><button class="mvp-secondary-action" type="button" disabled>More</button>`;
    if (activeTab === "fulfillment") return `<button class="mvp-secondary-action" type="button" data-mvp-route="/orders?order=${encodeURIComponent(orderReference(item))}">View Order Fulfillment</button><button class="mvp-secondary-action" type="button" disabled>More</button>`;
    if (activeTab === "history") return `<button class="mvp-primary-action" type="button" data-mvp-route="/orders?order=${encodeURIComponent(orderReference(item))}">View Order</button><button class="mvp-secondary-action" type="button" disabled>More</button>`;
    const missingQcStart = !item.qcStartedAt;
    const disabled = !fieldsReady || gate.length || next !== "ready" || missingQcStart;
    return `<button class="mvp-primary-action" type="button" data-mvp-advance="${html(item.id)}" data-mvp-next="ready" ${disabled ? "disabled" : ""}>Complete Quality Check</button><button class="mvp-secondary-action" type="button" disabled>More</button>${gate.length ? `<small>Resolve before completing QC: ${html(gate.join(", "))}</small>` : missingQcStart ? `<small>QC started metadata is required before completion.</small>` : ""}`;
  }

  function productionInProgressPanel(item, activeTab, fieldsReady) {
    if (activeTab === "workflow") return productionInProgressWorkflow(item);
    if (activeTab === "assignment") return productionInProgressAssignment(item, fieldsReady);
    if (activeTab === "fulfillment") return productionInProgressFulfillment(item);
    if (activeTab === "history") return productionInProgressHistory(item);
    return productionInProgressOverview(item);
  }

  function productionInProgressOverview(item) {
    const blocker = productionBlocker(item);
    return `<section class="mvp-production-panel"><h3>ORDER SUMMARY</h3><div class="mvp-production-detail-list">
      ${productionDetailLine("Job reference", jobReference(item))}
      ${productionDetailLine("Product", product(item))}
      ${productionDetailLine("Quantity", quantityDisplay(item))}
      ${productionDetailLine("Sizes", item.sizeBreakdown || "Not set")}
      ${productionDetailLine("Color", item.color || item.garmentColor || messageValue(item.message, ["Color", "Garment Color"]) || "Not set")}
      ${productionDetailLine("Due Date", item.dueDate ? dateShort(item.dueDate) : "Not set")}
      ${productionDetailLine("Current Stage", "In Production", "good")}
      ${productionDetailLine("Assigned Staff", assigned(item))}
    </div><h4>Release &amp; Payment Summary</h4><div class="mvp-production-summary-rows">
      ${productionSummaryRow("Artwork Status", productionArtworkLabel(item), item.artworkApprovedAt)}
      ${productionSummaryRow("Payment Status", paymentState(item).label, item.paymentVerifiedAt || item.paymentConfirmedAt)}
      ${productionDetailLine("Released To Production", item.productionUpdatedAt ? dateTime(item.productionUpdatedAt) : "Not set")}
      ${productionSummaryRow("Production Started", dateTime(item.productionStartedAt), productionStartedByLabel(item))}
    </div><article class="mvp-production-info-card ${blocker ? "danger" : "ok"}"><strong>${html(blocker ? "Production blocker" : "No production blocker")}</strong><span>${html(blocker || "Production is in progress.")}</span></article></section>`;
  }

  function productionInProgressWorkflow(item) {
    const rows = [
      { title: "Released to Production", state: "completed", when: item.productionUpdatedAt, actor: "Derived from production release" },
      { title: "In Production", state: "current", when: item.productionStartedAt, actor: productionStartedByLabel(item) },
      { title: "Quality Check", state: "pending" },
      { title: "Ready for Fulfillment", state: "pending" },
      { title: "Completed", state: "pending" },
    ];
    const blocker = productionBlocker(item);
    return `<section class="mvp-production-panel"><h3>PRODUCTION REQUIREMENTS</h3><div class="mvp-production-timeline">${rows.map(productionTimelineEvent).join("")}</div><h4>PRODUCTION BLOCKER</h4><article class="mvp-production-info-card ${blocker ? "danger" : "ok"}"><strong>${html(blocker ? "Blocked" : "No blocker")}</strong><span>${html(blocker || "Production is moving forward smoothly.")}</span></article></section>`;
  }

  function productionInProgressAssignment(item, fieldsReady) {
    const disabled = !fieldsReady || assignmentControlsDisabled();
    const help = assignmentNotice();
    return `<section class="mvp-production-panel"><h3>ASSIGNMENT &amp; NOTES</h3><div class="mvp-production-assignment-field"><label><span>Assigned Production Staff</span><div class="mvp-production-assignment-row"><select data-mvp-production-staff="${html(item.id)}" ${disabled ? "disabled" : ""}>${assignmentSelectOptions(item.assignedUserId, item.assignedStaff || item.assigned, "Unassigned")}</select><button type="button" data-mvp-save-production="${html(item.id)}" ${disabled ? "disabled" : ""}>Reassign</button></div></label>${help}</div><label class="mvp-production-note-field"><span>Internal Production Note</span><textarea data-mvp-production-note="${html(item.id)}" maxlength="500" ${fieldsReady ? "" : "disabled"}>${html(item.productionNote || "")}</textarea><small>${html(String(item.productionNote || "").length)} / 500</small></label><article class="mvp-production-info-card ok"><strong>Last Updated</strong><span>${html(item.productionUpdatedAt ? `${dateTime(item.productionUpdatedAt)} by ${assigned(item)}` : "No production update recorded.")}</span></article></section>`;
  }

  function productionInProgressFulfillment(item) {
    const visibleStatus = productionWorkflowState(item).key === "ready" ? productionDisplay(item).label : "Not Ready";
    return `<section class="mvp-production-panel"><h3>FULFILLMENT DETAILS</h3><div class="mvp-production-readonly-fields">
      ${productionReadonlyField("Method", fulfillment(item))}
      ${productionReadonlyField("Customer Tracking", tracking(item))}
      ${productionReadonlyField("Customer Visible Status", visibleStatus, visibleStatus === "Not Ready" ? "warning" : "good")}
      ${productionReadonlyField("Customer Note", item.trackingNote || customerNotes(item) || "Not set")}
    </div><article class="mvp-production-info-card neutral"><strong>Readiness</strong><span>Order-owned fulfillment data is read-only here. Readiness updates when Production reaches Quality Check and later fulfillment states.</span></article></section>`;
  }

  function productionInProgressHistory(item) {
    const rows = productionHistoryRows(item);
    return `<section class="mvp-production-panel"><h3>PRODUCTION HISTORY</h3><div class="mvp-production-history">${rows.map(productionHistoryEvent).join("")}</div></section>`;
  }

  function productionInProgressFooter(item, activeTab, next, fieldsReady, gate) {
    if (activeTab === "assignment") return `<button class="mvp-primary-action" type="button" data-mvp-save-production="${html(item.id)}" ${!fieldsReady ? "disabled" : ""}>Save Note</button><button class="mvp-secondary-action" type="button" disabled>More</button>`;
    if (activeTab === "fulfillment") return `<button class="mvp-secondary-action" type="button" data-mvp-route="/orders?order=${encodeURIComponent(orderReference(item))}">View Order Fulfillment</button><button class="mvp-secondary-action" type="button" disabled>More</button>`;
    if (activeTab === "history") return `<button class="mvp-primary-action" type="button" data-mvp-route="/orders?order=${encodeURIComponent(orderReference(item))}">View Order</button><button class="mvp-secondary-action" type="button" disabled>More</button>`;
    const disabled = !fieldsReady || gate.length || next !== "qc";
    return `<button class="mvp-primary-action" type="button" data-mvp-advance="${html(item.id)}" data-mvp-next="qc" ${disabled ? "disabled" : ""}>Move to Quality Check</button><button class="mvp-secondary-action" type="button" disabled>More</button>${gate.length ? `<small>Resolve before advancing: ${html(gate.join(", "))}</small>` : ""}`;
  }

  function productionHistoryRows(item) {
    const rows = [];
    if (item.createdAt || item.orderCreatedAt) rows.push({ title: "Order created", when: item.orderCreatedAt || item.createdAt, source: sourceInquiryReference(item) !== "Not linked" ? `Derived from source inquiry ${sourceInquiryReference(item)}` : "Derived from order data" });
    if (item.paymentConfirmedAt || item.paymentVerifiedAt) rows.push({ title: "Payment confirmed", when: item.paymentConfirmedAt || item.paymentVerifiedAt, source: "Derived from payment fields" });
    if (item.artworkApprovedAt) rows.push({ title: "Artwork approved", when: item.artworkApprovedAt, source: "Derived from artwork approval" });
    if (item.productionUpdatedAt) rows.push({ title: "Released to production", when: item.productionUpdatedAt, source: "Derived from production fields" });
    if (item.productionStartedAt) rows.push({ title: "Production started", when: item.productionStartedAt, source: "Persisted production start fields", actor: productionStartedByLabel(item) });
    if (item.qcStartedAt) rows.push({ title: "Quality check started", when: item.qcStartedAt, source: "Persisted QC start fields", actor: qcActorLabel(item, "started") });
    if (item.qcCompletedAt) rows.push({ title: "Quality check completed", when: item.qcCompletedAt, source: "Persisted QC completion fields", actor: qcActorLabel(item, "completed") });
    if (productionStage(item) === "ready" && item.qcCompletedAt) rows.push({ title: "Ready for fulfillment", when: item.qcCompletedAt, source: "Derived from QC completion", actor: qcActorLabel(item, "completed") });
    if (item.productionCompletedAt) rows.push({ title: "Production completed", when: item.productionCompletedAt, source: "Persisted Production completion fields", actor: productionCompletedByLabel(item) });
    return rows.sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0));
  }

  function productionDetailLine(label, value, tone = "") {
    return `<div class="${tone ? `tone-${tone}` : ""}"><span>${html(label)}</span><strong>${html(value || "Not set")}</strong></div>`;
  }

  function productionSummaryRow(label, value, meta) {
    return `<div><span>${html(label)}</span><strong>${html(value || "Not set")}</strong>${meta ? `<small>${html(dateTime(meta) === "Not set" ? meta : dateTime(meta))}</small>` : ""}</div>`;
  }

  function productionTimelineEvent(row) {
    return `<article class="${html(row.state)}"><i aria-hidden="true">${row.state === "completed" ? "&check;" : ""}</i><div><strong>${html(row.title)}</strong><span>${html(row.state === "current" ? "Current Stage" : row.when ? dateTime(row.when) : "Pending")}</span>${row.actor ? `<small>${html(row.actor.startsWith("Derived") ? row.actor : `by ${row.actor}`)}</small>` : ""}</div></article>`;
  }

  function productionHistoryEvent(row) {
    return `<article><i aria-hidden="true"></i><div><span>${html(dateTime(row.when))}</span><strong>${html(row.title)}</strong><small>${html(row.actor ? `by ${row.actor}` : row.source)}</small></div></article>`;
  }

  function productionReadonlyField(label, value, tone = "") {
    return `<div class="${tone ? `tone-${tone}` : ""}"><span>${html(label)}</span><strong>${html(value || "Not set")}</strong></div>`;
  }

  function qcActorLabel(item, kind = "started") {
    const actorId = String(kind === "completed" ? item.qcCompletedBy || item.qc_completed_by || "" : item.qcStartedBy || item.qc_started_by || "").trim();
    if (!actorId) return "Not recorded";
    return assignmentName(findAssignmentUser(actorId)) || actorId;
  }

  function productionCompletedByLabel(item) {
    const actorId = String(item.productionCompletedBy || item.production_completed_by || "").trim();
    if (!actorId) return "Not recorded";
    return assignmentName(findAssignmentUser(actorId)) || actorId;
  }

  function productionFulfillmentAddress(item) {
    return item.deliveryAddress || item.delivery_address || item.shipAddress || item.shippingAddress || item.address || item.deliveryCity || item.delivery_city || "Not set";
  }

  function dateShort(value) {
    if (!value) return "";
    const date = new Date(`${value}`.includes("T") ? value : `${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function tabLabel(tab) {
    return tab.replace(/^\w/, (value) => value.toUpperCase());
  }

  function productionDrawer(item) {
    if (!item) return "";
    const released = isReleasedToProduction(item);
    const stage = productionStage(item);
    const stateInfo = productionWorkflowState(item);
    const next = released ? nextStage(item) : "";
    const gate = released ? productionAdvanceGate(item) : [];
    const fieldsReady = !item.requiresProductionMigration;
    const editorLocked = !released || ["ready", "completed"].includes(stage);
    const editorEnabled = fieldsReady && !editorLocked;
    const assignmentHelp = assignmentNotice();
    const assignmentDisabled = assignmentControlsDisabled();
    const blocker = productionBlocker(item);
    if (released && stateInfo.key === "in_production") return productionInProgressDrawer(item, next, fieldsReady, gate);
    if (released && stage === "qc") return productionQualityCheckDrawer(item, next, fieldsReady, gate);
    if (released && stage === "ready") return productionReadyDrawer(item, next, fieldsReady, gate);
    if (released && stage === "completed") return productionCompletedDrawer(item);
    const footer = released ? productionFooterAction(item, next, fieldsReady, gate) : `<section class="mvp-production-action"><span>Not released to Production</span><strong>Return to Orders</strong><button class="mvp-secondary-action" type="button" data-mvp-route="/orders?order=${encodeURIComponent(item.id)}">Open Order</button></section>`;
    return drawer("production", item, released ? stateInfo.label : "Not released", `
      ${detailSection("Job", [["Job Reference", jobReference(item)], ["Item", itemDisplay(item)], ["Method", productionMethod(item)], ["Quantity", quantityDisplay(item)], ["Due Date", dueShortLabel(due(item), item)], ["Order Reference", orderReference(item) === jobReference(item) ? "Same as job" : orderReference(item)], ["Current Production Status", released ? stateInfo.label : "Not released"], ["Production Started", item.productionStartedAt ? dateTime(item.productionStartedAt) : "Not started"]])}
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
    if (FIRST_PRODUCTION_STATIONS.includes(stage) && productionStarted(item)) return "qc";
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
    root.querySelectorAll("[data-mvp-production-status]").forEach((button) => button.addEventListener("click", () => {
      state.production.status = button.dataset.mvpProductionStatus || "all";
      state.production.page = 1;
      clearQuery();
      rerender();
    }));
    root.querySelectorAll("[data-mvp-order-tab]").forEach((button) => button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const tab = button.dataset.mvpOrderTab;
      if (!orderDrawerTabs().some((item) => item.key === tab)) return;
      state.orderTab = tab;
      rerender();
    }));
    root.querySelectorAll("[data-mvp-production-tab]").forEach((button) => button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const tab = button.dataset.mvpProductionTab;
      if (!["overview", "workflow", "assignment", "fulfillment", "history"].includes(tab)) return;
      state.productionTab = tab;
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
    root.querySelectorAll("[data-mvp-production-page]").forEach((button) => button.addEventListener("click", () => {
      const page = Number(button.dataset.mvpProductionPage);
      if (!Number.isFinite(page)) return;
      state.production.page = page;
      rerender();
    }));
    root.querySelectorAll("[data-mvp-open]").forEach((element) => {
      const open = () => { state.returnFocus = { type: element.dataset.mvpOpen, id: element.dataset.mvpId }; state[`${element.dataset.mvpOpen}Id`] = element.dataset.mvpId; if (element.dataset.mvpOpen === "order") state.orderTab = "overview"; if (element.dataset.mvpOpen === "production") state.productionTab = "overview"; if (element.dataset.mvpOpen === "inquiry") { state.inquiryTab = null; state.inquiryActionId = null; state.inquiryMoreOpen = false; } rerender(); requestAnimationFrame(() => root.querySelector(".mvp-drawer [data-mvp-close]")?.focus()); };
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
      const staffControl = root.querySelector(`[data-mvp-production-staff="${CSS.escape(id)}"]`);
      const noteControl = root.querySelector(`[data-mvp-production-note="${CSS.escape(id)}"]`);
      const blockedControl = root.querySelector(`[data-mvp-production-blocked="${CSS.escape(id)}"]`);
      const changes = {};
      if (staffControl) changes.assignedUserId = staffControl.value === "__legacy__" ? null : staffControl.value || null;
      if (noteControl) changes.productionNote = noteControl.value.trim() || null;
      if (blockedControl) changes.blockedReason = blockedControl.value || null;
      button.disabled = true; button.textContent = "Saving...";
      await saveProduction(id, changes);
      rerender();
    }));
    root.querySelectorAll("[data-mvp-save-qc-note]").forEach((button) => button.addEventListener("click", async () => {
      if (button.disabled) return;
      const id = button.dataset.mvpSaveQcNote;
      const noteControl = root.querySelector(`[data-mvp-qc-note="${CSS.escape(id)}"]`);
      const changes = { qcNote: noteControl?.value?.trim() || null };
      button.disabled = true; button.textContent = "Saving...";
      await saveProduction(id, changes);
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
    root.querySelectorAll("[data-mvp-release-order]").forEach((button) => button.addEventListener("click", async () => {
      if (button.disabled) return;
      const id = button.dataset.mvpReleaseOrder;
      const next = button.dataset.mvpNext;
      if (!id || !next) return;
      state.orderReleaseId = id;
      state.orderReleaseError = "";
      button.disabled = true;
      button.textContent = "RELEASING...";
      try {
        const result = await saveProduction?.(id, { productionStage: next });
        if (result && result.ok === false) throw new Error(result.error || "Release failed.");
      } catch (error) {
        state.orderReleaseError = error?.message || "Release failed.";
      } finally {
        state.orderReleaseId = null;
      }
      rerender();
    }));
    root.querySelectorAll("[data-mvp-start-production]").forEach((button) => button.addEventListener("click", async () => {
      if (button.disabled) return;
      const id = button.dataset.mvpStartProduction;
      button.disabled = true;
      button.textContent = "Starting...";
      await saveProduction(id, { startProduction: true });
      rerender();
    }));
    root.querySelectorAll("[data-mvp-advance]").forEach((button) => button.addEventListener("click", async () => {
      if (button.disabled) return;
      const id = button.dataset.mvpAdvance;
      const staffControl = root.querySelector(`[data-mvp-production-staff="${CSS.escape(id)}"]`);
      const noteControl = root.querySelector(`[data-mvp-production-note="${CSS.escape(id)}"]`);
      const blockedControl = root.querySelector(`[data-mvp-production-blocked="${CSS.escape(id)}"]`);
      const changes = { productionStage: button.dataset.mvpNext };
      if (staffControl) changes.assignedUserId = staffControl.value === "__legacy__" ? null : staffControl.value || null;
      if (noteControl) changes.productionNote = noteControl.value.trim() || null;
      if (blockedControl) changes.blockedReason = blockedControl.value || null;
      button.disabled = true; button.textContent = "Saving...";
      await saveProduction(id, changes);
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
