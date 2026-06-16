const statusOptions = [
  "Pending Review",
  "Approved",
  "In Production",
  "Ready",
  "Completed",
  "Cancelled",
];

let orders = [
  {
    id: "UC-000126",
    client: "Urban Coffee",
    clientInitials: "UC",
    clientAddress: "123 Brew St.",
    cityState: "Austin, TX 78701",
    requestedBy: "Clark Lubguban",
    requesterRole: "Operations Manager",
    requesterEmail: "clark@urbancoffee.com",
    requesterPhone: "(512) 555-0188",
    items: "Admin Polo Uniform",
    itemLines: [{ name: "Admin Polo Uniform", qty: 1 }],
    qty: 1,
    fulfillment: "Delivery",
    shipTo: "Urban Coffee - Central Warehouse",
    shipAddress: "500 Roastery Way, Austin, TX 78702",
    neededDate: "June 28, 2026",
    daysUntilNeeded: "12 days",
    status: "Pending Review",
    submitted: "Today, 9:24 AM",
    priority: "Standard",
    notes:
      "Single admin polo reorder for new branch manager. Match existing Urban Coffee embroidery placement.",
  },
  {
    id: "SA-000125",
    client: "Salon Aurelia",
    clientInitials: "SA",
    clientAddress: "48 Rose Lane",
    cityState: "Dallas, TX 75201",
    requestedBy: "Maya Patel",
    requesterRole: "Owner",
    requesterEmail: "maya@salonaurelia.com",
    requesterPhone: "(214) 555-0140",
    items: "Embroidered Staff Cap",
    itemLines: [{ name: "Embroidered Staff Cap", qty: 12 }],
    qty: 12,
    fulfillment: "Pickup",
    shipTo: "TRRY Apparel Pickup Counter",
    shipAddress: "Main production office",
    neededDate: "June 30, 2026",
    daysUntilNeeded: "14 days",
    status: "Approved",
    submitted: "Yesterday, 4:12 PM",
    priority: "Standard",
    notes:
      "Approved for pickup. Client requested the same thread color used on the previous cap batch.",
  },
  {
    id: "CC-000124",
    client: "Clinic Central",
    clientInitials: "CC",
    clientAddress: "210 Medical Plaza",
    cityState: "Houston, TX 77002",
    requestedBy: "Dr. Amanda Ruiz",
    requesterRole: "Admin Director",
    requesterEmail: "amanda@cliniccentral.com",
    requesterPhone: "(713) 555-0162",
    items: "Admin Polo Uniform",
    itemLines: [{ name: "Admin Polo Uniform", qty: 24 }],
    qty: 24,
    fulfillment: "Delivery",
    shipTo: "Clinic Central Receiving",
    shipAddress: "210 Medical Plaza, Houston, TX 77002",
    neededDate: "July 2, 2026",
    daysUntilNeeded: "16 days",
    status: "In Production",
    submitted: "June 15, 2026",
    priority: "High",
    notes:
      "Production is underway. Confirm final packing count before dispatch to Clinic Central receiving desk.",
  },
];

let selectedId = "UC-000126";
let activeFilter = "All";
let query = "";
let draftStatus = "Pending Review";

const statMeta = [
  { label: "Pending Review", value: 18, icon: "queue", delta: "12% vs last week" },
  { label: "Approved", value: 32, icon: "check", delta: "8% vs last week" },
  { label: "In Production", value: 56, icon: "factory", delta: "15% vs last week" },
  { label: "Ready", value: 21, icon: "ready", delta: "5% vs last week" },
  { label: "Completed", value: 128, icon: "calendar", delta: "16% vs last month" },
];

function render() {
  const selectedOrder = orders.find((order) => order.id === selectedId);
  const filteredOrders = getFilteredOrders();

  document.getElementById("root").innerHTML = `
    <div class="app-shell">
      ${renderSidebar()}
      <section class="workspace">
        ${renderTopHeader()}
        <main class="orders-page">
          <div class="page-heading">
            <div>
              <h1>Orders</h1>
              <p class="subtitle">Manage incoming reorder requests from client portals.</p>
            </div>
          </div>

          <section class="status-grid" aria-label="Order status summary">
            ${statMeta.map(renderStatusCard).join("")}
          </section>

          <section class="orders-workbench ${selectedOrder ? "has-panel" : ""}">
            <div class="orders-list-card">
              ${renderToolbar()}
              ${renderTable(filteredOrders)}
            </div>
            ${selectedOrder ? renderDetailPanel(selectedOrder) : ""}
          </section>
        </main>
        ${renderFooter()}
      </section>
    </div>
  `;

  bindEvents();
}

