const statusOptions = [
  "Pending Review",
  "Approved",
  "In Production",
  "Ready",
  "Completed",
  "Cancelled",
];

const clientProgram = {
  id: "urban-coffee",
  name: "Urban Coffee",
  initials: "UC",
  domain: "urbancoffee.trryapparel.com",
  status: "Active",
  accountType: "Recurring Reorder",
  primaryContact: "Not set",
  contactEmail: "Not set",
  contactNumber: "Not set",
  approvedProducts: 2,
  savedEmployees: 0,
  activeOrders: 0,
  lastOrderDate: "None yet",
};

const products = [
  {
    code: "TRRY-UC-P001",
    product: "Admin Polo Uniform",
    client: "Urban Coffee",
    category: "Uniforms",
    color: "Black",
    logoPlacement: "Left Chest Embroidery",
    fabric: "Cotton Blend",
    status: "Approved",
    visible: "Yes",
    created: "MVP Setup",
    updated: "Recently",
  },
  {
    code: "TRRY-UC-P002",
    product: "Embroidered Staff Cap",
    client: "Urban Coffee",
    category: "Caps",
    color: "Navy",
    logoPlacement: "Front Embroidery",
    fabric: "Cotton",
    status: "Approved",
    visible: "Yes",
    created: "MVP Setup",
    updated: "Recently",
  },
];

let orders = [
  {
    id: "TRRY-UC-0003",
    client: "Urban Coffee",
    clientInitials: "UC",
    requestedBy: "Urban Coffee Admin",
    requesterRole: "Portal Admin",
    requesterEmail: "orders@urbancoffee.trryapparel.com",
    requesterPhone: "To be added",
    clientAddress: "urbancoffee.trryapparel.com",
    cityState: "Private client portal",
    items: "Admin Polo Uniform",
    itemCount: 1,
    qty: 18,
    fulfillment: "Delivery",
    neededDate: "June 28, 2026",
    daysUntilNeeded: "Production window",
    status: "Pending Review",
    shipTo: "Urban Coffee - Main Branch",
    shipAddress: "Delivery address to be confirmed",
    itemLines: [{ name: "Admin Polo Uniform - Black", qty: 18 }],
    updated: "New request",
  },
  {
    id: "TRRY-UC-0002",
    client: "Urban Coffee",
    clientInitials: "UC",
    requestedBy: "Urban Coffee Admin",
    requesterRole: "Portal Admin",
    requesterEmail: "orders@urbancoffee.trryapparel.com",
    requesterPhone: "To be added",
    clientAddress: "urbancoffee.trryapparel.com",
    cityState: "Private client portal",
    items: "Embroidered Staff Cap",
    itemCount: 1,
    qty: 24,
    fulfillment: "Pickup",
    neededDate: "June 30, 2026",
    daysUntilNeeded: "Approved queue",
    status: "Approved",
    shipTo: "Urban Coffee - Pickup",
    shipAddress: "Pickup schedule to be coordinated",
    itemLines: [{ name: "Embroidered Staff Cap - Navy", qty: 24 }],
    updated: "Approved",
  },
  {
    id: "TRRY-UC-0001",
    client: "Urban Coffee",
    clientInitials: "UC",
    requestedBy: "Urban Coffee Admin",
    requesterRole: "Portal Admin",
    requesterEmail: "orders@urbancoffee.trryapparel.com",
    requesterPhone: "To be added",
    clientAddress: "urbancoffee.trryapparel.com",
    cityState: "Private client portal",
    items: "Admin Polo Uniform, Embroidered Staff Cap",
    itemCount: 2,
    qty: 42,
    fulfillment: "Delivery",
    neededDate: "July 02, 2026",
    daysUntilNeeded: "In production",
    status: "In Production",
    shipTo: "Urban Coffee - Operations",
    shipAddress: "Delivery address to be confirmed",
    itemLines: [
      { name: "Admin Polo Uniform - Black", qty: 18 },
      { name: "Embroidered Staff Cap - Navy", qty: 24 },
    ],
    updated: "Moved to production",
  },
];

