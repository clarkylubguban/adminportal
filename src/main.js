import { createMvpDashboard } from "./mvpDashboard.js";
import { getAdminClientPrograms } from "./services/adminClients.js";
import { getAdminReorderRequests } from "./services/adminOrders.js";
import {
  createOpsBoardInquiry,
  getOpsBoardInquiries,
  updateOpsInquiryFields,
  updateOpsInquiryStatus,
} from "./services/opsBoard.js";
import { getApprovedAdminUser } from "./services/adminUsers.js";
import {
  catalogOptions,
  catalogStatusOptions,
  createAdminCatalogProduct,
  getAdminCatalogProducts,
  updateAdminCatalogProduct,
} from "./services/adminCatalog.js";
import {
  deleteCatalogImageByUrl,
  deleteCatalogImagePath,
  uploadCatalogImage,
  validateCatalogImageFileWithDimensions,
} from "./services/adminCatalogImages.js";
import {
  getCurrentAdminAuthSession,
  getSupabaseConfig,
  isSupabaseReady,
  signInAdminWithPassword,
  signOutAdmin,
} from "./lib/supabaseClient.js";

const mvpDashboard = createMvpDashboard();

const lucideIcons = {
  "layout-dashboard": '<rect width="7" height="9" x="3" y="3" rx="1"></rect><rect width="7" height="5" x="14" y="3" rx="1"></rect><rect width="7" height="9" x="14" y="12" rx="1"></rect><rect width="7" height="5" x="3" y="16" rx="1"></rect>',
  "clipboard-list": '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><path d="M12 11h4"></path><path d="M12 16h4"></path><path d="M8 11h.01"></path><path d="M8 16h.01"></path>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><path d="M16 3.128a4 4 0 0 1 0 7.744"></path><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><circle cx="9" cy="7" r="4"></circle>',
  shirt: '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"></path>',
  settings: '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"></path><circle cx="12" cy="12" r="3"></circle>',
  "shield-check": '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.68-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="m9 12 2 2 4-4"></path>',
  menu: '<path d="M4 6h16"></path><path d="M4 12h16"></path><path d="M4 18h16"></path>',
  search: '<path d="m21 21-4.34-4.34"></path><circle cx="11" cy="11" r="8"></circle>',
  bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"></path><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"></path>',
  bot: '<path d="M12 8V4H8"></path><rect width="16" height="12" x="4" y="8" rx="2"></rect><path d="M2 14h2"></path><path d="M20 14h2"></path><path d="M15 13v2"></path><path d="M9 13v2"></path>',
  "chevron-down": '<path d="m6 9 6 6 6-6"></path>',
  "chevron-right": '<path d="m9 18 6-6-6-6"></path>',
  filter: '<path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"></path>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"></path><circle cx="12" cy="12" r="3"></circle>',
  truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"></path><path d="M15 18H9"></path><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"></path><circle cx="17" cy="18" r="2"></circle><circle cx="7" cy="18" r="2"></circle>',
  "map-pin": '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"></path><circle cx="12" cy="10" r="3"></circle>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>',
  "file-text": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M10 9H8"></path><path d="M16 13H8"></path><path d="M16 17H8"></path>',
  "external-link": '<path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>',
  "circle-check": '<circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path>',
  factory: '<path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"></path><path d="M17 18h1"></path><path d="M12 18h1"></path><path d="M7 18h1"></path>',
  package: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"></path><path d="M12 22V12"></path><path d="m3.3 7 8.7 5 8.7-5"></path><path d="m7.5 4.27 9 5.15"></path>',
  "calendar-check": '<path d="M8 2v4"></path><path d="M16 2v4"></path><rect width="18" height="18" x="3" y="4" rx="2"></rect><path d="M3 10h18"></path><path d="m9 16 2 2 4-4"></path>',
  "clipboard-plus": '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><path d="M9 14h6"></path><path d="M12 11v6"></path>',
  "user-plus": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M19 8v6"></path><path d="M22 11h-6"></path>',
  "package-plus": '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"></path><path d="M12 22V12"></path><path d="m3.3 7 8.7 5 8.7-5"></path><path d="M12 8v8"></path><path d="M8 12h8"></path>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.064 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.064a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z"></path><path d="M20 3v4"></path><path d="M22 5h-4"></path><path d="M4 17v2"></path><path d="M5 18H3"></path>',
};

function renderIcon(name, className = "") {
  const icon = lucideIcons[name] ?? lucideIcons["circle-check"];
  const classes = [className, "lucide-icon"].filter(Boolean).join(" ");

  return `<span class="${classes}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg></span>`;
}

function getNavIcon(label) {
  const icons = {
    Overview: "layout-dashboard",
    Orders: "factory",
    Reorders: "clipboard-list",
    "Order Dashboard": "factory",
    Clients: "users",
    Products: "shirt",
    Catalog: "package",
    Settings: "settings",
  };

  return icons[label] ?? "circle-check";
}

function getCardIcon(icon) {
  const icons = {
    queue: "clipboard-list",
    check: "circle-check",
    factory: "factory",
    ready: "package",
    calendar: "calendar-check",
    clients: "users",
  };

  return icons[icon] ?? "circle-check";
}

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
  supabaseClientId: "91a0967d-c946-43f7-b03d-f289fe3f5eec",
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

const imageAngleLabels = ["Front", "Back", "Detail", "Size Chart"];

let productImages = products.flatMap((product) =>
  imageAngleLabels.map((angleLabel, index) => ({
    id: `${product.code}-${statusToClass(angleLabel)}`,
    product_id: product.code,
    image_url: createProductImageDataUrl(product, angleLabel),
    angle_label: angleLabel,
    sort_order: index + 1,
    is_main: angleLabel === "Front",
    created_at: "2026-06-17T00:00:00+08:00",
  }))
);

const OPS_LIME = "#DDFF4F";
const OPS_INK = "#111111";
const OPS_RED = "#E23F32";

const opsStatus = {
  new: { label: "New / Inquiry Received", dot: OPS_LIME, bg: OPS_LIME, text: OPS_INK },
  quote: { label: "Needs Quote", dot: OPS_INK, bg: "#FFFFFF", text: OPS_INK },
  sent: { label: "Quote Sent", dot: OPS_INK, bg: "#FFFFFF", text: OPS_INK },
  followup: { label: "Follow Up", dot: OPS_INK, bg: "#FFFFFF", text: OPS_INK },
  won: { label: "Won / Odoo Created", dot: OPS_LIME, bg: OPS_LIME, text: OPS_INK },
  lost: { label: "Lost", dot: OPS_RED, bg: "#FFF5F4", text: OPS_RED },
};

const opsServiceTypes = [
  "DTF Per Meter",
  "Embroidery",
  "Screen Printing",
  "Print Only",
  "DTF Printing",
];
const opsSource = {
  FB: { label: "FB", bg: "#FFFFFF", text: OPS_INK },
  "Walk-in": { label: "Walk-in", bg: "#FFFFFF", text: OPS_INK },
  Referral: { label: "Referral", bg: "#FFFFFF", text: OPS_INK },
  Portal: { label: "Portal", bg: OPS_LIME, text: OPS_INK },
};

const opsStatusNameToKey = {
  "New / Inquiry Received": "new",
  "New Inquiry": "new",
  "Need Details": "followup",
  "Needs Quote": "quote",
  "Quote Needed": "quote",
  "Quote Sent": "sent",
  "Follow Up": "followup",
  "Won / Odoo Created": "won",
  Lost: "lost",
};

const emptyOpsExtract = {
  customerName: "",
  businessName: "",
  source: "FB",
  serviceType: "",
  quantity: "",
  neededDate: "",
  summary: "",
  missingDetails: "",
  suggestedStatus: "New / Inquiry Received",
  nextAction: "",
  suggestedReply: "",
};

const localOpsInquiries = [
  { id: "TRY-0148", customer: "Ma. Theresa Cafe", service: "DTF Print", qty: "30 pcs", dueDate: "2026-07-11", followUpDate: null, next: "Reply with fabric options", assigned: "Jena", source: "FB", status: "new", odooSO: "" },
  { id: "TRY-0147", customer: "Kagawad Lito / Brgy. Hinaplanon", service: "Uniform + Embroidery", qty: "45 pcs", dueDate: "2026-07-07", followUpDate: null, next: "Ask sizes + logo file", assigned: "Jena", source: "FB", status: "followup", odooSO: "" },
  { id: "TRY-0146", customer: "Iligan Riders Club", service: "Screen Print", qty: "60 pcs", dueDate: "2026-07-15", followUpDate: null, next: "Prepare quotation", assigned: "Clark", source: "Referral", status: "quote", odooSO: "" },
  { id: "TRY-0145", customer: "St. Michael's College Org", service: "Org Shirts (DTF)", qty: "120 pcs", dueDate: "2026-07-22", followUpDate: "2026-07-07", next: "Follow up - quote sent Jul 6", assigned: "Clark", source: "Portal", status: "sent", odooSO: "" },
  { id: "TRY-0144", customer: "D' Native Grill", service: "Staff Uniforms", qty: "18 pcs", dueDate: "2026-07-14", followUpDate: null, next: "Schedule production", assigned: "Clark", source: "Walk-in", status: "won", odooSO: "SO-2214" },
  { id: "TRY-0143", customer: "J&M Trading", service: "Cap Embroidery", qty: "25 pcs", dueDate: null, followUpDate: null, next: "Went with another supplier", assigned: "Jena", source: "FB", status: "lost", odooSO: "" },
];

const shouldLoadSupabaseOps = isSupabaseReady();

let opsInquiries = shouldLoadSupabaseOps ? [] : [...localOpsInquiries];
let opsLoadState = shouldLoadSupabaseOps ? "loading" : "local";
let opsLoadError = "";
let hasLoadedOpsInquiries = false;

const opsProduction = [
  { name: "DTF", jobs: 0, note: "Production tracking not connected yet." },
  { name: "Embroidery", jobs: 0, note: "Production tracking not connected yet." },
  { name: "Screen Print", jobs: 0, note: "Production tracking not connected yet." },
  { name: "Ready for Pickup", jobs: 0, note: "Production tracking not connected yet." },
];

const opsPriorities = [
  { text: "Follow up pending quotation - St. Michael's College Org", tag: "Quote Sent", tone: "sent" },
  { text: "Ask missing details - Brgy. Hinaplanon needs sizes + logo file", tag: "Follow Up", tone: "followup" },
  { text: "Create Odoo Sales Order - Iligan Riders Club confirmed 60 pcs", tag: "Confirmed", tone: "won" },
  { text: "Check production queue - embroidery due this week", tag: "Production", tone: "followup" },
];

let opsRawMessage = "";
let opsExtractFields = null;
let opsSavedNotice = false;
let opsSoDraft = null;
let opsArtworkRequests = {};
let opsCustomerActionRequests = {};
let expandedOpsInquiryId = null;
let selectedOrderDashboardId = null;
let orderDashboardSaveError = "";
let orderDashboardReturnFocusId = null;
const orderDashboardCopyTimers = new Map();
let orderDashboardFilters = {
  search: "",
  stage: "all",
  staff: "all",
  fulfillment: "all",
  due: "all",
};

let mvpInquiryFilters = { stage: "all", owner: "all", service: "all", due: "all", search: "" };
let mvpProductionFilters = { stage: "all", staff: "all", due: "all", search: "" };
let selectedMvpInquiryId = null;
let selectedMvpProductionId = null;

const orderProductionStages = [
  { value: "queued", label: "Queued" },
  { value: "printing", label: "Printing" },
  { value: "embroidery", label: "Embroidery" },
  { value: "screen_printing", label: "Screen Printing" },
  { value: "qc", label: "QC" },
  { value: "ready", label: "Ready" },
  { value: "completed", label: "Completed" },
];
const localOrders = [
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

const shouldLoadSupabaseOrders = isSupabaseReady();

let orders = shouldLoadSupabaseOrders ? [] : [...localOrders];

let selectedId = orders[0]?.id ?? null;
let selectedProductCode = products[0].code;
let isProductDrawerOpen = false;
let activeFilter = "All";
let clientKpiFilter = "All";
let productFilter = "All";
let catalogStatusFilter = "active";
let query = "";
let draftStatus = orders[0]?.status ?? "Pending Review";
let clientQuery = "";
let selectedClientId = clientProgram.id;
let productQuery = "";
let selectedImageAngle = "Front";
let feedbackMessage = "";
let globalSearchQuery = "";
let feedbackTimer = null;
let hasLoadedAdminOrders = false;
let hasLoadedAdminClients = false;
let hasLoadedCatalogProducts = false;
let orderLoadState = shouldLoadSupabaseOrders ? "loading" : "local";
let clientLoadState = shouldLoadSupabaseOrders ? "loading" : "local";
let catalogProducts = [];
let catalogLoadState = shouldLoadSupabaseOrders ? "loading" : "empty";
let catalogLoadError = "";
let activeCatalogKey = "trry_webapp";
let selectedCatalogProductId = null;
let catalogDrawerMode = "";
let catalogDraft = null;
let catalogValidationError = "";
let catalogSaveState = "idle";
let catalogSaveError = "";

const routes = {
  "/": "Overview",
  "/inquiries": "Inquiries",
  "/order-dashboard": "Orders",
  "/orders": "Orders",
  "/production": "Production",
  "/reorders": "Reorders",
  "/overview": "Overview",
  "/clients": "Clients",
  "/products": "Products",
  "/catalog": "Catalog",
  "/settings": "Settings",
};

const defaultRoutePath = "/";
const ADMIN_ACCESS_SESSION_KEY = "trry_admin_access_unlocked";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "trry_admin_sidebar_collapsed_v3";

let adminAccessCodeInput = "";
let adminAccessError = "";
let adminAccessUnlockedMemory = false;
let adminAuthStatus = isSupabaseReady() ? "checking" : "access-code";
let adminAuthSession = null;
let adminUser = null;
let adminLoginEmail = "";
let adminLoginPassword = "";
let adminLoginError = "";
let adminAuthMessage = "";
let isSidebarCollapsed = getStoredSidebarCollapsed();
let isMobileSidebarOpen = false;

function render() {
  if (!canRenderAdminShell()) {
    renderAdminAuthGate();
    return;
  }

  const currentRoute = getCurrentRoute();
  const selectedOrder = orders.find((order) => order.id === selectedId);
  const selectedProduct =
    products.find((product) => product.code === selectedProductCode) ?? products[0];
  const filteredOrders = getFilteredOrders();
  const isAdminSaasRoute = ["Clients", "Products", "Catalog", "Settings"].includes(currentRoute);

  document.getElementById("root").innerHTML = `
    <div class="app-shell ${isSidebarCollapsed ? "sidebar-collapsed" : ""} ${isMobileSidebarOpen ? "mobile-sidebar-open" : ""} ${isAdminSaasRoute ? "admin-saas-shell" : ""}">
      ${renderMobileTopBar()}
      ${renderSidebar(currentRoute)}
      <button class="sidebar-backdrop" type="button" aria-label="Close navigation"></button>
      <section class="workspace ${isSidebarCollapsed ? "is-expanded" : ""} ${isAdminSaasRoute ? "admin-saas-workspace" : ""}">
        ${renderTopHeader()}
        ${
          currentRoute === "Orders"
            ? renderMvpOrdersPage()
            : currentRoute === "Reorders"
              ? renderOrdersPage(selectedOrder, filteredOrders)
              : currentRoute === "Inquiries"
                ? renderMvpInquiriesPage()
                : currentRoute === "Production"
                  ? renderMvpProductionPage()
                  : currentRoute === "Overview"
                ? renderOverviewPage()
                : currentRoute === "Clients"
                  ? renderClientsPage()
                  : currentRoute === "Products"
                    ? renderProductsPage(selectedProduct)
                    : currentRoute === "Catalog"
                      ? renderCatalogPage()
                      : currentRoute === "Settings"
                        ? renderSettingsPage()
                        : renderOverviewPage()
        }
        ${renderFooter()}
      </section>
      ${renderMobileBottomNav(currentRoute)}
    </div>
  `;

  bindEvents();
}


function canRenderAdminShell() {
  if (!isSupabaseReady()) {
    return isAdminAccessUnlocked();
  }

  return adminAuthStatus === "approved" && Boolean(adminAuthSession && adminUser);
}

function renderAdminAuthGate() {
  if (!isSupabaseReady()) {
    renderAdminAccessGate();
    return;
  }

  if (adminAuthStatus === "checking" || adminAuthStatus === "role-checking") {
    renderAdminAuthLoading();
    return;
  }

  if (adminAuthStatus === "blocked") {
    renderAdminBlockedScreen();
    return;
  }

  renderAdminLoginScreen();
}

function renderAdminAuthLoading() {
  const message = adminAuthStatus === "role-checking" ? "Checking admin role..." : "Checking admin session...";

  document.getElementById("root").innerHTML = `
    <main class="admin-access-page">
      <section class="admin-access-card admin-login-card" aria-label="TRRY Admin loading">
        <div class="admin-access-brand"><strong>TRRY</strong><span>APPAREL MANAGEMENT</span></div>
        <div class="admin-access-heading">
          <p>ADMIN AUTH</p>
          <h1>TRRY ADMIN LOGIN</h1>
          <span>${escapeHtml(message)}</span>
        </div>
      </section>
    </main>
  `;
}

function renderAdminLoginScreen() {
  document.getElementById("root").innerHTML = `
    <main class="admin-access-page">
      <section class="admin-access-card admin-login-card" aria-label="TRRY Admin login">
        <div class="admin-access-brand"><strong>TRRY</strong><span>APPAREL MANAGEMENT</span></div>
        <div class="admin-access-heading">
          <p>STAFF ACCESS</p>
          <h1>TRRY ADMIN LOGIN</h1>
          <span>Staff operations dashboard. Sign in to continue.</span>
        </div>
        <form class="admin-access-form" id="admin-login-form">
          <label for="admin-login-email">EMAIL</label>
          <input id="admin-login-email" value="${escapeHtml(adminLoginEmail)}" type="email" autocomplete="email" />
          <label for="admin-login-password">PASSWORD</label>
          <input id="admin-login-password" value="${escapeHtml(adminLoginPassword)}" type="password" autocomplete="current-password" />
          ${adminLoginError ? `<p class="admin-access-error">${escapeHtml(adminLoginError)}</p>` : ""}
          <button type="submit">SIGN IN</button>
        </form>
        <p class="admin-access-note">Internal beta only. Admin auth and secure RLS hardening continue in the next phase.</p>
      </section>
    </main>
  `;

  bindAdminLoginEvents();
}

function renderAdminBlockedScreen() {
  document.getElementById("root").innerHTML = `
    <main class="admin-access-page">
      <section class="admin-access-card admin-login-card blocked" aria-label="TRRY Admin access blocked">
        <div class="admin-access-brand"><strong>TRRY</strong><span>APPAREL MANAGEMENT</span></div>
        <div class="admin-access-heading">
          <p>ACCESS BLOCKED</p>
          <h1>TRRY ADMIN LOGIN</h1>
          <span>Your account is not approved for TRRY Admin access.</span>
        </div>
        ${adminAuthMessage ? `<p class="admin-access-error">${escapeHtml(adminAuthMessage)}</p>` : ""}
        <button class="admin-logout-button" id="admin-blocked-logout" type="button">LOGOUT</button>
      </section>
    </main>
  `;

  document.getElementById("admin-blocked-logout")?.addEventListener("click", async () => {
    await logoutAdminUser();
  });
}

function bindAdminLoginEvents() {
  const email = document.getElementById("admin-login-email");
  const password = document.getElementById("admin-login-password");
  const form = document.getElementById("admin-login-form");

  email?.addEventListener("input", (event) => {
    adminLoginEmail = event.target.value;
    adminLoginError = "";
  });

  password?.addEventListener("input", (event) => {
    adminLoginPassword = event.target.value;
    adminLoginError = "";
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await loginAdminUser();
  });

  email?.focus();
}

async function loginAdminUser() {
  adminLoginError = "";
  adminAuthStatus = "checking";
  render();

  try {
    const session = await signInAdminWithPassword(adminLoginEmail.trim(), adminLoginPassword);
    adminLoginPassword = "";
    await approveAdminSession(session);
  } catch (error) {
    console.error("Admin login failed.", error);
    adminAuthStatus = "login";
    adminLoginError = "Invalid login. Check your email or password.";
    render();
  }
}

async function approveAdminSession(session) {
  adminAuthStatus = "role-checking";
  adminAuthSession = session;
  render();

  try {
    const approvedUser = await getApprovedAdminUser(session);

    if (!approvedUser) {
      adminUser = null;
      adminAuthStatus = "blocked";
      adminAuthMessage = "Your account is not approved for TRRY Admin access.";
      render();
      return;
    }

    adminUser = approvedUser;
    adminAuthStatus = "approved";
    adminAuthMessage = "";
    render();
    startAdminDataLoading();
  } catch (error) {
    console.error("Admin role check failed.", error);
    adminUser = null;
    adminAuthStatus = "blocked";
    adminAuthMessage = error.message || "Unable to verify TRRY Admin access.";
    render();
  }
}

async function initializeAdminAuth() {
  if (!isSupabaseReady()) {
    adminAuthStatus = "access-code";
    render();
    if (isAdminAccessUnlocked()) startAdminDataLoading();
    return;
  }

  adminAuthStatus = "checking";
  render();

  const session = await getCurrentAdminAuthSession();
  if (!session) {
    adminAuthSession = null;
    adminUser = null;
    adminAuthStatus = "login";
    render();
    return;
  }

  await approveAdminSession(session);
}

async function logoutAdminUser() {
  await signOutAdmin();
  adminAuthSession = null;
  adminUser = null;
  adminLoginPassword = "";
  adminAuthMessage = "";
  adminAuthStatus = isSupabaseReady() ? "login" : "access-code";
  render();
}
function renderAdminAccessGate() {
  document.getElementById("root").innerHTML = `
    <main class="admin-access-page">
      <section class="admin-access-card" aria-label="TRRY Admin access gate">
        <div class="admin-access-brand">
          <strong>TRRY</strong>
          <span>APPAREL MANAGEMENT</span>
        </div>
        <div class="admin-access-heading">
          <p>INTERNAL BETA</p>
          <h1>TRRY ADMIN ACCESS</h1>
          <span>Internal beta dashboard. Enter access code to continue.</span>
        </div>
        <form class="admin-access-form" id="admin-access-form">
          <label for="admin-access-code">ADMIN ACCESS CODE</label>
          <input
            id="admin-access-code"
            value="${escapeHtml(adminAccessCodeInput)}"
            type="password"
            autocomplete="current-password"
            inputmode="text"
            aria-invalid="${adminAccessError ? "true" : "false"}"
          />
          ${adminAccessError ? `<p class="admin-access-error">${escapeHtml(adminAccessError)}</p>` : ""}
          <button type="submit">UNLOCK ADMIN</button>
        </form>
        <p class="admin-access-note">Internal beta only. Admin auth and secure RLS will be added before production use.</p>
      </section>
    </main>
  `;

  bindAdminAccessGateEvents();
}

function bindAdminAccessGateEvents() {
  const input = document.getElementById("admin-access-code");
  const form = document.getElementById("admin-access-form");

  input?.addEventListener("input", (event) => {
    adminAccessCodeInput = event.target.value;
    adminAccessError = "";
  });

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const configuredCode = getAdminAccessCode();

    if (!configuredCode || adminAccessCodeInput.trim() !== configuredCode) {
      adminAccessError = "Invalid access code. Try again.";
      renderAdminAccessGate();
      document.getElementById("admin-access-code")?.focus();
      return;
    }

    setAdminAccessUnlocked();
    adminAccessCodeInput = "";
    adminAccessError = "";
    render();
    startAdminDataLoading();
  });

  input?.focus();
}

