const statusOptions = [
  "Pending Review",
  "Approved",
  "In Production",
  "Ready",
  "Completed",
  "Cancelled",
];

let orders = [];

let selectedId = null;
let activeFilter = "All";
let query = "";
let draftStatus = "Pending Review";

const routes = {
  "/": "Orders",
  "/orders": "Orders",
  "/overview": "Overview",
  "/clients": "Clients",
  "/products": "Products",
  "/settings": "Settings",
};

const statMeta = [
  { label: "Pending Review", value: 0, icon: "queue", delta: "No data yet" },
  { label: "Approved", value: 0, icon: "check", delta: "No data yet" },
  { label: "In Production", value: 0, icon: "factory", delta: "No data yet" },
  { label: "Ready", value: 0, icon: "ready", delta: "No data yet" },
  { label: "Completed", value: 0, icon: "calendar", delta: "No data yet" },
];

const clientProgram = {
  name: "Urban Coffee",
  domain: "urbancoffee.trryapparel.com",
  status: "Active",
  approvedProducts: 2,
  lastUpdated: "Recently",
};

const approvedProducts = [
  {
    product: "Admin Polo Uniform",
    client: "Urban Coffee",
    category: "Uniform",
    color: "Black",
    logoPlacement: "Left Chest Embroidery",
    status: "Approved",
    visible: "Yes",
    fabric: "Cotton Blend",
  },
  {
    product: "Embroidered Staff Cap",
    client: "Urban Coffee",
    category: "Cap",
    color: "Navy",
    logoPlacement: "Front Embroidery",
    status: "Approved",
    visible: "Yes",
    fabric: "Cotton",
  },
];

function render() {
  const currentRoute = getCurrentRoute();

  const selectedOrder = orders.find((order) => order.id === selectedId);
  const filteredOrders = getFilteredOrders();

  document.getElementById("root").innerHTML = `
    <div class="app-shell">
      ${renderSidebar(currentRoute)}
      <section class="workspace">
        ${renderTopHeader()}
        ${
          currentRoute === "Orders"
            ? renderOrdersPage(selectedOrder, filteredOrders)
            : currentRoute === "Overview"
              ? renderOverviewPage()
              : currentRoute === "Clients"
                ? renderClientsPage()
                : currentRoute === "Products"
                  ? renderProductsPage()
                  : currentRoute === "Settings"
                    ? renderSettingsPage()
                    : renderPlaceholderPage(currentRoute)
        }
        ${renderFooter()}
      </section>
    </div>
  `;

  bindEvents();
}

function renderOrdersPage(selectedOrder, filteredOrders) {
  return `
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
  `;
}

function renderPlaceholderPage(title) {
  return `
    <main class="orders-page">
      <section class="placeholder-page">
        <p class="placeholder-kicker">TRRY Apparel Management</p>
        <h1>${title} - Coming soon</h1>
      </section>
    </main>
  `;
}

function renderClientsPage() {
  return `
    <main class="orders-page">
      <div class="page-heading">
        <div>
          <h1>Clients</h1>
          <p class="subtitle">Manage client portals and approved uniform programs.</p>
        </div>
      </div>

      <section class="content-card">
        <div class="client-program-row">
          <div class="client-cell">
            <span class="client-logo urban-coffee">UC</span>
            <div>
              <strong>${clientProgram.name}</strong>
              <span>${clientProgram.domain}</span>
            </div>
          </div>
          <span class="status-pill active">${clientProgram.status}</span>
          <div class="metric-pair">
            <span>Approved products</span>
            <strong>${clientProgram.approvedProducts}</strong>
          </div>
          <div class="metric-pair">
            <span>Last updated</span>
            <strong>${clientProgram.lastUpdated}</strong>
          </div>
        </div>
      </section>

      <p class="page-note">More client management tools coming soon.</p>
    </main>
  `;
}