let selectedId = orders[0]?.id ?? null;
let selectedProductCode = products[0].code;
let activeFilter = "All";
let productFilter = "All";
let query = "";
let draftStatus = orders[0]?.status ?? "Pending Review";
let clientQuery = "";
let selectedClientId = clientProgram.id;
let productQuery = "";
let feedbackMessage = "";
let globalSearchQuery = "";
let feedbackTimer = null;

const routes = {
  "/": "Overview",
  "/orders": "Orders",
  "/overview": "Overview",
  "/clients": "Clients",
  "/products": "Products",
  "/settings": "Settings",
};

function render() {
  const currentRoute = getCurrentRoute();
  const selectedOrder = orders.find((order) => order.id === selectedId);
  const selectedProduct =
    products.find((product) => product.code === selectedProductCode) ?? products[0];
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
                  ? renderProductsPage(selectedProduct)
                  : currentRoute === "Settings"
                    ? renderSettingsPage()
                    : renderOverviewPage()
        }
        ${renderFooter()}
      </section>
    </div>
  `;

  bindEvents();
}

function renderOverviewPage() {
  const cards = [
    { label: "Pending Review", value: countOrders("Pending Review"), icon: "queue", delta: "Needs admin review" },
    { label: "Approved", value: countOrders("Approved"), icon: "check", delta: "Ready for scheduling" },
    { label: "In Production", value: countOrders("In Production"), icon: "factory", delta: "Production active" },
    { label: "Ready to Ship", value: countOrders("Ready"), icon: "ready", delta: "Awaiting dispatch" },
    { label: "Completed This Month", value: countOrders("Completed"), icon: "calendar", delta: "June 2026" },
  ];

  return `
    <main class="orders-page">
      <div class="page-heading split-heading">
        <div>
          <h1>Overview</h1>
          <p class="subtitle">Monitor key client portal orders and production movement across TRRY Apparel.</p>
        </div>
        <span class="date-chip">June 2026 Operations</span>
      </div>

      <section class="status-grid" aria-label="Operations summary">
        ${cards.map(renderStatusCard).join("")}
      </section>

      <section class="overview-dashboard-grid">
        <article class="content-card dashboard-table-card">
          <div class="card-header">
            <h2>Recent Orders</h2>
            <button class="link-button" data-route-target="/orders" type="button">View all orders</button>
          </div>
          ${renderRecentOrdersTable()}
        </article>
        <div class="side-stack">
          <article class="activity-card">
            <div class="card-header">
              <h2>Today's Activity</h2>
              <span class="mini-label">Live queue</span>
            </div>
            <div class="activity-list">
              <div><span></span><strong>New reorder request submitted</strong><p>Urban Coffee - Admin Polo Uniform</p></div>
              <div><span></span><strong>Status moved to Approved</strong><p>Urban Coffee - Embroidered Staff Cap</p></div>
              <div><span></span><strong>Production queue updated</strong><p>Urban Coffee - Mixed reorder request</p></div>
            </div>
          </article>
          <article class="activity-card">
            <div class="card-header">
              <h2>Quick Actions</h2>
              <span class="mini-label">Admin tools</span>
            </div>
            <div class="quick-actions">
              ${["Create Order", "Add Client", "Add Product", "Reorder Request"]
                .map((label) => `<button type="button"><span></span>${label}</button>`)
                .join("")}
            </div>
          </article>
        </div>
      </section>
    </main>
  `;
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
        ${getOrderStatCards().map(renderStatusCard).join("")}
      </section>

      <section class="orders-workbench has-panel">
        <div class="orders-list-card">
          ${renderToolbar()}
          ${renderOrdersTable(filteredOrders)}
        </div>
        ${selectedOrder ? renderOrderDetailPanel(selectedOrder) : renderEmptyDetailPanel()}
      </section>
    </main>
  `;
}