function getAdminAccessCode() {
  return String(window.TRRY_ADMIN_ENV?.VITE_ADMIN_ACCESS_CODE ?? "");
}

function isAdminAccessUnlocked() {
  if (adminAccessUnlockedMemory) return true;

  try {
    return sessionStorage.getItem(ADMIN_ACCESS_SESSION_KEY) === "true";
  } catch {
    return false;
  }
}

function setAdminAccessUnlocked() {
  adminAccessUnlockedMemory = true;

  try {
    sessionStorage.setItem(ADMIN_ACCESS_SESSION_KEY, "true");
  } catch {
    // If sessionStorage is unavailable, keep access for this page load only.
  }
}

function getStoredSidebarCollapsed() {
  try {
    const storedValue = localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
    return storedValue === "true";
  } catch {
    return false;
  }
}

function setStoredSidebarCollapsed(value) {
  isSidebarCollapsed = value;

  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(value));
  } catch {
    // localStorage is a convenience only; the shell still works without it.
  }
}

function startAdminDataLoading() {
  if (!canRenderAdminShell()) return;
  loadOpsBoardInquiries();
  loadAdminOrders();
  loadAdminClients();
  loadCatalogProducts();
}

async function loadAdminOrders() {
  if (hasLoadedAdminOrders) return;
  hasLoadedAdminOrders = true;

  const result = await getAdminReorderRequests(localOrders, adminAuthSession);
  orders = result.orders;
  orderLoadState = result.status;

  if (!orders.some((order) => order.id === selectedId)) {
    selectedId = orders[0]?.id ?? null;
    draftStatus = orders[0]?.status ?? "Pending Review";
  }

  render();
}

async function loadAdminClients() {
  if (hasLoadedAdminClients) return;
  hasLoadedAdminClients = true;

  const result = await getAdminClientPrograms(clientProgram, adminAuthSession);
  Object.assign(clientProgram, result.clients[0] ?? clientProgram);
  clientLoadState = result.status;

  render();
}
async function loadCatalogProducts() {
  if (hasLoadedCatalogProducts) return;
  hasLoadedCatalogProducts = true;

  const result = await getAdminCatalogProducts(adminAuthSession);
  catalogProducts = result.products;
  catalogLoadState = result.status;
  catalogLoadError = result.error?.message ?? "";

  if (!catalogProducts.some((item) => item.id === selectedCatalogProductId)) {
    selectedCatalogProductId = catalogProducts.find((item) => item.catalogKey === activeCatalogKey)?.id ?? null;
  }

  render();
}
async function loadOpsBoardInquiries() {
  if (hasLoadedOpsInquiries) return;
  hasLoadedOpsInquiries = true;

  const result = await getOpsBoardInquiries(localOpsInquiries, adminAuthSession);
  opsInquiries = result.inquiries;
  opsLoadState = result.status;
  opsLoadError = result.error?.message ?? "";

  render();
}
function getMvpDashboardItems() {
  return opsInquiries.map((item) => ({
    ...item,
    requiresProductionMigration: shouldLoadSupabaseOps && !item.productionFieldsReady,
  }));
}

function renderOverviewPage() {
  return mvpDashboard.renderOverview({
    items: getMvpDashboardItems(),
    notices: renderOpsPersistenceNotice(),
  });
}

function renderMvpInquiriesPage() {
  return mvpDashboard.renderInquiries({
    items: getMvpDashboardItems(),
    notices: renderOpsPersistenceNotice(),
    renderQuote: renderOpsQuoteStage,
    renderOdoo: renderOpsOdooAction,
  });
}

function renderMvpOrdersPage() {
  return mvpDashboard.renderOrders({
    items: getMvpDashboardItems(),
    notices: renderOpsPersistenceNotice(),
    schemaNotice: renderOrderDashboardSchemaNotice(),
    renderPayment: renderOpsPaymentStage,
    renderTracking: renderOpsCustomerTracking,
  });
}

function renderMvpProductionPage() {
  return mvpDashboard.renderProduction({
    items: getMvpDashboardItems(),
    notices: renderOpsPersistenceNotice(),
    schemaNotice: renderOrderDashboardSchemaNotice(),
  });
}

function renderOpsPersistenceNotice() {
  if (opsLoadState === "success") return "";

  if (opsLoadState === "loading") {
    return `<section class="ops-persistence-card"><strong>Loading Ops Board inquiries</strong><span>Reading from Supabase...</span></section>`;
  }

  if (opsLoadState === "empty") {
    return `<section class="ops-persistence-card"><strong>No persisted inquiries yet</strong><span>Save a reviewed inquiry to create the first Ops Board card in Supabase.</span></section>`;
  }

  if (opsLoadState === "local") {
    return `<section class="ops-persistence-card"><strong>Local preview mode</strong><span>Supabase data is disabled or env is missing, so Ops Board changes reset on refresh.</span></section>`;
  }

  if (opsLoadState === "missing-table" || opsLoadState === "error") {
    const title = opsLoadState === "missing-table" ? "Ops Board table is not ready" : "Unable to load Ops Board inquiries";
    return `<section class="ops-persistence-card error"><strong>${title}</strong><span>${escapeHtml(opsLoadError || "Unable to load inquiries. Check the Supabase connection and admin access.")}</span></section>`;
  }

  return "";
}
function getOpsCounts() {
  return {
    newToday: opsInquiries.filter((item) => item.status === "new").length,
    quotesDue: opsInquiries.filter((item) => item.status === "quote").length,
    followUps: opsInquiries.filter((item) => item.status === "sent" || item.status === "followup").length,
    prodToday: opsProduction.filter((item) => item.name !== "Ready for Pickup").reduce((total, item) => total + item.jobs, 0),
    converted: opsInquiries.filter((item) => item.status === "won" && item.odooSO).length,
  };
}

function getOpsPriorityItems() {
  const today = todayIsoDate();
  const selected = [];
  const seen = new Set();
  const addInquiry = (item, tag, tone, text) => {
    if (!item || seen.has(item.id)) return;
    seen.add(item.id);
    selected.push({
      inquiryId: item.id,
      text,
      tag,
      tone,
    });
  };

  opsInquiries.filter(isOpsOverdue).forEach((item) =>
    addInquiry(item, "Overdue", "overdue", `${item.customer} - ${item.next || "Needs staff check"}`)
  );

  opsInquiries
    .filter((item) => item.status === "followup" && item.followUpDate === today)
    .forEach((item) => addInquiry(item, "Follow Up", "followup", `${item.customer} - follow up today`));

  opsInquiries
    .filter((item) => item.status === "sent" && !item.odooSO)
    .forEach((item) => addInquiry(item, "Quote Sent", "sent", `${item.customer} - quote sent, confirm next step`));

  opsInquiries
    .filter((item) => item.status === "quote")
    .forEach((item) => addInquiry(item, "Needs Quote", "quote", `${item.customer} - prepare quotation`));

  opsInquiries
    .filter((item) => /confirm/i.test(item.next || "") && !item.odooSO)
    .forEach((item) => addInquiry(item, "Need SO", "sent", `${item.customer} - add Odoo SO number`));

  const limited = selected.slice(0, 6).map((item, index) => ({ ...item, number: index + 1 }));

  if (limited.length) return limited;

  return [{ number: 1, text: "No linked inquiry yet.", tag: "Clear", tone: "new", inquiryId: "" }];
}
function renderOpsSummaryCard(card) {
  return `<article class="ops-kpi-card ${card.gold ? "gold" : ""}"><strong>${card.value}</strong><span>${card.label}</span><small>${card.hint}</small></article>`;
}

function renderOpsReviewForm() {
  const fields = opsExtractFields;
  const simpleFields = [["customerName", "Customer Name"], ["businessName", "Business Name"], ["quantity", "Quantity"], ["neededDate", "Needed Date"], ["nextAction", "Next Action"]];
  const textFields = [["summary", "Summary", 2], ["missingDetails", "Missing Details", 2], ["suggestedReply", "Suggested Reply", 3]];
  return `<div class="ops-review-box"><p class="ops-review-label">Review before saving - edit anything AI got wrong</p><div class="ops-review-grid">${simpleFields.map(([key, label]) => renderOpsInput(key, label, fields[key])).join("")}${renderOpsServiceTypeSelect(fields.serviceType)}<label><span>Source</span><select data-ops-field="source">${Object.keys(opsSource).map((source) => `<option value="${source}" ${source === fields.source ? "selected" : ""}>${source}</option>`).join("")}</select></label><label><span>Suggested Status</span><select data-ops-field="suggestedStatus">${["New / Inquiry Received", "Needs Quote", "Quote Sent", "Follow Up"].map((status) => `<option value="${status}" ${status === fields.suggestedStatus ? "selected" : ""}>${status}</option>`).join("")}</select></label></div><div class="ops-review-stack">${textFields.map(([key, label, rows]) => renderOpsTextarea(key, label, fields[key], rows)).join("")}</div><div class="ops-action-row"><button class="ops-gold-button" id="ops-save-inquiry" type="button">Save Inquiry</button><button class="ops-light-button" id="ops-clear-inquiry" type="button">Clear</button></div></div>`;
}

function renderOpsServiceTypeSelect(value) {
  return `<label><span>Service Type</span><select data-ops-field="serviceType"><option value="" ${value ? "" : "selected"}>Select service type</option>${opsServiceTypes.map((serviceType) => `<option value="${serviceType}" ${serviceType === value ? "selected" : ""}>${serviceType}</option>`).join("")}</select></label>`;
}
function renderOpsInput(key, label, value) {
  return `<label><span>${label}</span><input data-ops-field="${key}" value="${escapeHtml(value)}" /></label>`;
}

function renderOpsTextarea(key, label, value, rows) {
  return `<label><span>${label}</span><textarea data-ops-field="${key}" rows="${rows}">${escapeHtml(value)}</textarea></label>`;
}

function renderOpsPriorityRow(item) {
  const tone = item.tone === "overdue" ? { bg: "#FEECEC", text: "#B91C1C" } : opsStatus[item.tone] || { bg: "#FFFFFF", text: OPS_INK };
  const isLinked = Boolean(item.inquiryId);
  const isActive = isLinked && expandedOpsInquiryId === item.inquiryId;
  return `<button class="ops-priority-row ${item.tone === "overdue" ? "overdue" : ""} ${isActive ? "active" : ""} ${isLinked ? "" : "no-link"}" ${isLinked ? `data-ops-priority-id="${escapeHtml(item.inquiryId)}"` : ""} type="button"><span class="ops-row-number">${String(item.number).padStart(2, "0")}</span><span class="ops-priority-text">${escapeHtml(item.text)}</span><span class="ops-mini-badge" style="background:${tone.bg};color:${tone.text}">${escapeHtml(item.tag)}</span>${renderIcon("chevron-right", "ops-chevron-icon")}</button>`;
}

function renderOpsColumn(statusKey) {
  const status = opsStatus[statusKey];
  const items = opsInquiries.filter((item) => item.status === statusKey);
  return `<section class="ops-column"><header><span style="background:${status.dot}"></span><strong>${status.label}</strong><small>${items.length}</small></header><div class="ops-column-list">${items.length ? items.map((item) => renderOpsInquiryCard(item, statusKey)).join("") : `<div class="ops-empty-column">Walay sulod - clear!</div>`}</div></section>`;
}

function renderOpsInquiryCard(item, statusKey) {
  const status = opsStatus[statusKey];
  const overdue = isOpsOverdue(item);
  const isSelected = expandedOpsInquiryId === item.id;
  return `<article class="ops-ticket-card ops-accordion-card ${overdue ? "overdue" : ""} ${isSelected ? "is-expanded" : ""}"><button class="ops-ticket-summary ${isSelected ? "active" : ""}" data-ops-card-id="${escapeHtml(item.id)}" data-ops-toggle-details="${escapeHtml(item.id)}" type="button" aria-expanded="${isSelected ? "true" : "false"}" aria-label="${isSelected ? "Close" : "Open"} inquiry ${escapeHtml(item.id)} details"><span class="ops-summary-text"><strong>${escapeHtml(item.customer)}</strong><small>${escapeHtml(item.qty)} / ${status.label}</small></span><span class="ops-summary-indicator">${isSelected ? "x" : "+"}</span></button></article>`;
}

function renderOpsInquiryDrawer() {
  const item = opsInquiries.find((inquiry) => inquiry.id === expandedOpsInquiryId);
  if (!item) return "";

  const status = opsStatus[item.status] ?? opsStatus.new;
  const currentTask = getOpsInquiryCurrentTask(item);

  return `<div class="ops-drawer-backdrop" data-ops-close-details></div><aside class="ops-detail-drawer" aria-label="Inquiry details"><header><div><span>${escapeHtml(item.id)}</span><h2>${escapeHtml(item.customer)}</h2><mark>${escapeHtml(status.label)}</mark></div><button class="ops-drawer-close" data-ops-close-details type="button" aria-label="Close inquiry details">X</button></header><div class="ops-drawer-content"><section class="ops-next-task-card"><span>NEXT ACTION</span><strong>${escapeHtml(currentTask.text)}</strong></section>${renderOpsInquiryDetails(item)}${renderOpsStageOverview(item)}${renderOpsCurrentStageSections(item)}${renderOpsStaffActions(item, item.status)}</div></aside>`;
}

function getOpsNormalizedCustomerState(item) {
  return {
    artwork: item.artworkStatus || "missing",
    quote: item.quoteStatus || "pending",
    payment: item.paymentStatus || "not_required",
    status: String(item.status || "").trim().toLowerCase(),
    production: String(item.productionStage || "").trim().toLowerCase(),
  };
}

function isOpsQuotePublished(item) {
  return Boolean(item.quotePublishedAt) || ["ready", "approved", "changes_requested"].includes(String(item.quoteStatus || ""));
}

function hasOpsFinalProof(item) {
  return Boolean(item.artworkUrl && String(item.artworkUrl).includes("/proofs/"));
}

function canOpsPrepareProof(item) {
  const state = getOpsNormalizedCustomerState(item);
  return state.quote === "approved" && !["approval_required", "approved"].includes(state.artwork);
}

function canOpsRequestPayment(item) {
  const state = getOpsNormalizedCustomerState(item);
  return state.quote === "approved" && state.artwork === "approved" && state.payment !== "confirmed";
}

function getOpsInquiryCurrentTask(item) {
  const state = getOpsNormalizedCustomerState(item);
  if (["submitted", "under_review", "revision_requested"].includes(state.artwork)) return { stage: "artwork", text: state.artwork === "revision_requested" ? "Review requested artwork changes" : "Review uploaded artwork" };
  if (state.artwork === "missing") return { stage: "artwork", text: "Request customer artwork" };
  if (state.quote === "changes_requested" || item.quoteChangeRequest) return { stage: "quote", text: "Review requested quote changes" };
  if (!isOpsQuotePublished(item) || state.quote === "pending") return { stage: "quote", text: "Prepare and send quotation" };
  if (state.quote === "ready") return { stage: "quote", text: "Waiting for customer quote approval" };
  if (canOpsPrepareProof(item) && !hasOpsFinalProof(item)) return { stage: "artwork", text: "Upload approved design" };
  if (canOpsPrepareProof(item) && hasOpsFinalProof(item)) return { stage: "artwork", text: "Send approved design" };
  if (state.artwork === "approval_required") return { stage: "artwork", text: "Waiting for customer artwork approval" };
  if (canOpsRequestPayment(item) && ["proof_submitted", "under_review"].includes(state.payment)) return { stage: "payment", text: "Review payment receipt" };
  if (canOpsRequestPayment(item)) return { stage: "payment", text: "Request payment" };
  if (state.payment === "confirmed" && !item.odooSO) return { stage: "production", text: "Create Odoo Sales Order" };
  if (canEditOpsCustomerTracking(item)) return { stage: "fulfillment", text: "Update customer tracking" };
  return { stage: "inquiry", text: item.next || "Review inquiry" };
}

function getOpsInquiryStages(item) {
  const task = getOpsInquiryCurrentTask(item);
  const state = getOpsNormalizedCustomerState(item);
  const quoteComplete = ["ready", "approved"].includes(state.quote) || Boolean(item.quotePublishedAt);
  const artworkComplete = state.artwork === "approved";
  const paymentComplete = state.payment === "confirmed";
  const productionActive = ["printing", "embroidery", "screen_printing", "qc", "ready", "in_production", "qc_finishing", "ready_for_fulfillment", "completed"].includes(state.production) || state.status === "won";
  const fulfillmentActive = canEditOpsCustomerTracking(item) || ["ready_for_pickup", "out_for_delivery", "delivered", "completed"].includes(item.trackingSubstatus);
  const stageState = (key, complete, unlocked) => {
    if (complete) return "Complete";
    if (task.stage === key) return "Current";
    if (!unlocked) return "Locked";
    return "Waiting";
  };

  return [
    { number: 1, key: "inquiry", label: "Inquiry", state: stageState("inquiry", Boolean(item.customer), true) },
    { number: 2, key: "artwork", label: "Artwork", state: stageState("artwork", artworkComplete, true) },
    { number: 3, key: "quote", label: "Quote", state: stageState("quote", quoteComplete && state.quote === "approved", state.artwork !== "missing") },
    { number: 4, key: "payment", label: "Payment", state: stageState("payment", paymentComplete, state.quote === "approved" && artworkComplete) },
    { number: 5, key: "production", label: "Production", state: stageState("production", state.production === "completed", paymentComplete || productionActive) },
    { number: 6, key: "fulfillment", label: "Fulfillment", state: stageState("fulfillment", item.trackingSubstatus === "completed", fulfillmentActive) },
  ];
}

function renderOpsStageOverview(item) {
  return `<section class="ops-stage-overview" aria-label="Inquiry stage overview">${getOpsInquiryStages(item).map((stage) => `<div class="${stage.state.toLowerCase()}"><span>${stage.number}. ${escapeHtml(stage.label)}</span><strong>${stage.state}</strong></div>`).join("")}</section>`;
}

function renderOpsCurrentStageSections(item) {
  return `${renderOpsCustomerFeedback(item)}<div class="ops-stage-sections">${renderOpsArtworkStage(item)}${renderOpsQuoteStage(item)}${renderOpsPaymentStage(item)}${renderOpsProductionStage(item)}${renderOpsCustomerTracking(item)}</div>`;
}

function renderOpsMoreActions(actions) {
  const enabled = actions.filter(Boolean);
  if (!enabled.length) return "";
  return `<details class="ops-more-actions"><summary>MORE ACTIONS</summary><div>${enabled.join("")}</div></details>`;
}

function renderOpsActionButton({ label, action, id, tone = "", primary = false, disabled = false }) {
  const buttonClass = primary ? "ops-gold-button mini" : `ops-move-button ${tone}`.trim();
  const displayLabel = action === "revise_quote" ? "\u25b6 REVISE QUOTE" : label;
  return `<button class="${buttonClass}" data-ops-customer-action="${escapeHtml(action)}" data-ops-customer-id="${escapeHtml(id)}" type="button" ${disabled ? "disabled" : ""}>${escapeHtml(displayLabel)}</button>`;
}

function renderOpsAssetButton({ label, asset, id, disabled = false }) {
  return `<button class="ops-dark-button mini" data-ops-customer-asset="${escapeHtml(asset)}" data-ops-customer-id="${escapeHtml(id)}" type="button" ${disabled ? "disabled" : ""}>${escapeHtml(label)}</button>`;
}

function renderOpsStageShell({ key, title, status, current, locked = false, body }) {
  return `<section class="ops-stage-section ${current ? "current" : ""} ${locked ? "locked" : ""}" data-ops-stage="${escapeHtml(key)}"><div class="ops-stage-section-heading"><div><span>${escapeHtml(title)}</span>${status ? `<strong>${escapeHtml(status)}</strong>` : ""}</div>${current ? `<mark>CURRENT</mark>` : ""}</div>${body}</section>`;
}
const opsTrackingSubstatus = {
  ready_for_pickup: { label: "Ready for Pickup", methods: ["pickup"] },
  out_for_delivery: { label: "Out for Delivery", methods: ["delivery"] },
  delivered: { label: "Delivered", methods: ["delivery"] },
  completed: { label: "Completed", methods: ["pickup", "delivery"] },
};

function getOpsCustomerTrackingStep(item) {
  const status = String(item.status || "").trim().toLowerCase();
  if (["lost", "cancelled", "canceled"].includes(status)) return "Closed";
  if (["production", "in_production", "ready", "pickup", "delivery", "delivered", "completed", "won"].includes(status)) return "5 / Pickup or Delivery";
  if (["approved", "proof_approval", "proof_approved"].includes(status)) return "3 / Approved Design";
  if (["quote", "sent", "followup"].includes(status)) return "2 / Quote and Review";
  return "1 / Inquiry Received";
}

function canEditOpsCustomerTracking(item) {
  const method = String(item.fulfillmentMethod || "").trim().toLowerCase();
  const status = String(item.status || "").trim().toLowerCase();
  return ["pickup", "delivery"].includes(method) && ["production", "in_production", "ready", "pickup", "delivery", "delivered", "completed", "won"].includes(status);
}

function getOpsTrackingOptions(item) {
  const method = String(item.fulfillmentMethod || "").trim().toLowerCase();
  return Object.entries(opsTrackingSubstatus).filter(([, config]) => config.methods.includes(method));
}

