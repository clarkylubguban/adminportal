import { createMvpDashboard } from "./mvpDashboard.js";
import {
  approveTaskDraft,
  approveTaskWork,
  archiveTask,
  assignTask,
  cancelTask,
  createIdempotencyKey,
  createTaskDraft,
  getMyTasks,
  getTaskDetail,
  getWorkboardTasks,
  reopenTask,
  requestTaskRevision,
  startTaskRevision,
  startTaskWork,
  submitTaskForReview,
  submitTaskWithoutRecordedTime,
  updateTaskDraft,
} from "./services/tasks.js";
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
  getAdminAssignmentUsers,
  updateInquiryAssignment,
} from "./services/adminAssignments.js";
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
  readInviteSessionFromUrl,
  isSupabaseReady,
  signInAdminWithPassword,
  signOutAdmin,
  updateAdminInvitePassword,
} from "./lib/supabaseClient.js";

const mvpDashboard = createMvpDashboard({
  getAssignmentContext: () => ({
    users: assignmentUsers,
    loadState: assignmentLoadState,
    error: assignmentLoadError,
  }),
});

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
  quote: { label: "New Inquiry", dot: OPS_INK, bg: "#FFFFFF", text: OPS_INK },
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
let opsSoSavingId = null;
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
let selectedProductCode = null;
let isProductDrawerOpen = false;
let activeFilter = "All";
let clientKpiFilter = "All";
let productFilter = "All";
let catalogStatusFilter = "active";
let catalogCategoryFilter = "all";
let catalogFeaturedFilter = "all";
let query = "";
let draftStatus = orders[0]?.status ?? "Pending Review";
let clientQuery = "";
let selectedClientId = null;
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
let isAccountMenuOpen = false;
let staffUsers = [];
let staffLoadState = "idle";
let staffLoadError = "";
let staffFeedback = "";
let staffDrawerMode = "";
let staffEditingId = null;
let staffDraft = createEmptyStaffDraft();
let staffSaveState = "idle";
let staffSaveError = "";
let staffActionId = "";
let assignmentUsers = [];
let assignmentLoadState = "idle";
let assignmentLoadError = "";
let myTasks = [];
let myTasksLoadState = "idle";
let myTasksLoadError = "";
let myTasksFilter = "active";
let myTasksSearch = "";
let selectedTaskId = null;
let selectedTaskDetail = null;
let taskDrawerState = "closed";
let taskDetailLoadState = "idle";
let taskDetailLoadError = "";
let taskCommandState = "idle";
let taskCommandError = "";
let taskSubmissionNote = "";
let taskProofUrl = "";
let taskNoTimeReason = "";
let taskFallbackOpen = false;
let myTasksClock = Date.now();
let myTasksTickHandle = null;
let workboardTasks = [];
let workboardLoadState = "idle";
let workboardLoadError = "";
let workboardFilterStatus = "active";
let workboardFilterPriority = "";
let workboardFilterSource = "";
let workboardFilterAssignee = "";
let workboardFilterReviewer = "";
let workboardSearch = "";
let workboardDrawerMode = "closed";
let workboardCommandState = "idle";
let workboardCommandError = "";
let workboardReviewNote = "";
let workboardReason = "";
let workboardDraftForm = createEmptyWorkboardDraft();

const routes = {
  "/": "Overview",
  "/inquiries": "Inquiries",
  "/order-dashboard": "Orders",
  "/orders": "Orders",
  "/production": "Production",
  "/my-tasks": "My Tasks",
  "/workboard": "Workboard",
  "/reorders": "Reorders",
  "/overview": "Overview",
  "/clients": "Clients",
  "/products": "Products",
  "/catalog": "Catalog",
  "/staff": "Staff",
  "/settings": "Settings",
};

const defaultRoutePath = "/";
const parkedAdminRoutes = new Set(["/clients", "/products"]);
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
let adminLoginPasswordVisible = false;
let adminLoginError = "";
let adminLoginNotice = "";
let adminAuthMessage = "";
let adminShellMessage = "";
let passwordSetupDraft = { password: "", confirm: "" };
let passwordSetupStatus = "idle";
let passwordSetupError = "";
let passwordSetupSession = null;
let isSidebarCollapsed = getStoredSidebarCollapsed();
let isMobileSidebarOpen = false;

function render() {
  if (isPasswordSetupRoute()) {
    renderPasswordSetupScreen();
    return;
  }

  if (!canRenderAdminShell()) {
    renderAdminAuthGate();
    return;
  }

  const currentRoute = getCurrentRoute();
  const selectedOrder = orders.find((order) => order.id === selectedId);
  const selectedProduct = products.find((product) => product.code === selectedProductCode) ?? null;
  const filteredOrders = getFilteredOrders();
  const isAdminSaasRoute = ["Clients", "Products", "Catalog", "Staff", "Settings"].includes(currentRoute);
  if (currentRoute === "My Tasks" && myTasksLoadState === "idle") window.setTimeout(loadMyTasks, 0);
  if (currentRoute === "Workboard" && workboardLoadState === "idle") window.setTimeout(loadWorkboardTasks, 0);

  document.getElementById("root").innerHTML = `
    <div class="app-shell ${isSidebarCollapsed ? "sidebar-collapsed" : ""} ${isMobileSidebarOpen ? "mobile-sidebar-open" : ""} ${isAdminSaasRoute ? "admin-saas-shell" : ""}">
      ${renderMobileTopBar()}
      ${renderSidebar(currentRoute)}
      <button class="sidebar-backdrop" type="button" aria-label="Close navigation"></button>
      <section class="workspace ${isSidebarCollapsed ? "is-expanded" : ""} ${isAdminSaasRoute ? "admin-saas-workspace" : ""}">
        ${renderTopHeader()}${renderAdminShellMessage()}
        ${
          currentRoute === "Orders"
            ? renderMvpOrdersPage()
            : currentRoute === "Reorders"
              ? renderOrdersPage(selectedOrder, filteredOrders)
              : currentRoute === "Inquiries"
                ? renderMvpInquiriesPage()
                : currentRoute === "Production"
                  ? renderMvpProductionPage()
                  : currentRoute === "My Tasks"
                    ? renderMyTasksPage()
                    : currentRoute === "Workboard"
                      ? renderWorkboardPage()
                  : currentRoute === "Overview"
                ? renderOverviewPage()
                : currentRoute === "Clients"
                  ? renderClientsPage()
                  : currentRoute === "Products"
                    ? renderProductsPage(selectedProduct)
                    : currentRoute === "Catalog"
                      ? renderCatalogPage()
                      : currentRoute === "Staff"
                        ? renderStaffAccessPage()
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
  resetSettingsMobileNavPosition(currentRoute);
}


function resetSettingsMobileNavPosition(currentRoute) {
  if (currentRoute !== "Settings") {
    return;
  }

  window.requestAnimationFrame(() => {
    const settingsSubnav = document.querySelector(".settings-subnav");

    if (settingsSubnav) {
      settingsSubnav.scrollLeft = 0;
    }
  });
}


function canRenderAdminShell() {
  if (!isSupabaseReady()) {
    if (isLocalTaskQaMode()) {
      return adminAuthStatus === "approved" && Boolean(adminAuthSession && adminUser);
    }
    return isAdminAccessUnlocked();
  }

  return adminAuthStatus === "approved" && Boolean(adminAuthSession && adminUser);
}

function renderAdminAuthGate() {
  if (!isSupabaseReady()) {
    renderAdminAccessGate();
    return;
  }

  if (adminAuthStatus === "checking" || adminAuthStatus === "role-checking" || adminAuthStatus === "signing-out") {
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
  const message = adminAuthStatus === "role-checking"
    ? "Checking admin access..."
    : adminAuthStatus === "signing-out"
      ? "Signing out..."
      : "Checking admin session...";

  document.getElementById("root").innerHTML = `
    <main class="admin-access-page">
      <section class="admin-access-card admin-login-card" aria-label="TRRY Admin loading">
        <div class="admin-access-brand"><strong>TRRY</strong><span>ADMIN PORTAL</span></div>
        <div class="admin-access-heading">
          <h1>Welcome back</h1>
          <span>${escapeHtml(message)}</span>
        </div>
        <div class="admin-auth-loader" aria-hidden="true"><span></span></div>
      </section>
    </main>
  `;
}

function renderAdminLoginScreen() {
  const isSigningIn = adminAuthStatus === "signing-in";
  document.getElementById("root").innerHTML = `
    <main class="admin-access-page">
      <section class="admin-access-card admin-login-card" aria-label="TRRY Admin login">
        <div class="admin-access-brand"><strong>TRRY</strong><span>ADMIN PORTAL</span></div>
        <div class="admin-access-heading">
          <h1>Welcome back</h1>
          <span>Sign in to manage TRRY operations.</span>
        </div>
        <form class="admin-access-form" id="admin-login-form">
          <label for="admin-login-email">EMAIL</label>
          <input id="admin-login-email" value="${escapeHtml(adminLoginEmail)}" type="email" autocomplete="email" inputmode="email" aria-invalid="${adminLoginError ? "true" : "false"}" ${isSigningIn ? "disabled" : ""} />
          <label for="admin-login-password">PASSWORD</label>
          <div class="admin-password-field">
            <input id="admin-login-password" value="${escapeHtml(adminLoginPassword)}" type="${adminLoginPasswordVisible ? "text" : "password"}" autocomplete="current-password" aria-invalid="${adminLoginError ? "true" : "false"}" ${isSigningIn ? "disabled" : ""} />
            <button id="admin-password-toggle" class="admin-password-toggle" type="button" aria-controls="admin-login-password" aria-pressed="${adminLoginPasswordVisible ? "true" : "false"}" ${isSigningIn ? "disabled" : ""}>${adminLoginPasswordVisible ? "HIDE" : "SHOW"}</button>
          </div>
          ${getAdminLoginNotice() ? `<p class="admin-access-success" role="status">${escapeHtml(getAdminLoginNotice())}</p>` : ""}
          ${adminLoginError ? `<p class="admin-access-error" role="alert">${escapeHtml(adminLoginError)}</p>` : ""}
          <button type="submit" ${isSigningIn ? "disabled" : ""}>${isSigningIn ? "SIGNING IN..." : "SIGN IN"}</button>
        </form>
        <p class="admin-login-note">Authorized staff only.</p>
      </section>
    </main>
  `;

  bindAdminLoginEvents();
}

function getAdminLoginNotice() {
  if (adminLoginNotice) return adminLoginNotice;
  return new URLSearchParams(window.location.search).get("password_set") === "1"
    ? "PASSWORD SET. YOU CAN NOW SIGN IN."
    : "";
}

function renderPasswordSetupScreen() {
  const inviteError = passwordSetupSession?.error || "";
  const isSaving = passwordSetupStatus === "saving";
  const isInvalid = !passwordSetupSession?.access_token || Boolean(inviteError);
  const message = inviteError || (isInvalid ? "Invitation link is expired or invalid." : "Create your password to activate your staff account.");

  document.getElementById("root").innerHTML = `
    <main class="admin-access-page">
      <section class="admin-access-card admin-login-card" aria-label="TRRY Admin password setup">
        <div class="admin-access-brand"><strong>TRRY</strong><span>ADMIN PORTAL</span></div>
        <div class="admin-access-heading">
          <h1>Set password</h1>
          <span>${escapeHtml(message)}</span>
        </div>
        <form class="admin-access-form" id="admin-password-setup-form">
          <label for="admin-new-password">NEW PASSWORD</label>
          <input id="admin-new-password" value="${escapeHtml(passwordSetupDraft.password)}" type="password" autocomplete="new-password" aria-invalid="${passwordSetupError ? "true" : "false"}" ${isInvalid || isSaving ? "disabled" : ""} />
          <label for="admin-confirm-password">CONFIRM PASSWORD</label>
          <input id="admin-confirm-password" value="${escapeHtml(passwordSetupDraft.confirm)}" type="password" autocomplete="new-password" aria-invalid="${passwordSetupError ? "true" : "false"}" ${isInvalid || isSaving ? "disabled" : ""} />
          ${passwordSetupError ? `<p class="admin-access-error" role="alert">${escapeHtml(passwordSetupError)}</p>` : ""}
          <button type="submit" ${isInvalid || isSaving ? "disabled" : ""}>${isSaving ? "SAVING..." : "SAVE PASSWORD"}</button>
        </form>
        <p class="admin-login-note">Authorized staff only.</p>
      </section>
    </main>
  `;

  bindPasswordSetupEvents();
}

function bindPasswordSetupEvents() {
  const password = document.getElementById("admin-new-password");
  const confirm = document.getElementById("admin-confirm-password");
  const form = document.getElementById("admin-password-setup-form");

  password?.addEventListener("input", (event) => {
    passwordSetupDraft.password = event.target.value;
    passwordSetupError = "";
  });

  confirm?.addEventListener("input", (event) => {
    passwordSetupDraft.confirm = event.target.value;
    passwordSetupError = "";
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitPasswordSetup();
  });

  password?.focus();
}

async function submitPasswordSetup() {
  passwordSetupError = validateNewPassword(passwordSetupDraft.password, passwordSetupDraft.confirm);
  if (passwordSetupError) {
    render();
    return;
  }

  passwordSetupStatus = "saving";
  render();

  try {
    await updateAdminInvitePassword(passwordSetupSession, passwordSetupDraft.password);
    passwordSetupDraft = { password: "", confirm: "" };
    passwordSetupStatus = "idle";
    passwordSetupError = "";
    passwordSetupSession = null;
    adminAuthSession = null;
    adminUser = null;
    adminAuthStatus = "login";
    adminLoginNotice = "PASSWORD SET. YOU CAN NOW SIGN IN.";
    window.history.replaceState({}, "", "/?password_set=1");
    render();
  } catch (error) {
    console.error("Admin invite password setup failed.", error);
    passwordSetupStatus = "idle";
    passwordSetupError = error.message || "Unable to set password. Try a new invitation link.";
    render();
  }
}

function validateNewPassword(password, confirm) {
  if (!password || !confirm) return "Enter and confirm a new password.";
  if (password !== confirm) return "Passwords do not match.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must include upper and lower case letters and a number.";
  }
  return "";
}
function renderAdminBlockedScreen() {
  document.getElementById("root").innerHTML = `
    <main class="admin-access-page">
      <section class="admin-access-card admin-login-card blocked" aria-label="TRRY Admin access blocked">
        <div class="admin-access-brand"><strong>TRRY</strong><span>APPAREL MANAGEMENT</span></div>
        <div class="admin-access-heading">
          <p>ACCESS BLOCKED</p>
          <h1>Access restricted</h1>
          <span>Your Supabase account is signed in, but it is not active for this Admin Portal.</span>
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
    adminLoginNotice = "";
  });

  password?.addEventListener("input", (event) => {
    adminLoginPassword = event.target.value;
    adminLoginError = "";
    adminLoginNotice = "";
  });

  document.getElementById("admin-password-toggle")?.addEventListener("click", () => {
    adminLoginPasswordVisible = !adminLoginPasswordVisible;
    render();
    document.getElementById("admin-login-password")?.focus();
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await loginAdminUser();
  });

  email?.focus();
}

async function loginAdminUser() {
  adminLoginError = "";
  adminLoginNotice = "";
  adminAuthStatus = "signing-in";
  render();

  try {
    const session = await signInAdminWithPassword(adminLoginEmail.trim(), adminLoginPassword);
    adminLoginPassword = "";
    await approveAdminSession(session);
  } catch (error) {
    console.error("Admin login failed.", error);
    adminAuthStatus = "login";
    adminLoginError = error.message || "Invalid login. Check your email or password.";
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
      adminAuthMessage = "Unauthorized or disabled admin account.";
      render();
      return;
    }

    adminUser = approvedUser;
    adminAuthStatus = "approved";
    adminAuthMessage = "";
    startAdminDataLoading();
    render();
  } catch (error) {
    console.error("Admin role check failed.", error);
    adminUser = null;
    adminAuthStatus = "blocked";
    adminAuthMessage = error.message || "Unable to verify TRRY Admin access.";
    render();
  }
}