function renderClientsPage() {
  const normalizedQuery = clientQuery.trim().toLowerCase();
  const clientSlug = "urban-coffee";
  const clientMatches =
    !normalizedQuery ||
    [clientProgram.name, clientSlug, clientProgram.domain]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);

  const cards = [
    { label: "Total Clients", value: "1", icon: "clients", delta: "Urban Coffee active" },
    { label: "Active Portals", value: "1", icon: "ready", delta: "Private portal live" },
    { label: "Pending Setup", value: "0", icon: "calendar", delta: "No blocked setup" },
    { label: "High Activity", value: "0", icon: "factory", delta: "No high activity yet" },
  ];

  return `
    <main class="orders-page">
      <div class="page-heading">
        <div>
          <h1>Clients</h1>
          <p class="subtitle">Manage portal accounts and recurring reorder clients.</p>
        </div>
      </div>

      <section class="status-grid compact-grid" aria-label="Client summary">
        ${cards.map(renderStatusCard).join("")}
      </section>

      <div class="clients-action-row">
        <label class="search-field clients-search">
          <span aria-hidden="true"></span>
          <input id="client-search" value="${escapeHtml(clientQuery)}" placeholder="Search clients by name, slug, or domain..." type="search" />
        </label>
        <button class="primary-button disabled-primary" disabled title="Client creation will be connected to Supabase later." type="button">
          Add New Client
        </button>
      </div>

      <section class="two-column-page">
        <article class="content-card table-card">
          <table class="clients-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Portal Slug</th>
                <th>Account Type</th>
                <th>Active Orders</th>
                <th>Saved Employees</th>
                <th>Approved Products</th>
                <th>Status</th>
                <th>View</th>
              </tr>
            </thead>
            <tbody>
              ${
                clientMatches
                  ? `<tr class="${selectedClientId === clientProgram.id ? "selected" : ""}" data-client-id="${clientProgram.id}">
                      <td>
                        <div class="client-cell">
                          <span class="client-logo urban-coffee">${clientProgram.initials}</span>
                          <div><strong>${clientProgram.name}</strong><span>${clientProgram.domain}</span></div>
                        </div>
                      </td>
                      <td>${clientSlug}</td>
                      <td>${clientProgram.accountType}</td>
                      <td>${clientProgram.activeOrders}</td>
                      <td>${clientProgram.savedEmployees}</td>
                      <td>${clientProgram.approvedProducts}</td>
                      <td><span class="status-pill active">${clientProgram.status}</span></td>
                      <td><button class="view-button" data-client-id="${clientProgram.id}" type="button" aria-label="View Urban Coffee"><span></span></button></td>
                    </tr>`
                  : ""
              }
            </tbody>
          </table>
          ${
            clientMatches
              ? ""
              : `<div class="empty-state compact-empty"><strong>No clients found</strong><span>Try searching for Urban Coffee or the portal domain.</span></div>`
          }
        </article>
        ${renderClientPanel()}
      </section>
      ${renderFeedback()}
      <p class="page-note">More client management tools will be connected to Supabase later.</p>
    </main>
  `;
}