function formatOpsTrackingDate(value) {
  if (!value) return "Not updated";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function renderOpsCustomerTracking(item) {
  const canEdit = canEditOpsCustomerTracking(item);
  const options = getOpsTrackingOptions(item);
  const currentLabel = opsTrackingSubstatus[item.trackingSubstatus]?.label || "Not set";
  const optionHtml = options.map(([value, config]) => `<option value="${value}" ${item.trackingSubstatus === value ? "selected" : ""}>${config.label}</option>`).join("");

  if (!canEdit) {
    return renderOpsStageShell({
      key: "tracking",
      title: "Fulfillment",
      status: "Locked",
      locked: true,
      current: getOpsInquiryCurrentTask(item).stage === "fulfillment",
      body: `<p class="ops-stage-muted">Available once this inquiry enters production.</p>`,
    });
  }

  const body = `<div class="ops-tracking-compact"><div class="ops-stage-mini-grid"><div><span>Sub-status</span><strong>${escapeHtml(currentLabel)}</strong></div><div><span>Last update</span><strong>${escapeHtml(formatOpsTrackingDate(item.trackingUpdatedAt))}</strong></div></div><div class="ops-tracking-controls"><label><span>Sub-status</span><select data-ops-tracking-substatus="${escapeHtml(item.id)}"><option value="">Select sub-status</option>${optionHtml}</select></label><label class="wide"><span>Customer note</span><textarea data-ops-tracking-note="${escapeHtml(item.id)}" rows="2" placeholder="Optional note shown to customer">${escapeHtml(item.trackingNote || "")}</textarea></label><button class="ops-gold-button mini" data-ops-save-tracking="${escapeHtml(item.id)}" type="button">Save Customer Tracking</button></div></div>`;

  return renderOpsStageShell({
    key: "tracking",
    title: "Fulfillment",
    status: currentLabel,
    current: getOpsInquiryCurrentTask(item).stage === "fulfillment",
    body,
  });
}
function getOpsFulfillmentLabel(item) {
  const method = String(item.fulfillmentMethod || "").trim().toLowerCase();
  if (method === "pickup") return "Pickup";
  if (method === "delivery") return "Delivery";
  return "-";
}

function renderOpsDeliveryDetail(item) {
  if (String(item.fulfillmentMethod || "").trim().toLowerCase() !== "delivery") return "";
  const address = [item.deliveryAddress, item.deliveryCity].filter(Boolean).join(" / ") || "-";
  const landmark = item.deliveryLandmark ? `<div class="wide"><span>Delivery landmark</span><strong>${escapeHtml(item.deliveryLandmark)}</strong></div>` : "";
  return `<div class="wide"><span>Delivery address</span><strong>${escapeHtml(address)}</strong></div>${landmark}`;
}
function getOpsCustomerSubmittedNotes(item) {
  const directNotes = String(item.notes || item.customerNotes || "").trim();
  if (directNotes) return directNotes;

  const message = String(item.message || "");
  const match = message.match(/^Notes:\s*([\s\S]*?)(?=\nCustomer-side submitted at:\s|$)/m);
  const extracted = match ? match[1].trim() : "";
  if (!extracted || extracted.toLowerCase() === "none") return "";
  return extracted;
}
function renderOpsInquiryDetails(item) {
  const customerNotes = getOpsCustomerSubmittedNotes(item) || "No notes provided.";
  const notesAreLong = customerNotes.length > 140 || /\n/.test(customerNotes);
  const rows = [
    ["Contact", item.contact],
    ["Product / Service", item.service],
    ["Quantity", item.qty],
    ["Needed date", renderOpsCardDate(item)],
    ["Fulfillment", getOpsFulfillmentLabel(item)],
    ["Assigned staff", item.assigned || "Not assigned"],
    ["Estimated value", formatOpsValue(item.estimatedValue)],
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "" && String(value).trim() !== "-");

  const summaryRows = rows.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${label === "Estimated value" ? value : escapeHtml(value)}</strong></div>`).join("");
  const notesPair = `<div class="ops-summary-odoo-notes-row ${notesAreLong ? "wide" : ""}"><div><span>Odoo SO:</span><strong>${escapeHtml(item.odooSO || "Not created")}</strong></div><div class="ops-summary-customer-notes"><span>CUSTOMER NOTES</span><strong>${escapeHtml(customerNotes)}</strong></div></div>`;
  return `<section class="ops-inquiry-summary"><div class="ops-summary-grid">${summaryRows}${notesPair}</div><details class="ops-submission-details"><summary>CUSTOMER SUBMISSION</summary><p>${escapeHtml(item.message || "No message saved.")}</p></details></section>`;
}
function renderOpsArtworkAction(item) {
  const request = opsArtworkRequests[item.id] ?? {};
  const isLoading = request.status === "loading";
  const message = request.message ? `<p class="ops-artwork-message ${request.status === "error" ? "error" : ""}">${escapeHtml(request.message)}</p>` : "";

  return `<div class="ops-artwork-action"><span>Artwork file</span><div><button class="ops-dark-button mini" data-ops-view-artwork="${escapeHtml(item.id)}" type="button" ${isLoading ? "disabled" : ""}>${renderIcon("external-link", "ops-button-icon")}${isLoading ? "OPENING ARTWORK..." : "VIEW ARTWORK"}</button></div>${message}</div>`;
}

async function openOpsArtwork(inquiryId) {
  if (!inquiryId) return;

  opsArtworkRequests = {
    ...opsArtworkRequests,
    [inquiryId]: { status: "loading", message: "" },
  };
  render();

  try {
    const response = await fetch(`/api/inquiries/${encodeURIComponent(inquiryId)}/artwork`, {
      headers: adminAuthSession?.access_token
        ? { Authorization: `Bearer ${adminAuthSession.access_token}` }
        : {},
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload?.ok || !payload?.signedUrl) {
      opsArtworkRequests = {
        ...opsArtworkRequests,
        [inquiryId]: { status: "error", message: getOpsArtworkErrorMessage(response.status, payload?.error) },
      };
      render();
      return;
    }

    window.open(payload.signedUrl, "_blank", "noopener,noreferrer");
    opsArtworkRequests = {
      ...opsArtworkRequests,
      [inquiryId]: { status: "opened", message: `OPENED ${payload.filename || "ARTWORK FILE"}` },
    };
    render();
  } catch (error) {
    console.error("Unable to open inquiry artwork.", error);
    opsArtworkRequests = {
      ...opsArtworkRequests,
      [inquiryId]: { status: "error", message: "ARTWORK LINK FAILED. TRY AGAIN." },
    };
    render();
  }
}

function getOpsArtworkErrorMessage(status, error) {
  if (status === 404 && error === "no artwork uploaded") return "NO ARTWORK FILE AVAILABLE";
  if (status === 400) return "INVALID INQUIRY REFERENCE";
  if (status === 401) return "ADMIN SESSION REQUIRED";
  if (status === 404) return "INQUIRY NOT FOUND";
  return "ARTWORK LINK FAILED. TRY AGAIN.";
}
const opsCustomerActionLabels = {
  quote: {
    pending: "Pending",
    ready: "Ready for Customer",
    approved: "Customer Approved",
    changes_requested: "Changes Requested",
  },
  artwork: {
    missing: "Artwork Needed",
    submitted: "Artwork Usable",
    under_review: "Under Review",
    approval_required: "Waiting for Customer Approval",
    approved: "Customer Approved",
    revision_requested: "Revision Requested",
  },
  payment: {
    not_required: "Not Yet Requested",
    required: "Payment Requested",
    proof_submitted: "Receipt Received",
    under_review: "Receipt Under Review",
    confirmed: "Payment Confirmed",
  },
};

function getOpsCustomerActionLabel(group, value) {
  return opsCustomerActionLabels[group]?.[value] || "Not set";
}

function renderOpsCustomerActions(item) {
  return `${renderOpsArtworkStage(item)}${renderOpsQuoteStage(item)}${renderOpsPaymentStage(item)}`;
}

function renderOpsCustomerFeedback(item) {
  const request = opsCustomerActionRequests[item.id] || {};
  if (!request.message) return "";
  return `<p class="ops-customer-action-message ${request.status === "error" ? "error" : ""}">${escapeHtml(request.message)}</p>`;
}

function renderOpsArtworkStage(item) {
  const request = opsCustomerActionRequests[item.id] || {};
  const isLoading = request.status === "loading";
  const status = item.artworkStatus || "missing";
  const current = getOpsInquiryCurrentTask(item).stage === "artwork";
  const revision = item.artworkRevisionRequest ? `<p class="ops-customer-action-alert"><strong>CUSTOMER REQUESTED ARTWORK REVISION</strong>${escapeHtml(item.artworkRevisionRequest)}</p>` : "";
  const openArtwork = renderOpsAssetButton({ label: "OPEN ARTWORK", asset: "customer-artwork", id: item.id, disabled: isLoading });
  const finalProofAvailable = hasOpsFinalProof(item);
  const finalProofButton = finalProofAvailable ? renderOpsAssetButton({ label: "VIEW APPROVED DESIGN", asset: "artwork-proof", id: item.id, disabled: isLoading }) : "";
  let body = revision;

  if (status === "missing") {
    body += `<p class="ops-stage-muted"><strong>Status: Artwork needed</strong>No customer artwork uploaded.</p>`;
  } else if (["submitted", "under_review", "revision_requested"].includes(status)) {
    body += `<div class="ops-stage-actions">${openArtwork}${renderOpsActionButton({ label: "APPROVE ARTWORK", action: "mark_artwork_usable", id: item.id, primary: true, disabled: isLoading })}</div>${renderOpsMoreActions([
      renderOpsActionButton({ label: "Mark under review", action: "mark_artwork_under_review", id: item.id, disabled: isLoading }),
      renderOpsActionButton({ label: "REQUEST REPLACEMENT", action: "request_new_artwork", id: item.id, tone: "danger", disabled: isLoading }),
    ])}`;
  } else if (status === "approval_required") {
    body += `<p class="ops-stage-muted"><strong>Waiting for customer approval</strong>The approved design is published for customer review.</p>${finalProofButton ? `<div class="ops-stage-actions">${finalProofButton}</div>` : ""}`;
  } else if (status === "approved") {
    body += `<p class="ops-stage-complete">Artwork approved${item.artworkApprovedAt ? ` / ${escapeHtml(formatOpsTrackingDate(item.artworkApprovedAt))}` : ""}</p>${finalProofButton ? `<div class="ops-stage-actions">${finalProofButton}</div>` : ""}`;
  }

  if (canOpsPrepareProof(item)) {
    const publishDisabled = isLoading || !finalProofAvailable;
    body += `<details class="ops-proof-upload" ${current ? "open" : ""}><summary>APPROVED DESIGN</summary><label><span>Approved design file (PNG, JPG, PDF / 10 MB)</span><input accept=".png,.jpg,.jpeg,.pdf" data-ops-final-proof-file="${escapeHtml(item.id)}" type="file" ${isLoading ? "disabled" : ""} /></label>${finalProofButton}<div class="ops-stage-actions"><button class="ops-gold-button mini" data-ops-customer-action="publish_artwork" data-ops-customer-id="${escapeHtml(item.id)}" type="button" ${publishDisabled ? "disabled" : ""}>SEND APPROVED DESIGN</button></div></details>`;
  }

  return renderOpsStageShell({ key: "artwork", title: "Artwork", status: getOpsCustomerActionLabel("artwork", status), current, body });
}

function renderOpsQuoteHiddenFields(item) {
  return `<input data-ops-customer-field="quotedAmount" type="hidden" value="${escapeHtml(item.quotedAmount ?? "")}" /><input data-ops-customer-field="amountDue" type="hidden" value="${escapeHtml(item.amountDue ?? "")}" /><input data-ops-customer-field="quoteBreakdown" type="hidden" value="${escapeHtml(item.quoteBreakdown || "")}" /><input data-ops-customer-field="quoteNotes" type="hidden" value="${escapeHtml(item.quoteNotes || "")}" /><input data-ops-customer-field="quoteValidUntil" type="hidden" value="${escapeHtml(item.quoteValidUntil || "")}" /><input data-ops-customer-field="paymentLabel" type="hidden" value="${escapeHtml(item.paymentLabel || "")}" /><input data-ops-customer-field="paymentInstructions" type="hidden" value="${escapeHtml(item.paymentInstructions || "")}" />`;
}

function renderOpsQuoteForm(item, isLoading, open = false) {
  const overflowActions = isOpsQuotePublished(item)
    ? [
      renderOpsActionButton({ label: "REVISE QUOTE", action: "revise_quote", id: item.id, disabled: isLoading }),
      renderOpsActionButton({ label: "mark quote pending", action: "mark_quote_pending", id: item.id, disabled: isLoading }),
    ]
    : [];

  return `<details class="ops-quote-editor" ${open ? "open" : ""}><summary>${isOpsQuotePublished(item) ? "REVISE QUOTE" : "CREATE QUOTE"}</summary><div class="ops-customer-action-form"><label><span>Quoted amount</span><input data-ops-customer-field="quotedAmount" inputmode="decimal" type="text" value="${escapeHtml(item.quotedAmount ?? "")}" /></label><label><span>Amount due</span><input data-ops-customer-field="amountDue" inputmode="decimal" type="text" value="${escapeHtml(item.amountDue ?? "")}" /></label><label class="wide"><span>Price breakdown</span><textarea data-ops-customer-field="quoteBreakdown" rows="3">${escapeHtml(item.quoteBreakdown || "")}</textarea></label><label class="wide"><span>Quote notes</span><textarea data-ops-customer-field="quoteNotes" rows="2">${escapeHtml(item.quoteNotes || "")}</textarea></label><label><span>Valid until</span><input data-ops-customer-field="quoteValidUntil" type="date" value="${escapeHtml(item.quoteValidUntil || "")}" /></label><label><span>Deposit / payment label</span><input data-ops-customer-field="paymentLabel" value="${escapeHtml(item.paymentLabel || "")}" /></label><label class="wide"><span>Payment instructions</span><textarea data-ops-customer-field="paymentInstructions" rows="2">${escapeHtml(item.paymentInstructions || "")}</textarea></label></div><div class="ops-stage-actions"><button class="ops-move-button" data-ops-customer-action="save_quote_draft" data-ops-customer-id="${escapeHtml(item.id)}" type="button" ${isLoading ? "disabled" : ""}>SAVE DRAFT</button><button class="ops-gold-button mini" data-ops-customer-action="publish_quote" data-ops-customer-id="${escapeHtml(item.id)}" type="button" ${isLoading ? "disabled" : ""}>SEND QUOTE</button></div>${renderOpsMoreActions(overflowActions)}</details>`;
}

function renderOpsQuoteStage(item) {
  const request = opsCustomerActionRequests[item.id] || {};
  const isLoading = request.status === "loading";
  const current = getOpsInquiryCurrentTask(item).stage === "quote";
  const status = item.quoteStatus || "pending";
  const quoteChange = item.quoteChangeRequest ? `<p class="ops-customer-action-alert"><strong>CUSTOMER REQUESTED QUOTE CHANGES</strong>${escapeHtml(item.quoteChangeRequest)}</p>` : "";
  let body = quoteChange;

  if (!isOpsQuotePublished(item) || current) {
    body += !isOpsQuotePublished(item) ? `<p class="ops-stage-muted">No quote created yet.</p>` : "";
    body += renderOpsQuoteForm(item, isLoading, current);
  } else {
    body += `<div class="ops-stage-mini-grid"><div><span>Amount</span><strong>${formatOpsValue(item.quotedAmount)}</strong></div><div><span>Amount due</span><strong>${formatOpsValue(item.amountDue)}</strong></div><div><span>Valid until</span><strong>${escapeHtml(item.quoteValidUntil || "Not set")}</strong></div><div><span>Published</span><strong>${escapeHtml(formatOpsTrackingDate(item.quotePublishedAt))}</strong></div></div>${renderOpsQuoteForm(item, isLoading, false)}`;
  }

  return renderOpsStageShell({ key: "quote", title: "Quotation", status: getOpsCustomerActionLabel("quote", status), current, body });
}

function renderOpsPaymentStage(item) {
  const request = opsCustomerActionRequests[item.id] || {};
  const isLoading = request.status === "loading";
  const isReceiptLoading = isLoading && request.asset === "payment-proof";
  const receiptOpened = request.status === "success" && request.asset === "payment-proof" && request.signedUrl;
  const receiptUnavailable = request.status === "error" && request.asset === "payment-proof";
  const current = getOpsInquiryCurrentTask(item).stage === "payment";
  const status = item.paymentStatus || "not_required";
  let body = renderOpsQuoteHiddenFields(item);
  const paymentTotal = Number(item.quotedAmount) > 0 ? Number(item.quotedAmount) : 0;
  const paymentPaid = Number(item.paymentConfirmedAmount) > 0 ? Number(item.paymentConfirmedAmount) : 0;
  const paymentBalance = Math.max(paymentTotal - paymentPaid, 0);
  body += `<div class="ops-stage-mini-grid"><div><span>Total amount</span><strong>${formatOpsValue(paymentTotal)}</strong></div><div><span>Amount paid</span><strong>${formatOpsValue(paymentPaid)}</strong></div><div><span>Balance</span><strong>${formatOpsValue(paymentBalance)}</strong></div></div>`;

  if (status === "confirmed") {
    body += `<p class="ops-stage-complete">PAYMENT CONFIRMED &#10003; / ${formatOpsValue(item.paymentConfirmedAmount)}${item.paymentConfirmedAt ? ` / ${escapeHtml(formatOpsTrackingDate(item.paymentConfirmedAt))}` : ""}</p>`;
  } else if (!canOpsRequestPayment(item)) {
    body += `<p class="ops-stage-muted">Available after quote and artwork approval.</p>`;
  } else if (status === "required") {
    body += `<div class="ops-stage-mini-grid"><div><span>Amount due</span><strong>${formatOpsValue(item.amountDue)}</strong></div><div><span>Current status</span><strong>PAYMENT REQUESTED</strong></div></div><p class="ops-stage-muted"><strong>${item.paymentRejectedAt ? "NEW RECEIPT NEEDED" : "PAYMENT REQUESTED"}</strong>Awaiting receipt.</p>`;
  } else if (["proof_submitted", "under_review"].includes(status)) {
    const receipt = item.paymentProofPath ? renderOpsAssetButton({ label: isReceiptLoading ? "LOADING..." : receiptUnavailable ? "TRY AGAIN" : "REVIEW RECEIPT", asset: "payment-proof", id: item.id, disabled: isReceiptLoading }) : `<span class="ops-customer-empty">No receipt uploaded.</span>`;
    const receiptPreview = receiptOpened ? `<figure class="ops-payment-receipt-preview"><img alt="Uploaded payment receipt for ${escapeHtml(item.id)}" src="${escapeHtml(request.signedUrl)}" /><figcaption>Receipt opened for ${escapeHtml(item.id)}</figcaption></figure>` : "";
    const receiptError = receiptUnavailable ? `<p class="ops-customer-action-message error">RECEIPT UNAVAILABLE</p>` : "";
    body += `<div class="ops-stage-mini-grid"><div><span>Inquiry reference</span><strong>${escapeHtml(item.id)}</strong></div><div><span>Amount due</span><strong>${formatOpsValue(item.amountDue)}</strong></div><div><span>Current status</span><strong>RECEIPT RECEIVED</strong></div><div><span>Uploaded</span><strong>${escapeHtml(formatOpsTrackingDate(item.paymentProofSubmittedAt))}</strong></div><div><span>Receipt file</span><strong>${escapeHtml(item.paymentProofPath || "-")}</strong></div></div><div class="ops-customer-action-form compact"><label><span>Confirmed amount</span><input data-ops-customer-field="confirmedAmount" min="0" step="0.01" type="number" value="${escapeHtml(item.paymentConfirmedAmount ?? item.amountDue ?? "")}" /></label><label class="wide"><span>Reason for new receipt</span><textarea data-ops-customer-field="paymentReviewNote" rows="2">${escapeHtml(item.paymentReviewNote || "")}</textarea></label></div>${receiptPreview}${receiptError}<div class="ops-stage-actions">${receipt}${renderOpsActionButton({ label: "CONFIRM PAYMENT", action: "confirm_payment", id: item.id, primary: true, disabled: isLoading || !item.paymentProofPath })}${renderOpsActionButton({ label: "REQUEST NEW RECEIPT", action: "request_new_payment_proof", id: item.id, tone: "danger", disabled: isLoading })}</div>`;
  } else {
    body += `<div class="ops-stage-mini-grid"><div><span>Amount due</span><strong>${formatOpsValue(item.amountDue)}</strong></div></div><div class="ops-customer-action-form compact"><input data-ops-customer-field="confirmedAmount" type="hidden" value="${escapeHtml(item.paymentConfirmedAmount ?? item.amountDue ?? "")}" /><label class="wide"><span>Payment instructions</span><textarea data-ops-customer-field="paymentInstructions" rows="2">${escapeHtml(item.paymentInstructions || "")}</textarea></label></div><div class="ops-stage-actions">${renderOpsActionButton({ label: "REQUEST PAYMENT", action: "require_payment", id: item.id, primary: true, disabled: isLoading || ["required", "proof_submitted", "under_review", "confirmed"].includes(status) })}</div>`;
  }

  if (item.paymentRejectedAt) body += `<p class="ops-customer-action-alert"><strong>NEW RECEIPT NEEDED</strong>${escapeHtml(item.paymentReviewNote || "Replacement receipt requested.")}<small>${escapeHtml(formatOpsTrackingDate(item.paymentRejectedAt))}</small></p>`;

  return renderOpsStageShell({ key: "payment", title: "Payment", status: getOpsCustomerActionLabel("payment", status), current, locked: !canOpsRequestPayment(item) && status !== "confirmed", body });
}
function renderOpsProductionStage(item) {
  const current = getOpsInquiryCurrentTask(item).stage === "production";
  if (item.status === "sent") {
    return renderOpsStageShell({
      key: "production",
      title: "Production / Odoo",
      status: item.odooSO ? "Odoo created" : "Sales order needed",
      current,
      body: renderOpsOdooAction(item),
    });
  }
  if (item.odooSO) {
    return renderOpsStageShell({
      key: "production",
      title: "Production / Odoo",
      status: "Odoo created",
      current,
      body: `<p class="ops-stage-complete">Sales Order ${escapeHtml(item.odooSO)} is recorded.</p>`,
    });
  }
  return renderOpsStageShell({
    key: "production",
    title: "Production / Odoo",
    status: "Locked",
    locked: true,
    current,
    body: `<p class="ops-stage-muted">Available after quote, artwork, and payment are ready.</p>`,
  });
}
function getOpsCustomerActionFormPayload(action, sourceElement) {
  const quoteEditor = sourceElement?.closest?.(".ops-quote-editor");
  const stageSection = sourceElement?.closest?.(".ops-stage-section");
  const drawer = sourceElement?.closest?.(".ops-detail-drawer");
  const fieldValue = (name) => {
    const selector = `[data-ops-customer-field="${name}"]`;
    return quoteEditor?.querySelector(selector)?.value
      ?? stageSection?.querySelector(selector)?.value
      ?? drawer?.querySelector(selector)?.value
      ?? document.querySelector(selector)?.value
      ?? "";
  };

  return {
    action,
    quotedAmount: fieldValue("quotedAmount"),
    amountDue: fieldValue("amountDue"),
    quoteBreakdown: fieldValue("quoteBreakdown"),
    quoteNotes: fieldValue("quoteNotes"),
    quoteValidUntil: fieldValue("quoteValidUntil"),
    paymentLabel: fieldValue("paymentLabel"),
    paymentInstructions: fieldValue("paymentInstructions"),
    confirmedAmount: fieldValue("confirmedAmount"),
    paymentReviewNote: fieldValue("paymentReviewNote"),
  };
}

