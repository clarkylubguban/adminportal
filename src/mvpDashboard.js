const QUOTE_STAGES = {
  new: "New Inquiry",
  quote: "Needs Quote",
  sent: "Quote Sent",
  followup: "Follow-up",
  approved: "Quote Approved",
  lost: "Lost",
};

const PRODUCTION_STAGES = [
  ["queued", "Queued"],
  ["printing", "Printing"],
  ["embroidery", "Embroidery"],
  ["screen_printing", "Screen Printing"],
  ["qc", "QC"],
  ["ready", "Ready"],
  ["completed", "Completed"],
];

const STAFF = ["Mika", "Jorge", "Len", "Paolo"];
const ACTIVE_STAGES = ["printing", "embroidery", "screen_printing", "qc"];

export function createMvpDashboard() {
  const state = {
    inquiryId: null,
    orderId: null,
    productionId: null,
    returnFocus: null,
    inquiry: { search: "", stage: "all", owner: "all", service: "all", due: "all" },
    order: { search: "", stage: "all", payment: "all", fulfillment: "all", due: "all" },
    production: { search: "", stage: "all", staff: "all", due: "all" },
  };

  const quoteStage = (item) => {
    if (key(item.status) === "lost") return "lost";
    if (key(item.quoteStatus) === "approved") return "approved";
    if (key(item.status) === "followup") return "followup";
    if (key(item.status) === "sent" || key(item.quoteStatus) === "ready") return "sent";
    if (key(item.status) === "quote") return "quote";
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
    if (["confirmed", "paid"].includes(value)) return "Paid";
    if (["proof_submitted", "under_review"].includes(value)) return "Proof Submitted";
    if (["required", "awaiting_payment"].includes(value)) return "Awaiting Payment";
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
    return Boolean(String(item.odooSO || "").trim()) && (status === "won" || key(item.quoteStatus) === "approved");
  };

  const blockedReason = (item) => {
    if (productionStage(item) !== "queued") return "";
    if (item.blockedReason) return item.blockedReason;
    const artwork = artworkLabel(item);
    if (artwork === "No Artwork") return "No artwork";
    if (artwork !== "Artwork Approved") return "Awaiting customer artwork approval";
    if (Number(item.amountDue) > 0 && paymentLabel(item) !== "Paid") return "Payment requirement not completed";
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
  const owner = (item) => item.owner || item.ownerId || "Unassigned";
  const assigned = (item) => item.assignedStaff || item.assigned || "Not Yet Assigned";
  const stageLabel = (value) => PRODUCTION_STAGES.find(([stage]) => stage === value)?.[1] || "Queued";
  const query = (name) => new URLSearchParams(window.location.search).get(name) || "";

  function renderOverview({ items, notices = "" }) {
    const inquiries = items.filter((item) => !confirmed(item));
    const orders = items.filter(confirmed);
    const pipeline = countBy(Object.keys(QUOTE_STAGES), inquiries, quoteStage);
    const production = countBy(PRODUCTION_STAGES.map(([value]) => value), orders, productionStage);
    const priorities = buildPriorities(orders, inquiries);
    const inProgress = ACTIVE_STAGES.reduce((sum, value) => sum + production[value], 0);
    const completedToday = orders.filter((item) => productionStage(item) === "completed" && String(item.productionUpdatedAt || item.updatedAt || "").slice(0, 10) === todayIso()).length;
    return `<main class="mvp-page ops-board-page mvp-overview-page">
      ${pageTitle("Overview", "What needs attention today", new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }))}
      ${notices}
      ${metricSection("Pipeline", [
        metric("New Inquiries", pipeline.new, "/inquiries?stage=new", "Inquiries"),
        metric("Needs Quote", pipeline.quote, "/inquiries?stage=quote", "Inquiries"),
        metric("Quote Sent / Follow-up", pipeline.sent + pipeline.followup, "/inquiries?stage=active_quote", "Inquiries"),
        metric("Quote Approved / Awaiting SO", pipeline.approved, "/inquiries?stage=approved", "Inquiries", "lime"),
      ], "pipeline")}
      ${metricSection("Operations", [
        metric("Awaiting Payment", orders.filter((item) => paymentLabel(item) === "Awaiting Payment").length, "/orders?payment=awaiting", "Orders"),
        metric("In Production", inProgress, "/production?stage=in_progress", "Production"),
        metric("Overdue", orders.filter((item) => due(item).key === "overdue").length, "/production?due=overdue", "Production", "danger"),
        metric("Ready for Release", production.ready, "/orders?stage=ready", "Orders"),
        metric("Completed Today", completedToday, "/production?stage=completed", "Production"),
      ], "operations")}
      <section class="mvp-overview-grid">
        <div class="mvp-section"><div class="mvp-section-title"><h2>Today's Priorities</h2><span>${priorities.length}</span></div><div class="mvp-priority-list">${priorities.length ? priorities.map(priorityRow).join("") : empty("NO PRIORITIES REQUIRE ATTENTION")}</div></div>
        <div class="mvp-side-stack">${snapshot(orders, production, inProgress)}${staffWorkload(orders)}</div>
      </section>
    </main>`;
  }

  function buildPriorities(orders, inquiries) {
    const rows = [];
    orders.forEach((item) => {
      const dueState = due(item);
      const blocked = blockedReason(item);
      if (dueState.key === "overdue" || blocked) rows.push(priority(item, blocked ? `Blocked: ${blocked}` : "Order is overdue", dueState.label, `/production?order=${encodeURIComponent(item.id)}`, dueState.key === "overdue" ? "danger" : "warning"));
      else if (paymentLabel(item) === "Proof Submitted") rows.push(priority(item, "Payment proof submitted / verify payment", "Needs review", `/orders?order=${encodeURIComponent(item.id)}`, "warning"));
      else if (dueState.key === "today" || productionStage(item) === "ready") rows.push(priority(item, productionStage(item) === "ready" ? "Ready for release" : "Due today", dueState.label, `/orders?order=${encodeURIComponent(item.id)}`, ""));
    });
    inquiries.forEach((item) => {
      if (!item.followUpDate || ["approved", "lost"].includes(quoteStage(item))) return;
      const follow = new Date(`${item.followUpDate}T00:00:00`);
      const today = new Date(`${todayIso()}T00:00:00`);
      if (follow <= today) rows.push(priority(item, quoteStage(item) === "quote" ? "Quotation not sent" : "Customer follow-up due", follow < today ? `Since ${shortDate(item.followUpDate)}` : "Today", `/inquiries?inquiry=${encodeURIComponent(item.id)}`, follow < today ? "danger" : "warning"));
    });
    return rows.slice(0, 6);
  }

  return { state, renderOverview, renderInquiries, renderOrders, renderProduction, bind, helpers: { confirmed, productionStage, stageLabel } };
  function renderInquiries({ items, notices = "", renderQuote, renderOdoo }) {
    const inquiries = items.filter((item) => !confirmed(item));
    const stageFilter = query("stage") || state.inquiry.stage;
    const search = state.inquiry.search.toLowerCase();
    const rows = inquiries.filter((item) => {
      const stage = quoteStage(item);
      if (stageFilter === "active_quote" && !["sent", "followup"].includes(stage)) return false;
      if (!["all", "active_quote"].includes(stageFilter) && stage !== stageFilter) return false;
      if (state.inquiry.owner !== "all" && owner(item) !== state.inquiry.owner) return false;
      if (state.inquiry.service !== "all" && item.service !== state.inquiry.service) return false;
      if (state.inquiry.due !== "all" && inquiryDue(item) !== state.inquiry.due) return false;
      return !search || [item.id, item.customer, item.contact, item.service, product(item)].join(" ").toLowerCase().includes(search);
    });
    const selected = inquiries.find((item) => item.id === (state.inquiryId || query("inquiry")));
    return `<main class="mvp-page ops-board-page">
      ${pageTitle("Inquiries", "Inquiry Pipeline", `${inquiries.length} inquiries`)}
      <p class="mvp-rule">NO QUOTATION / NO WORK</p>${notices}
      ${filterBar("inquiry", items, ["owner", "service", "due"])}
      <div class="mvp-stage-cards">${Object.entries(QUOTE_STAGES).map(([value, label]) => `<button type="button" data-mvp-stage="${value}" class="${stageFilter === value ? "active" : ""}"><span>${label}</span><strong>${inquiries.filter((item) => quoteStage(item) === value).length}</strong></button>`).join("")}</div>
      ${inquiryTable(rows)}${inquiryDrawer(selected, renderQuote, renderOdoo)}
    </main>`;
  }

  function inquiryTable(items) {
    return table("inquiry", ["Code", "Customer", "Phone", "Inquiry / Item", "Service", "Qty", "Quote Status", "Follow-up", "Owner"], items.map((item) => {
      const stage = quoteStage(item);
      const phone = String(item.contact || "").trim();
      return row("inquiry", item.id, [
        copyButton(item.id, item.id, "inquiry code"),
        strong(item.customer || "Unnamed customer"),
        phone ? copyButton(phone, phone.replace(/\D/g, ""), "phone number") : cell("-"),
        cell(product(item)),
        cell(item.service || "-"),
        cell(item.qty || "-"),
        status(QUOTE_STAGES[stage], stage),
        `<span class="mvp-due ${inquiryDue(item)}">${item.followUpDate ? shortDate(item.followUpDate) : "-"}</span>`,
        cell(owner(item)),
      ]);
    }), "NO INQUIRIES MATCH THIS FILTER");
  }

  function inquiryDrawer(item, renderQuote, renderOdoo) {
    if (!item) return "";
    const stage = quoteStage(item);
    const amountReady = Number(item.quotedAmount) > 0;
    const approved = stage === "approved";
    const conversionAction = approved && amountReady && typeof renderOdoo === "function"
      ? renderOdoo(item)
      : `<button type="button" disabled>Confirm Odoo SO &amp; Create Order</button>`;
    const requestMessage = customerNotes(item) || "No customer message provided.";
    const moreDetails = item.message
      ? `<details class="mvp-more-details"><summary>MORE REQUEST DETAILS</summary><p>${html(item.message)}</p></details>`
      : "";
    return drawer("inquiry", item, QUOTE_STAGES[stage], `
      ${detailSection("Customer", [
        ["Full Name", item.customer || item.contact],
        ["Phone", item.contact],
        ["Company", item.company],
        ["Contact Channel", item.channel || item.source],
      ])}
      ${detailSection("Request", [
        ["Product / Item", product(item)],
        ["Service", item.service],
        ["Quantity", item.sizeBreakdown || item.qty],
        ["Needed Date", item.dueDate ? shortDate(item.dueDate) : "Not set"],
        ["Fulfillment", fulfillment(item)],
        ["Artwork / Reference", artworkLabel(item)],
      ], requestMessage)}${moreDetails}
      ${typeof renderQuote === "function" ? renderQuote(item) : detailSection("Quotation", [
        ["Quote Status", QUOTE_STAGES[stage]],
        ["Quoted Amount", money(item.quotedAmount)],
        ["Amount Due", money(item.amountDue)],
        ["Valid Until", item.quoteValidUntil ? shortDate(item.quoteValidUntil) : "Not set"],
        ["Published", dateTime(item.quotePublishedAt)],
      ], [item.quoteBreakdown, item.quoteNotes].filter(Boolean).join("\n\n"))}
      ${detailSection("Internal", [
        ["Owner", owner(item)],
        ["Priority", item.priority || "Normal"],
        ["Follow-up Date", item.followUpDate ? shortDate(item.followUpDate) : "Not set"],
        ["Internal Note", item.productionNote || item.internalNote || "Not set"],
        ["Last Update", dateTime(item.updatedAt)],
      ])}
      <section class="mvp-drawer-section"><h3>Conversion</h3><div class="mvp-detail-grid">
        <div><span>Quote Approval State</span><strong>${html(approved ? "Quote approved" : "Quote not approved")}</strong></div>
        <div><span>Odoo SO</span><strong>${html(item.odooSO || "Not created")}</strong></div>
        <div><span>Conversion Requirements</span><strong>${html(!approved ? "Customer quote approval is required." : !amountReady ? "A valid final quote amount is required." : item.odooSO ? "Order already has an Odoo sales order." : "Enter and confirm the Odoo SO to create the order.")}</strong></div>
      </div></section>
    `, conversionAction);
  }
  function renderOrders({ items, notices = "", schemaNotice = "", renderPayment, renderTracking }) {
    const orders = items.filter(confirmed);
    const stageQuery = query("stage");
    const paymentQuery = query("payment");
    const search = state.order.search.toLowerCase();
    const rows = orders.filter((item) => {
      const stage = productionStage(item);
      if (stageQuery && stage !== stageQuery) return false;
      if (paymentQuery === "awaiting" && paymentLabel(item) !== "Awaiting Payment") return false;
      if (state.order.stage !== "all" && stage !== state.order.stage) return false;
      if (state.order.payment !== "all" && paymentLabel(item) !== state.order.payment) return false;
      if (state.order.fulfillment !== "all" && key(item.fulfillmentMethod || "unset") !== state.order.fulfillment) return false;
      if (state.order.due !== "all" && due(item).key !== state.order.due) return false;
      return !search || [item.id, item.customer, item.contact, product(item), item.service, item.odooSO].join(" ").toLowerCase().includes(search);
    });
    const selected = orders.find((item) => item.id === (state.orderId || query("order")));
    return `<main class="mvp-page ops-board-page">${pageTitle("Orders", "Confirmed Orders", `${orders.length} orders`)}<p class="mvp-rule">NO CONFIRMED ORDER / DO NOT PRINT</p>${notices}${schemaNotice}
      ${filterBar("order", items, ["stage", "payment", "fulfillment", "due"])}${ordersTable(rows)}${orderDrawer(selected, renderPayment, renderTracking)}
    </main>`;
  }

  function ordersTable(items) {
    return table("orders", ["Code", "Customer", "Phone", "Product", "Service", "Qty", "Artwork", "Payment", "Due Date"], items.map((item) => {
      const dueState = due(item);
      const phone = String(item.contact || "").trim();
      return row("order", item.id, [
        copyButton(item.id, item.id, "order code"),
        strong(item.customer || "Unnamed customer"),
        phone ? copyButton(phone, phone.replace(/\D/g, ""), "phone number") : cell("-"),
        cell(product(item)),
        cell(item.service || "-"),
        cell(item.qty || "-"),
        status(artworkLabel(item), "artwork"),
        status(paymentLabel(item), "payment"),
        `<span class="mvp-due ${dueState.key}" title="${html(dueState.label)}">${html(dueState.label)}</span>`,
      ]);
    }), "NO ORDERS MATCH THIS FILTER");
  }

  function orderDrawer(item, renderPayment, renderTracking) {
    if (!item) return "";
    const stage = productionStage(item);
    return drawer("order", item, `${stageLabel(stage)}${blockedReason(item) ? " / Blocked" : ""}`, `
      ${detailSection("Order", [["Odoo Sales Order", item.odooSO], ["Product", product(item)], ["Service", item.service], ["Quantity / Sizes", item.sizeBreakdown || item.qty], ["Needed Date", due(item).label], ["Fulfillment Method", fulfillment(item)]])}
      ${detailSection("Artwork", [["Status", artworkLabel(item)], ["Approval", item.artworkApprovedAt ? dateTime(item.artworkApprovedAt) : "Not approved"]])}
      ${typeof renderPayment === "function" ? renderPayment(item) : paymentSummary(item)}
      ${detailSection("Production", [["Current Stage", stageLabel(stage)], ["Blocked", blockedReason(item) || "No"], ["Assigned Staff", assigned(item)]])}
      ${typeof renderTracking === "function" ? renderTracking(item) : ""}
    `, `<button class="mvp-primary-action" data-mvp-route="/production?order=${encodeURIComponent(item.id)}" type="button">Open Production &rarr;</button>`);
  }
  function renderProduction({ items, notices = "", schemaNotice = "" }) {
    const orders = items.filter(confirmed);
    const stageQuery = query("stage");
    const dueQuery = query("due");
    const search = state.production.search.toLowerCase();
    const rows = orders.filter((item) => {
      const stage = productionStage(item);
      if (stageQuery === "in_progress" && !ACTIVE_STAGES.includes(stage)) return false;
      if (stageQuery && stageQuery !== "in_progress" && stage !== stageQuery) return false;
      if (dueQuery && due(item).key !== dueQuery) return false;
      if (state.production.stage !== "all" && stage !== state.production.stage) return false;
      if (state.production.staff !== "all" && assigned(item) !== state.production.staff) return false;
      if (state.production.due !== "all" && due(item).key !== state.production.due) return false;
      return !search || [item.id, item.customer, item.service, product(item), assigned(item)].join(" ").toLowerCase().includes(search);
    });
    const selected = orders.find((item) => item.id === (state.productionId || query("order")));
    const counts = {
      overdue: orders.filter((item) => due(item).key === "overdue").length,
      today: orders.filter((item) => due(item).key === "today").length,
      blocked: orders.filter((item) => blockedReason(item)).length,
      progress: orders.filter((item) => ACTIVE_STAGES.includes(productionStage(item))).length,
      ready: orders.filter((item) => productionStage(item) === "ready").length,
      completed: orders.filter((item) => productionStage(item) === "completed").length,
    };
    return `<main class="mvp-page ops-board-page">${pageTitle("Production", "Production Dashboard", `${orders.length} orders`)}<p class="mvp-rule">NO ODOO RECORD / NO PRODUCTION</p>${notices}${schemaNotice}
      <div class="mvp-metrics production">${metric("Overdue", counts.overdue, "/production?due=overdue", "", "danger")}${metric("Due Today", counts.today, "/production?due=today", "", "lime")}${metric("Blocked", counts.blocked, "/production?stage=queued")}${metric("In Progress", counts.progress, "/production?stage=in_progress")}${metric("Ready", counts.ready, "/production?stage=ready")}${metric("Completed", counts.completed, "/production?stage=completed")}</div>
      ${filterBar("production", items, ["stage", "staff", "due"])}${productionTable(rows)}${productionDrawer(selected)}
    </main>`;
  }

  function productionTable(items) {
    return table("production", ["Code", "Customer", "Product / Inquiry", "Service", "Qty", "Artwork", "Production Stage", "Due Date", "Assigned"], items.map((item) => {
      const stage = productionStage(item);
      const blocked = blockedReason(item);
      const dueState = due(item);
      return row("production", item.id, [
        `<code>${html(item.id)}</code>`,
        strong(item.customer || "Unnamed customer"),
        cell(product(item)),
        cell(item.service || "-"),
        cell(item.qty || "-"),
        status(artworkLabel(item), "artwork"),
        `<span class="mvp-production-state"><b>${stageLabel(stage)}</b>${blocked ? `<small>Blocked: ${html(blocked)}</small>` : ""}</span>`,
        `<span class="mvp-due ${dueState.key}">${html(dueState.label)}</span>`,
        `<button class="mvp-staff-cell" type="button" data-mvp-open="production" data-mvp-id="${html(item.id)}">${html(assigned(item))}</button>`,
      ]);
    }), "NO PRODUCTION ORDERS MATCH THIS FILTER");
  }

  function productionDrawer(item) {
    if (!item) return "";
    const stage = productionStage(item);
    const next = nextStage(item);
    const gate = stage === "queued" ? productionGate(item) : [];
    const fieldsReady = !item.requiresProductionMigration;
    const editorLocked = ["ready", "completed"].includes(stage);
    const editorEnabled = fieldsReady && !editorLocked;
    const currentStaff = assigned(item);
    const staffOptions = ["Not Yet Assigned", "Unassigned"].includes(currentStaff) || STAFF.includes(currentStaff) ? STAFF : [currentStaff, ...STAFF];
    return drawer("production", item, stageLabel(stage), `
      ${detailSection("Order", [["Code", item.id], ["Product", product(item)], ["Service", item.service], ["Quantity", item.sizeBreakdown || item.qty], ["Needed Date", due(item).label]])}
      <section class="mvp-drawer-section"><h3>Production</h3>${fieldsReady ? "" : `<p class="mvp-inline-error">DATABASE FIELDS NOT READY. Apply the pending migration before saving.</p>`}${editorLocked ? `<p class="mvp-inline-note">${stage === "ready" ? "READY IS OPEN FOR FULFILLMENT. PRODUCTION DETAILS ARE LOCKED." : "COMPLETED PRODUCTION DETAILS ARE LOCKED."}</p>` : ""}<div class="mvp-production-editor">
        <label><span>Assigned Staff</span><select data-mvp-production-staff="${html(item.id)}" ${editorEnabled ? "" : "disabled"}><option value="">Unassigned</option>${staffOptions.map((staff) => `<option ${currentStaff === staff ? "selected" : ""}>${staff}</option>`).join("")}</select></label>
        <label><span>Current Stage</span><strong>${stageLabel(stage)}</strong></label>
        <label><span>Blocked Reason</span><select data-mvp-production-blocked="${html(item.id)}" ${editorEnabled ? "" : "disabled"}><option value="">Not blocked</option>${["No artwork", "Awaiting customer artwork approval", "Payment requirement not completed", "Materials unavailable"].map((reason) => `<option ${item.blockedReason === reason ? "selected" : ""}>${reason}</option>`).join("")}</select></label><label class="wide"><span>Internal Production Note</span><textarea data-mvp-production-note="${html(item.id)}" ${editorEnabled ? "" : "disabled"}>${html(item.productionNote || "")}</textarea></label>
      </div><button class="mvp-secondary-action" type="button" data-mvp-save-production="${html(item.id)}" ${editorEnabled ? "" : "disabled"}>Save Assignment &amp; Note</button>${blockedReason(item) ? `<p class="mvp-blocked">BLOCKED: ${html(blockedReason(item))}</p>` : ""}</section>
      ${detailSection("Artwork", [["Status", artworkLabel(item)], ["Approval", item.artworkApprovedAt ? dateTime(item.artworkApprovedAt) : "Not approved"]])}
      ${detailSection("Fulfillment", [["Method", fulfillment(item)], ["Customer Tracking", tracking(item)]])}
    `, `<section class="mvp-production-action"><span>Now: ${stageLabel(stage)}</span><strong>${next ? `Next: ${stageLabel(next)}` : "Production complete"}</strong>${next ? `<button type="button" data-mvp-advance="${html(item.id)}" data-mvp-next="${next}" ${!fieldsReady || gate.length ? "disabled" : ""}>${stage === "qc" ? "Mark Ready" : stage === "ready" ? "Mark Completed" : `Move to ${stageLabel(next)}`}</button>` : `<button type="button" disabled>Completed</button>`}${gate.length ? `<small>Resolve before advancing: ${html(gate.join(", "))}</small>` : ""}</section>`);
  }

  function nextStage(item) {
    const stage = productionStage(item);
    if (stage === "queued") return stationFor(item);
    if (["printing", "embroidery", "screen_printing"].includes(stage)) return "qc";
    if (stage === "qc") return "ready";
    if (stage === "ready") return "completed";
    return "";
  }

  function productionGate(item) {
    const missing = [];
    if (!item.odooSO) missing.push("Odoo SO");
    if (!product(item) || product(item) === "Not set") missing.push("product");
    if (!item.service || !item.qty) missing.push("service and quantity");
    if (!item.dueDate) missing.push("due date");
    if (artworkLabel(item) !== "Artwork Approved") missing.push("artwork approval");
    if (["Not Yet Assigned", "Unassigned"].includes(assigned(item))) missing.push("assigned staff");
    if (Number(item.amountDue) > 0 && paymentLabel(item) !== "Paid") missing.push("payment");
    if (item.blockedReason && !missing.length) missing.push(item.blockedReason);
    return missing;
  }

  function bind({ root = document, rerender, navigate, copy, saveProduction }) {
    root.querySelectorAll("[data-mvp-route]").forEach((button) => button.addEventListener("click", () => { navigate(button.dataset.mvpRoute); rerender(); }));
    root.querySelectorAll("[data-mvp-stage]").forEach((button) => button.addEventListener("click", () => { state.inquiry.stage = button.dataset.mvpStage; clearQuery(); rerender(); }));
    root.querySelectorAll("[data-mvp-filter]").forEach((field) => {
      const [scope, name] = field.dataset.mvpFilter.split(":");
      field.addEventListener(field.type === "search" ? "input" : "change", () => { state[scope][name] = field.value; clearQuery(); rerender(); if (field.type === "search") focusAtEnd(field.dataset.mvpFilter); });
    });
    root.querySelectorAll("[data-mvp-open]").forEach((element) => {
      const open = () => { state.returnFocus = { type: element.dataset.mvpOpen, id: element.dataset.mvpId }; state[`${element.dataset.mvpOpen}Id`] = element.dataset.mvpId; rerender(); requestAnimationFrame(() => root.querySelector(".mvp-drawer [data-mvp-close]")?.focus()); };
      element.addEventListener("click", (event) => { if (event.target.closest("[data-mvp-copy]")) return; event.stopPropagation(); open(); });
      element.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); open(); } });
    });
    root.querySelectorAll("[data-mvp-close]").forEach((button) => button.addEventListener("click", () => { const restore = state.returnFocus; state.inquiryId = null; state.orderId = null; state.productionId = null; state.returnFocus = null; clearQuery(); rerender(); requestAnimationFrame(() => { if (restore) root.querySelector(`[data-mvp-open="${restore.type}"][data-mvp-id="${CSS.escape(restore.id)}"]`)?.focus(); }); }));
    root.querySelectorAll("[data-mvp-copy]").forEach((button) => button.addEventListener("click", async (event) => { event.stopPropagation(); await copy(button.dataset.mvpCopy); button.dataset.copied = "true"; button.querySelector("small").textContent = "Copied"; window.setTimeout(() => { button.dataset.copied = "false"; const label = button.querySelector("small"); if (label) label.textContent = "Copy"; }, 1300); }));
    root.querySelectorAll("[data-mvp-save-production]").forEach((button) => button.addEventListener("click", async () => {
      if (button.disabled) return;
      const id = button.dataset.mvpSaveProduction;
      const staff = root.querySelector(`[data-mvp-production-staff="${CSS.escape(id)}"]`)?.value || null;
      const note = root.querySelector(`[data-mvp-production-note="${CSS.escape(id)}"]`)?.value.trim() || null;
      const blocked = root.querySelector(`[data-mvp-production-blocked="${CSS.escape(id)}"]`)?.value || null;
      button.disabled = true; button.textContent = "Saving...";
      await saveProduction(id, { assignedStaff: staff, productionNote: note, blockedReason: blocked });
      rerender();
    }));
    root.querySelectorAll("[data-mvp-advance]").forEach((button) => button.addEventListener("click", async () => {
      if (button.disabled) return;
      const id = button.dataset.mvpAdvance;
      const staff = root.querySelector(`[data-mvp-production-staff="${CSS.escape(id)}"]`)?.value || null;
      const note = root.querySelector(`[data-mvp-production-note="${CSS.escape(id)}"]`)?.value.trim() || null;
      const blocked = root.querySelector(`[data-mvp-production-blocked="${CSS.escape(id)}"]`)?.value || null;
      button.disabled = true; button.textContent = "Saving...";
      await saveProduction(id, { productionStage: button.dataset.mvpNext, assignedStaff: staff, productionNote: note, blockedReason: blocked });
      rerender();
    }));
  }
  function filterBar(scope, items, fields) {
    const values = state[scope];
    const services = [...new Set(items.map((item) => item.service).filter(Boolean))].sort();
    const people = [...new Set([...STAFF, ...items.map((item) => scope === "inquiry" ? owner(item) : assigned(item))].filter((value) => !["Unassigned", "Not Yet Assigned"].includes(value)))].sort();
    const controls = [`<label class="mvp-search"><span aria-hidden="true">?</span><input type="search" data-mvp-filter="${scope}:search" value="${html(values.search)}" placeholder="Search code, customer, product..." /></label>`];
    if (fields.includes("owner")) controls.push(select(scope, "owner", "All Owners", people, values.owner, true));
    if (fields.includes("staff")) controls.push(select(scope, "staff", "All Staff", people, values.staff, true));
    if (fields.includes("service")) controls.push(select(scope, "service", "All Services", services, values.service));
    if (fields.includes("stage")) controls.push(select(scope, "stage", "All Stages", PRODUCTION_STAGES, values.stage));
    if (fields.includes("payment")) controls.push(select(scope, "payment", "All Payments", ["Not Yet Requested", "Awaiting Payment", "Proof Submitted", "Paid"], values.payment));
    if (fields.includes("fulfillment")) controls.push(select(scope, "fulfillment", "All Fulfillment", [["pickup", "Pickup"], ["delivery", "Delivery"]], values.fulfillment));
    if (fields.includes("due")) controls.push(select(scope, "due", "All Dates", [["overdue", "Overdue"], ["today", "Due today"], ["week", "This week"]], values.due));
    return `<section class="mvp-filter-bar">${controls.join("")}</section>`;
  }

  function select(scope, name, allLabel, options, value, includeUnassigned = false) {
    const rows = options.map((option) => Array.isArray(option) ? option : [option, option]);
    if (includeUnassigned) rows.push([scope === "inquiry" ? "Unassigned" : "Not Yet Assigned", "Unassigned"]);
    return `<select data-mvp-filter="${scope}:${name}"><option value="all">${allLabel}</option>${rows.map(([keyValue, label]) => `<option value="${html(keyValue)}" ${value === keyValue ? "selected" : ""}>${html(label)}</option>`).join("")}</select>`;
  }

  function table(type, headers, rows, emptyLabel) {
    return `<section class="mvp-table-wrap"><div class="mvp-table ${type}" role="table"><div class="mvp-table-head" role="row">${headers.map((header) => `<span role="columnheader">${header}</span>`).join("")}</div><div role="rowgroup">${rows.length ? rows.join("") : empty(emptyLabel)}</div></div></section>`;
  }

  function row(type, id, cells) {
    return `<div class="mvp-table-row" data-mvp-open="${type}" data-mvp-id="${html(id)}" role="row" tabindex="0">${cells.join("")}</div>`;
  }

  function drawer(type, item, statusLabel, body, footer = "") {
    return `<button class="mvp-drawer-backdrop" data-mvp-close type="button" aria-label="Close details"></button><aside class="mvp-drawer ${type}" aria-label="${type} details"><header><div><code>${html(item.id)}</code><h2>${html(item.customer || item.company || "Details")}</h2><mark>${html(statusLabel)}</mark></div><button type="button" data-mvp-close aria-label="Close details">X</button></header><div class="mvp-drawer-body">${body}</div><footer class="mvp-drawer-footer">${footer}</footer></aside>`;
  }

  function detailSection(title, rows, note = "") {
    return `<section class="mvp-drawer-section"><h3>${html(title)}</h3><div class="mvp-detail-grid">${rows.map(([label, value]) => `<div><span>${html(label)}</span><strong>${html(value || "Not set")}</strong></div>`).join("")}</div>${note ? `<p class="mvp-customer-message">${html(note)}</p>` : ""}</section>`;
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
    const rows = STAFF.map((staff) => ({ staff, count: orders.filter((item) => assigned(item) === staff && !["ready", "completed"].includes(productionStage(item))).length, overdue: orders.filter((item) => assigned(item) === staff && due(item).key === "overdue").length })).filter((row) => row.count || row.overdue);
    return `<section class="mvp-section"><div class="mvp-section-title"><h2>Staff Workload</h2></div><div class="mvp-workload">${rows.length ? rows.map((row) => `<span><i>${row.staff.slice(0, 2).toUpperCase()}</i><strong>${html(row.staff)}</strong><b>${row.count} active${row.overdue ? ` / ${row.overdue} overdue` : ""}</b></span>`).join("") : empty("NO STAFF ASSIGNMENTS YET")}</div></section>`;
  }

  function priority(item, reason, when, route, tone) { return { code: item.id, customer: item.customer || "Unnamed", reason, when, route, tone }; }
  function priorityRow(item) { return `<button type="button" data-mvp-route="${html(item.route)}"><code>${html(item.code)}</code><strong>${html(item.customer)}</strong><span>${html(item.reason)}</span><b class="${item.tone}">${html(item.when)}</b><i>View</i></button>`; }
  function countBy(keys, items, getter) { return Object.fromEntries(keys.map((value) => [value, items.filter((item) => getter(item) === value).length])); }
  function copyButton(label, value, aria) { return `<button class="mvp-copy" type="button" data-mvp-copy="${html(value)}" aria-label="Copy ${html(aria)} ${html(label)}"><span>${html(label)}</span><small>Copy</small></button>`; }
  function strong(value) { return `<strong title="${html(value)}">${html(value)}</strong>`; }
  function cell(value) { return `<span title="${html(value)}">${html(value)}</span>`; }
  function status(label, tone) { return `<b class="mvp-status ${tone}" title="${html(label)}">${html(label)}</b>`; }
  function empty(label) { return `<p class="mvp-empty">${html(label)}</p>`; }
  function stationFor(item) { const value = String(item.service || "").toLowerCase(); return value.includes("embro") ? "embroidery" : value.includes("screen") ? "screen_printing" : "printing"; }
  function inquiryDue(item) { if (!item.followUpDate) return "none"; const date = new Date(`${item.followUpDate}T00:00:00`); const today = new Date(`${todayIso()}T00:00:00`); if (date < today) return "overdue"; if (+date === +today) return "today"; return "week"; }
  function fulfillment(item) { const value = key(item.fulfillmentMethod); return value === "pickup" ? "Pickup" : value === "delivery" ? "Delivery" : "Not set"; }
  function tracking(item) { const labels = { ready_for_pickup: "Ready for Pickup", out_for_delivery: "Out for Delivery", delivered: "Delivered", completed: "Completed" }; return labels[key(item.trackingSubstatus)] || "Not set"; }
  function paymentSummary(item) { const total = amount(item.quotedAmount); const paid = amount(item.paymentConfirmedAmount); const balance = Math.max(total - paid, 0); return detailSection("Payment", [["Status", paymentLabel(item)], ["Total Amount", money(total)], ["Amount Paid", money(paid)], ["Balance", money(balance)]]); }
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
  function money(value) { const number = Number(value); return Number.isFinite(number) ? `PHP ${number.toLocaleString("en-US")}` : "Not set"; }
  function key(value) { return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_"); }
  function todayIso() { return new Date().toISOString().slice(0, 10); }
  function clearQuery() { if (window.location.search) window.history.replaceState({}, "", window.location.pathname); }
  function focusAtEnd(filter) { requestAnimationFrame(() => { const field = document.querySelector(`[data-mvp-filter="${filter}"]`); field?.focus(); field?.setSelectionRange?.(field.value.length, field.value.length); }); }
  function html(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]); }
}