async function initializeAdminAuth() {
  if (isPasswordSetupRoute()) {
    passwordSetupSession = readInviteSessionFromUrl();
    adminAuthStatus = "password-setup";
    render();
    return;
  }

  if (!isSupabaseReady()) {
    if (isLocalTaskQaMode()) {
      adminAuthSession = createLocalTaskQaSession();
      adminUser = createLocalTaskQaUser();
      adminAuthStatus = "approved";
      adminAuthMessage = "";
      startAdminDataLoading();
      render();
      return;
    }

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
  if (adminAuthStatus === "signing-out") return;
  adminAuthStatus = "signing-out";
  adminShellMessage = "";
  render();
  try {
    await signOutAdmin();
    adminAuthSession = null;
    adminUser = null;
    adminLoginPassword = "";
    adminLoginPasswordVisible = false;
    adminAuthMessage = "";
    adminShellMessage = "";
    adminAuthStatus = isSupabaseReady() ? "login" : "access-code";
  } catch (error) {
    console.error("Admin logout failed.", error);
    adminShellMessage = error.message || "Unable to log out. Check your connection and try again.";
    adminAuthStatus = "approved";
  }
  render();
}
function renderAdminShellMessage() {
  return adminShellMessage
    ? `<p class="admin-shell-message" role="alert">${escapeHtml(adminShellMessage)}</p>`
    : "";
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
  loadAssignmentUsers();
  loadOpsBoardInquiries();
  loadAdminOrders();
  loadAdminClients();
  loadCatalogProducts();
  if (isTaskFeatureUiEnabled()) loadMyTasks();
}

async function loadAssignmentUsers() {
  if (!adminAuthSession?.access_token) return;
  assignmentLoadState = "loading";
  assignmentLoadError = "";
  render();

  try {
    assignmentUsers = await getAdminAssignmentUsers(adminAuthSession);
    assignmentLoadState = "ready";
  } catch (error) {
    console.error("Unable to load assignment users.", error);
    assignmentUsers = [];
    assignmentLoadState = "error";
    assignmentLoadError = error.message || "Unable to load team members.";
  }
  render();
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
  if (hasLoadedCatalogProducts && catalogLoadState !== "loading") return;
  hasLoadedCatalogProducts = true;
  catalogLoadState = "loading";
  catalogLoadError = "";

  try {
    const result = await getAdminCatalogProducts(adminAuthSession);
    const nextProducts = Array.isArray(result?.products) ? result.products : [];
    catalogProducts = nextProducts;
    catalogLoadState = result?.status === "error" ? "error" : nextProducts.length ? "success" : "empty";
    catalogLoadError = result?.error?.message ?? "";

    if (!catalogProducts.some((item) => item.id === selectedCatalogProductId)) {
      selectedCatalogProductId = catalogProducts.find((item) => item.catalogKey === activeCatalogKey)?.id ?? null;
    }
  } catch (error) {
    console.error("Unable to apply catalog products.", error);
    catalogProducts = [];
    catalogLoadState = "error";
    catalogLoadError = error.message || "Unable to load catalog records.";
  } finally {
    render();
  }
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
function isLocalTaskQaMode() {
  const value = String(window.TRRY_ADMIN_ENV?.VITE_LOCAL_TASK_QA_MODE ?? "false").trim().toLowerCase();
  const localHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  return localHost && ["1", "true", "yes", "on"].includes(value);
}

function createLocalTaskQaSession() {
  const userId = String(window.TRRY_ADMIN_ENV?.VITE_LOCAL_TASK_QA_USER_ID || "95000000-0000-4000-8000-000000000010");
  return {
    access_token: "synthetic-staff-a-token",
    refresh_token: "",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: userId },
  };
}

function createLocalTaskQaUser() {
  const role = String(window.TRRY_ADMIN_ENV?.VITE_LOCAL_TASK_QA_ROLE || "staff").trim().toLowerCase();
  const safeRole = ["owner", "admin", "staff"].includes(role) ? role : "staff";
  const userId = String(window.TRRY_ADMIN_ENV?.VITE_LOCAL_TASK_QA_USER_ID || "95000000-0000-4000-8000-000000000010");
  const displayName = safeRole === "owner" ? "Synthetic Owner" : safeRole === "admin" ? "Synthetic Admin" : "Synthetic Staff A";
  return {
    id: `synthetic-${safeRole}`,
    userId,
    email: `synthetic-${safeRole}.invalid`,
    displayName,
    role: safeRole,
  };
}
function isTaskFeatureUiEnabled() {
  const value = String(window.TRRY_ADMIN_ENV?.VITE_ENABLE_TASK_DOMAIN ?? window.TRRY_ADMIN_ENV?.VITE_TASK_DOMAIN_ENABLED ?? "false").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(value) && (isSupabaseReady() || isLocalTaskQaMode());
}

function canViewMyTasksRoute() {
  return isTaskFeatureUiEnabled() && ["owner", "admin", "staff"].includes(adminUser?.role);
}

async function loadMyTasks({ silent = false } = {}) {
  if (!canViewMyTasksRoute() || !adminAuthSession?.access_token) return;
  if (!silent) {
    myTasksLoadState = "loading";
    myTasksLoadError = "";
    render();
  }

  try {
    const response = await getMyTasks(adminAuthSession, getMyTasksApiFilters());
    myTasks = sortMyTasks(response.tasks || []);
    myTasksLoadState = "ready";
    myTasksLoadError = "";
    syncMyTasksTimerTick();
  } catch (error) {
    myTasksLoadState = error.code === "FEATURE_DISABLED" ? "feature-disabled" : error.code === "FORBIDDEN" ? "forbidden" : "error";
    myTasksLoadError = getTaskErrorMessage(error);
    myTasks = [];
    stopMyTasksTimerTick();
  }
  render();
}

function getMyTasksApiFilters() {
  const statusByFilter = {
    to_do: "TO_DO",
    in_progress: "IN_PROGRESS",
    needs_revision: "NEEDS_REVISION",
    for_review: "FOR_REVIEW",
    completed: "DONE",
  };
  return {
    status: statusByFilter[myTasksFilter] || "",
    search: myTasksSearch.trim(),
    pageSize: 100,
  };
}

function sortMyTasks(tasks) {
  const now = Date.now();
  return [...tasks]
    .filter((task) => task.status !== "DRAFT")
    .sort((a, b) => getTaskSortWeight(a, now) - getTaskSortWeight(b, now) || compareTaskDate(a, b));
}

function getTaskSortWeight(task, now = Date.now()) {
  if (task.openTimeEntry) return 0;
  if (isTaskOverdue(task, now)) return 10;
  if (task.status === "NEEDS_REVISION") return 20;
  if (isTaskDueToday(task, now)) return 30;
  if (task.status === "TO_DO") return 40;
  if (task.status === "IN_PROGRESS") return 45;
  if (task.status === "FOR_REVIEW") return 50;
  if (task.status === "DONE") return 80;
  return 60;
}

function compareTaskDate(a, b) {
  return Date.parse(a.submissionDeadline || a.scheduledDate || a.updatedAt || 0) - Date.parse(b.submissionDeadline || b.scheduledDate || b.updatedAt || 0);
}

function isTaskOverdue(task, now = Date.now()) {
  const due = Date.parse(task.submissionDeadline || "");
  return Number.isFinite(due) && due < startOfToday(now) && !["DONE", "CANCELLED"].includes(task.status);
}

function isTaskDueToday(task, now = Date.now()) {
  const due = Date.parse(task.submissionDeadline || task.scheduledDate || "");
  return Number.isFinite(due) && due >= startOfToday(now) && due < startOfTomorrow(now);
}

function startOfToday(now) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function startOfTomorrow(now) {
  return startOfToday(now) + 86400000;
}

function getRunningTask() {
  return myTasks.find((task) => task.openTimeEntry?.startedAt && task.status === "IN_PROGRESS") || null;
}

function syncMyTasksTimerTick() {
  if (myTasks.some((task) => task.openTimeEntry?.startedAt) || selectedTaskDetail?.task?.openTimeEntry?.startedAt) {
    if (!myTasksTickHandle) {
      myTasksTickHandle = window.setInterval(() => {
        myTasksClock = Date.now();
        render();
      }, 1000);
    }
    return;
  }
  stopMyTasksTimerTick();
}

function stopMyTasksTimerTick() {
  if (myTasksTickHandle) window.clearInterval(myTasksTickHandle);
  myTasksTickHandle = null;
}

function canViewWorkboardRoute() {
  return isTaskFeatureUiEnabled() && ["owner", "admin"].includes(adminUser?.role);
}

function createEmptyWorkboardDraft(task = null) {
  const now = new Date();
  const defaultDeadline = new Date(now.getTime() + 24 * 3600000).toISOString().slice(0, 16);
  return {
    title: task?.title || "",
    brief: task?.brief || "",
    sourceType: task?.sourceType || "MANUAL",
    sourceRecordType: task?.sourceRecordType || "",
    sourceRecordId: task?.sourceRecordId || "",
    priority: task?.priority || "MEDIUM",
    assignedUserId: task?.assignedUserId || "",
    reviewerUserId: task?.reviewerUserId || "",
    timeTrackingMode: task?.timeTrackingMode || "EXPECTED",
    draftApprovalRequired: task?.draftApprovalRequired === true,
    scheduledDate: task?.scheduledDate || "",
    startDeadline: toLocalDatetimeInput(task?.startDeadline || ""),
    submissionDeadline: toLocalDatetimeInput(task?.submissionDeadline || defaultDeadline),
    approvalDeadline: toLocalDatetimeInput(task?.approvalDeadline || ""),
  };
}

async function loadWorkboardTasks({ silent = false } = {}) {
  if (!canViewWorkboardRoute() || !adminAuthSession?.access_token) return;
  if (!silent) {
    workboardLoadState = "loading";
    workboardLoadError = "";
    render();
  }
  try {
    const response = await getWorkboardTasks(adminAuthSession, getWorkboardApiFilters());
    workboardTasks = sortMyTasks(response.tasks || []);
    workboardLoadState = "ready";
    workboardLoadError = "";
    syncMyTasksTimerTick();
  } catch (error) {
    workboardLoadState = error.code === "FEATURE_DISABLED" ? "feature-disabled" : error.code === "FORBIDDEN" ? "forbidden" : "error";
    workboardLoadError = getTaskErrorMessage(error);
    workboardTasks = [];
  }
  render();
}

function getWorkboardApiFilters() {
  const statusMap = {
    draft: "DRAFT",
    to_do: "TO_DO",
    in_progress: "IN_PROGRESS",
    for_review: "FOR_REVIEW",
    needs_revision: "NEEDS_REVISION",
    done: "DONE",
    cancelled: "CANCELLED",
  };
  return {
    status: statusMap[workboardFilterStatus] || "",
    priority: workboardFilterPriority,
    sourceType: workboardFilterSource,
    assignedUserId: workboardFilterAssignee,
    reviewerUserId: workboardFilterReviewer,
    archived: workboardFilterStatus === "archived" ? "true" : "false",
    search: workboardSearch.trim(),
    pageSize: 100,
  };
}

function getVisibleWorkboardTasks() {
  const normalized = workboardSearch.trim().toLowerCase();
  return workboardTasks.filter((task) => {
    if (workboardFilterStatus === "active" && ["DONE", "CANCELLED"].includes(task.status)) return false;
    if (workboardFilterStatus === "overdue" && !isTaskOverdue(task)) return false;
    if (normalized) return [task.taskCode, task.title, task.sourceType, task.priority, task.status, getUserLabel(task.assignedUser), getUserLabel(task.reviewerUser)].join(" ").toLowerCase().includes(normalized);
    return true;
  });
}

function renderWorkboardPage() {
  if (!canViewWorkboardRoute()) {
    return `<section class="mvp-page workboard-page"><div class="mvp-page-title"><div><span>WORKBOARD</span><h1>WORKBOARD</h1><p>Task planning is not enabled for this account.</p></div></div></section>`;
  }
  const visibleTasks = getVisibleWorkboardTasks();
  return `<section class="mvp-page workboard-page">
    <div class="mvp-page-title">
      <div><span>WORKBOARD</span><h1>WORKBOARD</h1><p>${visibleTasks.length} shown / ${workboardTasks.length} total</p></div>
      <button class="ops-gold-button" data-workboard-create type="button">CREATE TASK</button>
    </div>
    ${renderWorkboardStateNotice()}
    ${renderWorkboardSummary()}
    ${renderWorkboardFilters()}
    ${workboardLoadState === "loading" ? `<div class="my-tasks-empty"><strong>Loading Workboard</strong><span>Checking task records.</span></div>` : ""}
    ${workboardLoadState === "ready" ? renderWorkboardTaskList(visibleTasks) : ""}
    ${renderWorkboardDrawer()}
  </section>`;
}

function renderWorkboardStateNotice() {
  if (workboardLoadState === "error") return `<div class="ops-persistence-card error"><strong>Unable to load Workboard</strong><span>${escapeHtml(workboardLoadError)}</span></div>`;
  if (workboardLoadState === "forbidden") return `<div class="ops-persistence-card error"><strong>Workboard access is restricted</strong><span>${escapeHtml(workboardLoadError || "Your account cannot view manager task records.")}</span></div>`;
  if (workboardLoadState === "feature-disabled") return `<div class="ops-persistence-card"><strong>Workboard unavailable</strong><span>The task domain is disabled for this environment.</span></div>`;
  if (workboardCommandError) return `<div class="ops-persistence-card error"><strong>Workboard action needs attention</strong><span>${escapeHtml(workboardCommandError)}</span></div>`;
  return "";
}

function renderWorkboardSummary() {
  const counts = {
    drafts: workboardTasks.filter((task) => task.status === "DRAFT").length,
    todo: workboardTasks.filter((task) => task.status === "TO_DO").length,
    progress: workboardTasks.filter((task) => task.status === "IN_PROGRESS").length,
    review: workboardTasks.filter((task) => task.status === "FOR_REVIEW").length,
    revision: workboardTasks.filter((task) => task.status === "NEEDS_REVISION").length,
    overdue: workboardTasks.filter((task) => isTaskOverdue(task)).length,
    done: workboardTasks.filter((task) => task.status === "DONE").length,
  };
  return `<div class="workboard-summary">
    ${renderMyTaskMetric("Drafts", counts.drafts, "Planning")}
    ${renderMyTaskMetric("To Do", counts.todo, "Queued")}
    ${renderMyTaskMetric("In Progress", counts.progress, "Running")}
    ${renderMyTaskMetric("Waiting Review", counts.review, "Owner/Admin")}
    ${renderMyTaskMetric("Needs Revision", counts.revision, "Returned")}
    ${renderMyTaskMetric("Overdue", counts.overdue, "Needs attention")}
    ${renderMyTaskMetric("Approved", counts.done, "Completed")}
  </div>`;
}

function renderWorkboardFilters() {
  return `<div class="workboard-filters">
    ${renderWorkboardSelect("workboard-status-filter", workboardFilterStatus, [["active", "Active"], ["draft", "Draft"], ["to_do", "To Do"], ["in_progress", "In Progress"], ["for_review", "For Review"], ["needs_revision", "Needs Revision"], ["overdue", "Overdue"], ["done", "Done"], ["cancelled", "Cancelled"], ["archived", "Archived"]])}
    ${renderWorkboardSelect("workboard-priority-filter", workboardFilterPriority, [["", "All priorities"], ["URGENT", "Urgent"], ["HIGH", "High"], ["MEDIUM", "Medium"], ["LOW", "Low"]])}
    ${renderWorkboardSelect("workboard-source-filter", workboardFilterSource, [["", "All sources"], ["MANUAL", "Manual"], ["PRODUCTION", "Production"], ["SHOP_TASK", "Shop task"], ["AI_MARKETING", "AI marketing"], ["DAILY_CONTENT", "Daily content"]])}
    ${renderWorkboardUserSelect("workboard-assignee-filter", workboardFilterAssignee, "All assignees")}
    ${renderWorkboardUserSelect("workboard-reviewer-filter", workboardFilterReviewer, "All reviewers")}
    <label class="my-tasks-search workboard-search">${renderIcon("search", "search-icon")}<input id="workboard-search" value="${escapeHtml(workboardSearch)}" placeholder="Search task title or code..." type="search" /></label>
    <button data-workboard-clear type="button">CLEAR</button>
  </div>`;
}

function renderWorkboardSelect(id, value, options) {
  return `<select id="${escapeHtml(id)}">${options.map(([optionValue, label]) => `<option value="${escapeHtml(optionValue)}" ${String(value) === String(optionValue) ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select>`;
}

function renderWorkboardUserSelect(id, value, label) {
  const users = getEligibleAssignmentUsers(false);
  return `<select id="${escapeHtml(id)}"><option value="">${escapeHtml(label)}</option>${users.map((user) => `<option value="${escapeHtml(user.userId)}" ${value === user.userId ? "selected" : ""}>${escapeHtml(getAssignmentUserLabel(user))}</option>`).join("")}</select>`;
}

function renderWorkboardTaskList(tasks) {
  if (!tasks.length) return `<div class="my-tasks-empty"><strong>${workboardTasks.length ? "No tasks match your filters" : "No task records yet"}</strong><span>${workboardTasks.length ? "Try another status or search term." : "Create a manual task draft when planning is ready."}</span>${workboardTasks.length ? `<button data-workboard-clear type="button">CLEAR FILTERS</button>` : ""}</div>`;
  const groups = getWorkboardStatusGroups(tasks);
  return `<section class="workboard-board" aria-label="Workboard task groups">${groups.map(renderWorkboardGroup).join("")}</section>`;
}

function getWorkboardStatusGroups(tasks) {
  const definitions = [
    ["DRAFT", "Draft", "No draft tasks."],
    ["FOR_REVIEW", "Waiting for Review", "Nothing waiting for review."],
    ["NEEDS_REVISION", "Needs Revision", "No tasks need revision."],
    ["TO_DO", "To Do", "No queued tasks."],
    ["IN_PROGRESS", "In Progress", "No tasks in progress."],
    ["DONE", "Approved", "No approved tasks."],
    ["CANCELLED", "Cancelled", "No cancelled tasks."],
  ];
  const important = new Set(["DRAFT", "FOR_REVIEW", "NEEDS_REVISION"]);
  return definitions
    .map(([status, label, emptyText]) => ({ status, label, emptyText, tasks: tasks.filter((task) => task.status === status) }))
    .filter((group) => group.tasks.length || important.has(group.status) || (workboardFilterStatus !== "active" && tasks.some((task) => task.status === group.status)));
}

function renderWorkboardGroup(group) {
  return `<section class="workboard-group ${statusToClass(group.status)}"><header><div><strong>${escapeHtml(group.label)}</strong><span>${group.tasks.length}</span></div></header><div class="workboard-group-list">${group.tasks.length ? group.tasks.map(renderWorkboardCard).join("") : `<p class="workboard-empty">${escapeHtml(group.emptyText)}</p>`}</div></section>`;
}
function renderWorkboardRow(task) {
  const latest = getWorkboardPrimaryAction(task);
  return `<tr class="${task.status === "FOR_REVIEW" ? "for-review" : ""} ${isTaskOverdue(task) ? "overdue" : ""}">
    <td><button class="workboard-task-link" data-workboard-open="${escapeHtml(task.id)}" type="button"><span>${escapeHtml(task.taskCode || "TASK")}</span><strong>${escapeHtml(task.title || "Untitled task")}</strong></button></td>
    <td>${escapeHtml(formatSourceType(task.sourceType))}</td>
    <td>${renderTaskPriority(task.priority)}</td>
    <td>${renderTaskStatus(task.status)}${task.openTimeEntry ? `<span class="my-task-mode">RUNNING</span>` : ""}</td>
    <td>${escapeHtml(getUserLabel(task.assignedUser))}</td>
    <td>${escapeHtml(getUserLabel(task.reviewerUser))}</td>
    <td>${escapeHtml(formatTaskDue(task))}</td>
    <td>${escapeHtml(formatTaskTimeSummary(task))}</td>
    <td><button data-workboard-open="${escapeHtml(task.id)}" type="button">${escapeHtml(latest || "OPEN")}</button></td>
  </tr>`;
}

function renderWorkboardCard(task) {
  const objective = String(task.brief || formatSourceType(task.sourceType) || "No brief provided.").trim();
  const dueLabel = formatTaskDue(task);
  return `<button class="workboard-task-card ${task.openTimeEntry ? "running" : ""} ${isTaskOverdue(task) ? "overdue" : ""} ${statusToClass(task.status)}" data-workboard-open="${escapeHtml(task.id)}" type="button">
    <span class="workboard-card-top"><code>${escapeHtml(task.taskCode || "TASK")}</code>${renderTaskStatus(task.status)}</span>
    <strong>${escapeHtml(task.title || "Untitled task")}</strong>
    <small>${escapeHtml(objective)}</small>
    <span class="workboard-card-meta">${renderTaskPriority(task.priority)}<b>${escapeHtml(getUserLabel(task.assignedUser))}</b></span>
    <span class="workboard-card-footer"><em>${escapeHtml(dueLabel)}</em><i>${escapeHtml(getWorkboardPrimaryAction(task) || "OPEN")}</i></span>
  </button>`;
}
function getWorkboardPrimaryAction(task) {
  const actions = task.allowedActions || [];
  if (actions.includes("APPROVE_WORK")) return "REVIEW";
  if (actions.includes("REQUEST_REVISION")) return "REVIEW";
  if (actions.includes("APPROVE_DRAFT")) return "APPROVE DRAFT";
  if (actions.includes("EDIT_DRAFT")) return "EDIT";
  return "OPEN";
}

function renderWorkboardDrawer() {
  if (workboardDrawerMode === "closed") return "";
  const isForm = workboardDrawerMode === "create" || workboardDrawerMode === "edit";
  const detail = selectedTaskDetail;
  const task = detail?.task || workboardTasks.find((item) => item.id === selectedTaskId) || null;
  const drawerBadges = task && !isForm ? `<div class="workboard-drawer-badges">${renderTaskStatus(task.status)}${renderTaskPriority(task.priority)}</div>` : "";
  return `<div class="my-task-drawer-backdrop" data-workboard-close></div><aside class="my-task-drawer workboard-drawer" aria-label="Workboard task details">
    <header><div><span>${escapeHtml(workboardDrawerMode === "create" ? "NEW TASK" : task?.taskCode || "TASK")}</span><h2>${escapeHtml(workboardDrawerMode === "create" ? "Create manual task draft" : task?.title || "Loading task")}</h2>${drawerBadges}</div><button data-workboard-close type="button" aria-label="Close Workboard drawer">X</button></header>
    ${workboardCommandError ? `<div class="ops-persistence-card error"><strong>Action needs attention</strong><span>${escapeHtml(workboardCommandError)}</span></div>` : ""}
    ${isForm ? renderWorkboardDraftForm(task) : renderWorkboardTaskDetail(detail, task)}
  </aside>`;
}

function renderWorkboardDraftForm(task) {
  const busy = workboardCommandState === "saving";
  return `<form class="workboard-form" data-workboard-draft-form>
    <label><span>Title</span><input id="workboard-title" value="${escapeHtml(workboardDraftForm.title)}" maxlength="200" ${busy ? "disabled" : ""} /></label>
    <label><span>Brief</span><textarea id="workboard-brief" rows="5" ${busy ? "disabled" : ""}>${escapeHtml(workboardDraftForm.brief)}</textarea></label>
    <div class="workboard-form-grid">
      <label><span>Source</span>${renderWorkboardSelect("workboard-source-type", workboardDraftForm.sourceType, [["MANUAL", "Manual"], ["PRODUCTION", "Production"], ["SHOP_TASK", "Shop task"], ["AI_MARKETING", "AI marketing"], ["DAILY_CONTENT", "Daily content"]])}</label>
      <label><span>Priority</span>${renderWorkboardSelect("workboard-priority", workboardDraftForm.priority, [["LOW", "Low"], ["MEDIUM", "Medium"], ["HIGH", "High"], ["URGENT", "Urgent"]])}</label>
      <label><span>Assigned</span>${renderWorkboardDraftUserSelect("workboard-assigned", workboardDraftForm.assignedUserId, "Unassigned")}</label>
      <label><span>Reviewer</span>${renderWorkboardDraftUserSelect("workboard-reviewer", workboardDraftForm.reviewerUserId, "No reviewer")}</label>
      <label><span>Time mode</span>${renderWorkboardSelect("workboard-time-mode", workboardDraftForm.timeTrackingMode, [["EXPECTED", "Expected"], ["NONE", "Time not required"]])}</label>
      <label><span>Scheduled date</span><input id="workboard-scheduled" value="${escapeHtml(workboardDraftForm.scheduledDate)}" type="date" ${busy ? "disabled" : ""} /></label>
      <label><span>Start deadline</span><input id="workboard-start-deadline" value="${escapeHtml(workboardDraftForm.startDeadline)}" type="datetime-local" ${busy ? "disabled" : ""} /></label>
      <label><span>Submission deadline</span><input id="workboard-submission-deadline" value="${escapeHtml(workboardDraftForm.submissionDeadline)}" type="datetime-local" ${busy ? "disabled" : ""} /></label>
      <label><span>Approval deadline</span><input id="workboard-approval-deadline" value="${escapeHtml(workboardDraftForm.approvalDeadline)}" type="datetime-local" ${busy ? "disabled" : ""} /></label>
      <label><span>Source record type</span><input id="workboard-source-record-type" value="${escapeHtml(workboardDraftForm.sourceRecordType)}" maxlength="64" ${busy ? "disabled" : ""} /></label>
      <label><span>Source record id</span><input id="workboard-source-record-id" value="${escapeHtml(workboardDraftForm.sourceRecordId)}" maxlength="200" ${busy ? "disabled" : ""} /></label>
      <label class="workboard-checkbox"><input id="workboard-draft-approval" type="checkbox" ${workboardDraftForm.draftApprovalRequired ? "checked" : ""} ${busy ? "disabled" : ""} /><span>Owner approval required</span></label>
    </div>
    <div class="my-task-action-buttons sticky-actions"><button class="primary" type="submit" ${busy ? "disabled" : ""}>${busy ? "SAVING..." : workboardDrawerMode === "create" ? "CREATE DRAFT" : "SAVE DRAFT"}</button>${task?.allowedActions?.includes("APPROVE_DRAFT") ? `<button data-workboard-approve-draft="${escapeHtml(task.id)}" type="button" ${busy ? "disabled" : ""}>APPROVE DRAFT</button>` : ""}</div>
  </form>`;
}

function renderWorkboardDraftUserSelect(id, value, label) {
  const users = getEligibleAssignmentUsers(true);
  return `<select id="${escapeHtml(id)}"><option value="">${escapeHtml(label)}</option>${users.map((user) => `<option value="${escapeHtml(user.userId)}" ${value === user.userId ? "selected" : ""}>${escapeHtml(getAssignmentUserLabel(user))}</option>`).join("")}</select>`;
}

function renderWorkboardTaskDetail(detail, task) {
  if (taskDetailLoadState === "loading") return `<div class="my-tasks-empty"><strong>Loading task detail</strong><span>Fetching canonical task state.</span></div>`;
  if (taskDetailLoadError) return `<div class="ops-persistence-card error"><strong>Unable to open task</strong><span>${escapeHtml(taskDetailLoadError)}</span></div>`;
  if (!detail || !task) return `<div class="my-tasks-empty"><strong>No task selected</strong><span>Select a task to inspect.</span></div>`;
  const latestSubmission = (detail.submissions || []).at(-1) || null;
  return `<div class="my-task-drawer-content workboard-detail-content">
    <section class="workboard-detail-section"><h3>Task Summary</h3><div class="workboard-summary-line"><strong>${escapeHtml(formatSourceReference(task))}</strong><span>${escapeHtml(task.timeTrackingMode === "NONE" ? "Time not required" : "Time expected")}</span></div>${task.openTimeEntry ? `<p class="my-task-running-time">${escapeHtml(formatElapsed(getRunningElapsedSeconds(task)))}</p>` : ""}</section>
    <section class="workboard-detail-section workboard-instructions"><h3>Instructions</h3><p>${escapeHtml(task.brief || "No instructions recorded.")}</p></section>
    <section class="workboard-detail-section"><h3>Required Assets or Shots</h3><ul class="workboard-checklist"><li>No required assets or shot list recorded.</li></ul></section>
    <section class="workboard-detail-section"><h3>Assignment and Deadline</h3><div class="my-task-detail-grid workboard-detail-grid">
      ${renderTaskFact("Assigned", getUserLabel(task.assignedUser))}
      ${renderTaskFact("Reviewer", getUserLabel(task.reviewerUser))}
      ${renderTaskFact("Scheduled", formatTaskDate(task.scheduledDate))}
      ${renderTaskFact("Start", formatTaskDateTime(task.startDeadline))}
      ${renderTaskFact("Submission", formatTaskDateTime(task.submissionDeadline))}
      ${renderTaskFact("Approval", formatTaskDateTime(task.approvalDeadline))}
      ${renderTaskFact("Recorded", formatTaskTimeSummary(task))}
    </div></section>
    ${renderWorkboardSubmissionProof(latestSubmission)}
    ${renderWorkboardActionArea(task)}
    ${renderWorkboardHistory(detail.history || [])}
  </div>`;
}

function renderWorkboardSubmissionProof(submission) {
  if (!submission) return `<section class="workboard-detail-section workboard-proof-section"><h3>Submission / Proof</h3><p class="workboard-empty inline">No submissions yet.</p></section>`;
  const proof = submission.proofUrl ? `<a class="workboard-proof-action" href="${escapeHtml(submission.proofUrl)}" target="_blank" rel="noreferrer">VIEW PROOF</a>` : `<span class="workboard-proof-missing">No proof link submitted.</span>`;
  return `<section class="workboard-detail-section workboard-proof-section"><h3>Submission / Proof</h3><div class="workboard-proof-row"><div><strong>${escapeHtml(formatSubmissionTimeStatus(submission))}</strong><p>${escapeHtml(submission.submissionNote || "No note saved.")}</p><small>${escapeHtml(formatTaskDateTime(submission.submittedAt))} / ${escapeHtml(getUserLabel(submission.submittedByUser))}${submission.recordedDurationSeconds !== null ? ` / ${escapeHtml(formatDuration(submission.recordedDurationSeconds))}` : ""}</small>${submission.noTimeReason ? `<p><b>Time note:</b> ${escapeHtml(submission.noTimeReason)}</p>` : ""}${submission.reviewNote ? `<p><b>Review:</b> ${escapeHtml(submission.reviewNote)}</p>` : ""}</div>${proof}</div></section>`;
}

function renderWorkboardLatestSubmission(submission) {
  return renderWorkboardSubmissionProof(submission);
}
function renderWorkboardHistory(history) {
  if (!history.length) return "";
  return `<section class="my-task-history workboard-activity"><h3>Notes or Activity</h3>${history.slice(-6).reverse().map((event) => `<article><div><strong>${escapeHtml(String(event.eventType || "EVENT").replace(/_/g, " "))}</strong><span>${escapeHtml(formatTaskDateTime(event.occurredAt))}</span></div>${event.reason ? `<p>${escapeHtml(event.reason)}</p>` : ""}</article>`).join("")}</section>`;
}

function renderWorkboardActionArea(task) {
  const actions = task.allowedActions || [];
  const busy = workboardCommandState === "saving";
  if (!actions.length) return `<section class="my-task-action-area"><strong>No available manager action</strong><span>This task is waiting on another step.</span></section>`;
  return `<section class="my-task-action-area workboard-actions"><strong>Owner Review</strong>
    ${actions.includes("REQUEST_REVISION") || actions.includes("APPROVE_WORK") ? `<label><span>Review note</span><textarea id="workboard-review-note" rows="3" ${busy ? "disabled" : ""}>${escapeHtml(workboardReviewNote)}</textarea></label>` : ""}
    ${actions.includes("ASSIGN") ? `<label><span>Assign user</span>${renderWorkboardDraftUserSelect("workboard-assign-user", task.assignedUserId || "", "Unassigned")}</label>` : ""}
    ${actions.includes("CANCEL") || actions.includes("REOPEN") ? `<label><span>Reason</span><textarea id="workboard-reason" rows="3" ${busy ? "disabled" : ""}>${escapeHtml(workboardReason)}</textarea></label>` : ""}
    <div class="my-task-action-buttons sticky-actions">
      ${actions.includes("EDIT_DRAFT") ? `<button data-workboard-edit-draft="${escapeHtml(task.id)}" ${busy ? "disabled" : ""} type="button">EDIT DRAFT</button>` : ""}
      ${actions.includes("ASSIGN") ? `<button data-workboard-assign="${escapeHtml(task.id)}" ${busy ? "disabled" : ""} type="button">ASSIGN</button>` : ""}
      ${actions.includes("APPROVE_DRAFT") ? `<button class="primary" data-workboard-approve-draft="${escapeHtml(task.id)}" ${busy ? "disabled" : ""} type="button">APPROVE DRAFT</button>` : ""}
      ${actions.includes("REQUEST_REVISION") ? `<button data-workboard-request-revision="${escapeHtml(task.id)}" ${busy ? "disabled" : ""} type="button">REQUEST REVISION</button>` : ""}
      ${actions.includes("APPROVE_WORK") ? `<button class="primary" data-workboard-approve-work="${escapeHtml(task.id)}" ${busy ? "disabled" : ""} type="button">APPROVE WORK</button>` : ""}
      ${actions.includes("CANCEL") ? `<button data-workboard-cancel="${escapeHtml(task.id)}" ${busy ? "disabled" : ""} type="button">CANCEL</button>` : ""}
      ${actions.includes("REOPEN") ? `<button data-workboard-reopen="${escapeHtml(task.id)}" ${busy ? "disabled" : ""} type="button">REOPEN</button>` : ""}
      ${actions.includes("ARCHIVE") ? `<button data-workboard-archive="${escapeHtml(task.id)}" ${busy ? "disabled" : ""} type="button">ARCHIVE</button>` : ""}
    </div>
  </section>`;
}

function getEligibleAssignmentUsers(activeOnly = true) {
  return assignmentUsers.filter((user) => {
    if (!user?.userId) return false;
    if (activeOnly && user.isActive === false) return false;
    if (user.assignmentEligible === false) return false;
    return ["owner", "admin", "staff"].includes(String(user.role || "").toLowerCase());
  });
}

function getAssignmentUserLabel(user) {
  return `${user.displayName || "TRRY teammate"}${user.isActive === false ? " (inactive)" : ""} - ${formatAdminRole(user.role || "staff")}`;
}

function formatSourceReference(task) {
  const base = formatSourceType(task.sourceType);
  if (!task.sourceRecordType || !task.sourceRecordId) return base;
  return `${base} / ${task.sourceRecordType}:${task.sourceRecordId}`;
}

function formatTaskTimeSummary(task) {
  if (task.timeTrackingMode === "NONE") return "Time not required";
  if (task.openTimeEntry) return formatElapsed(getRunningElapsedSeconds(task));
  return formatDuration(task.totalClosedDurationSeconds);
}

function toLocalDatetimeInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalDatetimeInput(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function readWorkboardDraftForm() {
  workboardDraftForm = {
    title: document.getElementById("workboard-title")?.value || "",
    brief: document.getElementById("workboard-brief")?.value || "",
    sourceType: document.getElementById("workboard-source-type")?.value || "MANUAL",
    sourceRecordType: document.getElementById("workboard-source-record-type")?.value || "",
    sourceRecordId: document.getElementById("workboard-source-record-id")?.value || "",
    priority: document.getElementById("workboard-priority")?.value || "MEDIUM",
    assignedUserId: document.getElementById("workboard-assigned")?.value || "",
    reviewerUserId: document.getElementById("workboard-reviewer")?.value || "",
    timeTrackingMode: document.getElementById("workboard-time-mode")?.value || "EXPECTED",
    draftApprovalRequired: document.getElementById("workboard-draft-approval")?.checked === true,
    scheduledDate: document.getElementById("workboard-scheduled")?.value || "",
    startDeadline: document.getElementById("workboard-start-deadline")?.value || "",
    submissionDeadline: document.getElementById("workboard-submission-deadline")?.value || "",
    approvalDeadline: document.getElementById("workboard-approval-deadline")?.value || "",
  };
}

function buildWorkboardDraftPayload(task = null) {
  readWorkboardDraftForm();
  const sourceRecordType = workboardDraftForm.sourceRecordType.trim();
  const sourceRecordId = workboardDraftForm.sourceRecordId.trim();
  return {
    ...(task ? { expectedVersion: task.version } : {}),
    title: workboardDraftForm.title.trim(),
    brief: workboardDraftForm.brief.trim(),
    sourceType: workboardDraftForm.sourceType,
    sourceRecordType: sourceRecordType || null,
    sourceRecordId: sourceRecordId || null,
    priority: workboardDraftForm.priority,
    assignedUserId: workboardDraftForm.assignedUserId || null,
    reviewerUserId: workboardDraftForm.reviewerUserId || null,
    timeTrackingMode: workboardDraftForm.timeTrackingMode,
    draftApprovalRequired: workboardDraftForm.draftApprovalRequired,
    scheduledDate: workboardDraftForm.scheduledDate || null,
    startDeadline: fromLocalDatetimeInput(workboardDraftForm.startDeadline),
    submissionDeadline: fromLocalDatetimeInput(workboardDraftForm.submissionDeadline),
    approvalDeadline: fromLocalDatetimeInput(workboardDraftForm.approvalDeadline),
  };
}

async function openWorkboardTask(taskId) {
  selectedTaskId = taskId;
  selectedTaskDetail = null;
  taskDetailLoadState = "loading";
  taskDetailLoadError = "";
  workboardDrawerMode = "detail";
  workboardCommandError = "";
  workboardReviewNote = "";
  workboardReason = "";
  render();
  try {
    selectedTaskDetail = await getTaskDetail(taskId, adminAuthSession);
    taskDetailLoadState = "ready";
    workboardTasks = sortMyTasks(workboardTasks.map((item) => item.id === selectedTaskDetail.task.id ? selectedTaskDetail.task : item));
    syncMyTasksTimerTick();
  } catch (error) {
    taskDetailLoadState = "error";
    taskDetailLoadError = getTaskErrorMessage(error);
  }
  render();
}

function openWorkboardCreate() {
  selectedTaskId = null;
  selectedTaskDetail = null;
  workboardDrawerMode = "create";
  workboardDraftForm = createEmptyWorkboardDraft();
  workboardCommandError = "";
  render();
}

function openWorkboardEditDraft(taskId) {
  const task = selectedTaskDetail?.task?.id === taskId ? selectedTaskDetail.task : workboardTasks.find((item) => item.id === taskId);
  if (!task) return;
  selectedTaskId = taskId;
  workboardDrawerMode = "edit";
  workboardDraftForm = createEmptyWorkboardDraft(task);
  workboardCommandError = "";
  render();
}

function closeWorkboardDrawer() {
  workboardDrawerMode = "closed";
  selectedTaskId = null;
  selectedTaskDetail = null;
  taskDetailLoadState = "idle";
  taskDetailLoadError = "";
  workboardCommandError = "";
  workboardReviewNote = "";
  workboardReason = "";
  render();
}

async function saveWorkboardDraft() {
  if (workboardCommandState === "saving") return;
  const existing = workboardDrawerMode === "edit" ? selectedTaskDetail?.task || workboardTasks.find((item) => item.id === selectedTaskId) : null;
  const payload = buildWorkboardDraftPayload(existing);
  workboardCommandState = "saving";
  workboardCommandError = "";
  render();
  try {
    const response = existing
      ? await updateTaskDraft(existing.id, payload, adminAuthSession, createIdempotencyKey("draft"))
      : await createTaskDraft(payload, adminAuthSession, createIdempotencyKey("create"));
    applyTaskCommandResponse(response);
    workboardDrawerMode = "detail";
    await loadWorkboardTasks({ silent: true });
  } catch (error) {
    workboardCommandError = getTaskErrorMessage(error);
    if (error.code === "VERSION_CONFLICT" && existing?.id) await refreshTaskAfterConflict(existing.id);
  } finally {
    workboardCommandState = "idle";
    render();
  }
}

async function runWorkboardCommand(taskId, action) {
  if (workboardCommandState === "saving") return;
  const task = selectedTaskDetail?.task?.id === taskId ? selectedTaskDetail.task : workboardTasks.find((item) => item.id === taskId);
  if (!task) return;
  workboardReviewNote = document.getElementById("workboard-review-note")?.value || workboardReviewNote;
  workboardReason = document.getElementById("workboard-reason")?.value || workboardReason;
  workboardCommandState = "saving";
  workboardCommandError = "";
  render();
  try {
    const version = task.version;
    let response;
    if (action === "assign") response = await assignTask(taskId, { expectedVersion: version, assignedUserId: document.getElementById("workboard-assign-user")?.value || null }, adminAuthSession, createIdempotencyKey("assign"));
    if (action === "approve-draft") response = await approveTaskDraft(taskId, version, adminAuthSession, createIdempotencyKey("approve-draft"));
    if (action === "request-revision") response = await requestTaskRevision(taskId, { expectedVersion: version, reviewNote: workboardReviewNote.trim() }, adminAuthSession, createIdempotencyKey("revision-request"));
    if (action === "approve-work") response = await approveTaskWork(taskId, { expectedVersion: version, reviewNote: workboardReviewNote.trim() || null }, adminAuthSession, createIdempotencyKey("approve-work"));
    if (action === "cancel") response = await cancelTask(taskId, { expectedVersion: version, reason: workboardReason.trim() }, adminAuthSession, createIdempotencyKey("cancel"));
    if (action === "reopen") response = await reopenTask(taskId, { expectedVersion: version, reason: workboardReason.trim() }, adminAuthSession, createIdempotencyKey("reopen"));
    if (action === "archive") response = await archiveTask(taskId, version, adminAuthSession, createIdempotencyKey("archive"));
    applyTaskCommandResponse(response);
    await loadWorkboardTasks({ silent: true });
  } catch (error) {
    workboardCommandError = getTaskErrorMessage(error);
    if (["VERSION_CONFLICT", "TIMER_ALREADY_OPEN", "INVALID_TRANSITION"].includes(error.code)) await refreshTaskAfterConflict(taskId);
  } finally {
    workboardCommandState = "idle";
    render();
  }
}
function renderMyTasksPage() {
  if (!canViewMyTasksRoute()) {
    return `<section class="mvp-page my-tasks-page"><div class="mvp-page-title"><div><span>HOME / MY TASKS</span><h1>My Tasks</h1><p>Task execution is not enabled in this environment.</p></div></div></section>`;
  }

  const runningTask = getRunningTask();
  const visibleTasks = getVisibleMyTasks();
  const groups = getMyTaskGroups(visibleTasks);
  return `
    <section class="mvp-page my-tasks-page">
      <div class="mvp-page-title">
        <div><span>HOME / MY TASKS</span><h1>My Tasks</h1><p>Your assigned execution queue, review submissions, and task timing.</p></div>
        <label class="my-tasks-search">${renderIcon("search", "search-icon")}<input id="my-tasks-search" value="${escapeHtml(myTasksSearch)}" placeholder="Search task title or code..." type="search" /></label>
      </div>
      ${renderMyTasksStateNotice()}
      ${runningTask ? renderRunningTaskPin(runningTask) : ""}
      ${renderMyTasksSnapshot()}
      ${renderMyTasksFilters()}
      ${myTasksLoadState === "loading" ? `<div class="my-tasks-empty"><strong>Loading assigned tasks</strong><span>Checking your task queue.</span></div>` : ""}
      ${myTasksLoadState === "ready" ? renderMyTaskGroups(groups, visibleTasks) : ""}
      ${renderTaskDrawer()}
    </section>`;
}

function getVisibleMyTasks() {
  const normalized = myTasksSearch.trim().toLowerCase();
  return myTasks.filter((task) => {
    if (task.status === "DRAFT") return false;
    if (myTasksFilter === "active" && ["DONE", "CANCELLED"].includes(task.status)) return false;
    if (myTasksFilter === "to_do" && task.status !== "TO_DO") return false;
    if (myTasksFilter === "in_progress" && task.status !== "IN_PROGRESS") return false;
    if (myTasksFilter === "needs_revision" && task.status !== "NEEDS_REVISION") return false;
    if (myTasksFilter === "for_review" && task.status !== "FOR_REVIEW") return false;
    if (myTasksFilter === "completed" && task.status !== "DONE") return false;
    if (!normalized) return true;
    return [task.taskCode, task.title, task.sourceType, task.priority, task.status].join(" ").toLowerCase().includes(normalized);
  });
}

function renderMyTasksStateNotice() {
  if (myTasksLoadState === "error") return `<div class="ops-persistence-card error"><strong>Unable to load My Tasks</strong><span>${escapeHtml(myTasksLoadError)}</span></div>`;
  if (myTasksLoadState === "forbidden") return `<div class="ops-persistence-card error"><strong>Task access is restricted</strong><span>${escapeHtml(myTasksLoadError || "Your account cannot view task records.")}</span></div>`;
  if (myTasksLoadState === "feature-disabled") return `<div class="ops-persistence-card"><strong>My Tasks unavailable</strong><span>The task domain is disabled for this environment.</span></div>`;
  if (taskCommandError) return `<div class="ops-persistence-card error"><strong>Task action needs attention</strong><span>${escapeHtml(taskCommandError)}</span></div>`;
  return "";
}

function renderMyTasksSnapshot() {
  const counts = {
    due: myTasks.filter((task) => isTaskDueToday(task)).length,
    inProgress: myTasks.filter((task) => task.status === "IN_PROGRESS").length,
    revision: myTasks.filter((task) => task.status === "NEEDS_REVISION").length,
    review: myTasks.filter((task) => task.status === "FOR_REVIEW").length,
  };
  return `<div class="my-tasks-snapshot">
    ${renderMyTaskMetric("Due Today", counts.due, "Deadline today")}
    ${renderMyTaskMetric("In Progress", counts.inProgress, "Being worked on")}
    ${renderMyTaskMetric("Needs Revision", counts.revision, "Returned by reviewer")}
    ${renderMyTaskMetric("For Review", counts.review, "With reviewer")}
  </div>`;
}

function renderMyTaskMetric(label, value, note) {
  return `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`;
}

function renderRunningTaskPin(task) {
  return `<section class="my-tasks-running-pin"><div><span>RUNNING</span><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.taskCode)} / ${escapeHtml(formatElapsed(getRunningElapsedSeconds(task)))}</small></div><button class="ops-gold-button mini" data-task-open="${escapeHtml(task.id)}" type="button">OPEN TASK</button></section>`;
}

function renderMyTasksFilters() {
  const filters = [
    ["active", "Active"],
    ["to_do", "To Do"],
    ["in_progress", "In Progress"],
    ["needs_revision", "Needs Revision"],
    ["for_review", "For Review"],
    ["completed", "Completed"],
  ];
  return `<div class="my-tasks-filters">${filters.map(([value, label]) => `<button class="${myTasksFilter === value ? "active" : ""}" data-my-tasks-filter="${value}" type="button">${escapeHtml(label)}</button>`).join("")}</div>`;
}

function getMyTaskGroups(tasks) {
  return [
    ["IN_PROGRESS", "In Progress"],
    ["NEEDS_REVISION", "Needs Revision"],
    ["TO_DO", "To Do"],
    ["FOR_REVIEW", "For Review"],
    ["DONE", "Completed"],
  ].map(([status, label]) => [label, tasks.filter((task) => task.status === status)]).filter(([, items]) => items.length);
}

function renderMyTaskGroups(groups, visibleTasks) {
  if (!visibleTasks.length) return `<div class="my-tasks-empty"><strong>${myTasks.length ? "No tasks match your filters" : "No assigned tasks"}</strong><span>${myTasks.length ? "Try another status or search term." : "Your assigned queue is clear."}</span>${myTasks.length ? `<button data-my-tasks-clear type="button">CLEAR FILTERS</button>` : ""}</div>`;
  return `<div class="my-tasks-groups">${groups.map(([label, tasks]) => `<section class="my-task-group"><h2>${escapeHtml(label)} <span>${tasks.length}</span></h2><div class="my-task-list">${tasks.map(renderMyTaskCard).join("")}</div></section>`).join("")}</div>`;
}

function renderMyTaskCard(task) {
  const action = getPrimaryTaskAction(task);
  return `<article class="my-task-card ${task.openTimeEntry ? "running" : ""} ${isTaskOverdue(task) ? "overdue" : ""}">
    <button class="my-task-card-main" data-task-open="${escapeHtml(task.id)}" type="button">
      <span class="my-task-code">${escapeHtml(task.taskCode || "TASK")}</span>
      <strong>${escapeHtml(task.title || "Untitled task")}</strong>
      <small>${escapeHtml(formatSourceType(task.sourceType))} / ${escapeHtml(getUserLabel(task.assignedUser))}</small>
    </button>
    <div class="my-task-card-meta">
      ${renderTaskPriority(task.priority)}
      ${renderTaskStatus(task.status)}
      <span>${escapeHtml(formatTaskDue(task))}</span>
      <span>${escapeHtml(task.openTimeEntry ? formatElapsed(getRunningElapsedSeconds(task)) : formatDuration(task.totalClosedDurationSeconds))}</span>
    </div>
    <div class="my-task-card-actions">${action ? renderTaskQuickAction(task, action) : `<button data-task-open="${escapeHtml(task.id)}" type="button">OPEN</button>`}</div>
  </article>`;
}

function getPrimaryTaskAction(task) {
  const actions = task.allowedActions || [];
  if (actions.includes("START_WORK")) return "START_WORK";
  if (actions.includes("START_REVISION")) return "START_REVISION";
  if (actions.includes("SUBMIT_FOR_REVIEW")) return "SUBMIT_FOR_REVIEW";
  if (actions.includes("SUBMIT_WITHOUT_RECORDED_TIME")) return "OPEN_FALLBACK";
  return "";
}

function renderTaskQuickAction(task, action) {
  if (action === "START_WORK") return `<button class="primary" data-task-start="${escapeHtml(task.id)}" type="button">START WORK</button>`;
  if (action === "START_REVISION") return `<button class="primary" data-task-start-revision="${escapeHtml(task.id)}" type="button">START REVISION</button>`;
  if (action === "SUBMIT_FOR_REVIEW") return `<button data-task-open="${escapeHtml(task.id)}" type="button">SUBMIT</button>`;
  return `<button data-task-open="${escapeHtml(task.id)}" type="button">OPEN</button>`;
}

function renderTaskDrawer() {
  if (taskDrawerState === "closed") return "";
  const detail = selectedTaskDetail;
  const task = detail?.task || myTasks.find((item) => item.id === selectedTaskId) || null;
  return `<div class="my-task-drawer-backdrop" data-task-close></div><aside class="my-task-drawer" aria-label="Task details">
    <header><div><span>${escapeHtml(task?.taskCode || "TASK")}</span><h2>${escapeHtml(task?.title || "Loading task")}</h2></div><button data-task-close type="button" aria-label="Close task details">X</button></header>
    ${taskDetailLoadState === "loading" ? `<div class="my-tasks-empty"><strong>Loading task detail</strong><span>Fetching canonical task state.</span></div>` : ""}
    ${taskDetailLoadError ? `<div class="ops-persistence-card error"><strong>Unable to open task</strong><span>${escapeHtml(taskDetailLoadError)}</span></div>` : ""}
    ${detail ? renderTaskDetailBody(detail) : ""}
  </aside>`;
}

function renderTaskDetailBody(detail) {
  const task = detail.task;
  const latestSubmission = (detail.submissions || []).at(-1) || null;
  const latestRevision = [...(detail.submissions || [])].reverse().find((submission) => submission.reviewDecision === "REVISION_REQUESTED" && submission.reviewNote);
  return `<div class="my-task-drawer-content">
    <section class="my-task-detail-hero">
      <div>${renderTaskStatus(task.status)}${renderTaskPriority(task.priority)}${task.timeTrackingMode === "NONE" ? `<span class="my-task-mode">TIME NOT REQUIRED</span>` : ""}</div>
      <p>${escapeHtml(task.brief || "No brief provided.")}</p>
      ${task.openTimeEntry ? `<strong class="my-task-running-time">${escapeHtml(formatElapsed(getRunningElapsedSeconds(task)))}</strong>` : ""}
    </section>
    ${latestRevision ? `<section class="my-task-warning"><strong>REVISION NOTE</strong><p>${escapeHtml(latestRevision.reviewNote)}</p></section>` : ""}
    <section class="my-task-detail-grid">
      ${renderTaskFact("Source", formatSourceType(task.sourceType))}
      ${renderTaskFact("Scheduled", formatTaskDate(task.scheduledDate))}
      ${renderTaskFact("Deadline", formatTaskDateTime(task.submissionDeadline))}
      ${renderTaskFact("Assigned", getUserLabel(task.assignedUser))}
      ${renderTaskFact("Reviewer", getUserLabel(task.reviewerUser))}
      ${renderTaskFact("Recorded Time", task.openTimeEntry ? formatElapsed(getRunningElapsedSeconds(task)) : formatDuration(task.totalClosedDurationSeconds))}
    </section>
    ${renderTaskSubmissions(detail.submissions || [])}
    ${renderTaskActionArea(task, latestSubmission)}
  </div>`;
}

function renderTaskFact(label, value) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "-")}</strong></div>`;
}