function renderSidebar() {
  const navItems = ["Overview", "Orders", "Clients", "Products", "Settings"];

  return `
    <aside class="sidebar">
      <div class="brand-lockup">
        <strong>TRRY</strong>
        <span>APPAREL</span>
      </div>
      <nav>
        ${navItems
          .map(
            (item) => `
              <a class="${item === "Orders" ? "active" : ""}" href="${
                item === "Orders" ? "/orders" : "#"
              }">
                <span class="nav-icon ${item.toLowerCase()}" aria-hidden="true"></span>
                ${item}
              </a>`
          )
          .join("")}
      </nav>
      <div class="system-card">
        <span class="shield-icon" aria-hidden="true"></span>
        <div>
          <strong>System Status</strong>
          <p><span></span> All systems operational</p>
        </div>
      </div>
    </aside>
  `;
}

function renderTopHeader() {
  return `
    <header class="top-header">
      <div class="header-brand">
        <button aria-label="Toggle navigation" class="menu-button" type="button">
          <span></span>
        </button>
        <strong><span>TRRY</span> Apparel Management</strong>
      </div>
      <label class="global-search">
        <input placeholder="Search orders, clients, products..." type="search" />
        <span aria-hidden="true"></span>
      </label>
      <div class="header-actions">
        <button class="notification-button" aria-label="Notifications" type="button">
          <span></span>
        </button>
        <div class="profile-area">
          <div class="avatar">AT</div>
          <div>
            <strong>Alex Thorne</strong>
            <span>Super Admin</span>
          </div>
          <span class="chevron"></span>
        </div>
      </div>
    </header>
  `;
}

function renderStatusCard(item) {
  return `
    <article class="status-card">
      <span class="icon-mark ${item.icon}" aria-hidden="true"></span>
      <div>
        <p>${item.label}</p>
        <strong>${item.value}</strong>
        <small><span></span> ${item.delta}</small>
      </div>
    </article>
  `;
}

function renderToolbar() {
  return `
    <div class="toolbar">
      <div class="filter-tabs" aria-label="Order filters">
        ${["All", ...statusOptions]
          .map(
            (status) => `
              <button class="${status === activeFilter ? "active" : ""}"
                data-filter="${status}" type="button">${status}</button>`
          )
          .join("")}
      </div>
      <div class="table-actions">
        <label class="search-field">
          <span aria-hidden="true"></span>
          <input id="order-search" value="${escapeHtml(query)}"
            placeholder="Search orders..."
            type="search" />
        </label>
        <button class="filter-button" aria-label="Advanced filters" type="button">
          <span></span>
        </button>
      </div>
    </div>
  `;
}

function renderTable(filteredOrders) {
  const rows = filteredOrders
    .map(
      (order) => `
        <tr class="${order.id === selectedId ? "selected" : ""}">
          <td class="request-id">${order.id}</td>
          <td>
            <div class="client-cell">
              <span class="client-logo ${statusToClass(order.client)}">${order.clientInitials}</span>
              <strong>${order.client}</strong>
            </div>
          </td>
          <td>
            <div class="stacked-cell">
              <strong>${order.requestedBy}</strong>
              <span>${order.requesterRole}</span>
            </div>
          </td>
          <td>${order.items}</td>
          <td>${order.qty}</td>
          <td>
            <span class="fulfillment ${order.fulfillment.toLowerCase()}">
              <span></span>${order.fulfillment}
            </span>
          </td>
          <td>
            <div class="stacked-cell needed">
              <strong>${order.neededDate}</strong>
              <span>${order.daysUntilNeeded}</span>
            </div>
          </td>
          <td>${renderStatusPill(order.status)}</td>
          <td>
            <button class="view-button" data-order-id="${order.id}" aria-label="View ${order.id}" type="button">
              <span></span>
            </button>
          </td>
        </tr>`
    )
    .join("");

  return `
    <table>
      <thead>
        <tr>
          <th>Request No.</th>
          <th>Client</th>
          <th>Requested By</th>
          <th>Items</th>
          <th>Qty</th>
          <th>Fulfillment</th>
          <th>Needed Date</th>
          <th>Status</th>
          <th>View</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${filteredOrders.length === 0 ? '<div class="empty-state">No orders match this view.</div>' : ""}
    <div class="table-footer">
      <span>Showing 1 to ${filteredOrders.length} of ${orders.length} orders</span>
      <div class="pager">
        <button type="button" aria-label="Previous page"></button>
        <button class="active" type="button">1</button>
        <button type="button">2</button>
        <button type="button">3</button>
        <button type="button" aria-label="Next page"></button>
      </div>
    </div>
  `;
}