function renderProductsPage() {
  return `
    <main class="orders-page">
      <div class="page-heading">
        <div>
          <h1>Products</h1>
          <p class="subtitle">Approved products saved for each client portal.</p>
        </div>
      </div>

      <section class="content-card table-card">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Client</th>
              <th>Category</th>
              <th>Color</th>
              <th>Logo Placement</th>
              <th>Status</th>
              <th>Visible</th>
            </tr>
          </thead>
          <tbody>
            ${approvedProducts
              .map(
                (item) => `
                  <tr>
                    <td>
                      <div class="stacked-cell">
                        <strong>${item.product}</strong>
                        <span>${item.fabric}</span>
                      </div>
                    </td>
                    <td>${item.client}</td>
                    <td>${item.category}</td>
                    <td>${item.color}</td>
                    <td>${item.logoPlacement}</td>
                    <td><span class="status-pill approved">${item.status}</span></td>
                    <td><span class="status-pill visible">${item.visible}</span></td>
                  </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </section>

      <p class="page-note">Product editing will be connected to Supabase later.</p>
    </main>
  `;
}

function renderSettingsPage() {
  const settingsCards = [
    {
      title: "Admin Portal",
      rows: [
        ["Admin domain", "admin.trryapparel.com"],
        ["Version", "1.0.0"],
        ["Mode", "MVP Prototype"],
      ],
    },
    {
      title: "Database",
      rows: [
        ["Supabase project", "trryportalsystem"],
        ["Status", "Not connected in app yet"],
        ["Note", "Read-only connection planned next."],
      ],
    },
    {
      title: "Client Portal",
      rows: [
        ["Active client", "Urban Coffee"],
        ["Portal domain", "urbancoffee.trryapparel.com"],
        ["Approved products", "2"],
      ],
    },
  ];

  return `
    <main class="orders-page">
      <div class="page-heading">
        <div>
          <h1>Settings</h1>
          <p class="subtitle">Manage admin portal preferences and system setup.</p>
        </div>
      </div>

      <section class="settings-grid">
        ${settingsCards
          .map(
            (card) => `
              <article class="settings-card">
                <h2>${card.title}</h2>
                ${card.rows
                  .map(
                    ([label, value]) => `
                      <div class="settings-row">
                        <span>${label}</span>
                        <strong>${value}</strong>
                      </div>`
                  )
                  .join("")}
              </article>`
          )
          .join("")}
      </section>
    </main>
  `;
}

function renderOverviewPage() {
  const overviewMetrics = [
    { label: "Website Visits", value: "-" },
    { label: "Portal Visits", value: "-" },
    { label: "Reorder Requests", value: "0" },
    { label: "Estimated Sales Value", value: "PHP 0" },
  ];

  return `
    <main class="orders-page">
      <div class="page-heading">
        <div>
          <h1>Overview</h1>
          <p class="subtitle">Monitor TRRY Apparel admin operations as real data becomes available.</p>
        </div>
      </div>

      <section class="overview-grid">
        ${overviewMetrics
          .map(
            (metric) => `
              <article class="overview-card">
                <p>${metric.label}</p>
                <strong>${metric.value}</strong>
              </article>`
          )
          .join("")}
      </section>

      <section class="overview-content">
        <article class="analytics-card">
          <h2>No analytics data yet</h2>
          <p>Connect Supabase or analytics to start tracking.</p>
        </article>
        <article class="activity-card">
          <h2>Top Client Activity</h2>
          <p><strong>Urban Coffee</strong> - 2 approved products saved</p>
          <h2>Recent Portal Activity</h2>
          <p>No recent activity yet</p>
        </article>
      </section>
    </main>
  `;
}

function renderSidebar(currentRoute) {
  const navItems = [
    { label: "Overview", path: "/overview" },
    { label: "Orders", path: "/orders" },
    { label: "Clients", path: "/clients" },
    { label: "Products", path: "/products" },
    { label: "Settings", path: "/settings" },
  ];

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
              <a class="${item.label === currentRoute ? "active" : ""}" href="${item.path}" data-route-link>
                <span class="nav-icon ${item.label.toLowerCase()}" aria-hidden="true"></span>
                ${item.label}
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
          <div class="avatar">TA</div>
          <div>
            <strong>TRRY Admin</strong>
            <span>Admin</span>
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
    ${
      filteredOrders.length === 0
        ? `<div class="empty-state">
            <strong>No reorder requests yet</strong>
            <span>New client reorder requests will appear here.</span>
          </div>`
        : ""
    }
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
  document.querySelectorAll("[data-route-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      window.history.pushState({}, "", link.getAttribute("href"));
      render();
    });
  });

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

window.addEventListener("popstate", render);

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

function getCurrentRoute() {
  return routes[window.location.pathname] ?? "Orders";
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