function renderTaskSubmissions(submissions) {
  if (!submissions.length) return `<section class="my-task-history"><h3>Submission History</h3><p>No submissions yet.</p></section>`;
  return `<section class="my-task-history"><h3>Submission History</h3>${submissions.map((submission) => `<article class="${submission.timeRecordingStatus === "NOT_RECORDED" ? "no-time" : ""}"><div><strong>${escapeHtml(formatSubmissionTimeStatus(submission))}</strong><span>${escapeHtml(formatTaskDateTime(submission.submittedAt))}</span></div><p>${escapeHtml(submission.submissionNote || "No note saved.")}</p>${submission.noTimeReason ? `<p><b>Reason:</b> ${escapeHtml(submission.noTimeReason)}</p>` : ""}<small>Submitted by ${escapeHtml(getUserLabel(submission.submittedByUser))}${submission.recordedDurationSeconds !== null ? ` / ${escapeHtml(formatDuration(submission.recordedDurationSeconds))}` : ""}</small>${submission.reviewNote ? `<p><b>Review:</b> ${escapeHtml(submission.reviewNote)}</p>` : ""}</article>`).join("")}</section>`;
}

function renderTaskActionArea(task) {
  const actions = task.allowedActions || [];
  const busy = taskCommandState === "saving";
  if (!actions.length) return `<section class="my-task-action-area"><strong>No available staff action</strong><span>This task is waiting on another step.</span></section>`;
  return `<section class="my-task-action-area">
    ${taskCommandError ? `<p class="my-task-form-error" role="alert">${escapeHtml(taskCommandError)}</p>` : ""}
    ${actions.includes("SUBMIT_FOR_REVIEW") || actions.includes("SUBMIT_WITHOUT_RECORDED_TIME") ? renderTaskSubmitFields(busy) : ""}
    <div class="my-task-action-buttons">
      ${actions.includes("START_WORK") ? `<button class="primary" data-task-start="${escapeHtml(task.id)}" ${busy ? "disabled" : ""} type="button">${busy ? "STARTING..." : "START WORK"}</button>` : ""}
      ${actions.includes("START_REVISION") ? `<button class="primary" data-task-start-revision="${escapeHtml(task.id)}" ${busy ? "disabled" : ""} type="button">${busy ? "STARTING..." : "START REVISION"}</button>` : ""}
      ${actions.includes("SUBMIT_FOR_REVIEW") ? `<button class="dark" data-task-submit="${escapeHtml(task.id)}" ${busy ? "disabled" : ""} type="button">${busy ? "SUBMITTING..." : "SUBMIT FOR REVIEW"}</button>` : ""}
      ${actions.includes("SUBMIT_WITHOUT_RECORDED_TIME") ? `<button data-task-open-fallback="${escapeHtml(task.id)}" ${busy ? "disabled" : ""} type="button">SUBMIT WITHOUT RECORDED TIME</button>` : ""}
    </div>
    ${taskFallbackOpen ? renderNoTimeFallback(task, busy) : ""}
  </section>`;
}