function renderProductsPage(selectedProduct) {
  const normalizedQuery = productQuery.trim().toLowerCase();
  const visibleProducts = products.filter((item) => {
    const matchesFilter =
      productFilter === "All" ||
      item.category === productFilter ||
      (productFilter === "Merch" && item.category === "Merch") ||
      (productFilter === "Accessories" && item.category === "Accessories") ||
      (productFilter === "Drafts" && item.status === "Draft");
    const matchesQuery =
      !normalizedQuery ||
      [item.product, item.category, item.color, item.logoPlacement, item.client]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);

    return matchesFilter && matchesQuery;
  });

  const cards = [
    { label: "Approved Products", value: products.length, icon: "check", delta: "Visible in client portal" },
    { label: "Draft Products", value: "0", icon: "queue", delta: "No drafts yet" },
    { label: "Pending Approval", value: "0", icon: "calendar", delta: "No blocked specs" },
    { label: "Top Category", value: "Uniforms", icon: "ready", delta: "Primary program" },
  ];

  return `
    <main class="orders-page">
      <div class="page-heading">
        <div>
          <h1>Products</h1>
          <p class="subtitle">Manage approved uniforms, merch items, and saved product specs.</p>
        </div>
      </div>

      <section class="status-grid compact-grid" aria-label="Product summary">
        ${cards.map(renderStatusCard).join("")}
      </section>

      <section class="two-column-page">
        <article class="content-card table-card">
          <div class="toolbar inner-toolbar">
            <div class="filter-tabs" aria-label="Product filters">
              ${["All", "Uniforms", "Caps", "Merch", "Accessories", "Drafts"]
                .map(
                  (filter) => `
                    <button class="${filter === productFilter ? "active" : ""}" data-product-filter="${filter}" type="button">
                      ${filter}
                    </button>`
                )
                .join("")}
            </div>
            <label class="search-field product-search">
              <span aria-hidden="true"></span>
              <input id="product-search" value="${escapeHtml(productQuery)}" placeholder="Search products" type="search" />
            </label>
          </div>
          <p class="table-helper-text">Select a product to view details.</p>
          <table class="products-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Client</th>
                <th>Category</th>
                <th>Color</th>
                <th>Logo Placement</th>
                <th>Fabric / Spec</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${visibleProducts.map(renderProductRow).join("")}
            </tbody>
          </table>
          ${
            visibleProducts.length === 0
              ? `<div class="empty-state compact-empty"><strong>No products found</strong><span>Try a different product, category, color, or logo placement.</span></div>`
              : ""
          }
        </article>
        ${renderProductPanel(selectedProduct)}
      </section>
    </main>
  `;
}