function renderDetailPanel(order) {
  return `
    <aside class="detail-panel" aria-label="Selected order details">
      <div class="panel-header">
        <h2>Order ${order.id}</h2>
        <button aria-label="Close order detail" class="close-panel" id="close-detail" type="button">x</button>
      </div>

      <section class="panel-section">
        <p class="section-title">Client</p>
        <div class="client-profile">
          <span class="client-logo large ${statusToClass(order.client)}">${order.clientInitials}</span>
          <div>
            <strong>${order.client}</strong>
            <span>${order.clientAddress}</span>
            <span>${order.cityState}</span>
            <a href="#">View client profile</a>
          </div>
        </div>
      </section>

      <section class="panel-section">
        <p class="section-title">Requested By</p>
        <div class="person-row">
          <span class="person-icon"></span>
          <div>
            <strong>${order.requestedBy}</strong>
            <span>${order.requesterRole}</span>
            <span>${order.requesterEmail}</span>
            <span>${order.requesterPhone}</span>
          </div>
        </div>
      </section>

      <section class="panel-section">
        <p class="section-title">Items</p>
        <div class="item-lines">
          ${order.itemLines
            .map((item) => `<div><span>${item.name}</span><strong>${item.qty}</strong></div>`)
            .join("")}
        </div>
        <div class="total-line"><span>Total Quantity</span><strong>${order.qty}</strong></div>
      </section>

      <section class="panel-section">
        <div class="ship-block">
          <span class="pin-icon"></span>
          <div>
            <p class="section-title">Ship To</p>
            <strong>${order.shipTo}</strong>
            <span>${order.shipAddress}</span>
          </div>
        </div>
      </section>

      <section class="status-editor">
        <label for="status-select">Status</label>
        <select id="status-select">
          ${statusOptions
            .map(
              (status) =>
                `<option value="${status}" ${status === draftStatus ? "selected" : ""}>${status}</option>`
            )
            .join("")}
        </select>
        <button class="primary-button" id="update-status" type="button">Update Status</button>
        <button class="note-button" type="button">
          <span></span>Add Internal Note
        </button>
      </section>
    </aside>
  `;
}

function renderFooter() {
  return `
    <footer class="footer">
      <span>&copy; 2026 TRRY Apparel. All rights reserved.</span>
      <div>
        <span>Version 1.0.0</span>
        <strong><span></span> System Operational</strong>
      </div>
    </footer>
  `;
}

function renderStatusPill(status) {
  return `<span class="status-pill ${statusToClass(status)}">${status}</span>`;
}

function bindEvents() {
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter;
      render();
    });
  });

  document.querySelectorAll("[data-order-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const order = orders.find((item) => item.id === button.dataset.orderId);
      selectedId = order.id;
      draftStatus = order.status;
      render();
    });
  });

  const search = document.getElementById("order-search");
  if (search) {
    search.addEventListener("input", (event) => {
      query = event.target.value;
      render();
      document.getElementById("order-search")?.focus();
    });
  }

  document.getElementById("close-detail")?.addEventListener("click", () => {
    selectedId = null;
    draftStatus = "";
    render();
  });

  document.getElementById("status-select")?.addEventListener("change", (event) => {
    draftStatus = event.target.value;
  });

  document.getElementById("update-status")?.addEventListener("click", () => {
    if (!selectedId || !draftStatus) return;
    orders = orders.map((order) =>
      order.id === selectedId ? { ...order, status: draftStatus } : order
    );
    render();
  });
}

function getFilteredOrders() {
  const normalizedQuery = query.trim().toLowerCase();

  return orders.filter((order) => {
    const matchesFilter = activeFilter === "All" || order.status === activeFilter;
    const matchesQuery =
      !normalizedQuery ||
      [order.id, order.client, order.requestedBy, order.items]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);

    return matchesFilter && matchesQuery;
  });
}

function statusToClass(status) {
  return status.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };

    return entities[character];
  });
}

render();