function renderTaskSubmitFields(disabled) {
  return `<div class="my-task-submit-fields"><label><span>Submission note</span><textarea id="task-submission-note" rows="3" ${disabled ? "disabled" : ""}>${escapeHtml(taskSubmissionNote)}</textarea></label><label><span>Proof URL optional</span><input id="task-proof-url" value="${escapeHtml(taskProofUrl)}" placeholder="https://..." ${disabled ? "disabled" : ""} /></label></div>`;
}

function renderNoTimeFallback(task, busy) {
  return `<div class="my-task-no-time-dialog" role="alertdialog" aria-label="No work time recorded"><strong>NO WORK TIME RECORDED</strong><p>Did you forget to start the task timer?</p><label><span>Reason required</span><textarea id="task-no-time-reason" rows="3" ${busy ? "disabled" : ""} placeholder="Forgot to start timer">${escapeHtml(taskNoTimeReason)}</textarea></label><small>Examples: Forgot to start timer / Task was already completed before opening the portal / Quick task completed immediately</small><div><button class="primary" data-task-start="${escapeHtml(task.id)}" ${busy ? "disabled" : ""} type="button">START WORK NOW</button><button class="dark" data-task-submit-no-time="${escapeHtml(task.id)}" ${busy ? "disabled" : ""} type="button">SUBMIT WITHOUT RECORDED TIME</button><button data-task-cancel-fallback type="button">CANCEL</button></div></div>`;
}

function renderTaskStatus(status) {
  return `<span class="my-task-status ${statusToClass(status || "unknown")}">${escapeHtml(formatTaskStatus(status))}</span>`;
}

function renderTaskPriority(priority) {
  return `<span class="my-task-priority ${statusToClass(priority || "normal")}">${escapeHtml(formatTaskPriority(priority))}</span>`;
}

function formatTaskStatus(status) {
  return String(status || "UNKNOWN").replace(/_/g, " ");
}

function formatTaskPriority(priority) {
  return String(priority || "normal").replace(/_/g, " ").toUpperCase();
}

function formatSourceType(sourceType) {
  return String(sourceType || "TASK").replace(/_/g, " ").toUpperCase();
}

function getUserLabel(user) {
  if (!user) return "Unassigned";
  return `${user.displayName || "TRRY teammate"}${user.isActive === false ? " (inactive)" : ""}`;
}

function formatTaskDue(task) {
  if (isTaskOverdue(task)) return "Overdue";
  if (isTaskDueToday(task)) return "Due today";
  return formatTaskDate(task.submissionDeadline || task.scheduledDate);
}