function renderSettingsPage() {
  const sections = [
    {
      title: "Admin Profile",
      rows: [["Profile", "TRRY Admin"], ["Role", "Mother Admin"], ["Access", "Operations control center"]],
    },
    {
      title: "Company Settings",
      rows: [["Company", "TRRY Apparel Management"], ["Primary color", "#ff5a00"], ["Workspace", "Production admin"]],
    },
    {
      title: "Portal Settings",
      rows: [["Admin domain", "admin.trryapparel.com"], ["Client portal", clientProgram.domain], ["Mode", "MVP Prototype"]],
    },
    {
      title: "Notification Settings",
      rows: [["Order alerts", "On"], ["Production updates", "On"], ["Client portal activity", "On"]],
    },
    {
      title: "Status Workflow",
      rows: [["Start", "Pending Review"], ["Production", "Approved to In Production"], ["Fulfillment", "Ready to Completed"]],
    },
    {
      title: "Danger Zone",
      danger: true,
      rows: [["Delete portal data", "Disabled"], ["Reset workspace", "Disabled"], ["Live destructive actions", "Unavailable"]],
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

      <section class="settings-grid settings-grid-wide">
        ${sections
          .map(
            (section) => `
              <article class="settings-card ${section.danger ? "danger-card" : ""}">
                <h2>${section.title}</h2>
                ${section.rows
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

function renderRecentOrdersTable() {
  return `
    <table class="recent-table">
      <thead>
        <tr>
          <th>Order ID</th>
          <th>Client</th>
          <th>Product</th>
          <th>Status</th>
          <th>Due Date</th>
          <th>Last Updated</th>
        </tr>
      </thead>
      <tbody>
        ${orders
          .map(
            (order) => `
              <tr>
                <td class="request-id">${order.id}</td>
                <td>${order.client}</td>
                <td><div class="stacked-cell"><strong>${order.items}</strong><span>${order.qty} units</span></div></td>
                <td>${renderStatusPill(order.status)}</td>
                <td>${order.neededDate}</td>
                <td>${order.updated}</td>
              </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderToolbar() {
  return `
    <div class="toolbar">
      <div class="filter-tabs" aria-label="Order filters">
        ${["All", ...statusOptions]
          .map(
            (status) => `
              <button class="${status === activeFilter ? "active" : ""}" data-filter="${status}" type="button">
                ${status}
              </button>`
          )
          .join("")}
      </div>
      <div class="table-actions">
        <label class="search-field wide-search">
          <span aria-hidden="true"></span>
          <input id="order-search" value="${escapeHtml(query)}" placeholder="Search request no., client, or requested by..." type="search" />
        </label>
        <button class="filter-button" aria-label="Advanced filters" type="button"><span></span></button>
      </div>
    </div>
  `;
}

function renderOrdersTable(filteredOrders) {
  const rows = filteredOrders.map(renderOrderRow).join("");

  return `
    <table class="orders-table">
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
        ? `<div class="empty-state"><strong>No reorder requests found</strong><span>Try changing the filter or search term.</span></div>`
        : ""
    }
    <div class="table-footer">
      <span>Showing ${filteredOrders.length} of ${orders.length} orders</span>
      <div class="pager">
        <button type="button" aria-label="Previous page"></button>
        <button class="active" type="button">1</button>
        <button type="button" aria-label="Next page"></button>
      </div>
    </div>
  `;
}

function renderOrderRow(order) {
  return `
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
      <td>${order.itemCount}</td>
      <td>${order.qty}</td>
      <td><span class="fulfillment ${statusToClass(order.fulfillment)}"><span></span>${order.fulfillment}</span></td>
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
    </tr>
  `;
}

function renderProductRow(item) {
  return `
    <tr class="${item.code === selectedProductCode ? "selected" : ""}" data-product-code="${item.code}">
      <td>
        <div class="client-cell">
          <span class="product-thumb ${statusToClass(item.category)}"></span>
          <div><strong>${item.product}</strong><span>${item.code}</span></div>
        </div>
      </td>
      <td>${item.client}</td>
      <td>${item.category}</td>
      <td><span class="color-dot ${statusToClass(item.color)}"></span>${item.color}</td>
      <td>${item.logoPlacement}</td>
      <td>${item.fabric}</td>
      <td>${renderStatusPill(item.status)}</td>
      <td><button class="view-button" data-product-code="${item.code}" aria-label="View ${item.product}" type="button"><span></span></button></td>
    </tr>
  `;
}

function renderOrderDetailPanel(order) {
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
            <a href="https://${clientProgram.domain}" target="_blank" rel="noreferrer">View client profile</a>
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

      <section class="panel-section detail-metrics">
        <div><span>Fulfillment</span><strong>${order.fulfillment}</strong></div>
        <div><span>Needed Date</span><strong>${order.neededDate}</strong></div>
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
        <button class="note-button" type="button"><span></span>Add Internal Note</button>
      </section>
    </aside>
  `;
}

function renderEmptyDetailPanel() {
  return `
    <aside class="detail-panel empty-panel">
      <div class="empty-state">
        <strong>Select an order</strong>
        <span>Order details and production controls will appear here.</span>
      </div>
    </aside>
  `;
}

function renderClientPanel() {
  return `
    <aside class="detail-panel client-detail-panel">
      <div class="panel-header">
        <h2>Client Profile</h2>
      </div>
      <section class="panel-section centered-profile">
        <span class="client-logo xl urban-coffee">${clientProgram.initials}</span>
        <div class="client-panel-name">
          <strong>${clientProgram.name}</strong>
          ${renderStatusPill(clientProgram.status)}
        </div>
        <a class="portal-link" href="https://${clientProgram.domain}" target="_blank" rel="noreferrer">
          ${clientProgram.domain}<span class="external-link-icon" aria-hidden="true"></span>
        </a>
      </section>
      <section class="panel-section">
        <div class="settings-row"><span>Account type</span><strong>${clientProgram.accountType}</strong></div>
        <div class="settings-row"><span>Primary contact</span><strong>${clientProgram.primaryContact}</strong></div>
        <div class="settings-row"><span>Contact email</span><strong>${clientProgram.contactEmail}</strong></div>
        <div class="settings-row"><span>Contact number</span><strong>${clientProgram.contactNumber}</strong></div>
      </section>
      <section class="panel-section panel-stat-grid">
        <div><span>Approved Products</span><strong>${clientProgram.approvedProducts}</strong></div>
        <div><span>Saved Employees</span><strong>${clientProgram.savedEmployees}</strong></div>
        <div><span>Active Orders</span><strong>${clientProgram.activeOrders}</strong></div>
        <div><span>Last Order</span><strong>${clientProgram.lastOrderDate}</strong></div>
      </section>
      <section class="quick-panel-actions">
        <a href="https://${clientProgram.domain}" target="_blank" rel="noreferrer">Open Portal</a>
        <button data-copy-value="https://${clientProgram.domain}" data-copy-message="Portal link copied" type="button">Copy Portal Link</button>
        <button data-route-target="/products" type="button">View Products</button>
        <button data-route-target="/orders" type="button">View Orders</button>
        <button disabled title="Editing will be connected to Supabase later." type="button">Edit Client</button>
      </section>
    </aside>
  `;
}

function renderProductPanel(product) {
  return `
    <aside class="detail-panel product-detail-panel">
      <div class="panel-header">
        <h2>Product Details</h2>
      </div>
      <section class="product-image-panel">
        <div class="product-mock ${statusToClass(product.category)}"></div>
      </section>
      <section class="panel-section">
        <div class="panel-title-row">
          <h2>${product.product}</h2>
          ${renderStatusPill(product.status)}
        </div>
        <div class="settings-row"><span>Client</span><strong>${product.client}</strong></div>
        <div class="settings-row"><span>Category</span><strong>${product.category}</strong></div>
        <div class="settings-row"><span>Color</span><strong>${product.color}</strong></div>
        <div class="settings-row"><span>Logo placement</span><strong>${product.logoPlacement}</strong></div>
        <div class="settings-row"><span>Fabric / spec</span><strong>${product.fabric}</strong></div>
        <div class="settings-row"><span>Product code</span><strong>${product.code}</strong></div>
        <div class="settings-row"><span>Visible in portal</span><strong>${product.visible}</strong></div>
        <div class="settings-row"><span>Created</span><strong>${product.created}</strong></div>
        <div class="settings-row"><span>Last updated</span><strong>${product.updated}</strong></div>
      </section>
      <section class="quick-panel-actions product-actions">
        <button disabled title="Client portal product linking will be connected later." type="button">View in Client Portal</button>
        <button data-copy-value="${product.code}" data-copy-message="Product code copied" type="button">Copy Product Code</button>
        <button data-copy-value="https://${clientProgram.domain}" data-copy-message="Portal link copied" type="button">Copy Portal Link</button>
        <button disabled title="Editing will be connected to Supabase later." type="button">Edit Product</button>
        <button disabled title="Duplicate will be enabled after Supabase connection." type="button">Duplicate</button>
      </section>
      ${renderFeedback()}
    </aside>
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
      <div class="global-search-wrap">
        <label class="global-search">
          <input id="global-search" value="${escapeHtml(globalSearchQuery)}" placeholder="Search orders, clients, products..." type="search" />
          <span aria-hidden="true"></span>
        </label>
        ${renderGlobalSearchHint()}
      </div>
      <div class="header-actions">
        <button class="notification-button" aria-label="Notifications" type="button">
          <span></span>
        </button>
        <div class="profile-area">
          <div class="avatar">TA</div>
          <div>
            <strong>TRRY Admin</strong>
            <span>Mother Admin</span>
          </div>
          <span class="chevron"></span>
        </div>
      </div>
    </header>
  `;
}

function renderGlobalSearchHint() {
  const normalized = globalSearchQuery.trim().toLowerCase();
  if (!normalized) return "";

  if ("urban coffee".includes(normalized)) {
    return `<button class="search-suggestion" data-route-target="/clients" type="button">Open Clients</button>`;
  }

  if (
    "admin polo uniform".includes(normalized) ||
    "embroidered staff cap".includes(normalized)
  ) {
    return `<button class="search-suggestion" data-route-target="/products" type="button">Open Products</button>`;
  }

  if ("orders".includes(normalized) || "reorder".includes(normalized)) {
    return `<button class="search-suggestion" data-route-target="/orders" type="button">Open Orders</button>`;
  }

  return "";
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

function renderFeedback() {
  return feedbackMessage ? `<p class="copy-feedback">${feedbackMessage}</p>` : "";
}

function bindEvents() {
  document.querySelectorAll("[data-route-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      window.history.pushState({}, "", link.getAttribute("href"));
      render();
    });
  });

  document.querySelectorAll("[data-route-target]").forEach((button) => {
    button.addEventListener("click", () => {
      window.history.pushState({}, "", button.dataset.routeTarget);
      globalSearchQuery = "";
      render();
    });
  });

  document.querySelectorAll("[data-copy-value]").forEach((button) => {
    button.addEventListener("click", async () => {
      await copyToClipboard(button.dataset.copyValue);
      showFeedback(button.dataset.copyMessage);
    });
  });

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter;
      render();
    });
  });

  document.querySelectorAll("[data-product-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      productFilter = button.dataset.productFilter;
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

  document.querySelectorAll("[data-client-id]").forEach((element) => {
    element.addEventListener("click", () => {
      selectedClientId = element.dataset.clientId;
      render();
    });
  });

  document.querySelectorAll("[data-product-code]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedProductCode = button.dataset.productCode;
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

  const clientSearch = document.getElementById("client-search");
  if (clientSearch) {
    clientSearch.addEventListener("input", (event) => {
      clientQuery = event.target.value;
      render();
      document.getElementById("client-search")?.focus();
    });
  }

  const globalSearch = document.getElementById("global-search");
  if (globalSearch) {
    globalSearch.addEventListener("input", (event) => {
      globalSearchQuery = event.target.value;
      render();
      document.getElementById("global-search")?.focus();
    });
  }

  const productSearch = document.getElementById("product-search");
  if (productSearch) {
    productSearch.addEventListener("input", (event) => {
      productQuery = event.target.value;
      render();
      document.getElementById("product-search")?.focus();
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
      order.id === selectedId ? { ...order, status: draftStatus, updated: "Updated locally" } : order
    );
    render();
  });
}

async function copyToClipboard(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Use the fallback below if clipboard permissions are restricted.
    }
  }

  const input = document.createElement("input");
  input.value = value;
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

function showFeedback(message) {
  feedbackMessage = message;
  render();

  if (feedbackTimer) window.clearTimeout(feedbackTimer);
  feedbackTimer = window.setTimeout(() => {
    feedbackMessage = "";
    render();
  }, 1800);
}

window.addEventListener("popstate", render);

function getOrderStatCards() {
  return [
    { label: "Pending Review", value: countOrders("Pending Review"), icon: "queue", delta: "Awaiting admin action" },
    { label: "Approved", value: countOrders("Approved"), icon: "check", delta: "Ready for scheduling" },
    { label: "In Production", value: countOrders("In Production"), icon: "factory", delta: "Currently moving" },
    { label: "Ready", value: countOrders("Ready"), icon: "ready", delta: "Awaiting fulfillment" },
    { label: "Completed", value: countOrders("Completed"), icon: "calendar", delta: "Closed requests" },
  ];
}

function countOrders(status) {
  return orders.filter((order) => order.status === status).length;
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

function getCurrentRoute() {
  return routes[window.location.pathname] ?? "Overview";
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