function parseOpsQuoteMoney(value) {
  const text = String(value ?? "").trim().replace(/,/g, "");
  if (!text) return NaN;
  return Number(text);
}

function getOpsQuoteValidationMessage(action, body) {
  if (!["publish_quote", "save_quote_draft", "revise_quote", "mark_quote_pending", "require_payment", "request_new_payment_proof"].includes(action)) return "";

  const quotedAmountText = String(body.quotedAmount ?? "").trim();
  const amountDueText = String(body.amountDue ?? "").trim();
  const quotedAmount = parseOpsQuoteMoney(quotedAmountText);
  const amountDue = amountDueText ? parseOpsQuoteMoney(amountDueText) : quotedAmount;
  const validUntil = String(body.quoteValidUntil || "").trim();

  if (action === "publish_quote" && (!Number.isFinite(quotedAmount) || quotedAmount <= 0)) {
    return "ENTER A VALID QUOTED AMOUNT\nEnter an amount greater than 0 before sending the quote.";
  }

  if (action === "require_payment" && (!Number.isFinite(amountDue) || amountDue <= 0)) {
    return "ENTER A VALID AMOUNT DUE\nAmount due must be greater than 0 before requesting payment.";
  }

  if (quotedAmountText && (!Number.isFinite(quotedAmount) || quotedAmount < 0)) {
    return "ENTER A VALID QUOTED AMOUNT\nEnter an amount greater than 0 before sending the quote.";
  }

  if (amountDueText && (!Number.isFinite(amountDue) || amountDue < 0)) {
    return "ENTER A VALID AMOUNT DUE\nAmount due must be zero or greater.";
  }

  if (validUntil) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = new Date(`${validUntil}T00:00:00`);
    if (!Number.isFinite(expiry.getTime()) || expiry < today) {
      return "QUOTE VALIDITY DATE HAS EXPIRED\nChoose today or a future date before sending the quote.";
    }
  }

  if (action === "require_payment" && !String(body.paymentInstructions || "").trim()) {
    return "ENTER PAYMENT INSTRUCTIONS\nPayment instructions are required before requesting payment.";
  }

  if (action === "request_new_payment_proof" && String(body.paymentReviewNote || "").trim().length < 5) {
    return "ENTER A RECEIPT REQUEST REASON\nAdd a short reason before requesting a new receipt.";
  }

  return "";
}
function updateOpsCustomerActionInlineValidation(event) {
  const field = event.target;
  const stageSection = field?.closest?.(".ops-stage-section");
  if (!stageSection) return;

  const messageElement = stageSection.querySelector("[data-ops-customer-inline-message]");
  if (!messageElement?.classList.contains("error")) return;

  const requestButton = stageSection.querySelector('[data-ops-customer-action="require_payment"]');
  if (!requestButton) return;

  const body = getOpsCustomerActionFormPayload("require_payment", requestButton);
  if (!getOpsQuoteValidationMessage("require_payment", body)) {
    messageElement.remove();
  }
}

function setOpsCustomerActionInlineMessage(sourceElement, message, status = "error") {
  const stageSection = sourceElement?.closest?.(".ops-stage-section");
  if (!stageSection) return;

  let messageElement = stageSection.querySelector("[data-ops-customer-inline-message]");
  if (!messageElement) {
    messageElement = document.createElement("p");
    messageElement.dataset.opsCustomerInlineMessage = "true";
    stageSection.insertBefore(messageElement, stageSection.children[1] || null);
  }

  messageElement.className = `ops-customer-action-message ${status === "error" ? "error" : ""}`.trim();
  messageElement.textContent = message;
}

function getOpsActionLoadingLabel(action) {
  if (action === "require_payment") return "REQUESTING...";
  if (action === "confirm_payment") return "CONFIRMING...";
  if (action === "request_new_payment_proof") return "REQUESTING...";
  return "SAVING...";
}

function getOpsActionSavingMessage(action) {
  if (action === "require_payment") return "REQUESTING PAYMENT...";
  if (action === "confirm_payment") return "CONFIRMING PAYMENT...";
  if (action === "request_new_payment_proof") return "REQUESTING NEW RECEIPT...";
  return "SAVING CUSTOMER ACTION...";
}

function getOpsActionSuccessMessage(action) {
  if (action === "save_quote_draft") return "QUOTE DRAFT SAVED.";
  if (action === "require_payment") return "PAYMENT REQUESTED.";
  if (action === "confirm_payment") return "PAYMENT CONFIRMED.";
  if (action === "request_new_payment_proof") return "NEW RECEIPT NEEDED.";
  return "CUSTOMER ACTION SAVED.";
}