function formatTaskDate(value) {
  if (!value) return "No date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "No date" : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTaskDateTime(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not set" : date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatDuration(seconds) {
  const value = Number(seconds || 0);
  if (!value) return "No recorded time";
  return formatElapsed(value);
}

function formatElapsed(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds || 0)));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  return hours ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes}m ${String(secs).padStart(2, "0")}s`;
}

function getRunningElapsedSeconds(task) {
  const start = Date.parse(task?.openTimeEntry?.startedAt || "");
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Math.floor((myTasksClock - start) / 1000));
}

function formatSubmissionTimeStatus(submission) {
  if (submission.timeRecordingStatus === "NOT_RECORDED") return "TIME NOT RECORDED";
  if (submission.timeRecordingStatus === "NOT_REQUIRED") return "TIME NOT REQUIRED";
  return "RECORDED TIME";
}

async function openTaskDetail(taskId) {
  selectedTaskId = taskId;
  taskDrawerState = "open";
  taskDetailLoadState = "loading";
  taskDetailLoadError = "";
  taskCommandError = "";
  taskFallbackOpen = false;
  selectedTaskDetail = null;
  render();
  try {
    selectedTaskDetail = await getTaskDetail(taskId, adminAuthSession);
    taskDetailLoadState = "ready";
    seedTaskFormFromDetail(selectedTaskDetail);
    syncMyTasksTimerTick();
  } catch (error) {
    taskDetailLoadState = "error";
    taskDetailLoadError = getTaskErrorMessage(error);
  }
  render();
}

function seedTaskFormFromDetail(detail) {
  taskSubmissionNote = "";
  taskProofUrl = "";
  taskNoTimeReason = "";
  taskFallbackOpen = false;
  const task = detail?.task;
  myTasks = sortMyTasks(myTasks.map((item) => item.id === task?.id ? task : item));
}

function closeTaskDetail() {
  selectedTaskId = null;
  selectedTaskDetail = null;
  taskDrawerState = "closed";
  taskDetailLoadState = "idle";
  taskDetailLoadError = "";
  taskCommandError = "";
  taskFallbackOpen = false;
  render();
}

async function runTaskCommand(taskId, action) {
  if (taskCommandState === "saving") return;
  const task = selectedTaskDetail?.task?.id === taskId ? selectedTaskDetail.task : myTasks.find((item) => item.id === taskId);
  if (!task) return;
  taskCommandState = "saving";
  taskCommandError = "";
  render();
  try {
    const version = task.version;
    let response;
    if (action === "start") response = await startTaskWork(taskId, version, adminAuthSession, createIdempotencyKey("start"));
    if (action === "start-revision") response = await startTaskRevision(taskId, version, adminAuthSession, createIdempotencyKey("revision"));
    if (action === "submit") response = await submitTaskForReview(taskId, { expectedVersion: version, submissionNote: taskSubmissionNote.trim(), proofUrl: taskProofUrl.trim() }, adminAuthSession, createIdempotencyKey("submit"));
    if (action === "submit-no-time") response = await submitTaskWithoutRecordedTime(taskId, { expectedVersion: version, note: taskSubmissionNote.trim(), reason: taskNoTimeReason.trim() }, adminAuthSession, createIdempotencyKey("notime"));
    applyTaskCommandResponse(response);
  } catch (error) {
    taskCommandError = getTaskErrorMessage(error);
    if (["VERSION_CONFLICT", "TIMER_ALREADY_OPEN", "INVALID_TRANSITION"].includes(error.code)) await refreshTaskAfterConflict(taskId);
  } finally {
    taskCommandState = "idle";
    render();
  }
}

function applyTaskCommandResponse(response) {
  if (!response?.task) return;
  selectedTaskDetail = {
    task: response.task,
    submissions: response.submissions || (response.submission ? [response.submission] : selectedTaskDetail?.submissions || []),
    timeEntries: response.timeEntries || selectedTaskDetail?.timeEntries || [],
    history: response.history || selectedTaskDetail?.history || [],
  };
  myTasks = sortMyTasks(upsertTaskRecord(myTasks, response.task));
  workboardTasks = sortMyTasks(upsertTaskRecord(workboardTasks, response.task));
  taskFallbackOpen = false;
  taskSubmissionNote = "";
  taskProofUrl = "";
  taskNoTimeReason = "";
  syncMyTasksTimerTick();
}

function upsertTaskRecord(tasks, task) {
  const found = tasks.some((item) => item.id === task.id);
  return found ? tasks.map((item) => item.id === task.id ? task : item) : [task, ...tasks];
}

async function refreshTaskAfterConflict(taskId) {
  try {
    const detail = await getTaskDetail(taskId, adminAuthSession);
    selectedTaskDetail = detail;
    myTasks = sortMyTasks(upsertTaskRecord(myTasks, detail.task));
    workboardTasks = sortMyTasks(upsertTaskRecord(workboardTasks, detail.task));
  } catch {
    await loadMyTasks({ silent: true });
  }
}

function getTaskErrorMessage(error) {
  if (error?.code === "VERSION_CONFLICT") return "This task changed in another session. The latest task state has been refreshed.";
  if (error?.code === "TIMER_ALREADY_OPEN") return "Another task timer is already running. Open the running task before starting a new one.";
  if (error?.code === "VALIDATION_ERROR") return error.message || "Check the task form and try again.";
  if (error?.code === "TIMER_REQUIRED") return "Start Work is required before timed submission.";
  if (error?.code === "ACCOUNT_INACTIVE") return "This account is inactive and cannot perform task actions.";
  return error?.message || "Task request failed.";
}

function validateTaskSubmit(action) {
  taskSubmissionNote = document.getElementById("task-submission-note")?.value || taskSubmissionNote;
  taskProofUrl = document.getElementById("task-proof-url")?.value || taskProofUrl;
  taskNoTimeReason = document.getElementById("task-no-time-reason")?.value || taskNoTimeReason;
  if (["submit", "submit-no-time"].includes(action) && !taskSubmissionNote.trim()) {
    taskCommandError = "Submission note is required.";
    render();
    return false;
  }
  if (action === "submit" && taskProofUrl.trim() && !/^https:\/\//i.test(taskProofUrl.trim())) {
    taskCommandError = "Proof URL must start with https://.";
    render();
    return false;
  }
  if (action === "submit-no-time" && !taskNoTimeReason.trim()) {
    taskCommandError = "Reason is required when time was not recorded.";
    render();
    return false;
  }
  return true;
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
    renderArtwork: renderMvpArtworkAction,
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
    .forEach((item) => addInquiry(item, "New Inquiry", "new", `${item.customer} - prepare quotation`));

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
  return `<div class="ops-review-box"><p class="ops-review-label">Review before saving - edit anything AI got wrong</p><div class="ops-review-grid">${simpleFields.map(([key, label]) => renderOpsInput(key, label, fields[key])).join("")}${renderOpsServiceTypeSelect(fields.serviceType)}<label><span>Source</span><select data-ops-field="source">${Object.keys(opsSource).map((source) => `<option value="${source}" ${source === fields.source ? "selected" : ""}>${source}</option>`).join("")}</select></label><label><span>Suggested Status</span><select data-ops-field="suggestedStatus">${["New / Inquiry Received", "Quote Sent", "Follow Up"].map((status) => `<option value="${status}" ${status === fields.suggestedStatus ? "selected" : ""}>${status}</option>`).join("")}</select></label></div><div class="ops-review-stack">${textFields.map(([key, label, rows]) => renderOpsTextarea(key, label, fields[key], rows)).join("")}</div><div class="ops-action-row"><button class="ops-gold-button" id="ops-save-inquiry" type="button">Save Inquiry</button><button class="ops-light-button" id="ops-clear-inquiry" type="button">Clear</button></div></div>`;
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
  return state.quote === "approved" && state.artwork === "approved" && !isOpsPaymentConfirmed(state.payment);
}


function isOpsPaymentConfirmed(value) {
  return ["confirmed", "paid", "full_payment_confirmed", "down_payment_confirmed", "partially_paid"].includes(String(value || "").trim().toLowerCase());
}

function getOpsPaymentTypeLabel(value) {
  const key = String(value || "").trim().toLowerCase();
  if (key === "down_payment") return "50% Down Payment";
  if (key === "full") return "Full Payment";
  if (key === "shop") return "Pay at Shop";
  return "Not selected";
}

function getOpsPaymentMethodLabel(value) {
  const key = String(value || "").trim().toLowerCase();
  if (key === "online") return "Pay Online";
  if (key === "cash") return "Cash at Shop";
  if (key === "gcash") return "GCash at Shop";
  if (key === "bank_transfer") return "Bank Transfer";
  if (key === "card") return "Card";
  if (key === "other") return "Other";
  return "Not selected";
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
  if (canOpsRequestPayment(item) && ["pay_at_shop", "payment_pending_at_shop"].includes(state.payment)) return { stage: "payment", text: "Confirm shop payment" };
  if (canOpsRequestPayment(item)) return { stage: "payment", text: "Request payment" };
  if (isOpsPaymentConfirmed(state.payment) && !item.odooSO) return { stage: "production", text: "Create Odoo Sales Order" };
  if (canEditOpsCustomerTracking(item)) return { stage: "fulfillment", text: "Update customer tracking" };
  return { stage: "inquiry", text: item.next || "Review inquiry" };
}

function getOpsInquiryStages(item) {
  const task = getOpsInquiryCurrentTask(item);
  const state = getOpsNormalizedCustomerState(item);
  const quoteComplete = ["ready", "approved"].includes(state.quote) || Boolean(item.quotePublishedAt);
  const artworkComplete = state.artwork === "approved";
  const paymentComplete = isOpsPaymentConfirmed(state.payment);
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

function renderMvpArtworkAction(item) {
  const status = String(item.artworkStatus || "").trim().toLowerCase();
  const artworkUrl = String(item.artworkUrl || "").trim();
  const hasArtwork = Boolean(artworkUrl) || ["submitted", "under_review", "approval_required", "approved", "revision_requested"].includes(status);
  const request = opsCustomerActionRequests[item.id] || {};
  const isLoading = request.status === "loading" && request.asset === "customer-artwork";
  const message = request.asset === "customer-artwork" && request.message
    ? `<p class="ops-artwork-message ${request.status === "error" ? "error" : ""}">${escapeHtml(request.message)}</p>`
    : "";

  if (!hasArtwork) {
    return `<span class="mvp-artwork-empty">No customer artwork file or supported URL is saved.</span>`;
  }

  return `<button class="ops-dark-button mini" data-ops-customer-asset="customer-artwork" data-ops-customer-id="${escapeHtml(item.id)}" type="button" ${isLoading ? "disabled" : ""}>${renderIcon("external-link", "ops-button-icon")}${isLoading ? "OPENING..." : "VIEW ARTWORK"}</button>${message}`;
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
    paid: "Fully Paid",
    full_payment_confirmed: "Full Payment Confirmed",
    down_payment_confirmed: "Down Payment Confirmed",
    partially_paid: "Partially Paid",
    pay_at_shop: "Pay at Shop",
    payment_pending_at_shop: "Pending at Shop",
    correction_required: "Correction Required",
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
  return `<details class="ops-quote-editor" ${open ? "open" : ""}><summary>${isOpsQuotePublished(item) ? "REVISE QUOTE" : "CREATE QUOTE"}</summary><div class="ops-customer-action-form ops-quote-form"><label><span>Quoted amount</span><input data-ops-customer-field="quotedAmount" inputmode="decimal" type="text" value="${escapeHtml(item.quotedAmount ?? "")}" /></label><label class="wide"><span>Price breakdown</span><textarea data-ops-customer-field="quoteBreakdown" rows="2">${escapeHtml(item.quoteBreakdown || "")}</textarea></label><label class="wide"><span>Quote notes</span><textarea data-ops-customer-field="quoteNotes" rows="2">${escapeHtml(item.quoteNotes || "")}</textarea></label><label><span>Valid until</span><input data-ops-customer-field="quoteValidUntil" type="date" value="${escapeHtml(item.quoteValidUntil || "")}" /></label></div><div class="ops-stage-actions ops-quote-actions"><button class="ops-move-button" data-ops-customer-action="save_quote_draft" data-ops-customer-id="${escapeHtml(item.id)}" type="button" ${isLoading ? "disabled" : ""}>SAVE DRAFT</button><button class="ops-gold-button mini" data-ops-customer-action="publish_quote" data-ops-customer-id="${escapeHtml(item.id)}" type="button" ${isLoading ? "disabled" : ""}>SEND QUOTE</button></div>${renderOpsMoreActions(overflowActions)}</details>`;
}

function shouldShowOpsQuoteArtworkNotice(item) {
  const status = String(item.artworkStatus || "missing").trim().toLowerCase();
  const artworkUrl = String(item.artworkUrl || "").trim();
  return !artworkUrl && ["", "missing", "not_set", "not set", "none", "null", "undefined"].includes(status);
}
function renderOpsQuoteStage(item) {
  const request = opsCustomerActionRequests[item.id] || {};
  const isLoading = request.status === "loading";
  const current = getOpsInquiryCurrentTask(item).stage === "quote";
  const status = item.quoteStatus || "pending";
  const quoteChange = item.quoteChangeRequest ? `<p class="ops-customer-action-alert"><strong>CUSTOMER REQUESTED QUOTE CHANGES</strong>${escapeHtml(item.quoteChangeRequest)}</p>` : "";
  let body = quoteChange;
  if (shouldShowOpsQuoteArtworkNotice(item)) {
    body += `<p class="ops-quote-info-note">No artwork attached yet. This quotation is based on the provided requirements and may be updated after artwork review.</p>`;
  }

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

  if (isOpsPaymentConfirmed(status)) {
    body += `<p class="ops-stage-complete">PAYMENT CONFIRMED &#10003; / ${formatOpsValue(item.paymentVerifiedAmount ?? item.paymentConfirmedAmount)}${item.paymentConfirmedAt ? ` / ${escapeHtml(formatOpsTrackingDate(item.paymentConfirmedAt))}` : ""}</p>`;
  } else if (!canOpsRequestPayment(item)) {
    body += `<p class="ops-stage-muted">Available after quote and artwork approval.</p>`;
  } else if (["pay_at_shop", "payment_pending_at_shop"].includes(status)) {
    body += `<div class="ops-stage-mini-grid"><div><span>Selected method</span><strong>${escapeHtml(getOpsPaymentMethodLabel(item.paymentMethod))}</strong></div><div><span>Customer status</span><strong>PAY AT SHOP</strong></div><div><span>Amount to collect</span><strong>${formatOpsValue(item.quotedAmount)}</strong></div></div><p class="ops-stage-muted"><strong>SHOP PAYMENT PENDING</strong>Confirm only after staff receives payment at the shop.</p><div class="ops-customer-action-form compact"><label><span>Cash amount received</span><input data-ops-customer-field="confirmedAmount" min="0" step="0.01" type="number" value="${escapeHtml(item.quotedAmount ?? item.amountDue ?? "")}" /></label></div><div class="ops-stage-actions">${renderOpsActionButton({ label: "CONFIRM CASH PAYMENT", action: "confirm_cash_payment", id: item.id, primary: true, disabled: isLoading })}</div>`;
  } else if (["required", "correction_required"].includes(status)) {
    body += `<div class="ops-stage-mini-grid"><div><span>Amount due</span><strong>${formatOpsValue(item.amountDue)}</strong></div><div><span>Current status</span><strong>PAYMENT REQUESTED</strong></div></div><p class="ops-stage-muted"><strong>${item.paymentRejectedAt ? "NEW RECEIPT NEEDED" : "PAYMENT REQUESTED"}</strong>Awaiting receipt.</p>`;
  } else if (["proof_submitted", "under_review"].includes(status)) {
    const receipt = item.paymentProofPath ? renderOpsAssetButton({ label: isReceiptLoading ? "LOADING..." : receiptUnavailable ? "TRY AGAIN" : "REVIEW RECEIPT", asset: "payment-proof", id: item.id, disabled: isReceiptLoading }) : `<span class="ops-customer-empty">No receipt uploaded.</span>`;
    const receiptPreview = receiptOpened ? `<figure class="ops-payment-receipt-preview"><img alt="Uploaded payment receipt for ${escapeHtml(item.id)}" src="${escapeHtml(request.signedUrl)}" /><figcaption>Receipt opened for ${escapeHtml(item.id)}</figcaption></figure>` : "";
    const receiptError = receiptUnavailable ? `<p class="ops-customer-action-message error">RECEIPT UNAVAILABLE</p>` : "";
    body += `<div class="ops-stage-mini-grid"><div><span>Inquiry reference</span><strong>${escapeHtml(item.id)}</strong></div><div><span>Selected amount</span><strong>${formatOpsValue(item.paymentSelectedAmount ?? item.amountDue)}</strong></div><div><span>Payment type</span><strong>${escapeHtml(getOpsPaymentTypeLabel(item.paymentType))}</strong></div><div><span>Reference</span><strong>${escapeHtml(item.paymentReference || "-")}</strong></div><div><span>Customer note</span><strong>${escapeHtml(item.paymentCustomerNote || "-")}</strong></div><div><span>Uploaded</span><strong>${escapeHtml(formatOpsTrackingDate(item.paymentProofSubmittedAt))}</strong></div><div><span>Receipt file</span><strong>${escapeHtml(item.paymentReceiptFilename || item.paymentProofPath || "-")}</strong></div></div><div class="ops-customer-action-form compact"><label><span>Confirmed amount</span><input data-ops-customer-field="confirmedAmount" min="0" step="0.01" type="number" value="${escapeHtml(item.paymentSelectedAmount ?? item.paymentConfirmedAmount ?? item.amountDue ?? "")}" /></label><label class="wide"><span>Reason for new receipt</span><textarea data-ops-customer-field="paymentReviewNote" rows="2">${escapeHtml(item.paymentReviewNote || "")}</textarea></label></div>${receiptPreview}${receiptError}<div class="ops-stage-actions">${receipt}${renderOpsActionButton({ label: "CONFIRM PAYMENT", action: "confirm_payment", id: item.id, primary: true, disabled: isLoading || !item.paymentProofPath })}${renderOpsActionButton({ label: "REQUEST NEW RECEIPT", action: "request_new_payment_proof", id: item.id, tone: "danger", disabled: isLoading })}</div>`;
  } else {
    body += `<div class="ops-stage-mini-grid"><div><span>Amount due</span><strong>${formatOpsValue(item.amountDue)}</strong></div></div><div class="ops-customer-action-form compact"><input data-ops-customer-field="confirmedAmount" type="hidden" value="${escapeHtml(item.paymentSelectedAmount ?? item.paymentConfirmedAmount ?? item.amountDue ?? "")}" /><label class="wide"><span>Payment instructions</span><textarea data-ops-customer-field="paymentInstructions" rows="2">${escapeHtml(item.paymentInstructions || "")}</textarea></label></div><div class="ops-stage-actions">${renderOpsActionButton({ label: "REQUEST PAYMENT", action: "require_payment", id: item.id, primary: true, disabled: isLoading || ["required", "correction_required", "proof_submitted", "under_review", "pay_at_shop", "payment_pending_at_shop", "confirmed", "paid", "full_payment_confirmed", "down_payment_confirmed", "partially_paid"].includes(status) })}</div>`;
  }

  if (item.paymentRejectedAt) body += `<p class="ops-customer-action-alert"><strong>NEW RECEIPT NEEDED</strong>${escapeHtml(item.paymentReviewNote || "Replacement receipt requested.")}<small>${escapeHtml(formatOpsTrackingDate(item.paymentRejectedAt))}</small></p>`;

  return renderOpsStageShell({ key: "payment", title: "Payment", status: getOpsCustomerActionLabel("payment", status), current, locked: !canOpsRequestPayment(item) && !isOpsPaymentConfirmed(status), body });
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

  const quotedAmount = fieldValue("quotedAmount");
  const quoteAction = ["publish_quote", "save_quote_draft", "revise_quote", "mark_quote_pending"].includes(action);

  return {
    action,
    quotedAmount,
    amountDue: quoteAction ? quotedAmount : fieldValue("amountDue"),
    quoteBreakdown: fieldValue("quoteBreakdown"),
    quoteNotes: fieldValue("quoteNotes"),
    quoteValidUntil: fieldValue("quoteValidUntil"),
    paymentLabel: quoteAction ? "" : fieldValue("paymentLabel"),
    paymentInstructions: quoteAction ? "" : fieldValue("paymentInstructions"),
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
  if (action === "publish_quote") return "SENDING...";
  if (action === "require_payment") return "REQUESTING...";
  if (action === "confirm_payment" || action === "confirm_cash_payment") return "CONFIRMING...";
  if (action === "request_new_payment_proof") return "REQUESTING...";
  return "SAVING...";
}

function getOpsActionSavingMessage(action) {
  if (action === "publish_quote") return "SENDING QUOTE...";
  if (action === "require_payment") return "REQUESTING PAYMENT...";
  if (action === "confirm_payment" || action === "confirm_cash_payment") return "CONFIRMING PAYMENT...";
  if (action === "request_new_payment_proof") return "REQUESTING NEW RECEIPT...";
  return "SAVING CUSTOMER ACTION...";
}

function getOpsActionSuccessMessage(action) {
  if (action === "save_quote_draft") return "QUOTE DRAFT SAVED.";
  if (action === "publish_quote") return "QUOTE PUBLISHED FOR CUSTOMER.";
  if (action === "require_payment") return "PAYMENT REQUESTED.";
  if (action === "confirm_payment" || action === "confirm_cash_payment") return "PAYMENT CONFIRMED.";
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
    const payload = await requestOpsCustomerAction(inquiryId, body);
    if (payload?.inquiry) {
      opsInquiries = opsInquiries.map((item) => item.id === inquiryId ? { ...item, ...payload.inquiry } : item);
    }
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
      { to: "new", label: "New Inquiry", next: "Prepare quote and confirm requirements" },
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
      { to: "new", label: "Back to New Inquiry", next: "Prepare quote after follow-up" },
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
      opsSoSavingId = null;
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
    const isSaving = opsSoSavingId === item.id;
    return `<div class="ops-so-editor ops-order-confirm-card"><strong>CREATE CONFIRMED ORDER?</strong><p>This approved inquiry will be added to Orders.</p><div><button class="ops-gold-button mini" data-ops-confirm-so="${item.id}" type="button" ${isSaving ? "disabled" : ""}>${isSaving ? "CREATING..." : "CONFIRM &amp; CREATE ORDER"}</button><button class="ops-light-button mini" data-ops-cancel-so="${item.id}" type="button" ${isSaving ? "disabled" : ""}>CANCEL</button></div></div>`;
  }
  return `<button class="ops-add-so-button" data-ops-add-so="${item.id}" type="button">CREATE ORDER</button>`;
}

function createConfirmedOrderReference(item) {
  return String(item.odooSO || item.orderCode || item.orderReference || item.reference || item.id || "").trim();
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
  return { ...emptyOpsExtract, serviceType, quantity, summary: text.trim().slice(0, 90) + (text.trim().length > 90 ? "..." : ""), missingDetails: missing.join(", "), suggestedStatus: missing.length > 2 ? "Follow Up" : "New / Inquiry Received", nextAction: missing.length > 2 ? "Follow up for missing details" : "Prepare quote and confirm requirements", suggestedReply: "Salamat sa inquiry! Para ma-review namo ug tarong, pwede mangayo sa design file ug sizes? I-send ra diri." };
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
      opsSoSavingId = null;
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
  if (opsSoSavingId) return;
  const current = opsInquiries.find((item) => item.id === id);
  const so = current ? createConfirmedOrderReference(current) : "";
  if (!so || !current || String(current.quoteStatus || "").toLowerCase() !== "approved" || !(Number(current.quotedAmount) > 0)) return;
  opsSoSavingId = id;

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
      opsSoSavingId = null;
      return;
    }
  }

  if (!shouldLoadSupabaseOps) {
    opsInquiries = opsInquiries.map((item) => item.id === id ? { ...item, status: "won", odooSO: so, next: "Odoo Sales Order recorded" } : item);
  }
  opsSoDraft = null;
  opsSoSavingId = null;
  navigateTo(`/orders?order=${encodeURIComponent(id)}`);
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
async function requestInquiryFollowUpEvent(inquiryId, body) {
  const response = await fetch(`/api/inquiries/${encodeURIComponent(inquiryId)}/follow-ups`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(adminAuthSession?.access_token ? { Authorization: `Bearer ${adminAuthSession.access_token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Follow-up update failed.");
  return payload;
}function getAssignmentUserById(userId) {
  return assignmentUsers.find((user) => user.userId === userId) || null;
}

function formatAssignmentRole(role) {
  const value = String(role || "").trim().toLowerCase();
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Staff";
}

function formatAssignmentUser(user) {
  return user ? `${user.displayName || user.email} - ${formatAssignmentRole(user.role)}` : "";
}

function getLegacyAssignmentMatch(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return null;
  return assignmentUsers.find((user) => [user.displayName, user.email].some((candidate) => String(candidate || "").trim().toLowerCase() === text)) || null;
}

function getAssignmentDisplayFromItem(item, emptyLabel = "Not Yet Assigned") {
  if (item?.assignedUserId) return formatAssignmentUser(getAssignmentUserById(item.assignedUserId)) || "Inactive user (historical)";
  const legacy = String(item?.assignedStaff || item?.assigned || "").trim();
  if (!legacy) return emptyLabel;
  return formatAssignmentUser(getLegacyAssignmentMatch(legacy)) || "Inactive user (historical)";
}

function renderAssignmentOptions(currentUserId, legacyValue, emptyLabel = "Unassigned") {
  if (assignmentLoadState === "loading") return `<option value="">Loading team members...</option>`;
  const currentUser = currentUserId ? getAssignmentUserById(currentUserId) : getLegacyAssignmentMatch(legacyValue);
  const legacyText = String(legacyValue || "").trim();
  const rows = [[emptyLabel, ""]];
  if ((currentUserId || legacyText) && !currentUser) rows.push(["Inactive user (historical)", "__legacy__"]);
  assignmentUsers.forEach((user) => rows.push([formatAssignmentUser(user), user.userId]));
  return rows.map(([label, value]) => `<option value="${escapeHtml(value)}" ${currentUser?.userId === value || (!currentUser && value === "__legacy__") ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function renderAssignmentLoadMessage(className = "order-dashboard-schema-warning") {
  if (!shouldLoadSupabaseOps) return "";
  if (assignmentLoadState === "error") return `<p class="${className}">${escapeHtml(assignmentLoadError || "Unable to load team members.")}</p>`;
  if (assignmentLoadState === "loading") return `<p class="${className}">Loading team members...</p>`;
  if (!assignmentUsers.length) return `<p class="${className}">No active admin users are available for assignment.</p>`;
  return "";
}

function areAssignmentControlsReady() {
  return !shouldLoadSupabaseOps || (assignmentLoadState === "ready" && assignmentUsers.length > 0);
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
  return getAssignmentDisplayFromItem(item, "Not Yet Assigned");
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
  return assignmentUsers.map((user) => ({ value: user.userId, label: formatAssignmentUser(user) }));
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
    if (orderDashboardFilters.staff !== "all" && (item.assignedUserId || "") !== orderDashboardFilters.staff) return false;
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
    <select data-order-dashboard-filter="staff"><option value="all">All Staff</option>${staffOptions.map((staff) => `<option value="${escapeHtml(staff.value)}" ${orderDashboardFilters.staff === staff.value ? "selected" : ""}>${escapeHtml(staff.label)}</option>`).join("")}</select>
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
  const assignmentsReady = areAssignmentControlsReady();
  const disabled = fieldsReady && assignmentsReady ? "" : "disabled";
  const schemaNotice = fieldsReady ? "" : `<p class="order-dashboard-schema-warning">DATABASE FIELDS NOT READY. Apply the pending migration before saving internal production fields.</p>`;
  const assignmentNotice = renderAssignmentLoadMessage();
  const notice = `${schemaNotice}${assignmentNotice}`;
  return `<section class="order-production-editor ${fieldsReady ? "" : "schema-missing"}"><h3>Internal Production</h3>${notice}<div class="order-production-grid">
    <label><span>Assigned staff</span><select data-order-dashboard-assigned="${escapeHtml(item.id)}" ${disabled}>${renderAssignmentOptions(item.assignedUserId, item.assignedStaff || item.assigned, "Unassigned")}</select></label>
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
    assignedUserId: assignedInput?.value === "__legacy__" ? null : assignedInput?.value || null,
    productionStage: nextStage,
    productionNote: noteInput?.value?.trim() || null,
    productionUpdatedAt: new Date().toISOString(),
  };
  let savedInquiry = null;

  if (shouldLoadSupabaseOps) {
    try {
      const payload = await requestOpsWorkflowAction(id, {
        action: "save_production",
        assignedUserId: updates.assignedUserId,
        productionStage: updates.productionStage,
        productionNote: updates.productionNote,
      });
      savedInquiry = payload.inquiry;
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

      <section class="client-table-section">
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
        ${selectedClientId === clientProgram.id && clientMatches ? renderClientPanel() : ""}
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
        ${isProductDrawerOpen && selectedProduct && visibleProducts.some((item) => item.code === selectedProduct.code) ? renderProductPanel(selectedProduct) : ""}
      </section>
    </main>
  `;
}

function renderCatalogPage() {
  const visibleProducts = getVisibleCatalogProducts();
  const selectedProduct = catalogProducts.find((item) => item.id === selectedCatalogProductId);
  const canWrite = canWriteCatalogProducts();
  const destinationCounts = getCatalogDestinationCounts();
  const categoryOptions = getCatalogCategoryOptions();

  return `
    <main class="orders-page catalog-page admin-saas-page">
      <div class="page-heading catalog-heading">
        <div>
          <h1>Catalog</h1>
          <p class="subtitle">Manage how approved products appear across customer-facing catalogs.</p>
        </div>
        ${canWrite ? `<button class="catalog-add-button" data-catalog-add-product type="button">+ Add Catalog Item</button>` : ""}
      </div>

      <section class="catalog-controls" aria-label="Catalog controls">
        <div class="catalog-tabs" role="tablist" aria-label="Catalog destinations">
          ${catalogOptions.map((catalog) => `
            <button class="${catalog.key === activeCatalogKey ? "active" : ""}" data-catalog-tab="${catalog.key}" type="button" role="tab" aria-selected="${catalog.key === activeCatalogKey ? "true" : "false"}">
              <span>${catalog.label}</span>
              <strong>${destinationCounts[catalog.key] ?? 0}</strong>
            </button>`).join("")}
        </div>
        <div class="catalog-filter-row">
          <label class="search-field catalog-search">
            ${renderIcon("search", "search-icon")}
            <input id="product-search" value="${escapeHtml(productQuery)}" placeholder="Search catalog" type="search" />
          </label>
          <select class="catalog-status-filter" id="catalog-status-filter" aria-label="Publish status filter">
            ${getCatalogFilterOptions().map((option) => `<option value="${option.value}" ${option.value === catalogStatusFilter ? "selected" : ""}>${option.label}</option>`).join("")}
          </select>
          <select class="catalog-status-filter" id="catalog-category-filter" aria-label="Category filter">
            ${categoryOptions.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === catalogCategoryFilter ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
          </select>
          <select class="catalog-status-filter" id="catalog-featured-filter" aria-label="Featured filter">
            <option value="all" ${catalogFeaturedFilter === "all" ? "selected" : ""}>All featured states</option>
            <option value="featured" ${catalogFeaturedFilter === "featured" ? "selected" : ""}>Featured only</option>
            <option value="standard" ${catalogFeaturedFilter === "standard" ? "selected" : ""}>Not featured</option>
          </select>
        </div>
      </section>

      ${renderCatalogNotice()}

      <article class="content-card table-card catalog-table-card">
        <p class="table-helper-text catalog-count-label">${visibleProducts.length} ${visibleProducts.length === 1 ? "CATALOG ITEM" : "CATALOG ITEMS"}</p>
        <table class="products-table catalog-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Destination</th>
              <th>Category</th>
              <th>Price Display</th>
              <th>Min Qty</th>
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
    const matchesCategory = catalogCategoryFilter === "all" || item.category === catalogCategoryFilter;
    const matchesFeatured =
      catalogFeaturedFilter === "all" ||
      (catalogFeaturedFilter === "featured" && item.isFeatured) ||
      (catalogFeaturedFilter === "standard" && !item.isFeatured);
    const sourceProduct = getCatalogSourceProduct(item);
    const matchesQuery =
      !normalizedQuery ||
      [item.name, item.slug, item.category, item.description, item.priceLabel, sourceProduct?.product, sourceProduct?.code]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);

    return matchesCatalog && matchesStatus && matchesCategory && matchesFeatured && matchesQuery;
  });
}

function renderCatalogNotice() {
  if (catalogSaveState === "success") {
    return `<div class="catalog-notice success">Catalog item saved successfully.</div>`;
  }

  if (catalogLoadState === "loading") {
    return `<div class="catalog-notice">Loading catalog publishing records...</div>`;
  }

  if (catalogLoadState === "error") {
    return `<div class="catalog-notice error">Unable to load catalog records. Check Supabase access and RLS policies.</div>`;
  }

  if (!canWriteCatalogProducts()) {
    return `<div class="catalog-notice">Viewer access: catalog publishing records are read-only.</div>`;
  }

  return "";
}

function renderCatalogEmptyState(visibleProducts) {
  if (visibleProducts.length > 0) return "";

  if (catalogLoadState === "loading") {
    return `<div class="empty-state compact-empty catalog-empty-state"><strong>Loading catalog...</strong><span>Checking customer-facing publishing records.</span></div>`;
  }

  const catalogLabel = getCatalogLabel(activeCatalogKey);
  if (!catalogProducts.some((item) => item.catalogKey === activeCatalogKey)) {
    return `<div class="empty-state compact-empty catalog-empty-state"><strong>No Catalog records</strong><span>${catalogLabel} does not have published presentation records yet.</span></div>`;
  }

  return `<div class="empty-state compact-empty catalog-empty-state"><strong>No results from filters</strong><span>Try another search term, category, featured state, or publish status.</span></div>`;
}

function renderCatalogProductRow(item) {
  const sourceProduct = getCatalogSourceProduct(item);
  const secondary = item.slug ? item.slug : sourceProduct?.code ? `Source: ${sourceProduct.code}` : "No source product linked";

  return `
    <tr class="${item.id === selectedCatalogProductId ? "selected" : ""}" data-catalog-edit-product="${item.id}" role="button" tabindex="0" aria-label="Open ${escapeHtml(item.name)} catalog presentation details">
      <td class="catalog-name-cell"><div class="client-cell"><span class="catalog-product-image ${item.imageUrl ? "has-image" : "empty"}" ${item.imageUrl ? `style="background-image: url('${escapeHtml(item.imageUrl)}')" aria-label="Catalog image"` : `role="img" aria-label="No catalog image"`}>${item.imageUrl ? "" : renderIcon("package", "catalog-placeholder-icon")}</span><div><strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong><span title="${escapeHtml(secondary)}">${escapeHtml(secondary)}</span></div></div></td>
      <td class="catalog-destination-cell" data-mobile-label="Destination" title="${escapeHtml(getCatalogLabel(item.catalogKey))}" aria-label="Destination: ${escapeHtml(getCatalogLabel(item.catalogKey))}">${escapeHtml(getCatalogLabel(item.catalogKey))}</td>
      <td class="catalog-category-cell" data-mobile-label="Category">${escapeHtml(item.category || "-")}</td>
      <td class="catalog-price-cell" data-mobile-label="Price">${escapeHtml(formatCatalogPrice(item))}</td>
      <td class="catalog-moq-cell" data-mobile-label="Min Qty">${escapeHtml(item.minimumQuantity)}</td>
      <td class="catalog-featured-cell" data-mobile-label="Featured">${item.isFeatured ? `<span class="status-pill visible">Featured</span>` : `<span class="catalog-featured-muted">No</span>`}</td>
      <td class="catalog-status-cell" data-mobile-label="Status">${renderStatusPill(item.status)}</td>
      <td class="catalog-updated-cell" data-mobile-label="Updated"><span class="mono-value">${escapeHtml(formatCatalogUpdated(item.updatedAt))}</span></td>
    </tr>
  `;
}

function renderCatalogDrawer(selectedProduct) {
  const draft = catalogDraft ?? createCatalogDraft(selectedProduct);
  const isSaving = catalogSaveState === "saving" || catalogSaveState === "uploading";
  const canWrite = canWriteCatalogProducts();
  const title = draft.name || (catalogDrawerMode === "edit" ? "Catalog Item" : "Add Catalog Item");
  const sourceProduct = getCatalogSourceProduct(draft);

  return `
    <div class="catalog-drawer-backdrop" data-catalog-close-drawer></div>
    <aside class="catalog-drawer" aria-label="${escapeHtml(title)} catalog presentation details">
      <header>
        <div>
          <span>${escapeHtml(getCatalogLabel(draft.catalogKey))}</span>
          <h2>${escapeHtml(title)}</h2>
          ${renderStatusPill(draft.status || "draft")}
        </div>
        <button class="catalog-drawer-close" data-catalog-close-drawer type="button" aria-label="Close catalog drawer">X</button>
      </header>
      <form class="catalog-form" id="catalog-product-form">
        ${catalogValidationError ? `<p class="catalog-form-error">${escapeHtml(catalogValidationError)}</p>` : ""}
        ${catalogSaveError ? `<p class="catalog-form-error">${escapeHtml(catalogSaveError)}</p>` : ""}

        <section class="catalog-drawer-section catalog-preview-section" aria-label="Catalog preview">
          <h3>Preview</h3>
          <div class="catalog-preview-card">
            <div class="catalog-preview-image ${draft.imageUrl || draft.imageFilePreviewUrl ? "has-image" : "empty"}">${draft.imageUrl || draft.imageFilePreviewUrl ? `<img src="${escapeHtml(draft.imageFilePreviewUrl || draft.imageUrl)}" alt="${escapeHtml(draft.name || "Catalog image")}" />` : `<span role="img" aria-label="No catalog image">${renderIcon("package", "catalog-placeholder-icon")}</span>`}</div>
            <div>
              <strong>${escapeHtml(draft.name || "Customer-facing name")}</strong>
              <p>${escapeHtml(draft.description || "No short description yet.")}</p>
              <span>${escapeHtml(formatCatalogPrice(draft))}</span>
              <small>MOQ ${escapeHtml(draft.minimumQuantity || 1)}</small>
            </div>
          </div>
        </section>

        <section class="catalog-drawer-section" aria-label="Publishing">
          <h3>Publishing</h3>
          <div class="catalog-form-grid">
            ${renderCatalogField("catalog", "Destination", renderCatalogSelect(draft))}
            ${renderCatalogField("status", "Publish status", renderCatalogStatusSelect(draft))}
          </div>
          <div class="catalog-form-grid">
            ${renderCatalogFeaturedSetting(draft)}
            ${renderCatalogInput("sortOrder", "Sort order", draft.sortOrder, "number")}
          </div>
          <div class="catalog-kv-list">
            ${renderCatalogDetailRow("Last published", draft.status === "published" ? formatCatalogUpdated(draft.updatedAt) : "Not published")}
            ${renderCatalogDetailRow("Last updated", formatCatalogUpdated(draft.updatedAt))}
          </div>
        </section>

        <section class="catalog-drawer-section" aria-label="Customer-facing details">
          <h3>Customer-facing Details</h3>
          ${renderCatalogInput("name", "Display name", draft.name, "text", true)}
          ${renderCatalogInput("slug", "Slug", draft.slug, "text", true)}
          ${renderCatalogInput("category", "Category", draft.category)}
          ${renderCatalogTextarea("description", "Short description", draft.description)}
        </section>

        <section class="catalog-drawer-section" aria-label="Pricing display">
          <h3>Pricing Display</h3>
          <div class="catalog-form-grid">
            ${renderCatalogInput("startingPrice", "Starting price", draft.startingPrice, "number")}
            ${renderCatalogInput("priceLabel", "Price label", draft.priceLabel)}
          </div>
          ${renderCatalogInput("minimumQuantity", "Minimum quantity", draft.minimumQuantity, "number", true)}
        </section>

        <section class="catalog-drawer-section" aria-label="Customer options">
          <h3>Customer Options</h3>
          ${renderCatalogInput("availableSizesText", "Available sizes", draft.availableSizesText)}
          ${renderCatalogInput("availableColorsText", "Available colors", draft.availableColorsText)}
          ${renderCatalogInput("printMethodsText", "Print methods", draft.printMethodsText)}
        </section>

        <section class="catalog-drawer-section catalog-source-section" aria-label="Source product">
          <h3>Source Product</h3>
          ${sourceProduct
            ? `<div class="catalog-kv-list">
                ${renderCatalogDetailRow("Linked product", sourceProduct.product)}
                ${renderCatalogDetailRow("Internal code", sourceProduct.code, true)}
                ${renderCatalogDetailRow("Availability", sourceProduct.status || "Available")}
              </div>`
            : `<div class="catalog-source-empty"><strong>No source Product linked</strong><span>This Catalog item can still be edited, but staff should confirm the matching internal Product record before publishing.</span></div>`}
        </section>

        <section class="catalog-drawer-section" aria-label="Media">
          <h3>Media</h3>
          ${renderCatalogImageField(draft, canWrite, isSaving)}
        </section>

      </form>
      <div class="catalog-drawer-actions">
        <button class="primary-button catalog-save-button" form="catalog-product-form" type="submit" ${canWrite && !isSaving ? "" : "disabled"}>${catalogSaveState === "uploading" ? "Uploading..." : isSaving ? "Saving..." : getCatalogPrimaryActionLabel(draft)}</button>
        <button class="note-button" data-catalog-close-drawer type="button">Cancel</button>
      </div>
    </aside>
  `;
}
function getCatalogDestinationCounts() {
  return catalogOptions.reduce((counts, catalog) => {
    counts[catalog.key] = catalogProducts.filter((item) => item.catalogKey === catalog.key).length;
    return counts;
  }, {});
}

function getCatalogCategoryOptions() {
  const categories = Array.from(new Set(catalogProducts.map((item) => item.category).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  return [{ value: "all", label: "All categories" }, ...categories.map((category) => ({ value: category, label: category }))];
}

function getCatalogSourceProduct(item) {
  if (!item) return null;
  const itemSlug = slugify(item.slug || item.name || "");
  const itemName = String(item.name || "").trim().toLowerCase();

  return products.find((product) => {
    const productSlug = slugify(product.product || product.code || "");
    const productName = String(product.product || "").trim().toLowerCase();
    return productSlug === itemSlug || productName === itemName || itemName.includes(productName) || productName.includes(itemName);
  }) ?? null;
}

function renderCatalogFeaturedSetting(draft) {
  return `
    <label class="catalog-featured-setting">
      <span><strong>Featured in destination</strong><small>Highlight this item in the selected customer-facing catalog.</small></span>
      <input data-catalog-field="isFeatured" type="checkbox" ${draft.isFeatured ? "checked" : ""} />
    </label>
  `;
}

function renderCatalogDetailRow(label, value, mono = false) {
  const displayValue = value || "Not set";
  return `<div class="catalog-detail-row"><span>${escapeHtml(label)}</span><strong class="${mono ? "mono-value" : ""}">${escapeHtml(displayValue)}</strong></div>`;
}

function getCatalogPrimaryActionLabel(draft) {
  if (!draft?.id) return "Save Catalog Item";
  if (draft.status === "draft" || draft.status === "hidden") return "Publish";
  if (draft.status === "archived") return "Restore";
  return "Save Changes";
}
function renderCatalogImageField(draft, canWrite, isSaving) {
  const displayUrl = draft.imageFilePreviewUrl || (!draft.removeImage ? draft.imageUrl : "");
  const hasImage = Boolean(displayUrl);
  const selectedFilename = draft.imageFile?.name || "";
  const imageState = getCatalogImageState(draft);
  const actionLabel = hasImage ? "REPLACE IMAGE" : "UPLOAD IMAGE";
  const disabled = !canWrite || isSaving;
  const preview = hasImage
    ? `<img src="${escapeHtml(displayUrl)}" alt="${escapeHtml(draft.name || "Catalog product image")}" />`
    : `<span role="img" aria-label="No catalog image">${renderIcon("package", "catalog-placeholder-icon")}</span>`;
  const pickerControl = canWrite
    ? `<label class="catalog-image-picker ${disabled ? "disabled" : ""}">
        <span class="catalog-image-preview ${hasImage ? "has-image" : "empty"}">${preview}</span>
        <span class="catalog-image-pick-text">${actionLabel}</span>
        <input data-catalog-image-file type="file" accept="image/jpeg,image/png,image/webp,image/avif" ${disabled ? "disabled" : ""} />
      </label>`
    : `<div class="catalog-image-picker disabled"><span class="catalog-image-preview ${hasImage ? "has-image" : "empty"}">${preview}</span><span class="catalog-image-pick-text">PREVIEW ONLY</span></div>`;

  return `
    <div class="catalog-image-field" aria-label="Catalog image">
      <div class="catalog-image-heading">
        <span>MAIN CATALOG IMAGE</span>
        <strong class="${imageState === "UPLOAD FAILED" ? "error" : ""}">${imageState}</strong>
      </div>
      ${pickerControl}
      <div class="catalog-image-meta">
        ${selectedFilename ? `<span>${escapeHtml(selectedFilename)}</span>` : ""}
        ${canWrite ? `<button data-catalog-remove-image type="button" ${disabled || (!hasImage && !draft.imageFile && !draft.imageUrl) ? "disabled" : ""}>REMOVE IMAGE</button>` : ""}
      </div>
      <p>SQUARE IMAGE REQUIRED / 1200 x 1200 RECOMMENDED / MINIMUM 800 x 800 / MAXIMUM 5 MB</p>
      ${draft.imageError ? `<p class="catalog-image-error">${escapeHtml(draft.imageError)}</p>` : ""}
    </div>
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
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).toUpperCase();
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
  return ["owner", "admin", "staff"].includes(adminUser?.role);
}

function canManageStaffAccounts() {
  return ["owner", "admin"].includes(adminUser?.role);
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
function createEmptyStaffDraft() {
  return { displayName: "", email: "", role: "staff" };
}

function renderStaffAccessPage() {
  if (!canManageStaffAccounts()) {
    return `<main class="staff-access-page"><section class="staff-access-denied"><span>STAFF ACCESS</span><h1>Access restricted</h1><p>Your account cannot manage TRRY Admin Portal access.</p></section></main>`;
  }

  if (staffLoadState === "idle") {
    staffLoadState = "loading";
    window.setTimeout(loadStaffUsers, 0);
  }

  const loading = staffLoadState === "loading";
  const rows = staffUsers.map(renderStaffRow).join("");
  const cards = staffUsers.map(renderStaffCard).join("");
  const roleNote = adminUser?.role === "admin" ? "Admins can create and manage staff accounts only." : "Owners can create admin or staff accounts.";

  return `<main class="staff-access-page admin-saas-page">
    <section class="staff-access-header">
      <div><span>STAFF ACCESS</span><h1>Manage who can enter the TRRY Admin Portal.</h1><p>${escapeHtml(roleNote)}</p></div>
      <button class="staff-primary-action" type="button" data-staff-new ${loading ? "disabled" : ""}>+ NEW STAFF</button>
    </section>
    ${staffFeedback ? `<p class="staff-feedback" role="status">${escapeHtml(staffFeedback)}</p>` : ""}
    ${staffLoadError ? `<p class="staff-feedback error" role="alert">${escapeHtml(staffLoadError)}</p>` : ""}
    <section class="staff-list-panel">
      <div class="staff-table" role="table" aria-label="Staff access accounts">
        <div class="staff-table-head" role="row"><span>Name</span><span>Email</span><span>Role</span><span>Status</span><span>Created</span><span>Last sign-in</span><span>Actions</span></div>
        <div role="rowgroup">${loading ? `<p class="staff-empty">Loading staff accounts...</p>` : rows || `<p class="staff-empty">No manageable staff accounts yet.</p>`}</div>
      </div>
      <div class="staff-card-list">${loading ? `<p class="staff-empty">Loading staff accounts...</p>` : cards || `<p class="staff-empty">No manageable staff accounts yet.</p>`}</div>
    </section>
    ${staffDrawerMode ? renderStaffDrawer() : ""}
  </main>`;
}

function renderStaffRow(user) {
  const actions = renderStaffActions(user);
  return `<div class="staff-table-row" role="row">
    <strong title="${escapeHtml(user.displayName || user.email)}">${escapeHtml(user.displayName || "Unnamed staff")}</strong>
    <span title="${escapeHtml(user.email)}">${escapeHtml(user.email)}</span>
    ${renderStaffBadge(user.role, "role")}
    ${renderStaffBadge(user.isActive ? "ACTIVE" : "DISABLED", user.isActive ? "active" : "disabled")}
    <span>${escapeHtml(formatStaffDate(user.createdAt))}</span>
    <span>${escapeHtml(formatStaffDate(user.lastSignInAt, "Never"))}</span>
    <div class="staff-actions">${actions}</div>
  </div>`;
}

function renderStaffCard(user) {
  return `<article class="staff-card">
    <div><strong>${escapeHtml(user.displayName || "Unnamed staff")}</strong><span>${escapeHtml(user.email)}</span></div>
    <div class="staff-card-badges">${renderStaffBadge(user.role, "role")}${renderStaffBadge(user.isActive ? "ACTIVE" : "DISABLED", user.isActive ? "active" : "disabled")}</div>
    <small>Created ${escapeHtml(formatStaffDate(user.createdAt))} / Last sign-in ${escapeHtml(formatStaffDate(user.lastSignInAt, "Never"))}</small>
    <div class="staff-actions">${renderStaffActions(user)}</div>
  </article>`;
}

function renderStaffActions(user) {
  const busy = staffActionId === user.id;
  const edit = `<button type="button" data-staff-edit="${escapeHtml(user.id)}" ${busy ? "disabled" : ""}>EDIT</button>`;
  const status = user.isActive
    ? `<button type="button" data-staff-disable="${escapeHtml(user.id)}" ${busy ? "disabled" : ""}>${busy ? "SAVING..." : "DISABLE"}</button>`
    : `<button type="button" data-staff-activate="${escapeHtml(user.id)}" ${busy ? "disabled" : ""}>${busy ? "SAVING..." : "ACTIVATE"}</button>`;
  return `${edit}${status}`;
}

function renderStaffBadge(label, tone) {
  return `<b class="staff-badge ${tone}">${escapeHtml(String(label || "").toUpperCase())}</b>`;
}

function renderStaffDrawer() {
  const isEdit = staffDrawerMode === "edit";
  const title = isEdit ? "EDIT STAFF ACCESS" : "NEW STAFF";
  const roleOptions = getPermittedStaffRoleOptions(isEdit);
  const roleLocked = roleOptions.length <= 1;
  const saving = staffSaveState === "saving";
  const roleControl = roleLocked
    ? `<input value="${escapeHtml(formatAdminRole(staffDraft.role))}" disabled />`
    : `<select id="staff-role" ${saving ? "disabled" : ""}>${roleOptions.map((role) => `<option value="${role}" ${staffDraft.role === role ? "selected" : ""}>${escapeHtml(formatAdminRole(role))}</option>`).join("")}</select>`;

  return `<div class="staff-drawer-backdrop" data-staff-close></div><aside class="staff-drawer" aria-label="${escapeHtml(title)}">
    <header><div><span>STAFF ACCESS</span><h2>${title}</h2></div><button type="button" data-staff-close aria-label="Close staff drawer">X</button></header>
    <form id="staff-form" class="staff-form">
      <label><span>Display name</span><input id="staff-display-name" value="${escapeHtml(staffDraft.displayName)}" autocomplete="name" ${saving ? "disabled" : ""} required /></label>
      <label><span>Email</span><input id="staff-email" value="${escapeHtml(staffDraft.email)}" type="email" autocomplete="email" ${isEdit || saving ? "disabled" : ""} required /></label>
      <label><span>Role</span>${roleControl}</label>
      ${adminUser?.role === "admin" && !isEdit ? `<p class="staff-note">Role is locked to STAFF for admin users.</p>` : ""}
      ${staffSaveError ? `<p class="staff-form-error" role="alert">${escapeHtml(staffSaveError)}</p>` : ""}
      <button class="staff-primary-action" type="submit" ${saving ? "disabled" : ""}>${saving ? (isEdit ? "SAVING..." : "CREATING...") : (isEdit ? "SAVE CHANGES" : "CREATE STAFF")}</button>
    </form>
  </aside>`;
}

function getPermittedStaffRoleOptions(isEdit = false) {
  if (adminUser?.role === "owner") {
    const editing = isEdit ? staffUsers.find((user) => user.id === staffEditingId) : null;
    if (editing?.role === "owner") return ["owner"];
    return ["admin", "staff"];
  }
  return ["staff"];
}

function openNewStaffDrawer() {
  staffDrawerMode = "create";
  staffEditingId = null;
  staffDraft = { ...createEmptyStaffDraft(), role: adminUser?.role === "owner" ? "staff" : "staff" };
  staffSaveState = "idle";
  staffSaveError = "";
  render();
}

function openEditStaffDrawer(id) {
  const user = staffUsers.find((item) => item.id === id);
  if (!user) return;
  staffDrawerMode = "edit";
  staffEditingId = id;
  staffDraft = { displayName: user.displayName || "", email: user.email || "", role: user.role || "staff" };
  staffSaveState = "idle";
  staffSaveError = "";
  render();
}

function closeStaffDrawer() {
  staffDrawerMode = "";
  staffEditingId = null;
  staffDraft = createEmptyStaffDraft();
  staffSaveState = "idle";
  staffSaveError = "";
  render();
}

async function loadStaffUsers() {
  if (!canManageStaffAccounts() || !adminAuthSession?.access_token) return;
  staffLoadState = "loading";
  staffLoadError = "";
  try {
    const payload = await staffApiRequest("/api/admin-users", { method: "GET" });
    staffUsers = Array.isArray(payload.users) ? payload.users : [];
    staffLoadState = "ready";
  } catch (error) {
    console.error("Unable to load Staff Access accounts.", error);
    staffLoadState = "error";
    staffLoadError = error.message || "Unable to load staff accounts.";
  }
  render();
}

async function submitStaffForm() {
  staffSaveState = "saving";
  staffSaveError = "";
  render();
  try {
    if (staffDrawerMode === "edit") {
      const payload = await staffApiRequest(`/api/admin-users/${encodeURIComponent(staffEditingId)}`, {
        method: "PATCH",
        body: { action: "update", displayName: staffDraft.displayName, role: staffDraft.role },
      });
      staffUsers = staffUsers.map((user) => user.id === payload.user.id ? payload.user : user);
      staffFeedback = "Staff account updated.";
    } else {
      const payload = await staffApiRequest("/api/admin-users", {
        method: "POST",
        body: { displayName: staffDraft.displayName, email: staffDraft.email, role: staffDraft.role },
      });
      staffUsers = [payload.user, ...staffUsers.filter((user) => user.id !== payload.user.id)];
      staffFeedback = payload.inviteSent ? "Staff invite sent and access profile created." : "Staff account created.";
    }
    closeStaffDrawer();
  } catch (error) {
    staffSaveState = "idle";
    staffSaveError = error.message || "Staff account save failed.";
    render();
  }
}

async function updateStaffStatus(id, action) {
  staffActionId = id;
  staffFeedback = "";
  staffLoadError = "";
  render();
  try {
    const payload = await staffApiRequest(`/api/admin-users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { action },
    });
    staffUsers = staffUsers.map((user) => user.id === payload.user.id ? payload.user : user);
    staffFeedback = action === "disable" ? "Staff account disabled." : "Staff account activated.";
  } catch (error) {
    staffLoadError = error.message || "Staff account update failed.";
  }
  staffActionId = "";
  render();
}

async function staffApiRequest(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${adminAuthSession?.access_token || ""}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(getStaffApiErrorMessage(response.status, payload?.error));
  return payload;
}

function getStaffApiErrorMessage(status, error) {
  const normalized = String(error || "").toLowerCase();
  if (status === 401) return "Admin session required. Sign in again.";
  if (status === 403) return normalized.includes("role") ? "Role change is not permitted." : "You do not have permission for that staff account.";
  if (status === 409) return normalized.includes("auth") ? "That email already has a login account." : "That email already has admin access.";
  if (status === 503) return normalized.includes("server key") ? "Staff invite service is not configured. Check the Supabase server key." : "Staff invite email could not be sent. Configure Supabase email delivery.";
  if (normalized.includes("display")) return "Display name is required.";
  if (normalized.includes("email")) return "Enter a valid email address.";
  return "Staff account request failed. Try again.";
}

function formatStaffDate(value, fallback = "-") {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function renderSettingsPage() {
  const sections = [
    {
      key: "general",
      title: "General",
      helper: "Core Admin Portal identity and workspace display details.",
      rows: [["Admin Portal", "TRRY Apparel Management"], ["Access mode", isSupabaseReady() ? "Authenticated admin session" : "Access code session"], ["Data source", isSupabaseReady() ? "Supabase connected" : "Not connected"]],
    },
    {
      key: "portal",
      title: "Portal",
      helper: "Current portal domains and supported operating mode.",
      rows: [["Admin domain", "admin.trryapparel.com"], ["Client portal", clientProgram.domain], ["Customer WebApp", "trrywebapp.vercel.app"]],
    },
    {
      key: "notifications",
      title: "Notifications",
      helper: "Current notification display state. Editable notification preferences are not available in this Admin Portal.",
      rows: [["Order alerts", "Read-only display"], ["Production updates", "Read-only display"], ["Client portal activity", "Read-only display"]],
    },
    {
      key: "system",
      title: "System Information",
      helper: "Read-only operational context for the current Admin Portal.",
      rows: [["Calendar", "Phase 2 parked"], ["Catalog bucket", "catalog-images"], ["Workflow gates", "Server-side protected"]],
    },
    {
      key: "access",
      title: "Team and Access",
      helper: "Current authenticated access context only.",
      rows: [["Signed-in account", adminUser?.email || "Not available in access-code mode"], ["Access level", adminUser?.role ? formatAdminRole(adminUser.role) : "Admin access"], ["Company", "TRRY Apparel Management"]],
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
      <td>${formatProductDisplayValue(item.updated)}</td>
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
    <div class="client-drawer-backdrop" data-client-drawer-close></div><aside class="detail-panel client-detail-panel professional-client-drawer">
      <div class="panel-header client-drawer-header">
        <div class="client-drawer-title"><span class="client-logo urban-coffee">${clientProgram.initials}</span><div><code>${escapeHtml(clientProgram.id)}</code><h2>${escapeHtml(clientProgram.name)}</h2><span>${escapeHtml(clientProgram.domain)}</span></div></div>
        <div class="client-drawer-header-actions">${renderStatusPill(clientProgram.status)}<button data-client-drawer-close type="button" aria-label="Close client details">X</button></div>
      </div>
      <div class="client-drawer-body">
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
      </div>
      <section class="quick-panel-actions client-drawer-footer">
        <a class="primary-drawer-action" href="https://${clientProgram.domain}" target="_blank" rel="noreferrer">Open Portal</a>
        <details class="drawer-more-actions"><summary>More Actions</summary><div>
          <button data-copy-value="https://${clientProgram.domain}" data-copy-message="Portal link copied" type="button">Copy Portal Link</button>
          <button data-route-target="/orders" type="button">View Orders</button>
          <button disabled title="Editing requires a connected client management backend." type="button">Edit Client</button>
        </div></details>
      </section>
    </aside>
  `;
}

function formatProductDisplayValue(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "MVP Setup" || text === "Recently") return "Not available";
  return text;
}

function renderProductInfoRows(rows) {
  return rows
    .map(([label, value]) => `<div class="settings-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(formatProductDisplayValue(value))}</strong></div>`)
    .join("");
}

function renderProductPanel(product) {
  const productImage = getActiveProductImage(product.code);
  const methods = "Embroidery";
  const minimumQuantity = "Not set";
  const basePrice = "Not set";
  const priceLabel = "Not set";
  const pricingNote = "Not set";

  return `
    <div class="product-drawer-backdrop" data-product-drawer-close></div><aside class="detail-panel product-detail-panel professional-product-drawer">
      <div class="panel-header product-drawer-header">
        <div class="product-drawer-title">
          <span class="product-drawer-thumb" style="background-image: url('${escapeHtml(productImage.image_url)}')"></span>
          <div><code>${escapeHtml(product.code)}</code><h2>${escapeHtml(product.product)}</h2><span>${escapeHtml(product.category)} / Physical item</span></div>
        </div>
        <div class="product-drawer-header-actions">${renderStatusPill(product.visible === "Yes" ? "Active" : "Hidden")}<button data-product-drawer-close type="button" aria-label="Close product details">X</button></div>
      </div>
      <div class="product-drawer-body">
        <section class="panel-section product-overview-section">
          <p class="section-title">Overview</p>
          ${renderProductInfoRows([["Client", product.client], ["Type", "Physical item"], ["Category", product.category], ["Approval status", product.status], ["Portal visibility", product.visible], ["Product code", product.code]])}
        </section>
        <section class="panel-section product-spec-section">
          <p class="section-title">Specifications</p>
          ${renderProductInfoRows([["Color", product.color], ["Logo placement", product.logoPlacement], ["Fabric / specification", product.fabric], ["Available methods", methods], ["Minimum quantity", minimumQuantity]])}
        </section>
        <section class="panel-section product-pricing-section">
          <p class="section-title">Pricing</p>
          ${renderProductInfoRows([["Base price", basePrice], ["Price label", priceLabel], ["Minimum quantity", minimumQuantity], ["Pricing note", pricingNote]])}
        </section>
        ${renderProductImageManager(product)}
        <section class="panel-section product-portal-section">
          <p class="section-title">Client Portal</p>
          ${renderProductInfoRows([["Linked client", product.client], ["Portal visibility", product.visible], ["Portal URL", clientProgram.domain]])}
        </section>
        <section class="panel-section product-operations-section">
          <p class="section-title">Operations</p>
          ${renderProductInfoRows([["Created", product.created], ["Last updated", product.updated], ["Approval state", product.status], ["Related method", methods]])}
        </section>
      </div>
      <section class="quick-panel-actions product-actions product-drawer-footer">
        <button disabled title="Editing requires a connected product management backend." type="button">Edit Product</button>
        <details class="drawer-more-actions"><summary>More Actions</summary><div>
          <button disabled title="Client portal product linking will be connected later." type="button">View in Client Portal</button>
          <button data-copy-value="${product.code}" data-copy-message="Product code copied" type="button">Copy Product Code</button>
          <button data-copy-value="https://${clientProgram.domain}" data-copy-message="Portal link copied" type="button">Copy Portal Link</button>
          <button disabled title="Duplicate requires product persistence support." type="button">Duplicate</button>
        </div></details>
      </section>
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
                    ${hasImage ? "Replace" : "Add Image"}
                    <input data-image-upload-code="${product.code}" data-image-upload-angle="${angleLabel}" type="file" accept="image/*" />
                  </label>
                  <details class="image-more-actions"><summary>More</summary><div>
                    <button ${hasImage ? "" : "disabled"} data-set-main-image="${product.code}" data-set-main-angle="${angleLabel}" type="button">Set as Main</button>
                    <button ${!hasImage || isFront ? "disabled" : ""} data-remove-image="${product.code}" data-remove-angle="${angleLabel}" title="${isFront ? "Front image is required." : "Remove image"}" type="button">Remove</button>
                    <button ${!hasImage || savedIndex <= 0 ? "disabled" : ""} data-reorder-image="${product.code}" data-reorder-angle="${angleLabel}" data-reorder-direction="up" type="button">Move Up</button>
                    <button ${!hasImage || savedIndex < 0 || savedIndex === images.length - 1 ? "disabled" : ""} data-reorder-image="${product.code}" data-reorder-angle="${angleLabel}" data-reorder-direction="down" type="button">Move Down</button>
                  </div></details>
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
    { label: "Production", path: "/production", icon: "factory" },
    ...(canViewWorkboardRoute() ? [{ label: "Workboard", path: "/workboard", icon: "clipboard-list" }] : []),
    ...(canViewMyTasksRoute() ? [{ label: "My Tasks", path: "/my-tasks", icon: "clipboard-list" }] : []),
    { label: "Catalog", path: "/catalog" },
    ...(canManageStaffAccounts() ? [{ label: "Staff", path: "/staff", icon: "users" }] : []),
    { label: "Settings", path: "/settings" },
  ];

  return `
    <aside class="sidebar ${isSidebarCollapsed ? "is-collapsed" : ""}">
      <button class="sidebar-close-button" type="button" aria-label="Close navigation">X</button>
      <div class="brand-lockup"><strong>TRRY</strong><span>ADMIN PORTAL</span></div>
      <nav>
        ${navItems.map((item) => `<a class="${item.label === currentRoute ? "active" : ""}" href="${item.path}" data-route-link title="${item.label === "Staff" ? "Staff Access" : item.label}" aria-label="${item.label === "Staff" ? "Staff Access" : item.label}">${renderIcon(item.icon || getNavIcon(item.label), "nav-icon")}<span class="nav-label">${item.label === "Staff" ? "Staff Access" : item.label}</span></a>`).join("")}
        <span class="sidebar-phase-item" aria-disabled="true">${renderIcon("calendar-check", "nav-icon")}<span class="nav-label">Calendar<small>Phase 2</small></span></span><span class="sidebar-phase-item" aria-disabled="true">${renderIcon("clipboard-list", "nav-icon")}<span class="nav-label">Reports</span></span>
      </nav>
      <div class="system-card">${renderIcon("shield-check", "shield-icon")}<div><strong>System Status</strong><p><span></span> All systems operational</p></div></div>
    </aside>`;
}

function getAdminDisplayName() {
  return adminUser?.displayName || adminUser?.email || "TRRY Admin";
}

function getAdminInitials() {
  const label = getAdminDisplayName();
  const [name] = label.split("@");
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

function renderAccountMenu(surface = "desktop") {
  const isMobile = surface === "mobile";
  const triggerClass = isMobile ? "mobile-account-trigger" : "admin-account-trigger";
  const menuClass = isMobile ? "mobile-account-popover" : "admin-account-popover";
  const avatarClass = isMobile ? "mobile-avatar" : "avatar";
  const accountLabel = isMobile ? `<span class="mobile-account-label">ACCOUNT</span>` : "";
  const manageStaff = canManageStaffAccounts()
    ? `<button type="button" data-admin-account-action="staff">MANAGE STAFF</button>`
    : "";

  return `<div class="admin-account-menu ${isMobile ? "mobile" : "desktop"} ${isAccountMenuOpen ? "open" : ""}" data-admin-account-menu>
    <button class="${triggerClass}" type="button" data-admin-account-toggle aria-haspopup="menu" aria-expanded="${isAccountMenuOpen ? "true" : "false"}">
      <span class="${avatarClass}">${getAdminInitials()}</span>${accountLabel}
      <span class="admin-account-copy"><strong>${escapeHtml(getAdminDisplayName())}</strong><small>${escapeHtml(formatAdminRole(adminUser?.role))}</small></span>
      ${renderIcon("chevron-down", "account-chevron")}
    </button>
    <div class="${menuClass}" role="menu">
      <strong>${escapeHtml(getAdminDisplayName())}</strong>
      <span>${escapeHtml(formatAdminRole(adminUser?.role))}</span>
      <i aria-hidden="true"></i>
      ${manageStaff}
      <button type="button" data-admin-logout>LOG OUT</button>
    </div>
  </div>`;
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
        ${renderAccountMenu("desktop")}
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
        ${renderAccountMenu("mobile")}
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
  ...(canViewWorkboardRoute() ? [{ label: "Workboard", path: "/workboard", icon: "clipboard-list" }] : []),
    ...(canViewMyTasksRoute() ? [{ label: "My Tasks", path: "/my-tasks", icon: "clipboard-list" }] : []),
  ];
  return `<nav class="mobile-bottom-nav" aria-label="Mobile navigation">${navItems.map((item) => `<a class="${item.label === currentRoute ? "active" : ""}" href="${item.path}" data-route-link>${renderIcon(item.icon || getNavIcon(item.label), "nav-icon")}<small>${item.label}</small></a>`).join("")}</nav>`;
}
function renderGlobalSearchHint() {
  const normalized = globalSearchQuery.trim().toLowerCase();
  if (!normalized) return "";

  if ("urban coffee".includes(normalized)) {
    return `<button class="search-suggestion" data-route-target="/orders" type="button">Search Orders</button>`;
  }

  if (
    "admin polo uniform".includes(normalized) ||
    "embroidered staff cap".includes(normalized) ||
    normalized.includes("cap")
  ) {
    return `<button class="search-suggestion" data-route-target="/orders" type="button">Search Orders</button>`;
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
  if (mode === "create" && !canWriteCatalogProducts()) return;
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
function handleAccountOutsideClick(event) {
  if (!isAccountMenuOpen) return;
  if (event.target.closest("[data-admin-account-menu]")) return;
  isAccountMenuOpen = false;
  render();
}

function handleAccountEscape(event) {
  if (event.key !== "Escape") return;
  let changed = false;
  if (isAccountMenuOpen) {
    isAccountMenuOpen = false;
    changed = true;
  }
  if (staffDrawerMode) {
    staffDrawerMode = "";
    staffEditingId = null;
    staffDraft = createEmptyStaffDraft();
    staffSaveState = "idle";
    staffSaveError = "";
    changed = true;
  }
  if (changed) render();
}
function bindWorkboardEvents() {
  document.querySelector("[data-workboard-create]")?.addEventListener("click", openWorkboardCreate);
  document.querySelectorAll("[data-workboard-open]").forEach((button) => button.addEventListener("click", () => openWorkboardTask(button.dataset.workboardOpen)));
  document.querySelectorAll("[data-workboard-close]").forEach((button) => button.addEventListener("click", closeWorkboardDrawer));
  document.querySelectorAll("[data-workboard-edit-draft]").forEach((button) => button.addEventListener("click", () => openWorkboardEditDraft(button.dataset.workboardEditDraft)));

  const status = document.getElementById("workboard-status-filter");
  const priority = document.getElementById("workboard-priority-filter");
  const source = document.getElementById("workboard-source-filter");
  const assignee = document.getElementById("workboard-assignee-filter");
  const reviewer = document.getElementById("workboard-reviewer-filter");
  const search = document.getElementById("workboard-search");
  status?.addEventListener("change", (event) => { workboardFilterStatus = event.target.value; loadWorkboardTasks(); });
  priority?.addEventListener("change", (event) => { workboardFilterPriority = event.target.value; loadWorkboardTasks(); });
  source?.addEventListener("change", (event) => { workboardFilterSource = event.target.value; loadWorkboardTasks(); });
  assignee?.addEventListener("change", (event) => { workboardFilterAssignee = event.target.value; loadWorkboardTasks(); });
  reviewer?.addEventListener("change", (event) => { workboardFilterReviewer = event.target.value; loadWorkboardTasks(); });
  search?.addEventListener("input", (event) => {
    workboardSearch = event.target.value;
    render();
    focusFieldAtEnd("workboard-search");
  });
  document.querySelectorAll("[data-workboard-clear]").forEach((button) => button.addEventListener("click", () => {
    workboardFilterStatus = "active";
    workboardFilterPriority = "";
    workboardFilterSource = "";
    workboardFilterAssignee = "";
    workboardFilterReviewer = "";
    workboardSearch = "";
    loadWorkboardTasks();
  }));

  document.querySelector("[data-workboard-draft-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveWorkboardDraft();
  });
  document.querySelectorAll("[data-workboard-assign]").forEach((button) => button.addEventListener("click", () => runWorkboardCommand(button.dataset.workboardAssign, "assign")));
  document.querySelectorAll("[data-workboard-approve-draft]").forEach((button) => button.addEventListener("click", () => runWorkboardCommand(button.dataset.workboardApproveDraft, "approve-draft")));
  document.querySelectorAll("[data-workboard-request-revision]").forEach((button) => button.addEventListener("click", () => runWorkboardCommand(button.dataset.workboardRequestRevision, "request-revision")));
  document.querySelectorAll("[data-workboard-approve-work]").forEach((button) => button.addEventListener("click", () => runWorkboardCommand(button.dataset.workboardApproveWork, "approve-work")));
  document.querySelectorAll("[data-workboard-cancel]").forEach((button) => button.addEventListener("click", () => runWorkboardCommand(button.dataset.workboardCancel, "cancel")));
  document.querySelectorAll("[data-workboard-reopen]").forEach((button) => button.addEventListener("click", () => runWorkboardCommand(button.dataset.workboardReopen, "reopen")));
  document.querySelectorAll("[data-workboard-archive]").forEach((button) => button.addEventListener("click", () => runWorkboardCommand(button.dataset.workboardArchive, "archive")));
}
function bindMyTasksEvents() {
  document.getElementById("my-tasks-search")?.addEventListener("input", (event) => {
    myTasksSearch = event.target.value;
    loadMyTasks({ silent: true });
  });

  document.querySelectorAll("[data-my-tasks-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      myTasksFilter = button.dataset.myTasksFilter;
      loadMyTasks();
    });
  });

  document.querySelector("[data-my-tasks-clear]")?.addEventListener("click", () => {
    myTasksFilter = "active";
    myTasksSearch = "";
    loadMyTasks();
  });

  document.querySelectorAll("[data-task-open]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openTaskDetail(button.dataset.taskOpen);
    });
  });

  document.querySelectorAll("[data-task-close]").forEach((button) => {
    button.addEventListener("click", closeTaskDetail);
  });

  document.querySelectorAll("[data-task-start]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      runTaskCommand(button.dataset.taskStart, "start");
    });
  });

  document.querySelectorAll("[data-task-start-revision]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      runTaskCommand(button.dataset.taskStartRevision, "start-revision");
    });
  });

  document.querySelectorAll("[data-task-submit]").forEach((button) => {
    button.addEventListener("click", () => {
      if (validateTaskSubmit("submit")) runTaskCommand(button.dataset.taskSubmit, "submit");
    });
  });

  document.querySelectorAll("[data-task-submit-no-time]").forEach((button) => {
    button.addEventListener("click", () => {
      if (validateTaskSubmit("submit-no-time")) runTaskCommand(button.dataset.taskSubmitNoTime, "submit-no-time");
    });
  });

  document.querySelectorAll("[data-task-open-fallback]").forEach((button) => {
    button.addEventListener("click", () => {
      taskFallbackOpen = true;
      taskCommandError = "";
      render();
    });
  });

  document.querySelector("[data-task-cancel-fallback]")?.addEventListener("click", () => {
    taskFallbackOpen = false;
    taskNoTimeReason = "";
    render();
  });

  document.getElementById("task-submission-note")?.addEventListener("input", (event) => {
    taskSubmissionNote = event.target.value;
    taskCommandError = "";
  });
  document.getElementById("task-proof-url")?.addEventListener("input", (event) => {
    taskProofUrl = event.target.value;
    taskCommandError = "";
  });
  document.getElementById("task-no-time-reason")?.addEventListener("input", (event) => {
    taskNoTimeReason = event.target.value;
    taskCommandError = "";
  });
}
function bindEvents() {
  document.querySelectorAll("[data-admin-logout]").forEach((button) => {
    button.addEventListener("click", async () => {
      isAccountMenuOpen = false;
      await logoutAdminUser();
    });
  });

  document.querySelectorAll("[data-admin-account-toggle]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      isAccountMenuOpen = !isAccountMenuOpen;
      render();
    });
  });

  document.querySelectorAll("[data-admin-account-action='staff']").forEach((button) => {
    button.addEventListener("click", () => {
      isAccountMenuOpen = false;
      navigateTo("/staff");
      render();
    });
  });

  document.removeEventListener("click", handleAccountOutsideClick);
  document.addEventListener("click", handleAccountOutsideClick);
  document.removeEventListener("keydown", handleAccountEscape);
  document.addEventListener("keydown", handleAccountEscape);

  document.querySelectorAll("[data-staff-new]").forEach((button) => button.addEventListener("click", openNewStaffDrawer));
  document.querySelectorAll("[data-staff-edit]").forEach((button) => button.addEventListener("click", () => openEditStaffDrawer(button.dataset.staffEdit)));
  document.querySelectorAll("[data-staff-disable]").forEach((button) => button.addEventListener("click", () => updateStaffStatus(button.dataset.staffDisable, "disable")));
  document.querySelectorAll("[data-staff-activate]").forEach((button) => button.addEventListener("click", () => updateStaffStatus(button.dataset.staffActivate, "activate")));
  document.querySelectorAll("[data-staff-close]").forEach((button) => button.addEventListener("click", closeStaffDrawer));

  const staffForm = document.getElementById("staff-form");
  if (staffForm) {
    const displayName = document.getElementById("staff-display-name");
    const email = document.getElementById("staff-email");
    const role = document.getElementById("staff-role");

    displayName?.addEventListener("input", (event) => { staffDraft.displayName = event.target.value; staffSaveError = ""; });
    email?.addEventListener("input", (event) => { staffDraft.email = event.target.value; staffSaveError = ""; });
    role?.addEventListener("change", (event) => { staffDraft.role = event.target.value; staffSaveError = ""; });
    staffForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (staffSaveState === "saving") return;
      staffDraft.displayName = displayName?.value || staffDraft.displayName;
      staffDraft.email = email?.value || staffDraft.email;
      staffDraft.role = role?.value || staffDraft.role;
      await submitStaffForm();
    });
  }

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
    saveInquiryFollowUp: saveMvpInquiryFollowUp,
    handleInquiryFollowUpOutcome: handleMvpInquiryFollowUpOutcome,
  });
  document.body.classList.toggle("mvp-drawer-open", Boolean(document.querySelector(".mvp-drawer")));
  document.body.classList.toggle("catalog-drawer-open", Boolean(document.querySelector(".catalog-drawer")));
  bindOpsBoardEvents();
  bindOrderDashboardEvents();
  bindWorkboardEvents();
  bindMyTasksEvents();
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

  document.getElementById("catalog-category-filter")?.addEventListener("change", (event) => {
    catalogCategoryFilter = event.target.value;
    render();
  });

  document.getElementById("catalog-featured-filter")?.addEventListener("change", (event) => {
    catalogFeaturedFilter = event.target.value;
    render();
  });


  document.querySelector("[data-catalog-add-product]")?.addEventListener("click", () => {
    openCatalogDrawer("create");
  });

  document.querySelectorAll("[data-catalog-edit-product]").forEach((element) => {
    const openCatalogRow = () => openCatalogDrawer("edit", element.dataset.catalogEditProduct);

    element.addEventListener("click", (event) => {
      event.stopPropagation();
      openCatalogRow();
    });

    element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openCatalogRow();
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
    const openClient = () => {
      selectedClientId = element.dataset.clientId;
      render();
    };
    element.addEventListener("click", openClient);
    element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openClient();
    });
  });

  document.querySelectorAll("[data-product-code]").forEach((button) => {
    const openProduct = () => {
      selectedProductCode = button.dataset.productCode;
      selectedImageAngle = getMainProductImage(selectedProductCode).angle_label;
      isProductDrawerOpen = true;
      render();
    };
    button.addEventListener("click", openProduct);
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openProduct();
    });
  });

  document.querySelectorAll("[data-product-drawer-close]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedProductCode = null;
      isProductDrawerOpen = false;
      render();
    });
  });

  document.querySelectorAll("[data-client-drawer-close]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedClientId = null;
      render();
    });
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

async function handleMvpInquiryFollowUpOutcome(id, outcome) {
  if (outcome === "not_proceeding") {
    await moveOpsInquiry(id, "lost");
    return { ok: true };
  }

  return {
    ok: false,
    message: "Use the existing protected approval or conversion workflow for this result.",
  };
}
async function saveMvpInquiryFollowUp(id, updates) {
  const normalizedUpdates = {};
  if (Object.prototype.hasOwnProperty.call(updates, "ownerUserId") && updates.ownerUserId !== undefined) {
    normalizedUpdates.ownerUserId = updates.ownerUserId || null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "followUpDate")) {
    normalizedUpdates.followUpDate = updates.followUpDate || null;
  }

  if (!shouldLoadSupabaseOps) {
    opsInquiries = opsInquiries.map((item) =>
      item.id === id ? { ...item, ...normalizedUpdates } : item
    );
    return;
  }

  try {
    const savedInquiry = await updateInquiryAssignment(
      id,
      normalizedUpdates,
      adminAuthSession
    );

    if (!savedInquiry) {
      throw new Error("Inquiry follow-up update returned no saved inquiry.");
    }

    opsInquiries = opsInquiries.map((item) =>
      item.id === id ? { ...item, ...savedInquiry } : item
    );
  } catch (error) {
    console.error("Unable to save inquiry follow-up fields.", error);
    showFeedback(error.message || "Unable to save inquiry follow-up.");
  }
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
        assignedUserId: changes.assignedUserId,
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
      if (button.disabled || opsSoSavingId) return;
      opsSoDraft = { id: button.dataset.opsAddSo };
      render();
      document.querySelector(`[data-ops-confirm-so="${button.dataset.opsAddSo}"]`)?.focus();
    });
  });

  document.querySelectorAll("[data-ops-confirm-so]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.disabled || opsSoSavingId) return;
      button.disabled = true;
      button.textContent = "Saving...";
      await confirmOpsSO(button.dataset.opsConfirmSo);
      render();
    });
  });

  document.querySelectorAll("[data-ops-cancel-so]").forEach((button) => {
    button.addEventListener("click", () => {
      if (opsSoSavingId) return;
      opsSoDraft = null;
      render();
    });
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
    return { path: "/orders", orderQuery: value.trim() };
  }

  if ("admin polo uniform".includes(normalized)) {
    return { path: "/orders", orderQuery: value.trim() };
  }

  if ("embroidered staff cap".includes(normalized) || normalized.includes("cap")) {
    return { path: "/orders", orderQuery: value.trim() };
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
      <text x="28" y="194" fill="#111827" font-family="Inter, sans-serif" font-size="19" font-weight="700">${product.product}</text>
      <text x="28" y="216" fill="${labelColor}" font-family="Inter, sans-serif" font-size="13" font-weight="700">${angleLabel}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function statusToClass(status) {
  return status.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function isPasswordSetupRoute() {
  return window.location.pathname.replace(/\/+$/, "") === "/set-password";
}
function getCurrentRoute() {
  return routes[getRoutePath()] ?? routes[defaultRoutePath];
}

function getRoutePath() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (parkedAdminRoutes.has(path)) {
    window.history.replaceState({}, "", defaultRoutePath);
    return defaultRoutePath;
  }
  if (path === "/my-tasks" && !canViewMyTasksRoute()) return defaultRoutePath;
  if (path === "/workboard" && !canViewWorkboardRoute()) return defaultRoutePath;
  return routes[path] ? path : defaultRoutePath;
}

function navigateTo(path) {
  const normalizedPath = normalizeRoutePath(path);
  window.history.pushState({}, "", normalizedPath);
}

function normalizeRoutePath(path) {
  const url = new URL(String(path || defaultRoutePath), window.location.origin);
  const routePath = url.pathname.replace(/\/+$/, "") || "/";
  if (parkedAdminRoutes.has(routePath)) return defaultRoutePath;
  if (routePath === "/my-tasks" && !canViewMyTasksRoute()) return defaultRoutePath;
  if (routePath === "/workboard" && !canViewWorkboardRoute()) return defaultRoutePath;
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