function setOpsActionButtonLoading(button, isLoading) {
  if (!button) return;
  if (isLoading) {
    button.dataset.opsOriginalText = button.textContent || "";
    button.disabled = true;
    button.textContent = getOpsActionLoadingLabel(button.dataset.opsCustomerAction);
  } else {
    button.disabled = false;
    if (button.dataset.opsOriginalText) button.textContent = button.dataset.opsOriginalText;
    delete button.dataset.opsOriginalText;
  }
}
async function requestOpsCustomerAction(inquiryId, body) {
  const response = await fetch(`/api/inquiries/${encodeURIComponent(inquiryId)}/customer-actions`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(adminAuthSession?.access_token ? { Authorization: `Bearer ${adminAuthSession.access_token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload?.ok) {
    throw new Error(getOpsCustomerActionError(response.status, payload?.error));
  }

  return payload;
}

async function saveOpsCustomerAction(inquiryId, action, sourceElement) {
  if (!inquiryId || !action || sourceElement?.disabled) return;

  const body = getOpsCustomerActionFormPayload(action, sourceElement);
  const validationMessage = getOpsQuoteValidationMessage(action, body);
  if (validationMessage) {
    setOpsCustomerActionInlineMessage(sourceElement, validationMessage, "error");
    return;
  }

  setOpsCustomerActionInlineMessage(sourceElement, getOpsActionSavingMessage(action), "loading");
  setOpsActionButtonLoading(sourceElement, true);

  try {
    await requestOpsCustomerAction(inquiryId, body);
    opsCustomerActionRequests = {
      ...opsCustomerActionRequests,
      [inquiryId]: { status: "success", message: getOpsActionSuccessMessage(action) },
    };
    hasLoadedOpsInquiries = false;
    await loadOpsBoardInquiries();
  } catch (error) {
    setOpsActionButtonLoading(sourceElement, false);
    setOpsCustomerActionInlineMessage(sourceElement, error.message || "CUSTOMER ACTION FAILED. CHECK YOUR CONNECTION AND TRY AGAIN.", "error");
  }
}
async function uploadOpsFinalArtworkProof(inquiryId, file) {
  if (!inquiryId || !file) return;

  opsCustomerActionRequests = {
    ...opsCustomerActionRequests,
    [inquiryId]: { status: "loading", message: "UPLOADING APPROVED DESIGN..." },
  };
  render();

  try {
    const prepared = await requestOpsCustomerAction(inquiryId, {
      action: "prepare_artwork_proof_upload",
      filename: file.name,
      fileSize: file.size,
      contentType: file.type,
    });

    const uploadForm = new FormData();
    uploadForm.append("cacheControl", "3600");
    uploadForm.append("", file);

    const supabaseConfig = getSupabaseConfig();
    const uploadResponse = await fetch(prepared.upload.signedUrl, {
      method: "PUT",
      headers: {
        "x-upsert": "false",
        ...(supabaseConfig.anonKey ? { apikey: supabaseConfig.anonKey } : {}),
        ...(adminAuthSession?.access_token ? { Authorization: `Bearer ${adminAuthSession.access_token}` } : {}),
      },
      body: uploadForm,
    });

    if (!uploadResponse.ok) throw new Error("APPROVED DESIGN UPLOAD FAILED.");

    await requestOpsCustomerAction(inquiryId, {
      action: "finalize_artwork_proof_upload",
      proofPath: prepared.upload.path,
    });

    opsCustomerActionRequests = {
      ...opsCustomerActionRequests,
      [inquiryId]: { status: "success", message: "APPROVED DESIGN UPLOADED. PUBLISH WHEN READY." },
    };
    hasLoadedOpsInquiries = false;
    await loadOpsBoardInquiries();
  } catch (error) {
    opsCustomerActionRequests = {
      ...opsCustomerActionRequests,
      [inquiryId]: { status: "error", message: error.message || "APPROVED DESIGN UPLOAD FAILED." },
    };
    render();
  }
}

async function openOpsCustomerAsset(inquiryId, asset) {
  if (!inquiryId || !asset) return;

  const isPaymentReceipt = asset === "payment-proof";
  const popup = isPaymentReceipt ? null : window.open("about:blank", "_blank");
  if (popup) popup.opener = null;
  opsCustomerActionRequests = {
    ...opsCustomerActionRequests,
    [inquiryId]: { status: "loading", message: isPaymentReceipt ? "LOADING..." : "OPENING PRIVATE FILE...", asset },
  };
  render();

  try {
    const response = await fetch(`/api/inquiries/${encodeURIComponent(inquiryId)}/customer-actions?asset=${encodeURIComponent(asset)}`, {
      headers: adminAuthSession?.access_token
        ? { Authorization: `Bearer ${adminAuthSession.access_token}` }
        : {},
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload?.ok || !payload?.signedUrl) {
      throw new Error(getOpsCustomerActionError(response.status, payload?.error));
    }

    if (isPaymentReceipt) {
      opsCustomerActionRequests = {
        ...opsCustomerActionRequests,
        [inquiryId]: {
          status: "success",
          message: "RECEIPT OPENED.",
          asset,
          signedUrl: payload.signedUrl,
        },
      };
      render();
      return;
    }

    if (popup) popup.location.href = payload.signedUrl;
    else window.open(payload.signedUrl, "_blank", "noopener,noreferrer");

    opsCustomerActionRequests = {
      ...opsCustomerActionRequests,
      [inquiryId]: {
        status: "success",
        message: "PRIVATE FILE OPENED.",
        asset,
        artworkUploadedAt: asset === "customer-artwork" ? payload.uploadedAt || "" : "",
      },
    };
    render();
  } catch (error) {
    popup?.close();
    opsCustomerActionRequests = {
      ...opsCustomerActionRequests,
      [inquiryId]: {
        status: "error",
        message: isPaymentReceipt ? "RECEIPT UNAVAILABLE" : error.message || "PRIVATE FILE COULD NOT BE OPENED.",
        asset,
      },
    };
    render();
  }
}
function getOpsCustomerActionError(status, error) {
  const normalized = String(error || "").trim().toLowerCase();
  if (status === 401) return "ADMIN SESSION REQUIRED.";
  if (status === 403) return "ADMIN WRITE ACCESS REQUIRED.";
  if (status === 404) return "INQUIRY OR FILE NOT FOUND.";
  if (status === 503) return "CUSTOMER ACTION DATABASE FIELDS ARE NOT READY.";
  if (status === 400 && normalized === "enter a valid quoted amount") return "ENTER A VALID QUOTED AMOUNT\nEnter an amount greater than 0 before sending the quote.";
  if (status === 400 && normalized === "enter a valid amount due") return "ENTER A VALID AMOUNT DUE\nAmount due must be zero or greater.";
  if (status === 400 && ["enter a valid quote validity date", "quote validity date has expired"].includes(normalized)) return "QUOTE VALIDITY DATE HAS EXPIRED\nChoose today or a future date before sending the quote.";
  if (status === 400 && normalized === "enter payment instructions") return "ENTER PAYMENT INSTRUCTIONS\nPayment instructions are required before requesting payment.";
  if (status === 400 && normalized === "receipt request reason required") return "ENTER A RECEIPT REQUEST REASON\nAdd a short reason before requesting a new receipt.";
  if (status === 400 && normalized === "artwork must be uploaded before sending quote") return "ARTWORK IS REQUIRED BEFORE SENDING THE QUOTE.";
  if (status === 400 && error) return String(error).toUpperCase();
  return "CUSTOMER ACTION FAILED. CHECK YOUR CONNECTION AND TRY AGAIN.";
}
function renderOpsStaffActions(item, statusKey) {
  const actions = getOpsStatusActions(statusKey);

  if (actions.length === 0) {
    const finalText = statusKey === "won" ? "Closed - Odoo SO created" : "Closed - lost inquiry";
    return `<div class="ops-card-final">${finalText}</div>`;
  }

  const [primary, secondary, ...more] = actions;
  const renderMove = (action) => `<button class="ops-move-button ${action.tone || ""}" data-ops-move-id="${item.id}" data-ops-move-to="${action.to}" type="button">${action.label}</button>`;
  return `<div class="ops-card-actions compact"><span>Pipeline actions</span><div>${renderMove(primary)}${secondary ? renderMove(secondary) : ""}</div>${renderOpsMoreActions(more.map(renderMove))}</div>`;
}
function getOpsStatusActions(statusKey) {
  const actions = {
    new: [
      { to: "quote", label: "Needs Quote", next: "Prepare quote and confirm requirements" },
      { to: "followup", label: "Follow Up", next: "Follow up for missing details" },
      { to: "lost", label: "Lost", next: "Pipeline closed - lost inquiry", tone: "danger" },
    ],
    quote: [
      { to: "sent", label: "Quote Sent", next: "Quote sent - wait for confirmation or add Odoo SO when confirmed" },
      { to: "followup", label: "Follow Up", next: "Follow up before sending quote" },
      { to: "lost", label: "Lost", next: "Pipeline closed - lost inquiry", tone: "danger" },
    ],
    sent: [
      { to: "followup", label: "Follow Up", next: "Follow up on sent quote" },
      { to: "lost", label: "Lost", next: "Pipeline closed - lost inquiry", tone: "danger" },
    ],
    followup: [
      { to: "won", label: "Won", next: "Customer confirmed - move to Odoo sales order" },
      { to: "lost", label: "Lost", next: "Pipeline closed - lost inquiry", tone: "danger" },
      { to: "quote", label: "Back to Needs Quote", next: "Prepare quote after follow-up" },
    ],
  };

  return actions[statusKey] ?? [];
}

async function saveOpsCustomerTracking(id) {
  const current = opsInquiries.find((item) => item.id === id);
  if (!current || !canEditOpsCustomerTracking(current)) return;

  const select = document.querySelector(`[data-ops-tracking-substatus="${CSS.escape(id)}"]`);
  const noteField = document.querySelector(`[data-ops-tracking-note="${CSS.escape(id)}"]`);
  const nextSubstatus = select?.value || "";
  const allowed = getOpsTrackingOptions(current).some(([value]) => value === nextSubstatus);
  if (nextSubstatus && !allowed) return;

  const updates = {
    trackingSubstatus: nextSubstatus || null,
    trackingNote: noteField?.value?.trim() || null,
    trackingUpdatedAt: new Date().toISOString(),
  };
  let savedInquiry = null;

  if (shouldLoadSupabaseOps) {
    try {
      savedInquiry = await updateOpsInquiryFields(
        id,
        updates,
        adminAuthSession
      );

      if (!savedInquiry) {
        throw new Error("Customer tracking update returned no saved inquiry.");
      }

      opsLoadState = opsLoadState === "empty" ? "success" : opsLoadState;
      opsLoadError = "";
    } catch (error) {
      console.error("Unable to update customer tracking.", error);
      return;
    }
  }

  opsInquiries = opsInquiries.map((item) =>
    item.id === id ? { ...item, ...(savedInquiry || updates) } : item
  );
}
async function moveOpsInquiry(id, targetStatus) {
  const current = opsInquiries.find((item) => item.id === id);
  const action = current ? getOpsStatusActions(current.status).find((item) => item.to === targetStatus) : null;
  if (!current || !opsStatus[targetStatus] || !action) return;

  const updates = {
    status: targetStatus,
    next: action.next,
    followUpDate: targetStatus === "followup" ? current.followUpDate || todayIsoDate() : null,
  };

  if (shouldLoadSupabaseOps) {
    try {
      await updateOpsInquiryStatus(id, updates, adminAuthSession);
      opsLoadState = opsLoadState === "empty" ? "success" : opsLoadState;
      opsLoadError = "";
    } catch (error) {
      console.error("Unable to update Ops Board inquiry status.", error);
      opsLoadState = "error";
      opsLoadError = error.message;
      return;
    }
  }

  opsInquiries = opsInquiries.map((item) =>
    item.id === id
      ? {
          ...item,
          ...updates,
        }
      : item
  );

  if (opsSoDraft?.id === id && targetStatus !== "sent") {
    opsSoDraft = null;
  }
}
function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}
function renderOpsOdooAction(item) {
  if (opsSoDraft?.id === item.id) {
    const value = opsSoDraft.value ?? "";
    return `<div class="ops-so-editor"><span>Customer confirmed? Enter the Odoo SO number</span><input class="ops-so-input" data-ops-so-input="${item.id}" value="${escapeHtml(value)}" placeholder="e.g. SO-2216" /><div><button class="ops-gold-button mini" data-ops-confirm-so="${item.id}" type="button" ${value.trim() ? "" : "disabled"}>Confirm Odoo SO & Create Order</button><button class="ops-light-button mini" data-ops-cancel-so type="button">Cancel</button></div></div>`;
  }
  return `<button class="ops-add-so-button" data-ops-add-so="${item.id}" type="button">Confirm Odoo SO &amp; Create Order</button>`;
}

function renderOpsProductionCard(item) {
  return `<article class="ops-production-card"><div><span>${escapeHtml(item.name)}</span><strong>${item.jobs}</strong></div><p>${escapeHtml(item.note)}</p></article>`;
}

function formatOpsDue(iso) {
  if (!iso) return "-";
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function renderOpsCardDate(item) {
  if (item.followUpDate) return `Follow-up ${formatOpsDue(item.followUpDate)}`;
  return `Due ${formatOpsDue(item.dueDate)}`;
}

function formatOpsValue(value) {
  if (value === null || value === undefined || value === "") return "-";
  const numberValue = Number(value);
  if (Number.isFinite(numberValue)) {
    return `PHP ${numberValue.toLocaleString("en-US")}`;
  }
  return escapeHtml(value);
}
function isOpsOverdue(item) {
  if (item.status === "won" || item.status === "lost") return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isPast = (iso) => Boolean(iso && new Date(`${iso}T00:00:00`) < today);
  return isPast(item.dueDate) || isPast(item.followUpDate);
}

function detectOpsServiceType(text) {
  if (/dtf\s*(per\s*)?meter|per\s*meter/i.test(text)) return "DTF Per Meter";
  if (/embro|burda/i.test(text)) return "Embroidery";
  if (/screen|silk/i.test(text)) return "Screen Printing";
  if (/print\s*only/i.test(text)) return "Print Only";
  if (/dtf/i.test(text)) return "DTF Printing";
  return "";
}
function demoExtractOpsInquiry(text) {
  const qtyMatch = text.match(/\d+\s*(pcs|pc|pieces|shirts|caps|uniforms)?/i);
  const quantity = qtyMatch ? qtyMatch[0].trim() : "";
  const serviceType = detectOpsServiceType(text);
  const missing = [];
  if (!quantity) missing.push("quantity");
  if (!serviceType) missing.push("service type");
  missing.push("sizes", "design file");
  return { ...emptyOpsExtract, serviceType, quantity, summary: text.trim().slice(0, 90) + (text.trim().length > 90 ? "..." : ""), missingDetails: missing.join(", "), suggestedStatus: missing.length > 2 ? "Follow Up" : "Needs Quote", nextAction: missing.length > 2 ? "Follow up for missing details" : "Prepare quote and confirm requirements", suggestedReply: "Salamat sa inquiry! Para ma-review namo ug tarong, pwede mangayo sa design file ug sizes? I-send ra diri." };
}

async function saveOpsInquiry() {
  if (!opsExtractFields) return;
  const inquiry = buildOpsInquiryFromExtract();

  if (shouldLoadSupabaseOps) {
    try {
      const savedInquiry = await createOpsBoardInquiry(inquiry, adminAuthSession);
      opsInquiries = [savedInquiry, ...opsInquiries];
      opsLoadState = "success";
      opsLoadError = "";
    } catch (error) {
      console.error("Unable to save Ops Board inquiry.", error);
      opsLoadState = "error";
      opsLoadError = error.message;
      return;
    }
  } else {
    opsInquiries = [inquiry, ...opsInquiries];
  }

  opsRawMessage = "";
  opsExtractFields = null;
  opsSavedNotice = true;
}

function createOpsInquiryId() {
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  return `TRY-${timestamp}`;
}
function buildOpsInquiryFromExtract() {
  const status = opsStatusNameToKey[opsExtractFields.suggestedStatus] || "new";

  return {
    id: createOpsInquiryId(),
    customer: opsExtractFields.businessName || opsExtractFields.customerName || "Unnamed inquiry",
    contact: opsExtractFields.customerName || "",
    source: opsSource[opsExtractFields.source] ? opsExtractFields.source : "FB",
    message: opsRawMessage,
    service: opsExtractFields.serviceType || "-",
    qty: opsExtractFields.quantity || "-",
    priority: "normal",
    dueDate: normalizeOpsDate(opsExtractFields.neededDate),
    followUpDate: null,
    next: opsExtractFields.nextAction || "Review inquiry",
    assigned: "Unassigned",
    status,
    odooSO: "",
  };
}
function normalizeOpsDate(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

async function confirmOpsSO(id) {
  const so = (opsSoDraft?.value || "").trim();
  const current = opsInquiries.find((item) => item.id === id);
  if (!so || !current || String(current.quoteStatus || "").toLowerCase() !== "approved" || !(Number(current.quotedAmount) > 0)) return;

  if (shouldLoadSupabaseOps) {
    try {
      const payload = await requestOpsWorkflowAction(id, { action: "confirm_order", odooSO: so });
      const savedInquiry = payload.inquiry;
      if (!savedInquiry) throw new Error("Order conversion returned no saved inquiry.");
      opsInquiries = opsInquiries.map((item) => item.id === id ? { ...item, ...savedInquiry } : item);
      opsLoadState = opsLoadState === "empty" ? "success" : opsLoadState;
      opsLoadError = "";
    } catch (error) {
      console.error("Unable to save Ops Board Odoo SO.", error);
      opsLoadState = "error";
      opsLoadError = error.message;
      return;
    }
  }

  if (!shouldLoadSupabaseOps) {
    opsInquiries = opsInquiries.map((item) => item.id === id ? { ...item, status: "won", odooSO: so, next: "Odoo Sales Order recorded" } : item);
  }
  opsSoDraft = null;
}

async function requestOpsWorkflowAction(inquiryId, body) {
  const response = await fetch(`/api/inquiries/${encodeURIComponent(inquiryId)}/workflow`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(adminAuthSession?.access_token ? { Authorization: `Bearer ${adminAuthSession.access_token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Workflow update failed.");
  return payload;
}
function getOrderProductionStage(item) {
  const stage = String(item.productionStage || "").trim().toLowerCase();
  if (orderProductionStages.some((option) => option.value === stage)) return stage;
  if (stage === "qc_finishing") return "qc";
  if (stage === "ready_for_fulfillment") return "ready";
  if (stage === "in_production") {
    const service = String(item.service || "").toLowerCase();
    if (service.includes("embro")) return "embroidery";
    if (service.includes("screen")) return "screen_printing";
    return "printing";
  }
  return "queued";
}

function getOrderProductionStageLabel(value) {
  if (!value || value === "queued") return "Queued / Not Yet Assigned";
  return orderProductionStages.find((stage) => stage.value === value)?.label || "Queued / Not Yet Assigned";
}

function getOrderAssignedStaff(item) {
  return item.assignedStaff || item.assigned || "Not Yet Assigned";
}

function isConfirmedOpsOrder(item) {
  return mvpDashboard.helpers.confirmed(item);
}

function isOrderDashboardCompleted(item) {
  return getOrderProductionStage(item) === "completed";
}

function getOrderDueState(item) {
  if (isOrderDashboardCompleted(item)) return "completed";
  if (!item.dueDate) return "none";
  const today = new Date(todayIsoDate() + "T00:00:00");
  const due = new Date(item.dueDate + "T00:00:00");
  if (Number.isNaN(due.getTime())) return "none";
  const diffDays = Math.round((due - today) / 86400000);
  if (diffDays < 0) return "overdue";
  if (diffDays === 0) return "today";
  if (diffDays <= 3) return "soon";
  return "future";
}

function getOrderDueLabel(item) {
  const state = getOrderDueState(item);
  const due = formatOpsDue(item.dueDate);
  if (state === "overdue") return `Overdue / ${due}`;
  if (state === "today") return `Due today / ${due}`;
  if (state === "soon") return `Due soon / ${due}`;
  if (state === "completed") return "Completed";
  return due === "-" ? "No needed date" : `Due ${due}`;
}

function getConfirmedOrderDashboardOrders() {
  return opsInquiries.filter(isConfirmedOpsOrder);
}

function getOrderDashboardStaffOptions() {
  return [...new Set(getConfirmedOrderDashboardOrders().map(getOrderAssignedStaff).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function getFilteredOrderDashboardOrders() {
  const search = orderDashboardFilters.search.trim().toLowerCase();
  return getConfirmedOrderDashboardOrders().filter((item) => {
    const stage = getOrderProductionStage(item);
    const completed = isOrderDashboardCompleted(item);
    const dueState = getOrderDueState(item);
    const fulfillment = String(item.fulfillmentMethod || "").trim().toLowerCase() || "unset";
    const staff = getOrderAssignedStaff(item);
    const searchText = [item.id, item.customer, item.contact, item.service, item.qty, item.odooSO, staff].join(" ").toLowerCase();

    if (search && !searchText.includes(search)) return false;
    if (orderDashboardFilters.stage === "active" && completed) return false;
    if (orderDashboardFilters.stage === "completed" && !completed) return false;
    if (orderDashboardFilters.stage !== "all" && !["active", "completed"].includes(orderDashboardFilters.stage) && stage !== orderDashboardFilters.stage) return false;
    if (orderDashboardFilters.staff !== "all" && staff !== orderDashboardFilters.staff) return false;
    if (orderDashboardFilters.fulfillment !== "all" && fulfillment !== orderDashboardFilters.fulfillment) return false;
    if (orderDashboardFilters.due !== "all" && dueState !== orderDashboardFilters.due) return false;
    return true;
  });
}

function getOrderDashboardCounts() {
  const confirmed = getConfirmedOrderDashboardOrders();
  return {
    active: confirmed.filter((item) => !isOrderDashboardCompleted(item)).length,
    dueSoon: confirmed.filter((item) => ["overdue", "today", "soon"].includes(getOrderDueState(item))).length,
    inProduction: confirmed.filter((item) => getOrderProductionStage(item) === "in_production").length,
    ready: confirmed.filter((item) => getOrderProductionStage(item) === "ready_for_fulfillment" || ["ready_for_pickup", "out_for_delivery", "delivered"].includes(item.trackingSubstatus)).length,
    completed: confirmed.filter(isOrderDashboardCompleted).length,
  };
}

function renderOrderDashboardPage() {
  const filtered = getFilteredOrderDashboardOrders();
  const selected = getConfirmedOrderDashboardOrders().find((item) => item.id === selectedOrderDashboardId);
  const counts = getOrderDashboardCounts();

  return `
    <main class="orders-page ops-board-page order-dashboard-page">
      <div class="ops-shell order-dashboard-shell">
        <header class="ops-hero order-dashboard-hero">
          <div>
            <p class="ops-date-line">ORDER DASHBOARD</p>
            <h1>Confirmed Orders</h1>
            <p class="subtitle">Internal production view for Won inquiries and Odoo sales orders only.</p>
          </div>
          <div class="ops-rule-card">
            <strong>Odoo stays source of truth</strong>
            <span>Accounting, payment, inventory, costing, and invoicing remain outside this dashboard.</span>
          </div>
        </header>
        ${renderOpsPersistenceNotice()}
        ${renderOrderDashboardSchemaNotice()}
        ${orderDashboardSaveError ? `<section class="ops-persistence-card error"><strong>Order Dashboard save failed</strong><span>${escapeHtml(orderDashboardSaveError)}</span></section>` : ""}
        <section class="ops-kpi-grid order-dashboard-summary" aria-label="Order dashboard summary">
          ${renderOpsSummaryCard({ value: counts.active, label: "Active Orders", hint: "confirmed, not completed" })}
          ${renderOpsSummaryCard({ value: counts.dueSoon, label: "Due Soon", hint: "overdue, today, or 3 days" })}
          ${renderOpsSummaryCard({ value: counts.inProduction, label: "In Production", hint: "internal production stage" })}
          ${renderOpsSummaryCard({ value: counts.ready, label: "Ready for Fulfillment", hint: "pickup or delivery queue", gold: true })}
          ${renderOpsSummaryCard({ value: counts.completed, label: "Completed", hint: "archived orders" })}
        </section>
        ${renderOrderDashboardFilters()}
        <section class="order-dashboard-layout">
          <div class="order-dashboard-main">
            ${renderOrderDashboardActiveOrders(filtered)}
            ${renderOrderFulfillmentQueue(filtered)}
            ${renderOrderCompletedArchive(filtered)}
          </div>
          ${renderOrderDashboardDrawer(selected)}
        </section>
      </div>
    </main>`;
}

function areOrderDashboardFieldsReady() {
  const confirmed = getConfirmedOrderDashboardOrders();
  return confirmed.length > 0 && confirmed.some((item) => item.productionFieldsReady);
}

function renderOrderDashboardSchemaNotice() {
  if (!shouldLoadSupabaseOps) return "";
  const confirmed = getConfirmedOrderDashboardOrders();
  if (!confirmed.length || areOrderDashboardFieldsReady()) return "";
  return `<section class="ops-persistence-card"><strong>Order Dashboard fields not ready</strong><span>Run the pending migration before saving assigned staff, production stage, or production notes. Confirmed orders still load read-only.</span></section>`;
}
function renderOrderDashboardFilters() {
  const staffOptions = getOrderDashboardStaffOptions();
  const stageOptions = [
    { value: "active", label: "Active" },
    { value: "all", label: "All Confirmed" },
    ...orderProductionStages,
    { value: "completed", label: "Completed Archive" },
  ];
  const fulfillmentOptions = [
    { value: "all", label: "All Fulfillment" },
    { value: "pickup", label: "Pickup" },
    { value: "delivery", label: "Delivery" },
    { value: "unset", label: "Unset" },
  ];
  const dueOptions = [
    { value: "all", label: "All Dates" },
    { value: "overdue", label: "Overdue" },
    { value: "today", label: "Due Today" },
    { value: "soon", label: "Due Soon" },
    { value: "future", label: "Future" },
    { value: "none", label: "No Date" },
  ];

  return `<section class="order-dashboard-filters" aria-label="Order dashboard filters">
    <label class="order-dashboard-search">${renderIcon("search", "search-icon")}<input id="order-dashboard-search" value="${escapeHtml(orderDashboardFilters.search)}" placeholder="Search order, customer, Odoo SO..." type="search" /></label>
    <select data-order-dashboard-filter="stage">${stageOptions.map((option) => `<option value="${option.value}" ${orderDashboardFilters.stage === option.value ? "selected" : ""}>${option.label}</option>`).join("")}</select>
    <select data-order-dashboard-filter="staff"><option value="all">All Staff</option>${staffOptions.map((staff) => `<option value="${escapeHtml(staff)}" ${orderDashboardFilters.staff === staff ? "selected" : ""}>${escapeHtml(staff)}</option>`).join("")}</select>
    <select data-order-dashboard-filter="fulfillment">${fulfillmentOptions.map((option) => `<option value="${option.value}" ${orderDashboardFilters.fulfillment === option.value ? "selected" : ""}>${option.label}</option>`).join("")}</select>
    <select data-order-dashboard-filter="due">${dueOptions.map((option) => `<option value="${option.value}" ${orderDashboardFilters.due === option.value ? "selected" : ""}>${option.label}</option>`).join("")}</select>
  </section>`;
}

function renderOrderDashboardActiveOrders(items) {
  const active = items.filter((item) => !isOrderDashboardCompleted(item));
  const header = `<div class="order-dashboard-row order-dashboard-row-head" role="row">
    <span role="columnheader">Code</span>
    <span role="columnheader">Customer</span>
    <span class="order-dashboard-col-phone" role="columnheader">Phone</span>
    <span class="order-dashboard-col-product" role="columnheader">Inquiry / Item</span>
    <span role="columnheader">Service</span>
    <span role="columnheader">Qty</span>
    <span role="columnheader">Artwork</span>
    <span role="columnheader">Needed Date</span>
    <span role="columnheader">Action</span>
  </div>`;
  return `<section class="order-dashboard-section order-dashboard-active-section"><div class="ops-section-heading split"><h2>Active Orders</h2><span>${active.length} shown</span></div><div class="order-dashboard-table-scroll"><div class="order-dashboard-table" role="table" aria-label="Active orders">${active.length ? `${header}<div class="order-dashboard-table-body" role="rowgroup">${active.map(renderOrderDashboardRow).join("")}</div>` : `<div class="ops-empty-column">No active confirmed orders match the filters.</div>`}</div></div></section>`;
}

function getOrderDashboardMessageValue(item, labels) {
  const message = String(item.message || "");
  for (const label of labels) {
    const match = message.match(new RegExp(`^${label}:\\s*(.+)$`, "im"));
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return "";
}

function getOrderDashboardProductLabel(item) {
  return getOrderDashboardMessageValue(item, ["Product", "Garment", "Item", "Inquiry \\/ Product"]) || String(item.service || "-").trim() || "-";
}

function getOrderDashboardServiceLabel(item) {
  return getOrderDashboardMessageValue(item, ["Print Method", "Service Type", "Type of Service", "Service"]) || String(item.service || "-").trim() || "-";
}

function getOrderDashboardArtworkLabel(item) {
  const status = String(item.artworkStatus || "").trim().toLowerCase();
  if (status === "approved") return "Approved";
  if (status === "approval_required") return "For Approval";
  if (["submitted", "under_review"].includes(status)) return "For Review";
  if (status === "revision_requested") return "Revision";
  if (["usable", "ready"].includes(status)) return "Ready";
  return "No Artwork";
}

function normalizeOrderDashboardPhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function renderOrderDashboardCopyButton({ value, copyValue, field, id, label }) {
  if (!copyValue) return `<span class="order-dashboard-missing">${escapeHtml(value)}</span>`;
  return `<button class="order-dashboard-copy" data-order-dashboard-copy="${escapeHtml(copyValue)}" data-order-dashboard-copy-key="${escapeHtml(`${id}-${field}`)}" type="button" aria-label="Copy ${escapeHtml(label)} ${escapeHtml(value)}" title="Copy ${escapeHtml(value)}"><span class="order-dashboard-copy-value">${escapeHtml(value)}</span>${renderIcon("copy", "order-dashboard-copy-icon")}<span class="order-dashboard-copy-feedback" aria-live="polite"></span></button>`;
}

function renderOrderDashboardRow(item) {
  const selected = selectedOrderDashboardId === item.id;
  const dueState = getOrderDueState(item);
  const phone = String(item.contact || "").trim();
  const normalizedPhone = normalizeOrderDashboardPhone(phone);
  const product = getOrderDashboardProductLabel(item);
  const service = getOrderDashboardServiceLabel(item);
  const artwork = getOrderDashboardArtworkLabel(item);
  const artworkTone = String(item.artworkStatus || "missing").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  const rowLabel = `${item.id}, ${item.customer || "Unnamed customer"}, ${service}, ${item.qty || "quantity not set"}, ${artwork}, ${getOrderDueLabel(item)}`;
  return `<div class="order-dashboard-row order-dashboard-order-row ${selected ? "selected" : ""} ${dueState}" data-order-dashboard-row="${escapeHtml(item.id)}" role="row" tabindex="0" aria-label="Open order ${escapeHtml(rowLabel)}">
    <span class="order-dashboard-cell order-dashboard-id" role="cell">${renderOrderDashboardCopyButton({ value: item.id, copyValue: item.id, field: "code", id: item.id, label: "inquiry code" })}</span>
    <strong class="order-dashboard-cell order-dashboard-customer" role="cell" title="${escapeHtml(item.customer || "Unnamed customer")}">${escapeHtml(item.customer || "Unnamed customer")}</strong>
    <span class="order-dashboard-cell order-dashboard-col-phone" role="cell">${renderOrderDashboardCopyButton({ value: phone || "No phone", copyValue: normalizedPhone, field: "phone", id: item.id, label: "phone number" })}</span>
    <span class="order-dashboard-cell order-dashboard-col-product" role="cell" title="${escapeHtml(product)}">${escapeHtml(product)}</span>
    <span class="order-dashboard-cell" role="cell" title="${escapeHtml(service)}">${escapeHtml(service)}</span>
    <span class="order-dashboard-cell" role="cell" title="${escapeHtml(item.qty || "-")}">${escapeHtml(item.qty || "-")}</span>
    <span class="order-dashboard-cell order-dashboard-artwork ${artworkTone}" role="cell" title="Artwork: ${escapeHtml(artwork)}"><span class="order-dashboard-artwork-badge">${escapeHtml(artwork)}</span></span>
    <span class="order-dashboard-cell order-dashboard-due ${dueState}" role="cell" title="${escapeHtml(getOrderDueLabel(item))}">${escapeHtml(getOrderDueLabel(item))}</span>
    <span class="order-dashboard-cell order-dashboard-action" role="cell"><button class="order-dashboard-show-more" data-order-dashboard-open="${escapeHtml(item.id)}" type="button" aria-label="Show more details for ${escapeHtml(item.id)}">Show More</button></span>
  </div>`;
}
function renderOrderFulfillmentQueue(items) {
  const pickup = items.filter((item) => item.fulfillmentMethod === "pickup" && item.trackingSubstatus === "ready_for_pickup" && !isOrderDashboardCompleted(item));
  const delivery = items.filter((item) => item.fulfillmentMethod === "delivery" && ["out_for_delivery", "delivered"].includes(item.trackingSubstatus) && !isOrderDashboardCompleted(item));
  return `<section class="order-dashboard-section"><div class="ops-section-heading split"><h2>Fulfillment Queue</h2><span>${pickup.length + delivery.length} ready</span></div><div class="order-fulfillment-grid"><div><h3>Pickup</h3>${pickup.length ? pickup.map(renderOrderDashboardMiniCard).join("") : `<p class="order-dashboard-empty-note">No ready pickup orders.</p>`}</div><div><h3>Delivery</h3>${delivery.length ? delivery.map(renderOrderDashboardMiniCard).join("") : `<p class="order-dashboard-empty-note">No delivery orders out right now.</p>`}</div></div></section>`;
}

function renderOrderCompletedArchive(items) {
  const completed = items.filter(isOrderDashboardCompleted);
  return `<section class="order-dashboard-section"><div class="ops-section-heading split"><h2>Completed Archive</h2><span>${completed.length} completed</span></div><div class="order-dashboard-list compact">${completed.length ? completed.map(renderOrderDashboardCard).join("") : `<div class="ops-empty-column">No completed orders match the filters.</div>`}</div></section>`;
}

function renderOrderDashboardCard(item) {
  const stage = getOrderProductionStage(item);
  const selected = selectedOrderDashboardId === item.id;
  const dueState = getOrderDueState(item);
  return `<button class="order-dashboard-card ${selected ? "selected" : ""} ${dueState}" data-order-dashboard-open="${escapeHtml(item.id)}" type="button">
    <span class="order-dashboard-id">${escapeHtml(item.id)}</span>
    <strong>${escapeHtml(item.customer || "Unnamed customer")}</strong>
    <small>${escapeHtml(item.service || "-")} / ${escapeHtml(item.qty || "-")}</small>
    <div class="order-dashboard-meta"><span>${escapeHtml(getOrderProductionStageLabel(stage))}</span><span>${escapeHtml(getOpsFulfillmentLabel(item))}</span><span>${escapeHtml(getOrderDueLabel(item))}</span></div>
    <div class="order-dashboard-meta"><span>Staff: ${escapeHtml(getOrderAssignedStaff(item))}</span><span>Odoo: ${escapeHtml(item.odooSO || "-")}</span></div>
  </button>`;
}

function renderOrderDashboardMiniCard(item) {
  return `<button class="order-dashboard-mini-card" data-order-dashboard-open="${escapeHtml(item.id)}" type="button"><strong>${escapeHtml(item.customer || item.id)}</strong><span>${escapeHtml(item.id)} / ${escapeHtml(opsTrackingSubstatus[item.trackingSubstatus]?.label || "Not set")}</span></button>`;
}

function renderOrderDashboardDrawer(item) {
  if (!item) {
    return `<aside class="order-dashboard-drawer empty"><h2>Order Details</h2><p>Select a confirmed order to review production and customer tracking.</p></aside>`;
  }

  const stage = getOrderProductionStage(item);
  const trackingLabel = opsTrackingSubstatus[item.trackingSubstatus]?.label || "Not set";
  return `<aside class="order-dashboard-drawer" aria-label="Order details drawer">
    <header><div><span>${escapeHtml(item.id)}</span><h2>${escapeHtml(item.customer || "Order")}</h2></div><button class="ops-drawer-close" data-order-dashboard-close type="button" aria-label="Close order details">X</button></header>
    <div class="ops-ticket-details">
      <div><span>Status</span><strong>${escapeHtml(opsStatus[item.status]?.label || item.status || "Won")}</strong></div>
      <div><span>Odoo SO</span><strong>${escapeHtml(item.odooSO || "-")}</strong></div>
      <div><span>Product</span><strong>${escapeHtml(item.service || "-")}</strong></div>
      <div><span>Quantity</span><strong>${escapeHtml(item.qty || "-")}</strong></div>
      <div><span>Needed Date</span><strong>${escapeHtml(getOrderDueLabel(item))}</strong></div>
      <div><span>Fulfillment</span><strong>${escapeHtml(getOpsFulfillmentLabel(item))}</strong></div>
      <div><span>Tracking</span><strong>${escapeHtml(trackingLabel)}</strong></div>
      <div><span>Production</span><strong>${escapeHtml(getOrderProductionStageLabel(stage))}</strong></div>
      <div class="wide"><span>Customer Message</span><p>${escapeHtml(item.message || "No message saved.")}</p></div>
    </div>
    ${renderOrderProductionEditor(item)}
    ${renderOpsCustomerTracking(item)}
  </aside>`;
}

function renderOrderProductionEditor(item) {
  const stage = getOrderProductionStage(item);
  const fieldsReady = !shouldLoadSupabaseOps || item.productionFieldsReady;
  const disabled = fieldsReady ? "" : "disabled";
  const notice = fieldsReady ? "" : `<p class="order-dashboard-schema-warning">DATABASE FIELDS NOT READY. Apply the pending migration before saving internal production fields.</p>`;
  return `<section class="order-production-editor ${fieldsReady ? "" : "schema-missing"}"><h3>Internal Production</h3>${notice}<div class="order-production-grid">
    <label><span>Assigned staff</span><input data-order-dashboard-assigned="${escapeHtml(item.id)}" value="${escapeHtml(["Unassigned", "Not Yet Assigned"].includes(getOrderAssignedStaff(item)) ? "" : getOrderAssignedStaff(item))}" placeholder="Unassigned" ${disabled} /></label>
    <label><span>Production stage</span><select data-order-dashboard-stage="${escapeHtml(item.id)}" ${disabled}>${orderProductionStages.map((option) => `<option value="${option.value}" ${stage === option.value ? "selected" : ""}>${option.label}</option>`).join("")}</select></label>
    <label class="wide"><span>Production note</span><textarea data-order-dashboard-note="${escapeHtml(item.id)}" rows="3" placeholder="Internal note only" ${disabled}>${escapeHtml(item.productionNote || "")}</textarea></label>
  </div><div class="order-production-footer"><span>Last production update: ${escapeHtml(formatOpsTrackingDate(item.productionUpdatedAt))}</span><button class="ops-gold-button mini" data-order-dashboard-save="${escapeHtml(item.id)}" type="button" ${disabled}>Save Production</button></div></section>`;
}

async function saveOrderDashboardProduction(id) {
  const current = opsInquiries.find((item) => item.id === id);
  if (!current || !isConfirmedOpsOrder(current)) return;
  if (shouldLoadSupabaseOps && !current.productionFieldsReady) {
    orderDashboardSaveError = "Order Dashboard fields are not ready. Apply the pending migration before saving production fields.";
    return;
  }

  const assignedInput = document.querySelector(`[data-order-dashboard-assigned="${CSS.escape(id)}"]`);
  const stageSelect = document.querySelector(`[data-order-dashboard-stage="${CSS.escape(id)}"]`);
  const noteInput = document.querySelector(`[data-order-dashboard-note="${CSS.escape(id)}"]`);
  const nextStage = stageSelect?.value || getOrderProductionStage(current);
  if (!orderProductionStages.some((stage) => stage.value === nextStage)) return;

  const updates = {
    assignedStaff: assignedInput?.value?.trim() || null,
    productionStage: nextStage,
    productionNote: noteInput?.value?.trim() || null,
    productionUpdatedAt: new Date().toISOString(),
  };
  let savedInquiry = null;

  if (shouldLoadSupabaseOps) {
    try {
      savedInquiry = await updateOpsInquiryFields(id, updates, adminAuthSession);
      if (!savedInquiry) throw new Error("Order Dashboard update returned no saved inquiry.");
      orderDashboardSaveError = "";
    } catch (error) {
      console.error("Unable to update Order Dashboard production fields.", error);
      orderDashboardSaveError = error.message || "Unable to save production fields.";
      return;
    }
  }

  opsInquiries = opsInquiries.map((item) => (item.id === id ? { ...item, ...(savedInquiry || updates) } : item));
}
function renderOrdersPage(selectedOrder, filteredOrders) {
  return `
    <main class="orders-page">
      <div class="page-heading">
        <div>
          <h1>Client Reorder Requests</h1>
          <p class="subtitle">Manage submitted reorder requests from approved client portals.</p>
          <p class="page-helper-note">These are client portal requests. Review details before approving for production.</p>
        </div>
      </div>

      <section class="status-grid" aria-label="Client reorder request status summary">
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
  const matchesKpi =
    clientKpiFilter === "All" ||
    (clientKpiFilter === "Active" && clientProgram.status === "Active") ||
    (clientKpiFilter === "Pending Setup" && clientProgram.status === "Pending Setup") ||
    (clientKpiFilter === "High Activity" && clientProgram.activeOrders > 3);
  const clientMatches =
    matchesKpi &&
    (!normalizedQuery ||
      [clientProgram.name, clientSlug, clientProgram.domain]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery));

  const cards = [
    { label: "Total Clients", value: "1", icon: "clients", delta: "Urban Coffee active", clientFilter: "All", active: clientKpiFilter === "All" },
    { label: "Active Portals", value: "1", icon: "ready", delta: "Private portal live", clientFilter: "Active", active: clientKpiFilter === "Active" },
    { label: "Pending Setup", value: "0", icon: "calendar", delta: "No blocked setup", clientFilter: "Pending Setup", active: clientKpiFilter === "Pending Setup" },
    { label: "High Activity", value: "0", icon: "factory", delta: "No high activity yet", clientFilter: "High Activity", active: clientKpiFilter === "High Activity" },
  ];

  return `
    <main class="orders-page clients-page admin-saas-page">
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
          ${renderIcon("search", "search-icon")}
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
                <th>Company</th>
                <th>Phone</th>
                <th>Type</th>
                <th>Inquiries</th>
                <th>Orders</th>
                <th>Last Activity</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${
                clientMatches
                  ? `<tr class="${selectedClientId === clientProgram.id ? "selected" : ""}" data-client-id="${clientProgram.id}" role="button" tabindex="0" aria-label="Open ${escapeHtml(clientProgram.name)} client details">
                      <td>
                        <div class="client-cell">
                          <span class="client-logo urban-coffee">${clientProgram.initials}</span>
                          <div><strong>${clientProgram.name}</strong><span>${clientProgram.domain}</span></div>
                        </div>
                      </td>
                      <td>${clientProgram.domain}</td>
                      <td>${clientProgram.contactNumber}</td>
                      <td>${clientProgram.accountType}</td>
                      <td>-</td>
                      <td>${clientProgram.approvedProducts}</td>
                      <td>${clientProgram.lastOrderDate}</td>
                      <td><span class="status-pill active">${clientProgram.status}</span></td>
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
        ${selectedClientId === clientProgram.id && clientMatches ? renderClientPanel() : renderEmptyDetailPanel("Select a client", "Profile details will appear here.")}
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
      (productFilter === "Approved" && item.status === "Approved") ||
      (productFilter === "Pending Approval" && item.status === "Pending Approval") ||
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
    { label: "Approved Products", value: products.length, icon: "check", delta: "Visible in client portal", productFilter: "Approved", active: productFilter === "Approved" },
    { label: "Draft Products", value: "0", icon: "queue", delta: "No drafts yet", productFilter: "Drafts", active: productFilter === "Drafts" },
    { label: "Pending Approval", value: "0", icon: "calendar", delta: "No blocked specs", productFilter: "Pending Approval", active: productFilter === "Pending Approval" },
    { label: "Top Category", value: "Uniforms", icon: "ready", delta: "Primary program", productFilter: "Uniforms", active: productFilter === "Uniforms" },
  ];

  return `
    <main class="orders-page products-admin-page admin-saas-page">
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
              ${renderIcon("search", "search-icon")}
              <input id="product-search" value="${escapeHtml(productQuery)}" placeholder="Search products" type="search" />
            </label>
          </div>
          <p class="table-helper-text">Select a product to view details.</p>
          <table class="products-table">
            <thead>
              <tr>
                <th>Product / Service</th>
                <th>Type</th>
                <th>Category</th>
                <th>Base Price</th>
                <th>Minimum Qty</th>
                <th>Available Methods</th>
                <th>Availability</th>
                <th>Updated</th>
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
        ${isProductDrawerOpen && visibleProducts.some((item) => item.code === selectedProduct.code) ? renderProductPanel(selectedProduct) : ""}
      </section>
    </main>
  `;
}

function renderCatalogPage() {
  const visibleProducts = getVisibleCatalogProducts();
  const selectedProduct = catalogProducts.find((item) => item.id === selectedCatalogProductId);
  const canWrite = canWriteCatalogProducts();

  return `
    <main class="orders-page catalog-page admin-saas-page">
      <div class="page-heading catalog-heading">
        <div>
          <h1>Catalog</h1>
          <p class="subtitle">Manage how approved products appear across customer-facing catalogs.</p>
        </div>
        <button class="catalog-add-button" data-catalog-add-product type="button" ${canWrite ? "" : "disabled title=\"Viewer role can read only.\""}>+ Add Catalog Item</button>
      </div>

      <section class="catalog-controls" aria-label="Catalog controls">
        <div class="catalog-tabs" aria-label="Catalog tabs">
          ${catalogOptions.map((catalog) => `
            <button class="${catalog.key === activeCatalogKey ? "active" : ""}" data-catalog-tab="${catalog.key}" type="button">
              ${catalog.label}
            </button>`).join("")}
        </div>
        <label class="search-field catalog-search">
          ${renderIcon("search", "search-icon")}
          <input id="product-search" value="${escapeHtml(productQuery)}" placeholder="Search products" type="search" />
        </label>
        <select class="catalog-status-filter" id="catalog-status-filter" aria-label="Status filter">
          ${getCatalogFilterOptions().map((option) => `<option value="${option.value}" ${option.value === catalogStatusFilter ? "selected" : ""}>${option.label}</option>`).join("")}
        </select>
      </section>

      ${renderCatalogNotice()}

      <article class="content-card table-card catalog-table-card">
        <p class="table-helper-text catalog-count-label">${visibleProducts.length} ${visibleProducts.length === 1 ? "PRODUCT" : "PRODUCTS"}</p>
        <table class="products-table catalog-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Category</th>
              <th>Starting Price</th>
              <th>Minimum Qty</th>
              <th>Destination</th>
              <th>Featured</th>
              <th>Publish Status</th>
              <th>Updated</th>
              </tr>
            </thead>
          <tbody>
            ${visibleProducts.map(renderCatalogProductRow).join("")}
          </tbody>
        </table>
        ${renderCatalogEmptyState(visibleProducts)}
      </article>
      ${catalogDrawerMode ? renderCatalogDrawer(selectedProduct) : ""}
    </main>
  `;
}

function getVisibleCatalogProducts() {
  const normalizedQuery = productQuery.trim().toLowerCase();

  return catalogProducts.filter((item) => {
    const matchesCatalog = item.catalogKey === activeCatalogKey;
    const matchesStatus =
      catalogStatusFilter === "active"
        ? item.status !== "archived"
        : catalogStatusFilter === "all"
          ? true
          : item.status === catalogStatusFilter;
    const matchesQuery =
      !normalizedQuery ||
      [item.name, item.slug, item.category, item.description, item.priceLabel]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);

    return matchesCatalog && matchesStatus && matchesQuery;
  });
}

function renderCatalogNotice() {
  if (catalogSaveState === "success") {
    return `<div class="catalog-notice success">Product saved successfully.</div>`;
  }

  if (catalogLoadState === "loading") {
    return `<div class="catalog-notice">Loading catalog products...</div>`;
  }

  if (catalogLoadState === "error") {
    return `<div class="catalog-notice error">Unable to load catalog products. ${escapeHtml(catalogLoadError || "Check Supabase access and RLS policies.")}</div>`;
  }

  if (!canWriteCatalogProducts()) {
    return `<div class="catalog-notice">Viewer access: catalog products are read-only.</div>`;
  }

  return "";
}

function renderCatalogEmptyState(visibleProducts) {
  if (visibleProducts.length > 0) return "";

  if (catalogLoadState === "loading") {
    return `<div class="empty-state compact-empty"><strong>Loading catalog...</strong><span>Checking Supabase catalog products.</span></div>`;
  }

  const catalogLabel = getCatalogLabel(activeCatalogKey);
  if (!catalogProducts.some((item) => item.catalogKey === activeCatalogKey)) {
    return `<div class="empty-state compact-empty"><strong>Empty catalog</strong><span>${catalogLabel} has no products yet. Add the first product when ready.</span></div>`;
  }

  return `<div class="empty-state compact-empty"><strong>No search results</strong><span>Try another search term or status filter.</span></div>`;
}

function renderCatalogProductRow(item) {
  return `
    <tr class="${item.id === selectedCatalogProductId ? "selected" : ""}" data-catalog-edit-product="${item.id}" role="button" tabindex="0" aria-label="Open ${escapeHtml(item.name)} catalog editor">
      <td class="catalog-name-cell"><div class="client-cell"><span class="catalog-product-image ${item.imageUrl ? "has-image" : ""}" ${item.imageUrl ? `style="background-image: url('${escapeHtml(item.imageUrl)}')"` : ""}></span><div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.slug)}</span></div></div></td>
      <td class="catalog-category-cell">${escapeHtml(item.category || "-")}</td>
      <td class="catalog-price-cell">${escapeHtml(formatCatalogPrice(item))}</td>
      <td class="catalog-moq-cell">${escapeHtml(item.minimumQuantity)}</td>
      <td class="catalog-destination-cell">${escapeHtml(getCatalogLabel(item.catalogKey))}</td>
      <td class="catalog-featured-cell">${item.isFeatured ? `<span class="status-pill visible"><span class="desktop-featured-label">Yes</span><span class="mobile-featured-label">Featured</span></span>` : `<span class="status-pill draft"><span class="desktop-featured-label">No</span><span class="mobile-featured-label">Not featured</span></span>`}</td>
      <td class="catalog-status-cell">${renderStatusPill(item.status)}</td>
      <td class="catalog-updated-cell">${escapeHtml(formatCatalogUpdated(item.updatedAt))}</td>
    </tr>
  `;
}

function renderCatalogDrawer(selectedProduct) {
  const draft = catalogDraft ?? createCatalogDraft(selectedProduct);
  const isSaving = catalogSaveState === "saving" || catalogSaveState === "uploading";
  const canWrite = canWriteCatalogProducts();
  const title = catalogDrawerMode === "edit" ? (draft.name || "Edit Catalog Item") : "Add Catalog Item";

  return `
    <div class="catalog-drawer-backdrop" data-catalog-close-drawer></div>
    <aside class="catalog-drawer" aria-label="${title}">
      <header>
        <div><span>${escapeHtml(getCatalogLabel(draft.catalogKey))}</span><h2>${escapeHtml(title)}</h2>${renderStatusPill(draft.status || "draft")}</div>
        <button class="catalog-drawer-close" data-catalog-close-drawer type="button" aria-label="Close catalog drawer">X</button>
      </header>
      <form class="catalog-form" id="catalog-product-form">
        ${catalogValidationError ? `<p class="catalog-form-error">${escapeHtml(catalogValidationError)}</p>` : ""}
        ${catalogSaveError ? `<p class="catalog-form-error">${escapeHtml(catalogSaveError)}</p>` : ""}
        ${renderCatalogField("catalog", "Catalog", renderCatalogSelect(draft))}
        ${renderCatalogInput("name", "Product name", draft.name, "text", true)}
        ${renderCatalogInput("slug", "Slug", draft.slug, "text", true)}
        ${renderCatalogInput("category", "Category", draft.category)}
        ${renderCatalogImageField(draft, canWrite, isSaving)}
        ${renderCatalogTextarea("description", "Description", draft.description)}
        <div class="catalog-form-grid">
          ${renderCatalogInput("startingPrice", "Starting price", draft.startingPrice, "number")}
          ${renderCatalogInput("priceLabel", "Price label", draft.priceLabel)}
        </div>
        <div class="catalog-form-grid">
          ${renderCatalogInput("minimumQuantity", "Minimum quantity", draft.minimumQuantity, "number", true)}
          ${renderCatalogInput("sortOrder", "Sort order", draft.sortOrder, "number")}
        </div>
        ${renderCatalogInput("availableSizesText", "Available sizes", draft.availableSizesText)}
        ${renderCatalogInput("availableColorsText", "Available colors", draft.availableColorsText)}
        ${renderCatalogInput("printMethodsText", "Print methods", draft.printMethodsText)}
        <div class="catalog-form-grid">
          ${renderCatalogField("featured", "Featured", `<label class="catalog-toggle"><input data-catalog-field="isFeatured" type="checkbox" ${draft.isFeatured ? "checked" : ""} /><span>Featured product</span></label>`)}
          ${renderCatalogField("status", "Status", renderCatalogStatusSelect(draft))}
        </div>
        <div class="catalog-drawer-actions">
          <button class="primary-button catalog-save-button" type="submit" ${canWrite && !isSaving ? "" : "disabled"}>${catalogSaveState === "uploading" ? "Uploading..." : isSaving ? "Saving..." : "Save Product"}</button>
          <button class="note-button" data-catalog-close-drawer type="button">Cancel</button>
        </div>
      </form>
    </aside>
  `;
}

function renderCatalogImageField(draft, canWrite, isSaving) {
  const displayUrl = draft.imageFilePreviewUrl || (!draft.removeImage ? draft.imageUrl : "");
  const hasImage = Boolean(displayUrl);
  const filename = draft.removeImage ? "" : draft.imageFile?.name || getCatalogImageFilename(draft.imageUrl);
  const imageState = getCatalogImageState(draft);
  const actionLabel = hasImage ? "REPLACE IMAGE" : "UPLOAD IMAGE";
  const disabled = !canWrite || isSaving;
  const preview = hasImage
    ? `<img src="${escapeHtml(displayUrl)}" alt="${escapeHtml(draft.name || "Catalog product image")}" />`
    : `<span>NO IMAGE</span>`;
  const pickerControl = canWrite
    ? `<label class="catalog-image-picker ${disabled ? "disabled" : ""}">
        <span class="catalog-image-preview ${hasImage ? "has-image" : "empty"}">${preview}</span>
        <span class="catalog-image-pick-text">${actionLabel}</span>
        <input data-catalog-image-file type="file" accept="image/jpeg,image/png,image/webp,image/avif" ${disabled ? "disabled" : ""} />
      </label>`
    : `<div class="catalog-image-picker disabled"><span class="catalog-image-preview ${hasImage ? "has-image" : "empty"}">${preview}</span><span class="catalog-image-pick-text">PREVIEW ONLY</span></div>`;

  return `
    <section class="catalog-image-field" aria-label="Product image">
      <div class="catalog-image-heading">
        <span>PRODUCT IMAGE</span>
        <strong class="${imageState === "UPLOAD FAILED" ? "error" : ""}">${imageState}</strong>
      </div>
      ${pickerControl}
      <div class="catalog-image-meta">
        <span>${filename ? escapeHtml(filename) : "No file selected"}</span>
        ${canWrite ? `<button data-catalog-remove-image type="button" ${disabled || (!hasImage && !draft.imageFile && !draft.imageUrl) ? "disabled" : ""}>REMOVE IMAGE</button>` : ""}
      </div>
      <p>SQUARE IMAGE REQUIRED ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· 1200 ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â 1200 RECOMMENDED ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· MINIMUM 800 ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â 800 ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· MAXIMUM 5 MB</p>
      ${draft.imageError ? `<p class="catalog-image-error">${escapeHtml(draft.imageError)}</p>` : ""}
    </section>
  `;
}

function getCatalogImageState(draft) {
  if (catalogSaveState === "uploading") return "UPLOADING";
  if (draft.imageError) return "UPLOAD FAILED";
  if (draft.imageFile) return "FILE SELECTED";
  if (draft.removeImage || !draft.imageUrl) return "NO IMAGE";
  return "IMAGE SAVED";
}

function formatCatalogUpdated(value) {
  if (!value) return "Not set";
  return formatDate(value) || "Recently";
}

function getCatalogImageFilename(url) {
  try {
    const pathname = new URL(url).pathname;
    return decodeURIComponent(pathname.split("/").filter(Boolean).pop() || "");
  } catch {
    return "";
  }
}
function renderCatalogSelect(draft) {
  return `<select data-catalog-field="catalogKey">${catalogOptions.map((catalog) => `<option value="${catalog.key}" ${catalog.key === draft.catalogKey ? "selected" : ""}>${catalog.label}</option>`).join("")}</select>`;
}

function renderCatalogStatusSelect(draft) {
  return `<select data-catalog-field="status">${catalogStatusOptions.map((status) => `<option value="${status}" ${status === draft.status ? "selected" : ""}>${status}</option>`).join("")}</select>`;
}

function renderCatalogField(id, label, control) {
  return `<label class="catalog-field" for="catalog-${id}"><span>${label}</span>${control}</label>`;
}

function renderCatalogInput(field, label, value, type = "text", required = false) {
  return renderCatalogField(field, label, `<input id="catalog-${field}" data-catalog-field="${field}" value="${escapeHtml(value ?? "")}" type="${type}" ${required ? "required" : ""} />`);
}

function renderCatalogTextarea(field, label, value) {
  return renderCatalogField(field, label, `<textarea id="catalog-${field}" data-catalog-field="${field}" rows="3">${escapeHtml(value ?? "")}</textarea>`);
}

function getCatalogFilterOptions() {
  return [
    { value: "active", label: "All active" },
    { value: "published", label: "Published" },
    { value: "draft", label: "Draft" },
    { value: "hidden", label: "Hidden" },
    { value: "archived", label: "Archived" },
    { value: "all", label: "All statuses" },
  ];
}

function getCatalogLabel(key) {
  return catalogOptions.find((catalog) => catalog.key === key)?.label ?? "TRRY WEBAPP";
}

function formatCatalogPrice(item) {
  if (item.priceLabel) return item.priceLabel;
  if (item.startingPrice !== "" && item.startingPrice !== null && item.startingPrice !== undefined) {
    return `PHP ${Number(item.startingPrice).toLocaleString("en-US")}`;
  }
  return "-";
}

function canWriteCatalogProducts() {
  return ["admin", "staff"].includes(adminUser?.role);
}

function createCatalogDraft(product = null) {
  if (product) {
    return {
      ...product,
      imageDraftId: product.id,
      imageFile: null,
      imageFilePreviewUrl: "",
      imageError: "",
      removeImage: false,
      availableSizesText: product.availableSizes.join(", "),
      availableColorsText: product.availableColors.join(", "),
      printMethodsText: product.printMethods.join(", "),
    };
  }

  return {
    imageDraftId: createDraftImageId(),
    catalogKey: activeCatalogKey,
    name: "",
    slug: "",
    category: "",
    description: "",
    imageUrl: "",
    imageFile: null,
    imageFilePreviewUrl: "",
    imageError: "",
    removeImage: false,
    startingPrice: "",
    priceLabel: "",
    minimumQuantity: 1,
    availableSizes: [],
    availableColors: [],
    printMethods: [],
    availableSizesText: "",
    availableColorsText: "",
    printMethodsText: "",
    sortOrder: 0,
    isFeatured: false,
    status: "draft",
  };
}
function createDraftImageId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function renderSettingsPage() {
  const sections = [
    {
      key: "general",
      title: "General",
      helper: "Core Admin Portal identity and workspace display details.",
      rows: [["Profile", "TRRY Admin"], ["Role", "Mother Admin"], ["Workspace", "Production admin"]],
    },
    {
      key: "portal",
      title: "Portal",
      helper: "Current portal domains and supported operating mode.",
      rows: [["Admin domain", "admin.trryapparel.com"], ["Client portal", clientProgram.domain], ["Mode", "MVP Prototype"]],
    },
    {
      key: "notifications",
      title: "Notifications",
      helper: "Existing notification preferences shown as read-only states.",
      rows: [["Order alerts", "On"], ["Production updates", "On"], ["Client portal activity", "On"]],
    },
    {
      key: "workflow",
      title: "Operations",
      helper: "Current status workflow labels used by the Admin Portal.",
      rows: [["Start", "Pending Review"], ["Production", "Approved to In Production"], ["Fulfillment", "Ready to Completed"]],
    },
    {
      key: "access",
      title: "Team and Access",
      helper: "Current access context only. Advanced employee login remains outside this task.",
      rows: [["Access", "Operations control center"], ["Company", "TRRY Apparel Management"], ["Primary color", "TRRY lime / professional SaaS theme"]],
    },
    {
      key: "danger",
      title: "Danger Zone",
      helper: "Destructive actions are unavailable in this Admin Portal view.",
      danger: true,
      rows: [["Delete portal data", "Disabled"], ["Reset workspace", "Disabled"], ["Live destructive actions", "Unavailable"]],
    },
  ];

  return `
    <main class="orders-page settings-page admin-saas-page">
      <div class="page-heading settings-heading">
        <div>
          <h1>Settings</h1>
          <p class="subtitle">Manage Admin Portal preferences and operational configuration.</p>
        </div>
      </div>

      <section class="settings-layout" aria-label="Admin settings">
        <nav class="settings-subnav" aria-label="Settings sections">
          ${sections.map((section) => `<a href="#settings-${section.key}" class="${section.danger ? "danger" : ""}">${section.title}</a>`).join("")}
        </nav>
        <div class="settings-panel-stack">
          ${sections
            .map(
              (section) => `
                <article id="settings-${section.key}" class="settings-card ${section.danger ? "danger-card" : ""}">
                  <header>
                    <h2>${section.title}</h2>
                    <p>${section.helper}</p>
                  </header>
                  <div class="settings-row-list">
                    ${section.rows
                      .map(
                        ([label, value]) => `
                          <div class="settings-row">
                            <span>${label}</span>
                            <strong>${value}</strong>
                          </div>`
                      )
                      .join("")}
                  </div>
                </article>`
            )
            .join("")}
        </div>
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
              <tr data-recent-order-id="${order.id}">
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
          ${renderIcon("search", "search-icon")}
          <input id="order-search" value="${escapeHtml(query)}" placeholder="Search request no., client, or requested by..." type="search" />
        </label>
        <button class="filter-button" aria-label="Advanced filters" type="button">${renderIcon("filter", "filter-icon")}</button>
      </div>
    </div>
  `;
}

function renderOrdersTable(filteredOrders) {
  const rows = filteredOrders.map(renderOrderRow).join("");
  const emptyState = getOrdersEmptyState(filteredOrders);

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
          <th>Review</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${
      emptyState
        ? `<div class="empty-state"><strong>${emptyState.title}</strong><span>${emptyState.description}</span></div>`
        : ""
    }
    <div class="table-footer">
      <span>Showing ${filteredOrders.length} of ${orders.length} reorder requests</span>
      <div class="pager">
        <button type="button" aria-label="Previous page"></button>
        <button class="active" type="button">1</button>
        <button type="button" aria-label="Next page"></button>
      </div>
    </div>
  `;
}

function getOrdersEmptyState(filteredOrders) {
  if (filteredOrders.length > 0) return null;

  if (orderLoadState === "loading") {
    return {
      title: "Loading reorder requests...",
      description: "Checking Supabase for incoming client portal orders.",
    };
  }

  if (orderLoadState === "error") {
    return {
      title: "Unable to load client portal requests.",
      description: "Check Supabase network access, RLS policies, and client portal request tables.",
    };
  }

  if (orders.length === 0) {
    return {
      title: "No reorder requests yet.",
      description: "New client reorder requests will appear here.",
    };
  }

  return {
    title: "No reorder requests found",
    description: "Try changing the filter or search term.",
  };
}

function renderOrderRow(order) {
  return `
    <tr class="${order.id === selectedId ? "selected" : ""}" data-order-id="${order.id}">
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
      <td>${order.qtyLabel ?? order.qty}</td>
      <td><span class="fulfillment ${statusToClass(order.fulfillment)}">${renderIcon(isPickupFulfillment(order.fulfillment) ? "map-pin" : "truck", "fulfillment-icon")}${order.fulfillment}</span></td>
      <td>
        <div class="stacked-cell needed">
          <strong>${order.neededDate}</strong>
          <span>${order.daysUntilNeeded}</span>
        </div>
      </td>
      <td>${renderStatusPill(order.status)}</td>
      <td>
        <button class="view-button" data-order-id="${order.id}" aria-label="Review ${order.id}" type="button">
          <span class="review-action-label">Review</span>
        </button>
      </td>
    </tr>
  `;
}

function renderProductRow(item) {
  const mainImage = getMainProductImage(item.code);

  return `
    <tr class="${item.code === selectedProductCode ? "selected" : ""}" data-product-code="${item.code}" role="button" tabindex="0" aria-label="Open ${escapeHtml(item.product)} product details">
      <td>
        <div class="client-cell">
          <span class="product-thumb has-image ${statusToClass(item.category)}" style="background-image: url('${escapeHtml(mainImage.image_url)}')"></span>
          <div><strong>${item.product}</strong><span>${item.code}</span></div>
        </div>
      </td>
      <td>Physical item</td>
      <td>${item.category}</td>
      <td>Not set</td>
      <td>Not set</td>
      <td>${item.logoPlacement}</td>
      <td>${renderStatusPill(item.visible === "Yes" ? "Active" : "Hidden")}</td>
      <td>${item.updated}</td>
    </tr>
  `;
}

function renderOrderDetailPanel(order) {
  const fulfillmentDestination = getFulfillmentDestination(order);

  return `
    <aside class="detail-panel" aria-label="Selected reorder request details">
      <div class="panel-header">
        <h2>Selected Reorder Request Details</h2><span class="panel-kicker">Portal reorder ${order.id}</span>
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
          ${renderIcon("user", "person-icon")}
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
            .map((item) => `<div><span>${item.name}${item.sizeSummary ? ` - ${item.sizeSummary}` : ""}</span><strong>${item.qty}</strong></div>`)
            .join("")}
        </div>
        <div class="total-line"><span>Total Quantity</span><strong>${order.qtyLabel ?? order.qty}</strong></div>
      </section>

      <section class="panel-section">
        <div class="ship-block">
          ${renderIcon(isPickupFulfillment(order.fulfillment) ? "map-pin" : "truck", "pin-icon")}
          <div>
            <p class="section-title">${fulfillmentDestination.label}</p>
            <strong>${fulfillmentDestination.value}</strong>
            <span>${fulfillmentDestination.helper}</span>
          </div>
        </div>
      </section>

      <section class="status-editor">
        <label for="status-select">Status Update</label>
        <select id="status-select">
          ${statusOptions
            .map(
              (status) =>
                `<option value="${status}" ${status === draftStatus ? "selected" : ""}>${status}</option>`
            )
            .join("")}
        </select>
        <button class="primary-button" id="update-status" type="button">Update Status</button>
        <button class="note-button" type="button">${renderIcon("file-text", "note-icon")}Add Internal Note</button>
      </section>
    </aside>
  `;
}

function getFulfillmentDestination(order) {
  if (isPickupFulfillment(order.fulfillment)) {
    return {
      label: "Pickup Location",
      value: "TRRY Apparel",
      helper: "Customer will pick up at TRRY.",
    };
  }

  return {
    label: "Ship To",
    value: order.shipTo || `${order.client} - Delivery`,
    helper: order.shipAddress || "Delivery address to be confirmed",
  };
}

function isPickupFulfillment(value) {
  return String(value || "").toLowerCase().includes("pickup");
}

function renderEmptyDetailPanel(title = "Select a reorder request", message = "Details will appear here.") {
  return `
    <aside class="detail-panel empty-panel">
      <div class="empty-state">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(message)}</span>
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
          ${clientProgram.domain}${renderIcon("external-link", "external-link-icon")}
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
  const productImage = getActiveProductImage(product.code);

  return `
    <div class="product-drawer-backdrop" data-product-drawer-close></div><aside class="detail-panel product-detail-panel professional-product-drawer">
      <div class="panel-header product-drawer-header">
        <div><code>${escapeHtml(product.code)}</code><h2>${escapeHtml(product.product)}</h2><span>${escapeHtml(product.category)} / Physical item</span></div>
        <div class="product-drawer-header-actions">${renderStatusPill(product.visible === "Yes" ? "Active" : "Hidden")}<button data-product-drawer-close type="button" aria-label="Close product details">X</button></div>
      </div>
      <section class="product-image-panel">
        <div class="product-image-viewer" style="background-image: url('${escapeHtml(productImage.image_url)}')">
          <span>${productImage.angle_label}</span>
        </div>
        <div class="image-angle-strip" aria-label="Product image angles">
          ${getProductImages(product.code)
            .map(
              (image) => `
                <button class="${image.angle_label === productImage.angle_label ? "active" : ""}" data-image-angle="${image.angle_label}" type="button">
                  ${image.angle_label}${image.is_main ? " - Main" : ""}
                </button>`
            )
            .join("")}
        </div>
      </section>
      ${renderProductImageManager(product)}
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
      <section class="quick-panel-actions product-actions product-drawer-footer">
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

function renderProductImageManager(product) {
  const images = getProductImages(product.code);
  const imageRows = [
    ...images,
    ...imageAngleLabels
      .filter((angleLabel) => !images.some((image) => image.angle_label === angleLabel))
      .map((angleLabel) => ({
        angle_label: angleLabel,
        image_url: "",
        is_main: false,
      })),
  ];

  return `
    <section class="panel-section image-manager-section product-images-section">
      <div class="section-heading-row">
        <p class="section-title">Product Images</p>
        <span>Front required</span>
      </div>
      <div class="image-manager-grid professional-image-grid">
        ${imageRows
          .map((image, index) => {
            const angleLabel = image.angle_label;
            const savedIndex = images.findIndex((item) => item.angle_label === angleLabel);
            const hasImage = Boolean(image.image_url);
            const isFront = angleLabel === "Front";

            return `
              <article class="image-slot ${image.is_main ? "main" : ""}">
                <div class="image-slot-preview ${hasImage ? "" : "empty"}" ${hasImage ? `style="background-image: url('${escapeHtml(image.image_url)}')"` : ""}>
                  <span>${angleLabel}</span>
                </div>
                <div class="image-slot-meta">
                  <strong>${angleLabel}</strong>
                  <small>${isFront ? "Required" : "Optional"}${image.is_main ? " - Main" : ""}</small>
                </div>
                <div class="image-slot-actions professional-image-actions">
                  <label class="image-action-button">
                    ${hasImage ? "Replace" : "Add"}
                    <input data-image-upload-code="${product.code}" data-image-upload-angle="${angleLabel}" type="file" accept="image/*" />
                  </label>
                  <button ${hasImage ? "" : "disabled"} data-set-main-image="${product.code}" data-set-main-angle="${angleLabel}" type="button">
                    Main
                  </button>
                  <button ${!hasImage || isFront ? "disabled" : ""} data-remove-image="${product.code}" data-remove-angle="${angleLabel}" title="${isFront ? "Front image is required." : "Remove image"}" type="button">
                    Remove
                  </button>
                  <button ${!hasImage || savedIndex <= 0 ? "disabled" : ""} data-reorder-image="${product.code}" data-reorder-angle="${angleLabel}" data-reorder-direction="up" type="button">
                    Up
                  </button>
                  <button ${!hasImage || savedIndex < 0 || savedIndex === images.length - 1 ? "disabled" : ""} data-reorder-image="${product.code}" data-reorder-angle="${angleLabel}" data-reorder-direction="down" type="button">
                    Down
                  </button>
                </div>
              </article>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderSidebar(currentRoute) {
  const navItems = [
    { label: "Overview", path: "/overview" },
    { label: "Inquiries", path: "/inquiries", icon: "clipboard-list" },
    { label: "Orders", path: "/orders", icon: "package" },
    { label: "Clients", path: "/clients" },
    { label: "Products", path: "/products" },
    { label: "Production", path: "/production", icon: "factory" },
    { label: "Catalog", path: "/catalog" },
    { label: "Settings", path: "/settings" },
  ];

  return `
    <aside class="sidebar ${isSidebarCollapsed ? "is-collapsed" : ""}">
      <button class="sidebar-close-button" type="button" aria-label="Close navigation">X</button>
      <div class="brand-lockup"><strong>TRRY</strong><span>ADMIN PORTAL</span></div>
      <nav>
        ${navItems.map((item) => `<a class="${item.label === currentRoute ? "active" : ""}" href="${item.path}" data-route-link title="${item.label}" aria-label="${item.label}">${renderIcon(item.icon || getNavIcon(item.label), "nav-icon")}<span class="nav-label">${item.label}</span></a>`).join("")}
        <span class="sidebar-phase-item" aria-disabled="true">${renderIcon("calendar-check", "nav-icon")}<span class="nav-label">Calendar<small>Phase 2</small></span></span><span class="sidebar-phase-item" aria-disabled="true">${renderIcon("clipboard-list", "nav-icon")}<span class="nav-label">Reports</span></span>
      </nav>
      <div class="system-card">${renderIcon("shield-check", "shield-icon")}<div><strong>System Status</strong><p><span></span> All systems operational</p></div></div>
    </aside>`;
}

function getAdminInitials() {
  const email = adminUser?.email || "TRRY Admin";
  const [name] = email.split("@");
  return name
    .split(/[._\-\s]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "TA";
}

function formatAdminRole(role) {
  if (!role) return "Admin";
  return role.charAt(0).toUpperCase() + role.slice(1);
}
function renderTopHeader() {
  return `
    <header class="top-header">
      <div class="header-brand">
        <button aria-label="Toggle navigation" aria-pressed="${isSidebarCollapsed ? "true" : "false"}" class="menu-button" type="button">
          ${renderIcon("menu", "menu-icon")}
        </button>
        <strong><span>TRRY</span> Apparel Management</strong>
      </div>
      <div class="global-search-wrap">
        <label class="global-search">
          <input id="global-search" value="${escapeHtml(globalSearchQuery)}" placeholder="Search orders, clients, products..." type="search" />
          ${renderIcon("search", "search-icon")}
        </label>
        ${renderGlobalSearchHint()}
      </div>
      <div class="header-actions">
        <button class="notification-button" aria-label="Notifications" type="button">
          ${renderIcon("bell", "notification-icon")}
        </button>
        <div class="profile-area">
          <div class="avatar">${getAdminInitials()}</div>
          <div>
            <strong>${escapeHtml(adminUser?.email ?? "TRRY Admin")}</strong>
            <span>${escapeHtml(formatAdminRole(adminUser?.role))}</span>
          </div>
          <button class="logout-button" type="button" data-admin-logout>Logout</button>
        </div>
      </div>
    </header>
  `;
}

function renderMobileTopBar() {
  return `
    <header class="mobile-top-bar">
      <button aria-label="Open navigation" class="mobile-menu-button" type="button">
        ${renderIcon("menu", "mobile-menu-icon")}
      </button>
      <strong>TRRY APPAREL</strong>
      <div class="mobile-top-actions">
        <button aria-label="Search" class="mobile-search-button" type="button">${renderIcon("search", "mobile-search-icon")}</button>
        <span class="mobile-avatar" aria-label="TRRY Admin">TA</span>
      </div>
    </header>
  `;
}

function renderMobileBottomNav(currentRoute) {
  const navItems = [
    { label: "Overview", path: "/overview" },
    { label: "Inquiries", path: "/inquiries", icon: "clipboard-list" },
    { label: "Orders", path: "/orders", icon: "package" },
    { label: "Production", path: "/production", icon: "factory" },
  ];
  return `<nav class="mobile-bottom-nav" aria-label="Mobile navigation">${navItems.map((item) => `<a class="${item.label === currentRoute ? "active" : ""}" href="${item.path}" data-route-link>${renderIcon(item.icon || getNavIcon(item.label), "nav-icon")}<small>${item.label}</small></a>`).join("")}</nav>`;
}

function renderGlobalSearchHint() {
  const normalized = globalSearchQuery.trim().toLowerCase();
  if (!normalized) return "";

  if ("urban coffee".includes(normalized)) {
    return `<button class="search-suggestion" data-route-target="/clients" type="button">Open Clients</button>`;
  }

  if (
    "admin polo uniform".includes(normalized) ||
    "embroidered staff cap".includes(normalized) ||
    normalized.includes("cap")
  ) {
    return `<button class="search-suggestion" data-route-target="/products" type="button">Open Products</button>`;
  }

  if ("orders".includes(normalized) || "reorder".includes(normalized) || normalized.includes("trry-uc")) {
    return `<button class="search-suggestion" data-route-target="/orders" type="button">Open Orders</button>`;
  }

  return "";
}

function renderStatusCard(item) {
  const interactiveAttrs = [
    item.route ? `data-route-target="${item.route}"` : "",
    item.orderFilter ? `data-order-filter="${item.orderFilter}"` : "",
    item.clientFilter ? `data-client-filter="${item.clientFilter}"` : "",
    item.productFilter ? `data-product-kpi-filter="${item.productFilter}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const classes = ["status-card", interactiveAttrs ? "clickable-card" : "", item.active ? "active" : ""]
    .filter(Boolean)
    .join(" ");

  return `
    <article class="${classes}" ${interactiveAttrs}>
      ${renderIcon(getCardIcon(item.icon), `icon-mark ${item.icon}`)}
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

function focusFieldAtEnd(id) {
  const field = document.getElementById(id);
  if (!field) return;
  field.focus();
  const length = field.value?.length ?? 0;
  if (typeof field.setSelectionRange === "function") {
    field.setSelectionRange(length, length);
  }
}
function openCatalogDrawer(mode, productId = null) {
  if (!canWriteCatalogProducts()) return;
  const product = catalogProducts.find((item) => item.id === productId) ?? null;
  clearCatalogImagePreview();
  catalogDrawerMode = mode;
  selectedCatalogProductId = product?.id ?? selectedCatalogProductId;
  catalogDraft = createCatalogDraft(product);
  catalogValidationError = "";
  catalogSaveError = "";
  catalogSaveState = "idle";
  render();
}

function closeCatalogDrawer() {
  clearCatalogImagePreview();
  catalogDrawerMode = "";
  catalogDraft = null;
  catalogValidationError = "";
  catalogSaveError = "";
  catalogSaveState = "idle";
  render();
}

function clearCatalogImagePreview() {
  if (catalogDraft?.imageFilePreviewUrl) {
    URL.revokeObjectURL(catalogDraft.imageFilePreviewUrl);
  }
}

async function updateCatalogImageFile(file) {
  if (!catalogDraft || !canWriteCatalogProducts()) return;

  clearCatalogImagePreview();
  const validationError = await validateCatalogImageFileWithDimensions(file);
  if (validationError) {
    catalogDraft = {
      ...catalogDraft,
      imageFile: null,
      imageFilePreviewUrl: "",
      imageError: validationError,
    };
    render();
    return;
  }

  catalogDraft = {
    ...catalogDraft,
    imageFile: file,
    imageFilePreviewUrl: URL.createObjectURL(file),
    imageError: "",
    removeImage: false,
  };
  catalogSaveError = "";
  render();
}

function removeCatalogImageFromDraft() {
  if (!catalogDraft || !canWriteCatalogProducts()) return;

  clearCatalogImagePreview();
  catalogDraft = {
    ...catalogDraft,
    imageFile: null,
    imageFilePreviewUrl: "",
    imageError: "",
    removeImage: true,
  };
  catalogSaveError = "";
  render();
}
function updateCatalogDraftField(field, value, inputType = "text") {
  if (!catalogDraft) return;
  const nextValue = inputType === "checkbox" ? Boolean(value) : value;
  const shouldCreateSlug = field === "name" && (!catalogDraft.slug || catalogDraft.slug === slugify(catalogDraft.name));

  catalogDraft = {
    ...catalogDraft,
    [field]: nextValue,
  };

  if (shouldCreateSlug) {
    catalogDraft.slug = slugify(nextValue);
  }

  catalogValidationError = "";
  catalogSaveError = "";
}

async function saveCatalogDraft() {
  if (!canWriteCatalogProducts() || !catalogDraft || catalogSaveState === "saving" || catalogSaveState === "uploading") return;

  const draft = catalogDraft;
  const previousImageUrl = String(draft.imageUrl || "").trim();
  const product = normalizeCatalogDraft(draft);
  const validationError = validateCatalogProduct(product);
  if (validationError) {
    catalogValidationError = validationError;
    render();
    return;
  }

  if (draft.imageFile) {
    const imageValidationError = await validateCatalogImageFileWithDimensions(draft.imageFile);
    if (imageValidationError) {
      catalogDraft = { ...draft, imageError: imageValidationError };
      render();
      return;
    }
  }

  let uploadedImage = null;
  let failedPhase = "save";
  catalogSaveState = draft.imageFile ? "uploading" : "saving";
  catalogSaveError = "";
  catalogValidationError = "";
  catalogDraft = { ...draft, imageError: "" };
  render();

  try {
    if (draft.imageFile) {
      failedPhase = "upload";
      uploadedImage = await uploadCatalogImage(draft.imageFile, product, adminAuthSession);
      product.imageUrl = uploadedImage.publicUrl;
      failedPhase = "save";
      catalogSaveState = "saving";
      render();
    } else if (draft.removeImage) {
      product.imageUrl = "";
    }

    const savedProduct = catalogDrawerMode === "edit" && draft.id
      ? await updateAdminCatalogProduct(draft.id, product, adminAuthSession)
      : await createAdminCatalogProduct(product, adminAuthSession);

    if (savedProduct) {
      catalogProducts = upsertCatalogProduct(catalogProducts, savedProduct);
      selectedCatalogProductId = savedProduct.id;
      activeCatalogKey = savedProduct.catalogKey;
    }

    const shouldDeletePreviousImage = Boolean(
      savedProduct &&
      previousImageUrl &&
      previousImageUrl !== savedProduct.imageUrl &&
      (uploadedImage || draft.removeImage)
    );

    clearCatalogImagePreview();
    catalogDrawerMode = "";
    catalogDraft = null;
    catalogSaveState = "success";
    window.setTimeout(() => {
      if (catalogSaveState === "success") {
        catalogSaveState = "idle";
        render();
      }
    }, 1800);
    render();

    if (shouldDeletePreviousImage) {
      deleteCatalogImageByUrl(previousImageUrl, adminAuthSession).catch((error) => {
        console.warn("Unable to remove replaced catalog image.", error);
      });
    }
  } catch (error) {
    if (uploadedImage?.path) {
      try {
        await deleteCatalogImagePath(uploadedImage.path, adminAuthSession);
      } catch (cleanupError) {
        console.warn("Unable to clean up uploaded catalog image after failed save.", cleanupError);
      }
    }

    console.error("Unable to save catalog product.", error);
    catalogSaveState = "idle";
    catalogSaveError = error.message || "Save failed. Check RLS and catalog product fields.";
    if (catalogDraft) {
      catalogDraft = {
        ...catalogDraft,
        imageError: failedPhase === "upload" ? catalogSaveError : catalogDraft.imageError,
      };
    }
    render();
  }
}

function normalizeCatalogDraft(draft) {
  return {
    ...draft,
    name: String(draft.name || "").trim(),
    slug: slugify(draft.slug || draft.name),
    category: String(draft.category || "").trim(),
    description: String(draft.description || "").trim(),
    imageUrl: draft.removeImage ? "" : String(draft.imageUrl || "").trim(),
    startingPrice: draft.startingPrice === "" ? "" : Number(draft.startingPrice),
    priceLabel: String(draft.priceLabel || "").trim(),
    minimumQuantity: Number(draft.minimumQuantity || 1),
    availableSizes: splitCatalogList(draft.availableSizesText),
    availableColors: splitCatalogList(draft.availableColorsText),
    printMethods: splitCatalogList(draft.printMethodsText),
    sortOrder: Number(draft.sortOrder || 0),
    isFeatured: draft.isFeatured === true,
    status: draft.status || "draft",
  };
}

function validateCatalogProduct(product) {
  if (!catalogOptions.some((catalog) => catalog.key === product.catalogKey)) return "Choose a valid catalog.";
  if (!product.name) return "Product name is required.";
  if (!product.slug) return "Slug is required.";
  if (!catalogStatusOptions.includes(product.status)) return "Choose a valid status.";
  if (!Number.isFinite(product.minimumQuantity) || product.minimumQuantity < 1) return "Minimum quantity must be at least 1.";
  if (product.startingPrice !== "" && (!Number.isFinite(product.startingPrice) || product.startingPrice < 0)) return "Starting price cannot be negative.";
  if (!Number.isFinite(product.sortOrder) || product.sortOrder < 0) return "Sort order cannot be negative.";
  return "";
}

function upsertCatalogProduct(items, product) {
  const nextItems = items.some((item) => item.id === product.id)
    ? items.map((item) => item.id === product.id ? product : item)
    : [...items, product];

  return nextItems.sort((a, b) => a.catalogKey.localeCompare(b.catalogKey) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

function splitCatalogList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
function bindEvents() {
  document.querySelectorAll("[data-admin-logout]").forEach((button) => {
    button.addEventListener("click", async () => {
      await logoutAdminUser();
    });
  });

  document.querySelectorAll(".menu-button, .mobile-menu-button").forEach((button) => {
    button.addEventListener("click", () => {
      if (window.matchMedia("(max-width: 768px)").matches) {
        isMobileSidebarOpen = true;
      } else {
        setStoredSidebarCollapsed(!isSidebarCollapsed);
      }
      render();
    });
  });

  document.querySelectorAll(".sidebar-backdrop, .sidebar-close-button").forEach((button) => {
    button.addEventListener("click", () => {
      isMobileSidebarOpen = false;
      render();
    });
  });

  document.querySelectorAll("[data-route-link]").forEach((link) => {
    const openRoute = () => {
      navigateTo(link.getAttribute("href"));
      isMobileSidebarOpen = false;
      render();
    };

    link.addEventListener("click", (event) => {
      event.preventDefault();
      openRoute();
    });

    link.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      openRoute();
    });
  });

  document.querySelectorAll("[data-route-target]").forEach((button) => {
    button.addEventListener("click", () => {
      navigateTo(button.dataset.routeTarget);
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

  mvpDashboard.bind({
    root: document,
    rerender: render,
    navigate: navigateTo,
    copy: copyToClipboard,
    saveProduction: saveMvpProductionFields,
  });
  document.body.classList.toggle("mvp-drawer-open", Boolean(document.querySelector(".mvp-drawer")));
  bindOpsBoardEvents();
  bindOrderDashboardEvents();
  document.querySelectorAll("[data-catalog-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeCatalogKey = button.dataset.catalogTab;
      catalogStatusFilter = catalogStatusFilter || "active";
      selectedCatalogProductId = catalogProducts.find((item) => item.catalogKey === activeCatalogKey)?.id ?? null;
      clearCatalogImagePreview();
      catalogDrawerMode = "";
      catalogDraft = null;
      render();
    });
  });

  document.getElementById("catalog-status-filter")?.addEventListener("change", (event) => {
    catalogStatusFilter = event.target.value;
    render();
  });

  document.querySelector("[data-catalog-add-product]")?.addEventListener("click", () => {
    openCatalogDrawer("create");
  });

  document.querySelectorAll("[data-catalog-edit-product]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      openCatalogDrawer("edit", element.dataset.catalogEditProduct);
    });
  });

  document.querySelectorAll("[data-catalog-close-drawer]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.preventDefault();
      closeCatalogDrawer();
    });
  });

  document.querySelectorAll("[data-catalog-field]").forEach((field) => {
    const eventName = field.type === "checkbox" ? "change" : "input";
    field.addEventListener(eventName, (event) => {
      updateCatalogDraftField(field.dataset.catalogField, field.type === "checkbox" ? field.checked : event.target.value, field.type);
      if (field.dataset.catalogField === "name") {
        const slugInput = document.getElementById("catalog-slug");
        if (slugInput && catalogDraft?.slug) slugInput.value = catalogDraft.slug;
      }
    });
  });

  document.querySelector("[data-catalog-image-file]")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0] ?? null;
    if (file) await updateCatalogImageFile(file);
  });

  document.querySelector("[data-catalog-remove-image]")?.addEventListener("click", () => {
    removeCatalogImageFromDraft();
  });
  document.getElementById("catalog-product-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveCatalogDraft();
  });

  document.querySelectorAll("[data-order-filter]").forEach((card) => {
    card.addEventListener("click", () => {
      activeFilter = card.dataset.orderFilter;
      if (card.dataset.routeTarget) {
        navigateTo(card.dataset.routeTarget);
      }
      render();
    });
  });

  document.querySelectorAll("[data-client-filter]").forEach((card) => {
    card.addEventListener("click", () => {
      clientKpiFilter = card.dataset.clientFilter;
      render();
    });
  });

  document.querySelectorAll("[data-product-kpi-filter]").forEach((card) => {
    card.addEventListener("click", () => {
      productFilter = card.dataset.productKpiFilter;
      render();
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

  document.querySelectorAll("[data-recent-order-id]").forEach((row) => {
    row.addEventListener("click", () => {
      const order = orders.find((item) => item.id === row.dataset.recentOrderId);
      selectedId = row.dataset.recentOrderId;
      draftStatus = order?.status ?? draftStatus;
      activeFilter = "All";
      navigateTo("/orders");
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
      selectedImageAngle = getMainProductImage(selectedProductCode).angle_label;
      isProductDrawerOpen = true;
      render();
    });
  });

  document.querySelector("[data-product-drawer-close]")?.addEventListener("click", () => {
    isProductDrawerOpen = false;
    render();
  });

  document.querySelectorAll("[data-image-angle]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedImageAngle = button.dataset.imageAngle;
      render();
    });
  });

  document.querySelectorAll("[data-set-main-image]").forEach((button) => {
    button.addEventListener("click", () => {
      setMainProductImage(button.dataset.setMainImage, button.dataset.setMainAngle);
      selectedImageAngle = button.dataset.setMainAngle;
      render();
    });
  });

  document.querySelectorAll("[data-remove-image]").forEach((button) => {
    button.addEventListener("click", () => {
      removeProductImage(button.dataset.removeImage, button.dataset.removeAngle);
      selectedImageAngle = getMainProductImage(button.dataset.removeImage).angle_label;
      render();
    });
  });

  document.querySelectorAll("[data-reorder-image]").forEach((button) => {
    button.addEventListener("click", () => {
      reorderProductImage(
        button.dataset.reorderImage,
        button.dataset.reorderAngle,
        button.dataset.reorderDirection
      );
      selectedImageAngle = button.dataset.reorderAngle;
      render();
    });
  });

  document.querySelectorAll("[data-image-upload-code]").forEach((input) => {
    input.addEventListener("change", async (event) => {
      const [file] = event.target.files;
      if (!file) return;

      const imageUrl = await readFileAsDataUrl(file);
      upsertProductImage(input.dataset.imageUploadCode, input.dataset.imageUploadAngle, imageUrl);
      selectedImageAngle = input.dataset.imageUploadAngle;
      showFeedback(`${input.dataset.imageUploadAngle} image updated`);
    });
  });

  const search = document.getElementById("order-search");
  if (search) {
    search.addEventListener("input", (event) => {
      query = event.target.value;
      render();
      focusFieldAtEnd("order-search");
    });
  }

  const clientSearch = document.getElementById("client-search");
  if (clientSearch) {
    clientSearch.addEventListener("input", (event) => {
      clientQuery = event.target.value;
      render();
      focusFieldAtEnd("client-search");
    });
  }

  const globalSearch = document.getElementById("global-search");
  if (globalSearch) {
    globalSearch.addEventListener("input", (event) => {
      globalSearchQuery = event.target.value;
      render();
      focusFieldAtEnd("global-search");
    });
    globalSearch.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      const route = getSearchRoute(globalSearch.value);
      if (!route) return;
      event.preventDefault();
      applySearchRoute(route);
    });
  }

  const productSearch = document.getElementById("product-search");
  if (productSearch) {
    productSearch.addEventListener("input", (event) => {
      productQuery = event.target.value;
      render();
      focusFieldAtEnd("product-search");
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

async function saveMvpProductionFields(id, changes) {
  const current = opsInquiries.find((item) => item.id === id);
  if (!current || !isConfirmedOpsOrder(current)) return;
  if (shouldLoadSupabaseOps && !current.productionFieldsReady) {
    orderDashboardSaveError = "Production fields are not ready. Apply the pending migration before saving.";
    return;
  }

  const updates = {
    ...changes,
    productionUpdatedAt: new Date().toISOString(),
  };
  let savedInquiry = null;

  if (shouldLoadSupabaseOps) {
    try {
      const payload = await requestOpsWorkflowAction(id, {
        action: changes.productionStage ? "advance_production" : "save_production",
        productionStage: changes.productionStage,
        assignedStaff: changes.assignedStaff,
        productionNote: changes.productionNote,
        blockedReason: changes.blockedReason,
      });
      savedInquiry = payload.inquiry;
      if (!savedInquiry) throw new Error("Production update returned no saved inquiry.");
      orderDashboardSaveError = "";
    } catch (error) {
      console.error("Unable to save MVP production fields.", error);
      orderDashboardSaveError = error.message || "Unable to save production fields.";
      return;
    }
  }

  opsInquiries = opsInquiries.map((item) => item.id === id ? { ...item, ...(savedInquiry || updates) } : item);
}

function bindOrderDashboardEvents() {
  const search = document.getElementById("order-dashboard-search");
  search?.addEventListener("input", (event) => {
    orderDashboardFilters = { ...orderDashboardFilters, search: event.target.value };
    render();
    focusFieldAtEnd("order-dashboard-search");
  });

  document.querySelectorAll("[data-order-dashboard-filter]").forEach((field) => {
    field.addEventListener("change", (event) => {
      orderDashboardFilters = { ...orderDashboardFilters, [field.dataset.orderDashboardFilter]: event.target.value };
      render();
    });
  });

  const openOrderDrawer = (id) => {
    if (!id || (selectedOrderDashboardId === id && document.querySelector("[data-order-dashboard-close]"))) return;
    selectedOrderDashboardId = id;
    orderDashboardReturnFocusId = id;
    orderDashboardSaveError = "";
    render();
    document.querySelector("[data-order-dashboard-close]")?.focus();
  };

  document.querySelectorAll("[data-order-dashboard-row]").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest("button, a, input, select, textarea")) return;
      openOrderDrawer(row.dataset.orderDashboardRow);
    });
    row.addEventListener("keydown", (event) => {
      if (event.target !== row || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      openOrderDrawer(row.dataset.orderDashboardRow);
    });
  });

  document.querySelectorAll("[data-order-dashboard-open]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openOrderDrawer(button.dataset.orderDashboardOpen);
    });
  });

  document.querySelectorAll("[data-order-dashboard-copy]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const key = button.dataset.orderDashboardCopyKey;
      const feedback = button.querySelector(".order-dashboard-copy-feedback");
      await copyToClipboard(button.dataset.orderDashboardCopy);
      if (feedback) feedback.textContent = "Copied";
      button.classList.add("copied");
      if (orderDashboardCopyTimers.has(key)) window.clearTimeout(orderDashboardCopyTimers.get(key));
      orderDashboardCopyTimers.set(key, window.setTimeout(() => {
        button.classList.remove("copied");
        if (feedback) feedback.textContent = "";
        orderDashboardCopyTimers.delete(key);
      }, 1300));
    });
  });

  document.querySelector("[data-order-dashboard-close]")?.addEventListener("click", () => {
    const returnFocusId = orderDashboardReturnFocusId || selectedOrderDashboardId;
    selectedOrderDashboardId = null;
    render();
    document.querySelector(`[data-order-dashboard-row="${CSS.escape(returnFocusId || "")}"]`)?.focus();
  });
  document.querySelectorAll("[data-order-dashboard-save]").forEach((button) => {
    button.addEventListener("click", async () => {
      await saveOrderDashboardProduction(button.dataset.orderDashboardSave);
      render();
    });
  });
}
function bindOpsBoardEvents() {
  const rawMessage = document.getElementById("ops-raw-message");
  if (rawMessage) {
    rawMessage.addEventListener("input", (event) => {
      opsRawMessage = event.target.value;
      opsSavedNotice = false;
      const extractButton = document.getElementById("ops-extract-inquiry");
      if (extractButton) {
        extractButton.disabled = !opsRawMessage.trim();
      }
      document.querySelector(".ops-save-notice")?.remove();
    });
  }

  document.getElementById("ops-extract-inquiry")?.addEventListener("click", () => {
    if (!opsRawMessage.trim()) return;
    opsExtractFields = demoExtractOpsInquiry(opsRawMessage);
    opsSavedNotice = false;
    render();
  });

  document.querySelectorAll("[data-ops-field]").forEach((field) => {
    field.addEventListener("input", (event) => {
      if (!opsExtractFields) return;
      opsExtractFields = { ...opsExtractFields, [field.dataset.opsField]: event.target.value };
    });
  });

  document.getElementById("ops-save-inquiry")?.addEventListener("click", async () => {
    await saveOpsInquiry();
    render();
  });

  document.getElementById("ops-clear-inquiry")?.addEventListener("click", () => {
    opsExtractFields = null;
    opsRawMessage = "";
    opsSavedNotice = false;
    render();
  });

  document.querySelectorAll("[data-ops-view-artwork]").forEach((button) => {
    button.addEventListener("click", async () => {
      await openOpsArtwork(button.dataset.opsViewArtwork);
    });
  });

  document.querySelectorAll("[data-ops-customer-field]").forEach((field) => {
    field.addEventListener("input", updateOpsCustomerActionInlineValidation);
  });

  document.querySelectorAll("[data-ops-customer-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      await saveOpsCustomerAction(button.dataset.opsCustomerId, button.dataset.opsCustomerAction, button);
    });
  });

  document.querySelectorAll("[data-ops-customer-asset]").forEach((button) => {
    button.addEventListener("click", async () => {
      await openOpsCustomerAsset(button.dataset.opsCustomerId, button.dataset.opsCustomerAsset);
    });
  });

  document.querySelectorAll("[data-ops-final-proof-file]").forEach((input) => {
    input.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (file) await uploadOpsFinalArtworkProof(input.dataset.opsFinalProofFile, file);
    });
  });

  document.querySelectorAll("[data-ops-move-to]").forEach((button) => {
    button.addEventListener("click", async () => {
      await moveOpsInquiry(button.dataset.opsMoveId, button.dataset.opsMoveTo);
      render();
    });
  });




  document.querySelectorAll("[data-ops-save-tracking]").forEach((button) => {
    button.addEventListener("click", async () => {
      await saveOpsCustomerTracking(button.dataset.opsSaveTracking);
      render();
    });
  });
  document.querySelectorAll("[data-ops-priority-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.opsPriorityId;
      if (!id) return;
      expandedOpsInquiryId = id;
      render();
      requestAnimationFrame(() => {
        document.querySelector(`[data-ops-card-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
      });
    });
  });
  document.querySelectorAll("[data-ops-toggle-details]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.opsToggleDetails;
      expandedOpsInquiryId = expandedOpsInquiryId === id ? null : id;
      render();
    });
  });

  document.querySelectorAll("[data-ops-close-details]").forEach((button) => {
    button.addEventListener("click", () => {
      expandedOpsInquiryId = null;
      opsSoDraft = null;
      opsArtworkRequests = {};
      opsCustomerActionRequests = {};
      render();
    });
  });
  document.querySelectorAll("[data-ops-add-so]").forEach((button) => {
    button.addEventListener("click", () => {
      opsSoDraft = { id: button.dataset.opsAddSo, value: "" };
      render();
      document.querySelector(`[data-ops-so-input="${button.dataset.opsAddSo}"]`)?.focus();
    });
  });

  document.querySelectorAll("[data-ops-so-input]").forEach((input) => {
    input.addEventListener("input", (event) => {
      opsSoDraft = { id: input.dataset.opsSoInput, value: event.target.value };
      render();
      const soField = document.querySelector(`[data-ops-so-input="${input.dataset.opsSoInput}"]`); if (soField) { soField.focus(); soField.setSelectionRange?.(soField.value.length, soField.value.length); }
    });
  });

  document.querySelectorAll("[data-ops-confirm-so]").forEach((button) => {
    button.addEventListener("click", async () => {
      await confirmOpsSO(button.dataset.opsConfirmSo);
      render();
    });
  });

  document.querySelector("[data-ops-cancel-so]")?.addEventListener("click", () => {
    opsSoDraft = null;
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

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
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
    { label: "Pending Review", value: countOrders("Pending Review"), icon: "queue", delta: "Awaiting admin action", orderFilter: "Pending Review", active: activeFilter === "Pending Review" },
    { label: "Approved", value: countOrders("Approved"), icon: "check", delta: "Ready for scheduling", orderFilter: "Approved", active: activeFilter === "Approved" },
    { label: "In Production", value: countOrders("In Production"), icon: "factory", delta: "Currently moving", orderFilter: "In Production", active: activeFilter === "In Production" },
    { label: "Ready", value: countOrders("Ready"), icon: "ready", delta: "Awaiting fulfillment", orderFilter: "Ready", active: activeFilter === "Ready" },
    { label: "Completed", value: countOrders("Completed"), icon: "calendar", delta: "Closed requests", orderFilter: "Completed", active: activeFilter === "Completed" },
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

function getSearchRoute(value) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  if ("urban coffee".includes(normalized)) {
    return { path: "/clients", clientQuery: "Urban Coffee" };
  }

  if ("admin polo uniform".includes(normalized)) {
    return { path: "/products", productQuery: "Admin Polo" };
  }

  if ("embroidered staff cap".includes(normalized) || normalized.includes("cap")) {
    return { path: "/products", productQuery: "Cap" };
  }

  if (normalized.includes("trry-uc") || "orders".includes(normalized) || "reorder".includes(normalized)) {
    return { path: "/orders", orderQuery: value.trim() };
  }

  return null;
}

function applySearchRoute(route) {
  if (route.clientQuery) {
    clientQuery = route.clientQuery;
    clientKpiFilter = "All";
  }

  if (route.productQuery) {
    productQuery = route.productQuery;
    productFilter = "All";
  }

  if (route.orderQuery) {
    query = route.orderQuery;
    activeFilter = "All";
  }

  globalSearchQuery = "";
  navigateTo(route.path);
  render();
}

function getProductImages(productCode) {
  return productImages
    .filter((image) => image.product_id === productCode)
    .sort((a, b) => a.sort_order - b.sort_order);
}

function getMainProductImage(productCode) {
  const images = getProductImages(productCode);
  return images.find((image) => image.is_main) ?? images[0] ?? createFallbackProductImage(productCode);
}

function getActiveProductImage(productCode) {
  const images = getProductImages(productCode);
  return (
    images.find((image) => image.angle_label === selectedImageAngle) ??
    images.find((image) => image.is_main) ??
    images[0] ??
    createFallbackProductImage(productCode)
  );
}

function setMainProductImage(productCode, angleLabel) {
  productImages = productImages.map((image) =>
    image.product_id === productCode
      ? { ...image, is_main: image.angle_label === angleLabel }
      : image
  );
}

function upsertProductImage(productCode, angleLabel, imageUrl) {
  const existingImage = productImages.find(
    (image) => image.product_id === productCode && image.angle_label === angleLabel
  );
  const nextSortOrder =
    Math.max(0, ...getProductImages(productCode).map((image) => image.sort_order)) + 1;

  if (existingImage) {
    productImages = productImages.map((image) =>
      image.id === existingImage.id
        ? { ...image, image_url: imageUrl }
        : image
    );
    normalizeProductImageSortOrder(productCode);
    return;
  }

  productImages = [
    ...productImages,
    {
      id: `${productCode}-${statusToClass(angleLabel)}-${Date.now()}`,
      product_id: productCode,
      image_url: imageUrl,
      angle_label: angleLabel,
      sort_order: nextSortOrder,
      is_main: false,
      created_at: new Date().toISOString(),
    },
  ];
  normalizeProductImageSortOrder(productCode);
}

function removeProductImage(productCode, angleLabel) {
  if (angleLabel === "Front") return;

  const removedImage = productImages.find(
    (image) => image.product_id === productCode && image.angle_label === angleLabel
  );

  productImages = productImages.filter(
    (image) => !(image.product_id === productCode && image.angle_label === angleLabel)
  );

  if (removedImage?.is_main) {
    setMainProductImage(productCode, "Front");
  }

  normalizeProductImageSortOrder(productCode);
}

function reorderProductImage(productCode, angleLabel, direction) {
  const images = getProductImages(productCode);
  const currentIndex = images.findIndex((image) => image.angle_label === angleLabel);
  if (currentIndex < 0) return;

  const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (nextIndex < 0 || nextIndex >= images.length) return;

  const reorderedImages = [...images];
  const [movedImage] = reorderedImages.splice(currentIndex, 1);
  reorderedImages.splice(nextIndex, 0, movedImage);

  const untouchedImages = productImages.filter((image) => image.product_id !== productCode);
  productImages = [
    ...untouchedImages,
    ...reorderedImages.map((image, index) => ({ ...image, sort_order: index + 1 })),
  ];
}

function normalizeProductImageSortOrder(productCode) {
  productImages = productImages.map((image) => {
    if (image.product_id !== productCode) return image;

    const sortedIndex = getProductImages(productCode).findIndex((item) => item.id === image.id);
    return { ...image, sort_order: sortedIndex + 1 };
  });
}

function createFallbackProductImage(productCode) {
  const product = products.find((item) => item.code === productCode) ?? products[0];

  return {
    id: `${productCode}-front-fallback`,
    product_id: productCode,
    image_url: createProductImageDataUrl(product, "Front"),
    angle_label: "Front",
    sort_order: 1,
    is_main: true,
    created_at: "2026-06-17T00:00:00+08:00",
  };
}

function createProductImageDataUrl(product, angleLabel) {
  const isCap = product.category === "Caps";
  const baseColor = isCap ? "#172554" : "#111111";
  const accentColor = isCap ? "#dbeafe" : "#fbf9f8";
  const labelColor = isCap ? "#1e3a8a" : "#a04100";
  const shape = isCap
    ? `<path d="M42 105c24-27 88-27 112 0 17 0 28 7 34 22H8c6-15 17-22 34-22Z" fill="${baseColor}"/><path d="M52 104c5-31 87-31 92 0" fill="#243b73"/><path d="M42 128h112" stroke="${accentColor}" stroke-width="3"/>`
    : `<path d="M62 38h72l22 28-18 17-10-11v84H68V72L58 83 40 66l22-28Z" fill="${baseColor}"/><path d="M78 38c3 15 37 15 40 0" fill="#2a2a2a"/><path d="M82 78h28v23H82z" fill="${accentColor}" opacity=".2"/>`;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
      <rect width="320" height="240" rx="18" fill="#f5f3f3"/>
      <rect x="18" y="18" width="284" height="204" rx="14" fill="#ffffff" stroke="#e2bfb0"/>
      <g transform="translate(62 36)">${shape}</g>
      <text x="28" y="194" fill="#111827" font-family="Arial, sans-serif" font-size="19" font-weight="700">${product.product}</text>
      <text x="28" y="216" fill="${labelColor}" font-family="Arial, sans-serif" font-size="13" font-weight="700">${angleLabel}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function statusToClass(status) {
  return status.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function getCurrentRoute() {
  return routes[getRoutePath()] ?? routes[defaultRoutePath];
}

function getRoutePath() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return routes[path] ? path : defaultRoutePath;
}

function navigateTo(path) {
  const normalizedPath = normalizeRoutePath(path);
  window.history.pushState({}, "", normalizedPath);
}

function normalizeRoutePath(path) {
  const url = new URL(String(path || defaultRoutePath), window.location.origin);
  const routePath = url.pathname.replace(/\/+$/, "") || "/";
  return routes[routePath] ? `${routePath}${url.search}` : defaultRoutePath;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
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

initializeAdminAuth();
