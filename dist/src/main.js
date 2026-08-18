import { createMvpDashboard } from "./mvpDashboard.js";
import {
  approveTaskDraft,
  approveAndAssignTask,
  approveTaskWork,
  archiveTask,
  assignTask,
  cancelTask,
  createIdempotencyKey,
  createTaskDraft,
  getMyTasks,
  getTaskCalendar,
  getTaskDetail,
  getWorkboardTasks,
  reopenTask,
  requestAutoPlanToday,
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
import {
  buildDualReadOrders,
  normalizeNativeOrderResponseToRow,
  getNativeOrderRows,
} from "./services/orderCompatibility.js";
import {
  findNativeOrderBySourceInquiryId,
  hasNativeOrderAuthority,
} from "./services/nativeOrderAuthority.js";
import { getApprovedAdminUser } from "./services/adminUsers.js";
import {
  getAdminAssignmentUsers,
  updateInquiryAssignment,
} from "./services/adminAssignments.js";
import {
  catalogOptions,
  catalogStatusOptions,
  createAdminBrand,
  createAdminProductCategory,
  createAdminProduct,
  getAdminBrands,
  getAdminProductCategories,
  getAdminCatalogProducts,
  productTypeOptions,
  duplicateAdminProduct,
  updateAdminBrand,
  updateAdminProductCategory,
  updateAdminProduct,
} from "./services/adminCatalog.js";
import {
  deleteCatalogImagePath,
  uploadCatalogImage,
  validateCatalogImageFileWithDimensions,
} from "./services/adminCatalogImages.js";
import {
  getCurrentAdminAuthSession,
  getSupabaseConfig,
  getAdminPasswordResetRedirectUrl,
  cleanAdminAuthCallbackUrl,
  readInviteSessionFromUrl,
  readRecoverySessionFromUrl,
  isSupabaseReady,
  requestAdminPasswordReset,
  signInAdminWithPassword,
  signOutAdmin,
  updateAdminInvitePassword,
  updateAdminRecoveryPassword,
} from "./lib/supabaseClient.js";

const mvpDashboard = createMvpDashboard({
  getAssignmentContext: () => ({
    users: assignmentUsers,
    loadState: assignmentLoadState,
    error: assignmentLoadError,
  }),
});

const TASK_PRIORITIES = new Set(["LOW", "MEDIUM", "HIGH", "URGENT"]);
const TASK_TIME_TRACKING_MODES = new Set(["EXPECTED", "NONE"]);
const TASK_PRIORITY_LABELS = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

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
  "alert-circle": '<circle cx="12" cy="12" r="10"></circle><line x1="12" x2="12" y1="8" y2="12"></line><line x1="12" x2="12.01" y1="16" y2="16"></line>',
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
let nativeOrderRows = [];
let nativeOrdersLoadState = shouldLoadSupabaseOps ? "loading" : "local";
let nativeOrdersLoadError = "";
let nativeOrderConversionRequests = {};

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
let opsArtworkRequests = {};
let opsCustomerActionRequests = {};
let mvpPaymentConfirmationRequests = {};
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
let catalogBrandFilter = "all";
let catalogCategoryFilter = "all";
let catalogFeaturedFilter = "all";
let catalogProductTypeFilter = "all";
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
let productCategories = [];
let brands = [];
let catalogLoadState = shouldLoadSupabaseOrders ? "loading" : "empty";
let catalogLoadError = "";
let categoryLoadState = shouldLoadSupabaseOrders ? "loading" : "empty";
let categoryLoadError = "";
let brandLoadState = shouldLoadSupabaseOrders ? "loading" : "empty";
let brandLoadError = "";
let activeCatalogKey = "trry_webapp";
let selectedCatalogProductId = null;
let catalogExpandedProductId = null;
let catalogQuickSaveState = "idle";
let catalogQuickSaveError = "";
let catalogEditorMode = "";
let catalogEditorRouteKey = "";
let catalogDraft = null;
let catalogValidationError = "";
let catalogSaveState = "idle";
let catalogSaveError = "";
const CATALOG_PRODUCT_IMAGE_LIMIT = 6;
let categoryStatusFilter = "active";
let categoryProductTypeFilter = "all";
let categoryHierarchyFilter = "all";
let selectedCategoryId = null;
let categoryDrawerMode = "";
let categoryDraft = null;
let categoryValidationError = "";
let categorySaveState = "idle";
let categorySaveError = "";
let hasLoadedProductCategories = false;
let hasLoadedBrands = false;
let brandStatusFilter = "active";
let selectedBrandId = null;
let brandDrawerMode = "";
let brandDraft = null;
let brandValidationError = "";
let brandSaveState = "idle";
let brandSaveError = "";
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
let myTasksLastFullTickRender = 0;
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
let autoPlanQuickDirection = "";
let autoPlanState = "idle";
let autoPlanError = "";
let autoPlanResult = null;
let autoPlanIdempotencyKey = "";
let calendarEvents = [];
let calendarLoadState = "idle";
let calendarLoadError = "";
let calendarSelectedDate = getManilaTodayKey();
let calendarVisibleMonth = getMonthKey(calendarSelectedDate);
let calendarAssigneeFilter = "";
let calendarSourceFilter = "";
let calendarStatusFilter = "";
let calendarSelectedTask = null;

const routes = {
  "/": "Overview",
  "/inquiries": "Inquiries",
  "/orders": "Orders",
  "/production": "Production",
  "/catalog": "Catalog",
  "/my-tasks": "My Tasks",
  "/calendar": "Calendar",
  "/workboard": "Workboard",
  "/overview": "Overview",
  "/catalog": "Catalog",
  "/catalog/brands": "Catalog",
  "/catalog/categories": "Catalog",
};

const defaultRoutePath = "/";
const legacyOrderDashboardPath = "/order-dashboard";
const activeOrdersPath = "/orders";
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
let passwordResetEmail = "";
let passwordResetStatus = "idle";
let passwordResetError = "";
let passwordResetNotice = "";
let adminAuthMessage = "";
let adminShellMessage = "";
let passwordSetupDraft = { password: "", confirm: "" };
let passwordSetupStatus = "idle";
let passwordSetupError = "";
let passwordSetupSession = null;
let passwordSetupMode = "invite";
let passwordSetupSuccess = "";
let isSidebarCollapsed = getStoredSidebarCollapsed();
let isMobileSidebarOpen = false;

function render() {
  if (normalizeLegacyOrderDashboardRoute()) {
    return;
  }

  if (isPasswordSetupRoute()) {
    renderPasswordSetupScreen("invite");
    return;
  }

  if (isPasswordResetRoute()) {
    renderPasswordSetupScreen("recovery");
    return;
  }

  if (isForgotPasswordRoute()) {
    renderForgotPasswordScreen();
    return;
  }

  if (isLoginRoute() && adminAuthStatus !== "approved") {
    renderAdminAuthGate();
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
  const isAdminSaasRoute = currentRoute === "Catalog";
  if (currentRoute === "My Tasks" && myTasksLoadState === "idle") window.setTimeout(loadMyTasks, 0);
  if (currentRoute === "Workboard" && workboardLoadState === "idle") window.setTimeout(loadWorkboardTasks, 0);
  if (currentRoute === "Calendar" && calendarLoadState === "idle") window.setTimeout(loadTaskCalendar, 0);

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
            : currentRoute === "Inquiries"
                ? renderMvpInquiriesPage()
                : currentRoute === "Production"
                  ? renderMvpProductionPage()
                  : currentRoute === "My Tasks"
                    ? renderMyTasksPage()
                    : currentRoute === "Calendar"
                      ? renderCalendarPage()
                      : currentRoute === "Workboard"
                        ? renderWorkboardPage()
                        : currentRoute === "Catalog"
                          ? renderCatalogPage()
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
        <button class="admin-auth-link" data-forgot-password type="button" ${isSigningIn ? "disabled" : ""}>Forgot Password?</button>
        <p class="admin-login-note">Authorized staff only.</p>
      </section>
    </main>
  `;

  bindAdminLoginEvents();
}

function getAdminLoginNotice() {
  if (adminLoginNotice) return adminLoginNotice;
  if (new URLSearchParams(window.location.search).get("password_reset") === "1") {
    return "PASSWORD UPDATED. YOU CAN NOW SIGN IN.";
  }
  return new URLSearchParams(window.location.search).get("password_set") === "1"
    ? "PASSWORD SET. YOU CAN NOW SIGN IN."
    : "";
}

function renderForgotPasswordScreen() {
  const isSending = passwordResetStatus === "sending";
  document.getElementById("root").innerHTML = `
    <main class="admin-access-page">
      <section class="admin-access-card admin-login-card" aria-label="TRRY Admin password reset request">
        <div class="admin-access-brand"><strong>TRRY</strong><span>ADMIN PORTAL</span></div>
        <div class="admin-access-heading">
          <h1>Reset password</h1>
          <span>Enter your Admin Staging email address.</span>
        </div>
        <form class="admin-access-form" id="admin-forgot-password-form">
          <label for="admin-reset-email">EMAIL</label>
          <input id="admin-reset-email" value="${escapeHtml(passwordResetEmail)}" type="email" autocomplete="email" inputmode="email" aria-invalid="${passwordResetError ? "true" : "false"}" ${isSending ? "disabled" : ""} />
          ${passwordResetNotice ? `<p class="admin-access-success" role="status">${escapeHtml(passwordResetNotice)}</p>` : ""}
          ${passwordResetError ? `<p class="admin-access-error" role="alert">${escapeHtml(passwordResetError)}</p>` : ""}
          <button type="submit" ${isSending ? "disabled" : ""}>${isSending ? "SENDING..." : "SEND RESET LINK"}</button>
        </form>
        <button class="admin-auth-link" data-back-to-login type="button" ${isSending ? "disabled" : ""}>Back to Login</button>
        <p class="admin-login-note">Authorized staff only.</p>
      </section>
    </main>
  `;

  bindForgotPasswordEvents();
}

function bindForgotPasswordEvents() {
  const email = document.getElementById("admin-reset-email");
  const form = document.getElementById("admin-forgot-password-form");

  email?.addEventListener("input", (event) => {
    passwordResetEmail = event.target.value;
    passwordResetError = "";
    passwordResetNotice = "";
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitPasswordResetRequest();
  });

  document.querySelector("[data-back-to-login]")?.addEventListener("click", () => {
    passwordResetError = "";
    passwordResetNotice = "";
    navigateTo("/");
    render();
  });

  email?.focus();
}

async function submitPasswordResetRequest() {
  const email = passwordResetEmail.trim();
  if (!email) {
    passwordResetError = "Enter the email address for your admin account.";
    render();
    return;
  }

  passwordResetStatus = "sending";
  passwordResetError = "";
  passwordResetNotice = "";
  render();

  try {
    await requestAdminPasswordReset(email, getAdminPasswordResetRedirectUrl());
    passwordResetStatus = "sent";
    passwordResetNotice = "RESET LINK REQUESTED. CHECK THE EMAIL INBOX FOR THIS ACCOUNT.";
  } catch (error) {
    console.error("Admin password reset request failed.", error);
    passwordResetStatus = "idle";
    passwordResetError = error.message || "Unable to send password reset email. Check the address and try again.";
  }
  render();
}

function renderPasswordSetupScreen(mode = "invite") {
  passwordSetupMode = mode;
  const inviteError = passwordSetupSession?.error || "";
  const isSaving = passwordSetupStatus === "saving";
  const isInvalid = !passwordSetupSession?.access_token || Boolean(inviteError);
  const isRecovery = mode === "recovery";
  const isInvalidRecovery = isRecovery && isInvalid && !passwordSetupSuccess;
  const invalidMessage = isRecovery ? "This password reset link is invalid or has expired." : "Invitation link is expired or invalid.";
  const activeMessage = isRecovery ? "Choose a new password for your Admin Staging account." : "Create your password to activate your staff account.";
  const message = passwordSetupSuccess || inviteError || (isInvalid ? invalidMessage : activeMessage);
  const heading = isInvalidRecovery ? "PASSWORD RESET LINK EXPIRED" : isRecovery ? "Reset Password" : "Set password";

  document.getElementById("root").innerHTML = `
    <main class="admin-access-page">
      <section class="admin-access-card admin-login-card" aria-label="TRRY Admin ${isRecovery ? "password reset" : "password setup"}">
        <div class="admin-access-brand"><strong>TRRY</strong><span>ADMIN PORTAL</span></div>
        <div class="admin-access-heading">
          <h1>${escapeHtml(heading)}</h1>
          <span>${escapeHtml(message)}</span>
        </div>
        ${isInvalidRecovery ? "" : `<form class="admin-access-form" id="admin-password-setup-form">
          <label for="admin-new-password">NEW PASSWORD</label>
          <input id="admin-new-password" value="${escapeHtml(passwordSetupDraft.password)}" type="password" autocomplete="new-password" aria-invalid="${passwordSetupError ? "true" : "false"}" ${isInvalid || isSaving ? "disabled" : ""} />
          <label for="admin-confirm-password">CONFIRM PASSWORD</label>
          <input id="admin-confirm-password" value="${escapeHtml(passwordSetupDraft.confirm)}" type="password" autocomplete="new-password" aria-invalid="${passwordSetupError ? "true" : "false"}" ${isInvalid || isSaving ? "disabled" : ""} />
          ${passwordSetupSuccess ? `<p class="admin-access-success" role="status">${escapeHtml(passwordSetupSuccess)}</p>` : ""}
          ${passwordSetupError ? `<p class="admin-access-error" role="alert">${escapeHtml(passwordSetupError)}</p>` : ""}
          <button type="submit" ${isInvalid || isSaving ? "disabled" : ""}>${isSaving ? "UPDATING..." : isRecovery ? "UPDATE PASSWORD" : "SAVE PASSWORD"}</button>
        </form>`}
        ${isInvalidRecovery ? `<button class="admin-auth-link" data-request-new-reset type="button">REQUEST NEW RESET LINK</button>` : ""}
        ${isInvalid || passwordSetupSuccess ? `<button class="admin-auth-link" data-back-to-login type="button">BACK TO LOGIN</button>` : ""}
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
    passwordSetupSuccess = "";
  });

  confirm?.addEventListener("input", (event) => {
    passwordSetupDraft.confirm = event.target.value;
    passwordSetupError = "";
    passwordSetupSuccess = "";
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitPasswordSetup();
  });

  document.querySelector("[data-back-to-login]")?.addEventListener("click", () => {
    passwordSetupSession = null;
    passwordSetupDraft = { password: "", confirm: "" };
    passwordSetupError = "";
    passwordSetupSuccess = "";
    navigateTo("/login");
    render();
  });

  document.querySelector("[data-request-new-reset]")?.addEventListener("click", () => {
    passwordSetupSession = null;
    passwordSetupDraft = { password: "", confirm: "" };
    passwordSetupError = "";
    passwordSetupSuccess = "";
    navigateTo("/forgot-password");
    render();
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
    if (passwordSetupMode === "recovery") {
      await updateAdminRecoveryPassword(passwordSetupSession, passwordSetupDraft.password);
    } else {
      await updateAdminInvitePassword(passwordSetupSession, passwordSetupDraft.password);
    }
    passwordSetupDraft = { password: "", confirm: "" };
    passwordSetupStatus = "idle";
    passwordSetupError = "";
    passwordSetupSession = null;
    passwordSetupSuccess = "Password updated successfully.";
    adminAuthSession = null;
    adminUser = null;
    adminAuthStatus = "login";
    adminLoginNotice = passwordSetupMode === "recovery"
      ? "Password updated successfully."
      : "PASSWORD SET. YOU CAN NOW SIGN IN.";
    window.history.replaceState({}, "", passwordSetupMode === "recovery" ? "/login?password_reset=1" : "/login?password_set=1");
    render();
  } catch (error) {
    console.error("Admin password setup failed.", error);
    passwordSetupStatus = "idle";
    passwordSetupError = error.message || (passwordSetupMode === "recovery"
      ? "Unable to set password. Try a new recovery link."
      : "Unable to set password. Try a new invitation link.");
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

  document.querySelector("[data-forgot-password]")?.addEventListener("click", () => {
    passwordResetEmail = adminLoginEmail.trim();
    passwordResetStatus = "idle";
    passwordResetError = "";
    passwordResetNotice = "";
    navigateTo("/forgot-password");
    render();
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
    passwordSetupMode = "invite";
    passwordSetupSuccess = "";
    adminAuthStatus = "password-setup";
    if (passwordSetupSession?.access_token) cleanAdminAuthCallbackUrl("/set-password");
    render();
    return;
  }

  if (isPasswordResetRoute()) {
    passwordSetupSession = readRecoverySessionFromUrl();
    passwordSetupMode = "recovery";
    passwordSetupSuccess = "";
    adminAuthStatus = "password-reset";
    if (passwordSetupSession?.access_token) cleanAdminAuthCallbackUrl("/reset-password");
    render();
    return;
  }

  if (isForgotPasswordRoute()) {
    adminAuthStatus = "forgot-password";
    render();
    return;
  }

  if (isLoginRoute()) {
    adminAuthStatus = isSupabaseReady() ? "login" : "access-code";
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
  loadProductCategories();
  loadBrands();
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

async function loadProductCategories() {
  if (hasLoadedProductCategories && categoryLoadState !== "loading") return;
  hasLoadedProductCategories = true;
  categoryLoadState = "loading";
  categoryLoadError = "";

  try {
    const result = await getAdminProductCategories(adminAuthSession);
    const nextCategories = Array.isArray(result?.categories) ? result.categories : [];
    productCategories = sortProductCategories(nextCategories);
    categoryLoadState = result?.status === "error" ? "error" : nextCategories.length ? "success" : "empty";
    categoryLoadError = result?.error?.message ?? "";

    if (!productCategories.some((item) => item.id === selectedCategoryId)) {
      selectedCategoryId = productCategories[0]?.id ?? null;
    }
  } catch (error) {
    console.error("Unable to apply product categories.", error);
    productCategories = [];
    categoryLoadState = "error";
    categoryLoadError = error.message || "Unable to load product categories.";
  } finally {
    render();
  }
}

async function loadBrands() {
  if (hasLoadedBrands && brandLoadState !== "loading") return;
  hasLoadedBrands = true;
  brandLoadState = "loading";
  brandLoadError = "";

  try {
    const result = await getAdminBrands(adminAuthSession);
    const nextBrands = Array.isArray(result?.brands) ? result.brands : [];
    brands = sortBrands(nextBrands);
    brandLoadState = result?.status === "error" ? "error" : nextBrands.length ? "success" : "empty";
    brandLoadError = result?.error?.message ?? "";

    if (!brands.some((item) => item.id === selectedBrandId)) {
      selectedBrandId = brands[0]?.id ?? null;
    }
  } catch (error) {
    console.error("Unable to apply brands.", error);
    brands = [];
    brandLoadState = "error";
    brandLoadError = error.message || "Unable to load brands.";
  } finally {
    render();
  }
}
async function loadOpsBoardInquiries() {
  if (hasLoadedOpsInquiries) return;
  hasLoadedOpsInquiries = true;

  const [result, nativeResult] = await Promise.all([
    getOpsBoardInquiries(localOpsInquiries, adminAuthSession),
    getNativeOrderRows(adminAuthSession),
  ]);
  opsInquiries = result.inquiries;
  opsLoadState = result.status;
  opsLoadError = result.error?.message ?? "";
  nativeOrderRows = nativeResult.rows;
  nativeOrdersLoadState = nativeResult.status;
  nativeOrdersLoadError = nativeResult.error?.message ?? "";

  render();
}

async function loadNativeOrderRows() {
  const result = await getNativeOrderRows(adminAuthSession);
  nativeOrderRows = result.rows;
  nativeOrdersLoadState = result.status;
  nativeOrdersLoadError = result.error?.message ?? "";
  return result;
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

function isFeatureFlagEnabled(...names) {
  return names.some((name) => ["1", "true", "yes", "on"].includes(String(window.TRRY_ADMIN_ENV?.[name] ?? "false").trim().toLowerCase()));
}

function canViewMyTasksRoute() {
  return isTaskFeatureUiEnabled() && isFeatureFlagEnabled("VITE_ENABLE_MY_TASKS", "VITE_MY_TASKS_ENABLED") && ["owner", "admin", "staff"].includes(adminUser?.role);
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
        renderMyTasksTimerTick();
      }, 1000);
    }
    return;
  }
  stopMyTasksTimerTick();
}

function stopMyTasksTimerTick() {
  if (myTasksTickHandle) window.clearInterval(myTasksTickHandle);
  myTasksTickHandle = null;
  myTasksLastFullTickRender = 0;
}

function renderMyTasksTimerTick() {
  updateMyTasksTimerLabels();
  if (isTaskSubmitFieldFocused()) return;
  if (Date.now() - myTasksLastFullTickRender < 5000) return;
  myTasksLastFullTickRender = Date.now();
  render();
}

function updateMyTasksTimerLabels() {
  const taskMap = new Map(myTasks.map((task) => [task.id, task]));
  if (selectedTaskDetail?.task?.id) taskMap.set(selectedTaskDetail.task.id, selectedTaskDetail.task);
  document.querySelectorAll("[data-task-elapsed]").forEach((element) => {
    const task = taskMap.get(element.dataset.taskElapsed);
    if (task?.openTimeEntry?.startedAt) {
      element.textContent = formatElapsed(getRunningElapsedSeconds(task));
    }
  });
}

function isTaskSubmitFieldFocused() {
  const active = document.activeElement;
  return isEditableElement(active) && Boolean(active.closest(".my-task-action-area"));
}

function isEditableElement(element) {
  if (!element) return false;
  const tag = String(element.tagName || "").toLowerCase();
  return ["input", "textarea", "select"].includes(tag) || element.isContentEditable;
}

function canViewWorkboardRoute() {
  return isTaskFeatureUiEnabled() && isFeatureFlagEnabled("VITE_ENABLE_WORKBOARD", "VITE_WORKBOARD_ENABLED") && ["owner", "admin"].includes(adminUser?.role);
}

function canUseAutoPlanTodayUi() {
  return canViewWorkboardRoute() && isFeatureFlagEnabled("VITE_ENABLE_AUTO_PLAN_TODAY", "VITE_AUTO_PLAN_TODAY_ENABLED") && adminUser?.role === "owner";
}

function canViewCalendarRoute() {
  return isTaskFeatureUiEnabled() && isFeatureFlagEnabled("VITE_ENABLE_CALENDAR", "VITE_CALENDAR_ENABLED") && ["owner", "admin", "staff"].includes(adminUser?.role);
}

async function loadTaskCalendar({ silent = false } = {}) {
  if (!canViewCalendarRoute()) return;
  if (!adminAuthSession?.access_token) {
    calendarLoadState = "auth-required";
    calendarLoadError = "Authentication required.";
    calendarEvents = [];
    render();
    return;
  }
  if (!silent) {
    calendarLoadState = "loading";
    calendarLoadError = "";
    render();
  }
  try {
    const response = await getTaskCalendar(adminAuthSession, getCalendarApiFilters());
    calendarEvents = Array.isArray(response.events) ? response.events : [];
    calendarLoadState = "ready";
    calendarLoadError = "";
  } catch (error) {
    calendarLoadState = error.code === "FEATURE_DISABLED" ? "feature-disabled" : error.code === "FORBIDDEN" ? "forbidden" : error.code === "AUTH_REQUIRED" ? "auth-required" : "error";
    calendarLoadError = getTaskErrorMessage(error);
    calendarEvents = [];
  }
  render();
}

function getCalendarApiFilters() {
  const bounds = getCalendarMonthBounds(calendarVisibleMonth);
  return {
    from: bounds.from,
    to: bounds.to,
    assignedUserId: calendarAssigneeFilter,
    sourceType: calendarSourceFilter,
    status: calendarStatusFilter,
  };
}

function getCalendarMonthBounds(monthKey) {
  const [year, month] = String(monthKey || getMonthKey(getManilaTodayKey())).split("-").map(Number);
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: first, to: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}` };
}

function getManilaTodayKey(now = new Date()) {
  return toManilaDateKey(now.toISOString());
}

function getMonthKey(dateKey) {
  return String(dateKey || getManilaTodayKey()).slice(0, 7);
}

function toManilaDateKey(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
    return "";
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function formatManilaTime(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "All day";
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "All day";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
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
    submissionDeadline: task ? toLocalDatetimeInput(task.submissionDeadline || "") : defaultDeadline,
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
    workboardTasks = sortWorkboardTasks(response.tasks || []);
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
    if (workboardFilterStatus === "active" && ["DRAFT", "CANCELLED"].includes(task.status)) return false;
    if (workboardFilterStatus === "overdue" && !isTaskOverdue(task)) return false;
    if (normalized) return [task.taskCode, task.title, task.sourceType, task.priority, task.status, getUserLabel(task.assignedUser), getUserLabel(task.reviewerUser)].join(" ").toLowerCase().includes(normalized);
    return true;
  });
}

function renderWorkboardPage() {
  if (!canViewWorkboardRoute()) {
    return `<section class="mvp-page workboard-page"><div class="mvp-page-title"><div><span>HOME / WORKBOARD</span><h1>Workboard</h1><p>Task planning is not enabled for this account.</p></div></div></section>`;
  }
  const visibleTasks = getVisibleWorkboardTasks();
  return `<section class="mvp-page workboard-page">
    <div class="mvp-page-title">
      <div><span>HOME / WORKBOARD</span><h1>Workboard</h1><p>Plan, assign, review, and monitor canonical task records.</p></div>
      <button class="ops-gold-button" data-workboard-create type="button">CREATE TASK</button>
    </div>
    ${renderWorkboardStateNotice()}
    ${renderAutoPlanTodayPanel()}
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
    ${renderMyTaskMetric("For Review", counts.review, "Owner/Admin")}
    ${renderMyTaskMetric("Needs Revision", counts.revision, "Returned")}
    ${renderMyTaskMetric("Overdue", counts.overdue, "Needs attention")}
    ${renderMyTaskMetric("Done", counts.done, "Completed")}
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

function renderWorkboardSelect(id, value, options, config = {}) {
  return `<select id="${escapeHtml(id)}" ${config.disabled ? "disabled" : ""}>${options.map(([optionValue, label]) => `<option value="${escapeHtml(optionValue)}" ${String(value) === String(optionValue) ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select>`;
}

function renderWorkboardUserSelect(id, value, label) {
  const users = getEligibleAssignmentUsers(false);
  return `<select id="${escapeHtml(id)}"><option value="">${escapeHtml(label)}</option>${users.map((user) => `<option value="${escapeHtml(user.userId)}" ${value === user.userId ? "selected" : ""}>${escapeHtml(getAssignmentUserLabel(user))}</option>`).join("")}</select>`;
}

function renderWorkboardTaskList(tasks) {
  if (!tasks.length) return `<div class="my-tasks-empty"><strong>${workboardTasks.length ? "No tasks match your filters" : "No task records yet"}</strong><span>${workboardTasks.length ? "Try another status or search term." : "Create a manual task draft when planning is ready."}</span>${workboardTasks.length ? `<button data-workboard-clear type="button">CLEAR FILTERS</button>` : ""}</div>`;
  if (workboardFilterStatus === "active") return renderWorkboardKanban(tasks);
  return `<div class="workboard-table-wrap"><table class="workboard-table"><thead><tr><th>Task</th><th>Source</th><th>Priority</th><th>Status</th><th>Assigned</th><th>Reviewer</th><th>Deadline</th><th>Time</th><th>Action</th></tr></thead><tbody>${tasks.map(renderWorkboardRow).join("")}</tbody></table></div><div class="workboard-card-list">${tasks.map(renderWorkboardCard).join("")}</div>`;
}

function renderAutoPlanTodayPanel() {
  if (!canUseAutoPlanTodayUi()) return "";
  const busy = autoPlanState === "submitting";
  const result = autoPlanResult;
  const stateText = getAutoPlanStateText(result);
  return `<section class="auto-plan-panel">
    <div class="auto-plan-heading">
      <div><span>${renderIcon("sparkles", "auto-plan-icon")}AUTO PLAN TODAY</span><p>Create unassigned AI marketing and daily content drafts for Owner review.</p></div>
      <button class="ops-gold-button" data-auto-plan-submit type="button" ${busy ? "disabled" : ""}>${busy ? "GENERATING..." : "GENERATE"}</button>
    </div>
    <label class="auto-plan-direction"><span>Quick Direction</span><textarea id="auto-plan-quick-direction" rows="3" maxlength="500" ${busy ? "disabled" : ""} placeholder="Optional direction for today only.">${escapeHtml(autoPlanQuickDirection)}</textarea></label>
    ${busy ? `<div class="auto-plan-state"><strong>Planning request submitting</strong><span>Waiting for canonical drafts from the configured workflow.</span></div>` : ""}
    ${autoPlanError ? `<div class="auto-plan-state error"><strong>Planning needs attention</strong><span>${escapeHtml(autoPlanError)}</span></div>` : ""}
    ${result ? `<div class="auto-plan-state success"><strong>${escapeHtml(stateText.title)}</strong><span>${escapeHtml(stateText.message)}</span><button data-auto-plan-drafts type="button">OPEN DRAFT VIEW</button></div>` : ""}
  </section>`;
}

function getAutoPlanStateText(result) {
  const count = Number(result?.draftsReceived || 0);
  const trace = result?.traceCode ? ` Trace ${result.traceCode}.` : "";
  if (count >= 2) return { title: `${count} drafts received`, message: `Review the unassigned drafts in Workboard before approval.${trace}` };
  if (count === 1) return { title: "1 draft received", message: `Fewer drafts were returned than expected. Review it before approval.${trace}` };
  if (result?.dispatchStatus === "REQUESTED") return { title: "Plan pending", message: `The planning request is traceable, but no drafts have been ingested yet.${trace}` };
  return { title: "No valid drafts received", message: `No canonical draft was created. Try again after checking the staging workflow.${trace}` };
}

function sortWorkboardTasks(tasks) {
  const now = Date.now();
  return [...tasks].sort((a, b) => getTaskSortWeight(a, now) - getTaskSortWeight(b, now) || compareTaskDate(a, b));
}

function renderWorkboardKanban(tasks) {
  const columns = [
    ["TO_DO", "TO DO", (task) => task.status === "TO_DO"],
    ["IN_PROGRESS", "IN PROGRESS", (task) => ["IN_PROGRESS", "FOR_REVIEW", "NEEDS_REVISION"].includes(task.status)],
    ["DONE", "COMPLETED", (task) => task.status === "DONE"],
  ];
  return `<div class="workboard-kanban" aria-label="Workboard Kanban">${columns.map(([key, label, predicate]) => {
    const items = tasks.filter(predicate);
    return `<section class="workboard-kanban-column" data-workboard-column="${key}"><header><span>${escapeHtml(label)}</span><strong>${items.length}</strong></header><div>${items.length ? items.map(renderWorkboardKanbanCard).join("") : `<article class="workboard-kanban-empty">No tasks</article>`}</div></section>`;
  }).join("")}</div>`;
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
  return `<article class="my-task-card ${task.openTimeEntry ? "running" : ""} ${isTaskOverdue(task) ? "overdue" : ""}">
    <button class="my-task-card-main" data-workboard-open="${escapeHtml(task.id)}" type="button"><span class="my-task-code">${escapeHtml(task.taskCode || "TASK")}</span><strong>${escapeHtml(task.title || "Untitled task")}</strong><small>${escapeHtml(formatSourceType(task.sourceType))} / ${escapeHtml(getUserLabel(task.assignedUser))}</small></button>
    <div class="my-task-card-meta">${renderTaskPriority(task.priority)}${renderTaskStatus(task.status)}<span>${escapeHtml(formatTaskDue(task))}</span><span>${escapeHtml(formatTaskTimeSummary(task))}</span></div>
  </article>`;
}

function renderWorkboardKanbanCard(task) {
  return `<article class="workboard-kanban-card ${task.openTimeEntry ? "running" : ""} ${isTaskOverdue(task) ? "overdue" : ""}">
    <button data-workboard-open="${escapeHtml(task.id)}" type="button">
      <span>${escapeHtml(task.taskCode || "TASK")}</span>
      <strong>${escapeHtml(task.title || "Untitled task")}</strong>
      <small>${escapeHtml(formatSourceType(task.sourceType))} / ${escapeHtml(formatTaskDue(task))}</small>
    </button>
    <div>${renderTaskPriority(task.priority)}${renderTaskStatus(task.status)}${task.status === "FOR_REVIEW" ? `<span class="my-task-mode">FOR REVIEW</span>` : ""}${task.status === "NEEDS_REVISION" ? `<span class="my-task-mode">NEEDS REVISION</span>` : ""}</div>
    <footer><span>${escapeHtml(getUserLabel(task.assignedUser))}</span><button data-workboard-open="${escapeHtml(task.id)}" type="button">${escapeHtml(getWorkboardPrimaryAction(task))}</button></footer>
  </article>`;
}

function getWorkboardPrimaryAction(task) {
  const actions = task.allowedActions || [];
  if (actions.includes("APPROVE_WORK")) return "REVIEW";
  if (actions.includes("REQUEST_REVISION")) return "REVIEW";
  if (actions.includes("APPROVE_AND_ASSIGN")) return "APPROVE AND ASSIGN";
  if (actions.includes("APPROVE_DRAFT")) return "APPROVE DRAFT";
  if (actions.includes("EDIT_DRAFT")) return "EDIT";
  return "OPEN";
}

function renderWorkboardDrawer() {
  if (workboardDrawerMode === "closed") return "";
  const isForm = workboardDrawerMode === "create" || workboardDrawerMode === "edit";
  const detail = selectedTaskDetail;
  const task = detail?.task || workboardTasks.find((item) => item.id === selectedTaskId) || null;
  return `<div class="my-task-drawer-backdrop" data-workboard-close></div><aside class="my-task-drawer workboard-drawer" aria-label="Workboard task details">
    <header><div><span>${escapeHtml(workboardDrawerMode === "create" ? "NEW TASK" : task?.taskCode || "TASK")}</span><h2>${escapeHtml(workboardDrawerMode === "create" ? "Create manual task draft" : task?.title || "Loading task")}</h2></div><button data-workboard-close type="button" aria-label="Close Workboard drawer">X</button></header>
    ${workboardCommandError ? `<div class="ops-persistence-card error"><strong>Action needs attention</strong><span>${escapeHtml(workboardCommandError)}</span></div>` : ""}
    ${isForm ? renderWorkboardDraftForm(task) : renderWorkboardTaskDetail(detail, task)}
  </aside>`;
}

function renderWorkboardDraftForm(task) {
  const busy = workboardCommandState === "saving";
  const isEdit = Boolean(task);
  const isAutomationDraft = isAutomatedTaskSource(workboardDraftForm.sourceType);
  return `<form class="workboard-form" data-workboard-draft-form>
    <label><span>Title</span><input id="workboard-title" value="${escapeHtml(workboardDraftForm.title)}" maxlength="200" ${busy ? "disabled" : ""} /></label>
    <label><span>Brief / instructions</span><textarea id="workboard-brief" rows="5" ${busy ? "disabled" : ""}>${escapeHtml(workboardDraftForm.brief)}</textarea></label>
    <div class="workboard-form-grid">
      <label><span>Source</span>${renderWorkboardSelect("workboard-source-type", workboardDraftForm.sourceType, [["MANUAL", "Manual"], ["PRODUCTION", "Production"], ["SHOP_TASK", "Shop task"], ["AI_MARKETING", "AI marketing"], ["DAILY_CONTENT", "Daily content"]], { disabled: busy || isEdit })}${isEdit ? `<small class="workboard-field-help">Source type is immutable after draft creation.</small>` : ""}</label>
      <label><span>Priority</span>${renderWorkboardSelect("workboard-priority", workboardDraftForm.priority, [["LOW", "Low"], ["MEDIUM", "Medium"], ["HIGH", "High"], ["URGENT", "Urgent"]])}</label>
      <label><span>${isAutomationDraft ? "Assignee selected during approval" : "Assigned"}</span>${renderWorkboardDraftUserSelect("workboard-assigned", isAutomationDraft ? "" : workboardDraftForm.assignedUserId, isAutomationDraft ? "Unassigned until approval" : "Unassigned", { disabled: busy || isAutomationDraft })}</label>
      <label><span>Reviewer</span>${renderWorkboardDraftReviewerSelect("workboard-reviewer", workboardDraftForm.reviewerUserId, "No reviewer")}</label>
      <label><span>Time mode</span>${renderWorkboardSelect("workboard-time-mode", workboardDraftForm.timeTrackingMode, [["EXPECTED", "Expected"], ["NONE", "Time not required"]])}</label>
      <label><span>Scheduled date</span><input id="workboard-scheduled" value="${escapeHtml(workboardDraftForm.scheduledDate)}" type="date" ${busy ? "disabled" : ""} /></label>
      <label><span>Start deadline</span><input id="workboard-start-deadline" value="${escapeHtml(workboardDraftForm.startDeadline)}" type="datetime-local" ${busy ? "disabled" : ""} /></label>
      <label><span>Submission deadline</span><input id="workboard-submission-deadline" value="${escapeHtml(workboardDraftForm.submissionDeadline)}" type="datetime-local" ${busy ? "disabled" : ""} /></label>
      <label><span>Approval deadline</span><input id="workboard-approval-deadline" value="${escapeHtml(workboardDraftForm.approvalDeadline)}" type="datetime-local" ${busy ? "disabled" : ""} /></label>
      <label><span>Source record type</span><input id="workboard-source-record-type" value="${escapeHtml(workboardDraftForm.sourceRecordType)}" maxlength="64" ${busy ? "disabled" : ""} /></label>
      <label><span>Source record id</span><input id="workboard-source-record-id" value="${escapeHtml(workboardDraftForm.sourceRecordId)}" maxlength="200" ${busy ? "disabled" : ""} /></label>
      <label class="workboard-checkbox"><input id="workboard-draft-approval" type="checkbox" ${workboardDraftForm.draftApprovalRequired || isAutomationDraft ? "checked" : ""} ${busy || isAutomationDraft ? "disabled" : ""} /><span>Owner approval required</span></label>
    </div>
    <div class="my-task-action-buttons sticky-actions"><button class="primary" type="submit" ${busy ? "disabled" : ""}>${busy ? "SAVING..." : workboardDrawerMode === "create" ? "CREATE DRAFT" : "SAVE DRAFT"}</button></div>
  </form>`;
}

function renderWorkboardDraftUserSelect(id, value, label, config = {}) {
  const users = getEligibleAssignmentUsers(true);
  return `<select id="${escapeHtml(id)}" ${config.disabled ? "disabled" : ""}><option value="">${escapeHtml(label)}</option>${users.map((user) => `<option value="${escapeHtml(user.userId)}" ${value === user.userId ? "selected" : ""}>${escapeHtml(getAssignmentUserLabel(user))}</option>`).join("")}</select>`;
}

function renderWorkboardTaskDetail(detail, task) {
  if (taskDetailLoadState === "loading") return `<div class="my-tasks-empty"><strong>Loading task detail</strong><span>Fetching canonical task state.</span></div>`;
  if (taskDetailLoadError) return `<div class="ops-persistence-card error"><strong>Unable to open task</strong><span>${escapeHtml(taskDetailLoadError)}</span></div>`;
  if (!detail || !task) return `<div class="my-tasks-empty"><strong>No task selected</strong><span>Select a task to inspect.</span></div>`;
  const latestSubmission = (detail.submissions || []).at(-1) || null;
  return `<div class="my-task-drawer-content">
    <section class="my-task-detail-hero"><div>${renderTaskStatus(task.status)}${renderTaskPriority(task.priority)}${task.timeTrackingMode === "NONE" ? `<span class="my-task-mode">TIME NOT REQUIRED</span>` : ""}${task.openTimeEntry ? `<span class="my-task-mode">RUNNING</span>` : ""}</div><p>${escapeHtml(task.brief || "No brief provided.")}</p>${task.openTimeEntry ? `<strong class="my-task-running-time">${escapeHtml(formatElapsed(getRunningElapsedSeconds(task)))}</strong>` : ""}</section>
    ${renderWorkboardAutomationNotice(task)}
    <section class="my-task-detail-grid">
      ${renderTaskFact("Source", formatSourceReference(task))}
      ${renderTaskFact("Assigned", getUserLabel(task.assignedUser))}
      ${renderTaskFact("Reviewer", getUserLabel(task.reviewerUser))}
      ${renderTaskFact("Scheduled", formatTaskDate(task.scheduledDate))}
      ${renderTaskFact("Start", formatTaskDateTime(task.startDeadline))}
      ${renderTaskFact("Submission", formatTaskDateTime(task.submissionDeadline))}
      ${renderTaskFact("Approval", formatTaskDateTime(task.approvalDeadline))}
      ${renderTaskFact("Recorded", formatTaskTimeSummary(task))}
    </section>
    ${task.status === "DRAFT" ? renderWorkboardPlanningCheck(task) : ""}
    ${latestSubmission ? renderWorkboardLatestSubmission(latestSubmission) : ""}
    ${renderTaskSubmissions(detail.submissions || [])}
    ${renderWorkboardHistory(detail.history || [])}
    ${renderWorkboardActionArea(task)}
  </div>`;
}

function renderWorkboardAutomationNotice(task) {
  if (!isAutomatedTaskSource(task.sourceType)) return "";
  const trace = task.automationTrace || {};
  const suggested = trace.suggestedAssignee?.label || trace.suggestedAssignee?.reason
    ? ` / Suggestion only: ${trace.suggestedAssignee.label || "Unspecified"}${trace.suggestedAssignee.reason ? ` (${trace.suggestedAssignee.reason})` : ""}`
    : "";
  return `<section class="my-task-warning"><strong>AI-GENERATED DRAFT</strong><p>Human approval is required. This task must stay unassigned until Owner approval activates it.</p><small>${escapeHtml(trace.planningRequestId ? `Planning ${trace.planningRequestId}` : "Planning trace pending")} / ${escapeHtml(trace.externalTaskId ? `External task ${trace.externalTaskId}` : "External task pending")}${escapeHtml(suggested)}</small></section>`;
}

function renderWorkboardPlanningCheck(task) {
  const missing = getDraftActivationMissingFields(task);
  const trace = task.automationTrace || {};
  const suggested = trace.suggestedAssignee?.label || trace.suggestedAssignee?.reason
    ? `${trace.suggestedAssignee.label || "Unspecified"}${trace.suggestedAssignee.reason ? ` (${trace.suggestedAssignee.reason})` : ""}`
    : "None";
  return `<section class="workboard-planning-check">
    <div class="workboard-planning-check-header"><strong>PLANNING CHECK</strong>${missing.length ? `<span class="missing">Missing required: ${escapeHtml(missing.join(", "))}</span>` : `<span class="ready">Required planning fields complete</span>`}</div>
    ${missing.length ? `<p class="workboard-planning-guidance">Use EDIT DRAFT to complete required planning fields before activation.</p>` : ""}
    <div class="workboard-planning-groups">
      <div>
        <h4>Required planning fields</h4>
        <div class="my-task-detail-grid compact">
          ${renderPlanningCheckFact("Title", task.title || "Not set", missing.includes("title"))}
          ${renderPlanningCheckFact("Brief / instructions", task.brief || "Not set", missing.includes("brief/instructions"))}
          ${renderPlanningCheckFact("Priority", formatTaskPriorityLabel(task.priority), missing.includes("priority"))}
          ${renderPlanningCheckFact("Time tracking mode", formatTaskTimeMode(task.timeTrackingMode), missing.includes("time tracking mode"))}
          ${renderPlanningCheckFact("Submission deadline", formatTaskDateTime(task.submissionDeadline), missing.includes("submission deadline"))}
          ${renderPlanningCheckFact("Assignee", getUserLabel(task.assignedUser), missing.includes("assignee"))}
          ${renderPlanningCheckFact("Reviewer", getUserLabel(task.reviewerUser), missing.includes("reviewer"))}
        </div>
      </div>
      <div>
        <h4>Optional planning fields</h4>
        <div class="my-task-detail-grid compact">
          ${renderPlanningCheckFact("Scheduled date optional", formatTaskDate(task.scheduledDate))}
          ${renderPlanningCheckFact("Start deadline optional", formatTaskDateTime(task.startDeadline))}
          ${renderPlanningCheckFact("Approval deadline optional", formatTaskDateTime(task.approvalDeadline))}
          ${renderPlanningCheckFact("Suggested assignee", `${suggested} / SUGGESTION ONLY`)}
        </div>
      </div>
    </div>
  </section>`;
}

function renderPlanningCheckFact(label, value, isMissing = false) {
  return `<div class="${isMissing ? "planning-missing" : ""}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "Not set")}</strong></div>`;
}

function renderWorkboardLatestSubmission(submission) {
  return `<section class="my-task-warning ${submission.timeRecordingStatus === "NOT_RECORDED" ? "no-time" : ""}"><strong>LATEST SUBMISSION - ${escapeHtml(formatSubmissionTimeStatus(submission))}</strong><p>${escapeHtml(submission.submissionNote || "No note saved.")}</p>${submission.proofUrl ? `<p><b>Proof:</b> ${escapeHtml(submission.proofUrl)}</p>` : ""}${submission.noTimeReason ? `<p><b>Time not recorded reason:</b> ${escapeHtml(submission.noTimeReason)}</p>` : ""}<small>${escapeHtml(formatTaskDateTime(submission.submittedAt))} / ${escapeHtml(getUserLabel(submission.submittedByUser))}${submission.recordedDurationSeconds !== null ? ` / ${escapeHtml(formatDuration(submission.recordedDurationSeconds))}` : ""}</small></section>`;
}

function renderWorkboardHistory(history) {
  if (!history.length) return "";
  return `<section class="my-task-history"><h3>Audit History</h3>${history.slice(-6).reverse().map((event) => `<article><div><strong>${escapeHtml(String(event.eventType || "EVENT").replace(/_/g, " "))}</strong><span>${escapeHtml(formatTaskDateTime(event.occurredAt))}</span></div>${event.reason ? `<p>${escapeHtml(event.reason)}</p>` : ""}</article>`).join("")}</section>`;
}

function renderWorkboardActionArea(task) {
  const actions = task.allowedActions || [];
  const busy = workboardCommandState === "saving";
  const showAssignAction = actions.includes("ASSIGN") && !(task.status === "DRAFT" && actions.includes("APPROVE_AND_ASSIGN"));
  const approveMissing = actions.includes("APPROVE_AND_ASSIGN") ? getDraftPlanningBlockingFields(task) : [];
  const approveBlocked = approveMissing.length > 0;
  if (!actions.length) return `<section class="my-task-action-area"><strong>No available manager action</strong><span>This task is waiting on another step.</span></section>`;
  return `<section class="my-task-action-area workboard-actions"><strong>Allowed manager actions</strong>
    ${approveBlocked ? `<p class="my-task-form-error" role="status">Complete required planning fields before activation: ${escapeHtml(approveMissing.join(", "))}.</p>` : ""}
    ${actions.includes("REQUEST_REVISION") || actions.includes("APPROVE_WORK") ? `<label><span>Review note</span><textarea id="workboard-review-note" rows="3" ${busy ? "disabled" : ""}>${escapeHtml(workboardReviewNote)}</textarea></label>` : ""}
    ${actions.includes("ASSIGN") || actions.includes("APPROVE_AND_ASSIGN") ? `<label><span>Assignee</span>${renderWorkboardDraftUserSelect("workboard-assign-user", task.assignedUserId || "", "Unassigned")}</label>` : ""}
    ${actions.includes("APPROVE_AND_ASSIGN") ? `<label><span>Reviewer</span>${renderWorkboardDraftReviewerSelect("workboard-assign-reviewer", task.reviewerUserId || "", "Reviewer required")}</label>` : ""}
    ${actions.includes("CANCEL") || actions.includes("REOPEN") ? `<label><span>Reason</span><textarea id="workboard-reason" rows="3" ${busy ? "disabled" : ""}>${escapeHtml(workboardReason)}</textarea></label>` : ""}
    <div class="my-task-action-buttons sticky-actions">
      ${actions.includes("EDIT_DRAFT") ? `<button data-workboard-edit-draft="${escapeHtml(task.id)}" type="button">EDIT DRAFT</button>` : ""}
      ${showAssignAction ? `<button data-workboard-assign="${escapeHtml(task.id)}" ${busy ? "disabled" : ""} type="button">ASSIGN</button>` : ""}
      ${actions.includes("APPROVE_AND_ASSIGN") ? `<button class="primary" data-workboard-approve-assign="${escapeHtml(task.id)}" ${busy || approveBlocked ? "disabled" : ""} type="button">APPROVE AND ASSIGN</button>` : ""}
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

function getEligibleReviewerUsers() {
  return getEligibleAssignmentUsers(true).filter((user) => ["owner", "admin"].includes(String(user.role || "").toLowerCase()));
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

function renderWorkboardDraftReviewerSelect(id, value, label) {
  const users = getEligibleReviewerUsers();
  return `<select id="${escapeHtml(id)}"><option value="">${escapeHtml(label)}</option>${users.map((user) => `<option value="${escapeHtml(user.userId)}" ${value === user.userId ? "selected" : ""}>${escapeHtml(getAssignmentUserLabel(user))}</option>`).join("")}</select>`;
}

function buildWorkboardDraftPayload(task = null) {
  readWorkboardDraftForm();
  const sourceRecordType = workboardDraftForm.sourceRecordType.trim();
  const sourceRecordId = workboardDraftForm.sourceRecordId.trim();
  const isAutomationDraft = isAutomatedTaskSource(task?.sourceType || workboardDraftForm.sourceType);
  return {
    ...(task ? { expectedVersion: task.version } : {}),
    title: workboardDraftForm.title.trim(),
    brief: workboardDraftForm.brief.trim(),
    ...(task ? {} : { sourceType: workboardDraftForm.sourceType }),
    sourceRecordType: sourceRecordType || null,
    sourceRecordId: sourceRecordId || null,
    priority: workboardDraftForm.priority,
    assignedUserId: isAutomationDraft ? null : workboardDraftForm.assignedUserId || null,
    reviewerUserId: workboardDraftForm.reviewerUserId || null,
    timeTrackingMode: workboardDraftForm.timeTrackingMode,
    draftApprovalRequired: isAutomationDraft || workboardDraftForm.draftApprovalRequired,
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
    workboardTasks = sortWorkboardTasks(workboardTasks.map((item) => item.id === selectedTaskDetail.task.id ? selectedTaskDetail.task : item));
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

async function submitAutoPlanToday() {
  if (autoPlanState === "submitting") return;
  autoPlanQuickDirection = document.getElementById("auto-plan-quick-direction")?.value || autoPlanQuickDirection;
  autoPlanState = "submitting";
  autoPlanError = "";
  autoPlanResult = null;
  autoPlanIdempotencyKey = autoPlanIdempotencyKey || createIdempotencyKey("auto-plan");
  render();
  try {
    const response = await requestAutoPlanToday({ quickDirection: autoPlanQuickDirection }, adminAuthSession, autoPlanIdempotencyKey);
    autoPlanResult = response;
    autoPlanState = "received";
    workboardFilterStatus = "draft";
    workboardFilterSource = "";
    await loadWorkboardTasks({ silent: true });
  } catch (error) {
    autoPlanState = "failed";
    autoPlanError = getTaskErrorMessage(error);
  } finally {
    autoPlanIdempotencyKey = "";
    render();
  }
}

function openAutoPlanDraftView() {
  workboardFilterStatus = "draft";
  workboardFilterSource = "";
  loadWorkboardTasks();
}

async function runWorkboardCommand(taskId, action) {
  if (workboardCommandState === "saving") return;
  const task = selectedTaskDetail?.task?.id === taskId ? selectedTaskDetail.task : workboardTasks.find((item) => item.id === taskId);
  if (!task) return;
  workboardReviewNote = document.getElementById("workboard-review-note")?.value || workboardReviewNote;
  workboardReason = document.getElementById("workboard-reason")?.value || workboardReason;
  const commandSelection = readWorkboardCommandSelection();
  const validationMessage = validateWorkboardCommand(action, task, commandSelection);
  if (validationMessage) {
    workboardCommandError = validationMessage;
    render();
    return;
  }
  workboardCommandState = "saving";
  workboardCommandError = "";
  render();
  try {
    const version = task.version;
    let response;
    if (action === "assign") response = await assignTask(taskId, { expectedVersion: version, assignedUserId: commandSelection.assignedUserId }, adminAuthSession, createIdempotencyKey("assign"));
    if (action === "approve-and-assign") response = await approveAndAssignTask(taskId, {
      expectedVersion: version,
      assignedUserId: commandSelection.assignedUserId,
      reviewerUserId: commandSelection.reviewerUserId,
      startDeadline: task.startDeadline || null,
      submissionDeadline: task.submissionDeadline || null,
      approvalDeadline: task.approvalDeadline || null,
    }, adminAuthSession, createIdempotencyKey("approve-and-assign"));
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

function readWorkboardCommandSelection() {
  return {
    assignedUserId: document.getElementById("workboard-assign-user")?.value
      || document.getElementById("workboard-assigned")?.value
      || null,
    reviewerUserId: document.getElementById("workboard-assign-reviewer")?.value
      || document.getElementById("workboard-reviewer")?.value
      || null,
  };
}

function validateWorkboardCommand(action, task, selection) {
  if (action === "approve-and-assign") {
    const missing = getDraftActivationMissingFields({
      ...task,
      assignedUserId: selection.assignedUserId,
      reviewerUserId: selection.reviewerUserId,
    });
    if (missing.length) return `Complete required planning fields before activation: ${missing.join(", ")}.`;
    if (!getEligibleAssignmentUsers(true).some((user) => user.userId === selection.assignedUserId)) {
      return "Selected assignee is not eligible for task assignment.";
    }
    if (!getEligibleReviewerUsers().some((user) => user.userId === selection.reviewerUserId)) {
      return "Selected reviewer is not eligible to review tasks.";
    }
  }
  if (action === "assign" && task.status !== "DRAFT" && selection.assignedUserId
      && !getEligibleAssignmentUsers(true).some((user) => user.userId === selection.assignedUserId)) {
    return "Selected assignee is not eligible for task assignment.";
  }
  return "";
}

function getDraftActivationMissingFields(task) {
  const missing = [];
  if (!String(task?.title || "").trim()) missing.push("title");
  if (!String(task?.brief || "").trim()) missing.push("brief/instructions");
  if (!TASK_PRIORITIES.has(String(task?.priority || "").toUpperCase())) missing.push("priority");
  if (!TASK_TIME_TRACKING_MODES.has(String(task?.timeTrackingMode || "").toUpperCase())) missing.push("time tracking mode");
  if (!task?.assignedUserId) missing.push("assignee");
  if (!task?.reviewerUserId) missing.push("reviewer");
  if (!task?.submissionDeadline) missing.push("submission deadline");
  return missing;
}

function getDraftPlanningBlockingFields(task) {
  return getDraftActivationMissingFields(task).filter((field) => !["assignee", "reviewer"].includes(field));
}

function isAutomatedTaskSource(sourceType) {
  return ["AI_MARKETING", "DAILY_CONTENT"].includes(String(sourceType || "").toUpperCase());
}

function formatTaskPriorityLabel(priority) {
  return TASK_PRIORITY_LABELS[priority] || priority || "Not set";
}

function formatTaskTimeMode(mode) {
  if (mode === "NONE") return "Time not required";
  if (mode === "EXPECTED") return "Expected";
  return "Not set";
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
  return `<section class="my-tasks-running-pin"><div><span>RUNNING</span><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.taskCode)} / <span data-task-elapsed="${escapeHtml(task.id)}">${escapeHtml(formatElapsed(getRunningElapsedSeconds(task)))}</span></small></div><button class="ops-gold-button mini" data-task-open="${escapeHtml(task.id)}" type="button">OPEN TASK</button></section>`;
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
      <span>${task.openTimeEntry ? `<span data-task-elapsed="${escapeHtml(task.id)}">${escapeHtml(formatElapsed(getRunningElapsedSeconds(task)))}</span>` : escapeHtml(formatDuration(task.totalClosedDurationSeconds))}</span>
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
      ${task.openTimeEntry ? `<strong class="my-task-running-time" data-task-elapsed="${escapeHtml(task.id)}">${escapeHtml(formatElapsed(getRunningElapsedSeconds(task)))}</strong>` : ""}
    </section>
    ${latestRevision ? `<section class="my-task-warning"><strong>REVISION NOTE</strong><p>${escapeHtml(latestRevision.reviewNote)}</p></section>` : ""}
    <section class="my-task-detail-grid">
      ${renderTaskFact("Source", formatSourceType(task.sourceType))}
      ${renderTaskFact("Scheduled", formatTaskDate(task.scheduledDate))}
      ${renderTaskFact("Deadline", formatTaskDateTime(task.submissionDeadline))}
      ${renderTaskFact("Assigned", getUserLabel(task.assignedUser))}
      ${renderTaskFact("Reviewer", getUserLabel(task.reviewerUser))}
      ${renderTaskFact("Recorded Time", task.openTimeEntry ? `<span data-task-elapsed="${escapeHtml(task.id)}">${escapeHtml(formatElapsed(getRunningElapsedSeconds(task)))}</span>` : formatDuration(task.totalClosedDurationSeconds), { html: Boolean(task.openTimeEntry) })}
    </section>
    ${renderTaskSubmissions(detail.submissions || [])}
    ${renderTaskActionArea(task, latestSubmission)}
  </div>`;
}

function renderTaskFact(label, value, options = {}) {
  return `<div><span>${escapeHtml(label)}</span><strong>${options.html ? value : escapeHtml(value || "-")}</strong></div>`;
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
  workboardTasks = sortWorkboardTasks(upsertTaskRecord(workboardTasks, response.task));
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
    workboardTasks = sortWorkboardTasks(upsertTaskRecord(workboardTasks, detail.task));
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

function renderCalendarPage() {
  if (!canViewCalendarRoute()) {
    return `<section class="mvp-page calendar-page"><div class="mvp-page-title"><div><span>HOME / CALENDAR</span><h1>Calendar</h1><p>Task calendar is not enabled in this environment.</p></div></div></section>`;
  }
  const monthLabel = formatCalendarMonth(calendarVisibleMonth);
  const selectedEvents = getCalendarEventsForDate(calendarSelectedDate);
  const blockedState = ["auth-required", "error", "forbidden", "feature-disabled"].includes(calendarLoadState);
  return `<section class="mvp-page calendar-page">
    <div class="mvp-page-title">
      <div><span>HOME / CALENDAR</span><h1>Calendar</h1><p>Read-only task schedule projected from canonical task dates.</p></div>
      <strong>Asia/Manila</strong>
    </div>
    ${renderCalendarStateNotice()}
    ${blockedState ? "" : `<div class="calendar-toolbar">
      <div class="calendar-toolbar-main">
        <div class="calendar-month-nav" aria-label="Calendar month navigation">
          <button class="calendar-icon-button" data-calendar-prev type="button" aria-label="Previous month">${renderIcon("chevron-right", "calendar-prev-icon")}</button>
          <strong>${escapeHtml(monthLabel)}</strong>
          <button class="calendar-icon-button" data-calendar-next type="button" aria-label="Next month">${renderIcon("chevron-right", "calendar-next-icon")}</button>
        </div>
        <button class="calendar-today-button" data-calendar-today type="button">TODAY</button>
      </div>
      ${renderCalendarFilters()}
    </div>
    ${renderCalendarLegend()}`}
    ${calendarLoadState === "loading" ? `<div class="my-tasks-empty"><strong>Loading Calendar</strong><span>Projecting permitted task dates.</span></div>` : ""}
    ${calendarLoadState === "ready" ? `${calendarEvents.length ? "" : renderCalendarEmptyState()}<div class="calendar-layout">${renderCalendarMonthGrid()}${renderCalendarAgenda(selectedEvents)}</div>` : ""}
    ${renderCalendarTaskSummary()}
  </section>`;
}

function renderCalendarStateNotice() {
  if (calendarLoadState === "auth-required") return `<div class="calendar-auth-required ops-persistence-card error"><strong>Authentication required</strong><span>${escapeHtml(calendarLoadError || "Log in again to view the read-only task Calendar.")}</span><button data-calendar-login-again type="button">LOGIN AGAIN</button></div>`;
  if (calendarLoadState === "error") return `<div class="ops-persistence-card error"><strong>Unable to load Calendar</strong><span>${escapeHtml(calendarLoadError)}</span></div>`;
  if (calendarLoadState === "forbidden") return `<div class="ops-persistence-card error"><strong>Calendar access is restricted</strong><span>${escapeHtml(calendarLoadError || "Your account cannot view task calendar records.")}</span></div>`;
  if (calendarLoadState === "feature-disabled") return `<div class="ops-persistence-card"><strong>Calendar unavailable</strong><span>The task domain is disabled for this environment.</span></div>`;
  return "";
}

function renderCalendarLegend() {
  const items = [
    ["scheduledStart", "Scheduled start"],
    ["taskDeadline", "Submission deadline"],
    ["reviewDeadline", "Review deadline"],
    ["completed", "Completion date"],
    ["overdue", "Overdue"],
  ];
  return `<div class="calendar-legend" aria-label="Calendar projection legend">${items.map(([key, label]) => `<span><i class="${escapeHtml(key)}"></i>${escapeHtml(label)}</span>`).join("")}</div>`;
}

function renderCalendarEmptyState() {
  const hasFilters = Boolean(calendarAssigneeFilter || calendarSourceFilter || calendarStatusFilter);
  return `<div class="my-tasks-empty compact"><strong>${hasFilters ? "No matching dated tasks" : "No dated tasks this month"}</strong><span>${hasFilters ? "Clear filters to return to the full read-only task schedule." : "Tasks without canonical dates are intentionally not projected as Calendar events."}</span></div>`;
}

function renderCalendarFilters() {
  const assignees = [...new Map(calendarEvents.map((event) => [event.assignedUserId, { ...event.assignee, userId: event.assignedUserId }]).filter(([id]) => id)).values()];
  const sources = [...new Set(calendarEvents.map((event) => event.sourceType).filter(Boolean))].sort();
  const statuses = ["DRAFT", "TO_DO", "IN_PROGRESS", "FOR_REVIEW", "NEEDS_REVISION", "DONE", "CANCELLED"];
  return `<div class="calendar-filters" aria-label="Calendar filters">
    <select id="calendar-assignee-filter"><option value="">All assignees</option>${assignees.map((user) => `<option value="${escapeHtml(user.userId)}" ${calendarAssigneeFilter === user.userId ? "selected" : ""}>${escapeHtml(getUserLabel(user))}</option>`).join("")}</select>
    <select id="calendar-source-filter"><option value="">All sources</option>${sources.map((source) => `<option value="${escapeHtml(source)}" ${calendarSourceFilter === source ? "selected" : ""}>${escapeHtml(formatSourceType(source))}</option>`).join("")}</select>
    <select id="calendar-status-filter"><option value="">All statuses</option>${statuses.map((status) => `<option value="${escapeHtml(status)}" ${calendarStatusFilter === status ? "selected" : ""}>${escapeHtml(formatTaskStatus(status))}</option>`).join("")}</select>
    <button data-calendar-clear type="button">CLEAR</button>
  </div>`;
}

function renderCalendarMonthGrid() {
  const days = buildCalendarDays(calendarVisibleMonth);
  const byDate = groupCalendarEventsByDate(calendarEvents);
  const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `<section class="calendar-month-view" aria-label="Month view">
    <div class="calendar-weekdays">${weekdayLabels.map((day) => `<span>${day}</span>`).join("")}</div>
    <div class="calendar-grid">${days.map((day) => renderCalendarDay(day, byDate.get(day.key) || [])).join("")}</div>
  </section>`;
}

function renderCalendarDay(day, events) {
  const visibleEvents = events.slice(0, 3);
  const more = events.length - visibleEvents.length;
  return `<button class="calendar-day ${day.inMonth ? "" : "muted"} ${day.key === calendarSelectedDate ? "selected" : ""} ${day.key === getManilaTodayKey() ? "today" : ""}" data-calendar-date="${escapeHtml(day.key)}" type="button">
    <span class="calendar-day-number"><b>${escapeHtml(String(day.day))}</b>${day.key === getManilaTodayKey() ? `<em>Today</em>` : ""}</span>
    <div>${visibleEvents.map(renderCalendarDayItem).join("")}${more > 0 ? `<small class="calendar-more">+${more} more</small>` : ""}</div>
  </button>`;
}

function renderCalendarDayItem(event) {
  return `<i class="calendar-dot ${escapeHtml(event.projectionTypeKey)} ${event.overdue ? "overdue" : ""}"><span>${escapeHtml(shortProjectionType(event.projectionType))}</span><strong>${escapeHtml(event.taskCode || "TASK")}</strong><small>${escapeHtml(shortTaskTitle(event.title || "Untitled task"))}</small></i>`;
}

function renderCalendarAgenda(events) {
  const title = formatCalendarDateHeading(calendarSelectedDate);
  return `<section class="calendar-agenda" aria-label="Agenda view">
    <header><span>AGENDA</span><h2>${escapeHtml(title)}</h2></header>
    ${events.length ? events.map(renderCalendarAgendaItem).join("") : `<div class="my-tasks-empty compact"><strong>No dated tasks</strong><span>No permitted task projections for this date.</span></div>`}
  </section>`;
}

function renderCalendarAgendaItem(event) {
  return `<article class="calendar-agenda-item ${event.overdue ? "overdue" : ""}">
    <button data-calendar-event="${escapeHtml(event.key)}" type="button" aria-label="Open ${escapeHtml(event.taskCode || "task")} Calendar summary">
      <span class="calendar-agenda-type ${escapeHtml(event.projectionTypeKey)}">${escapeHtml(event.projectionType)}</span>
      <span class="calendar-agenda-time">${escapeHtml(formatManilaTime(event.dateTime))}</span>
      <strong><span>${escapeHtml(event.taskCode || "TASK")}</span>${escapeHtml(event.title || "Untitled task")}</strong>
      <div class="calendar-agenda-meta" aria-label="Calendar task metadata">
        <small><b>Status</b>${escapeHtml(formatTaskStatus(event.status))}</small>
        <small><b>Source</b>${escapeHtml(formatSourceType(event.sourceType))}</small>
        <small><b>Assignee</b>${escapeHtml(getUserLabel(event.assignee))}</small>
      </div>
    </button>
    <div class="calendar-agenda-badges">${renderTaskPriority(event.priority)}${event.overdue ? `<span class="my-task-status overdue">OVERDUE</span>` : ""}</div>
  </article>`;
}

function renderCalendarTaskSummary() {
  if (!calendarSelectedTask) return "";
  return `<div class="my-task-drawer-backdrop" data-calendar-close></div><aside class="my-task-drawer calendar-drawer" aria-label="Calendar task summary">
    <header><div><span>${escapeHtml(calendarSelectedTask.taskCode || "TASK")}</span><h2>${escapeHtml(calendarSelectedTask.title || "Untitled task")}</h2></div><button data-calendar-close type="button" aria-label="Close Calendar summary">X</button></header>
    <div class="my-task-drawer-content">
      <section class="my-task-detail-hero"><div>${renderTaskStatus(calendarSelectedTask.status)}${renderTaskPriority(calendarSelectedTask.priority)}</div><p>Read-only Calendar projection. Use Workboard or My Tasks for permitted task detail and actions.</p></section>
      <section class="my-task-detail-grid">
        ${renderTaskFact("Projection", calendarSelectedTask.projectionType)}
        ${renderTaskFact("When", `${calendarSelectedTask.dateKey} ${formatManilaTime(calendarSelectedTask.dateTime)}`)}
        ${renderTaskFact("Source", formatSourceType(calendarSelectedTask.sourceType))}
        ${renderTaskFact("Assigned", getUserLabel(calendarSelectedTask.assignee))}
      </section>
      <section class="my-task-action-area"><strong>Read only</strong><span>Calendar cannot create, reschedule, assign, transition, or delete tasks.</span></section>
    </div>
  </aside>`;
}

function buildCalendarDays(monthKey) {
  const [year, month] = String(monthKey).split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const startOffset = first.getUTCDay();
  const start = new Date(Date.UTC(year, month - 1, 1 - startOffset));
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getTime() + index * 86400000);
    const key = date.toISOString().slice(0, 10);
    return { key, day: date.getUTCDate(), inMonth: date.getUTCMonth() === month - 1 };
  });
}

function groupCalendarEventsByDate(events) {
  const grouped = new Map();
  for (const event of events) {
    if (!grouped.has(event.dateKey)) grouped.set(event.dateKey, []);
    grouped.get(event.dateKey).push(event);
  }
  return grouped;
}

function getCalendarEventsForDate(dateKey) {
  return calendarEvents.filter((event) => event.dateKey === dateKey);
}

function shiftCalendarMonth(delta) {
  const [year, month] = calendarVisibleMonth.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1 + delta, 1));
  calendarVisibleMonth = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
  calendarSelectedDate = getCalendarMonthBounds(calendarVisibleMonth).from;
  calendarSelectedTask = null;
  loadTaskCalendar();
}

function formatCalendarMonth(monthKey) {
  const [year, month] = String(monthKey).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function formatCalendarDateHeading(dateKey) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

function shortProjectionType(type) {
  if (type === "SCHEDULED START") return "Start";
  if (type === "TASK DEADLINE") return "Due";
  if (type === "REVIEW DEADLINE") return "Review";
  return "Done";
}

function shortTaskTitle(title) {
  const value = String(title || "").trim();
  return value.length > 28 ? `${value.slice(0, 25)}...` : value;
}

function getMvpDashboardItems() {
  return opsInquiries.map((item) => ({
    ...item,
    ...getNativeOrderIdentityForInquiry(item.id),
    orderCreationState: nativeOrderConversionRequests[item.id]?.status || "",
    orderCreationError: nativeOrderConversionRequests[item.id]?.message || "",
    requiresProductionMigration: shouldLoadSupabaseOps && !item.productionFieldsReady,
  }));
}

function getMvpOrderItems() {
  const inquiries = getMvpDashboardItems();
  return buildDualReadOrders({
    inquiries,
    nativeRows: nativeOrderRows,
  });
}

function getNativeOrderIdentityForInquiry(inquiryId) {
  const row = findNativeOrderRowBySourceInquiryId(inquiryId);
  if (!row) return {};
  return {
    nativeOrderId: row.id || "",
    nativeOrderReference: row.order_reference || row.orderReference || "",
    nativeOrderStatus: row.status || "",
  };
}

function findNativeOrderRowBySourceInquiryId(inquiryId) {
  return findNativeOrderBySourceInquiryId(nativeOrderRows, inquiryId);
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
    renderArtwork: renderMvpArtworkAction,
  });
}

function renderMvpOrdersPage() {
  return mvpDashboard.renderOrders({
    items: getMvpOrderItems(),
    notices: `${renderOpsPersistenceNotice()}${renderNativeOrdersPersistenceNotice()}`,
    schemaNotice: renderOrderDashboardSchemaNotice(),
    renderPayment: renderMvpPaymentConfirmation,
    renderTracking: renderOpsCustomerTracking,
  });
}

function renderMvpProductionPage() {
  return mvpDashboard.renderProduction({
    items: getMvpOrderItems(),
    notices: `${renderOpsPersistenceNotice()}${renderNativeOrdersPersistenceNotice()}`,
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

function renderNativeOrdersPersistenceNotice() {
  if (!shouldLoadSupabaseOps) return "";
  if (nativeOrdersLoadState === "success" || nativeOrdersLoadState === "empty") return "";
  if (nativeOrdersLoadState === "loading") {
    return `<section class="ops-persistence-card"><strong>Loading native Orders</strong><span>Reading TRRY Orders alongside legacy inquiry orders...</span></section>`;
  }
  if (nativeOrdersLoadState === "missing-table") {
    return `<section class="ops-persistence-card"><strong>Native Orders table is not exposed yet</strong><span>Showing legacy inquiry-derived orders only.</span></section>`;
  }
  if (nativeOrdersLoadState === "error") {
    return `<section class="ops-persistence-card error"><strong>Unable to load native Orders</strong><span>${escapeHtml(nativeOrdersLoadError || "Showing legacy inquiry-derived orders only.")}</span></section>`;
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
    return `<section class="mvp-drawer-section mvp-artwork-access"><h3>Artwork</h3><strong>NO ARTWORK</strong><span>No customer artwork file or supported URL is saved for this inquiry.</span></section>`;
  }

  return `<section class="mvp-drawer-section mvp-artwork-access"><h3>Artwork</h3><strong>${escapeHtml(getOpsCustomerActionLabel("artwork", status || "missing"))}</strong><button class="ops-dark-button mini" data-ops-customer-asset="customer-artwork" data-ops-customer-id="${escapeHtml(item.id)}" type="button" ${isLoading ? "disabled" : ""}>${renderIcon("external-link", "ops-button-icon")}${isLoading ? "OPENING..." : "VIEW ARTWORK"}</button>${message}</section>`;
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

function renderMvpPaymentConfirmation(item) {
  const request = mvpPaymentConfirmationRequests[item.id] || {};
  const status = String(item.paymentStatus || "").trim().toLowerCase();
  const paid = Number(item.paymentVerifiedAmount ?? item.paymentConfirmedAmount ?? 0) || 0;
  const total = Number(item.quotedAmount || item.amountDue || 0) || 0;
  const balance = Math.max(Math.round((total - paid) * 100) / 100, 0);
  const isLoading = request.status === "loading";
  const isPaid = ["paid", "confirmed", "full_payment_confirmed"].includes(status) && balance <= 0;
  const isShop = ["pay_at_shop", "payment_pending_at_shop"].includes(status) || String(item.paymentType || "").toLowerCase() === "shop";
  const isOnline = ["proof_submitted", "under_review", "required", "correction_required"].includes(status) || String(item.paymentMethod || "").toLowerCase() === "online";

  if (isPaid) {
    return `<section class="mvp-drawer-section mvp-payment-confirmation"><h3>Payment Confirmation</h3><p class="mvp-inline-note">PAYMENT CONFIRMED. ${escapeHtml(formatOpsValue(paid))} recorded${item.paymentConfirmedAt ? ` / ${escapeHtml(formatOpsTrackingDate(item.paymentConfirmedAt))}` : ""}.</p></section>`;
  }

  if (balance <= 0) {
    return `<section class="mvp-drawer-section mvp-payment-confirmation"><h3>Payment Confirmation</h3><p class="mvp-inline-note">No outstanding balance is available for payment confirmation.</p></section>`;
  }

  const title = isOnline && !isShop ? "REVIEW & CONFIRM ONLINE PAYMENT" : "RECORD PAYMENT RECEIVED";
  const warning = isShop
    ? "Confirm only after staff receives payment at the shop."
    : isOnline
      ? "Review the Messenger receipt before confirming. This does not use in-app receipt upload."
      : "Record only money actually received by TRRY.";
  const message = request.status === "error"
    ? `<p class="mvp-payment-message error" data-mvp-payment-message>${escapeHtml(request.message || "Payment confirmation failed.")}</p>`
    : request.status === "success"
      ? `<p class="mvp-payment-message" data-mvp-payment-message>${escapeHtml(request.message || "Payment confirmation saved.")}</p>`
      : `<p class="mvp-payment-message" data-mvp-payment-message>${escapeHtml(warning)}</p>`;

  return `<section class="mvp-drawer-section mvp-payment-confirmation" data-mvp-payment-confirmation="${escapeHtml(item.id)}"><h3>${title}</h3><div class="mvp-payment-warning"><strong>FINANCIAL ACTION</strong><span>${escapeHtml(warning)}</span></div><div class="mvp-payment-form"><label><span>Amount received</span><input data-mvp-payment-field="amountReceived" min="0.01" max="${escapeHtml(String(balance))}" step="0.01" type="number" value="${escapeHtml(balance || total || "")}" ${isLoading ? "disabled" : ""} /></label><label><span>Payment source</span><select data-mvp-payment-field="paymentSource" ${isLoading ? "disabled" : ""}><option value="cash">Cash</option><option value="gcash">GCash</option><option value="card">Card</option><option value="bank_transfer">Bank Transfer</option></select></label><label><span>Reference number</span><input data-mvp-payment-field="referenceNumber" type="text" value="${escapeHtml(item.paymentReference || "")}" ${isLoading ? "disabled" : ""} /></label><label class="wide"><span>Internal note</span><textarea data-mvp-payment-field="internalNote" rows="2" ${isLoading ? "disabled" : ""}>${escapeHtml(item.paymentInternalNote || "")}</textarea></label></div>${message}<button class="mvp-primary-action" type="button" data-mvp-confirm-payment="${escapeHtml(item.id)}" ${isLoading || balance <= 0 ? "disabled" : ""}>${isLoading ? "CONFIRMING..." : `CONFIRM ${escapeHtml(formatOpsValue(balance || total))} PAYMENT`}</button></section>`;
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
    dueDate: fieldValue("dueDate"),
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
  if (!["publish_quote", "save_quote_draft", "revise_quote", "mark_quote_pending", "set_due_date", "approve_artwork", "require_payment", "request_new_payment_proof"].includes(action)) return "";

  const quotedAmountText = String(body.quotedAmount ?? "").trim();
  const amountDueText = String(body.amountDue ?? "").trim();
  const quotedAmount = parseOpsQuoteMoney(quotedAmountText);
  const amountDue = amountDueText ? parseOpsQuoteMoney(amountDueText) : quotedAmount;
  const validUntil = String(body.quoteValidUntil || "").trim();
  const dueDate = String(body.dueDate || "").trim();

  if (action === "set_due_date" && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return "ENTER AN AGREED DUE DATE\nChoose the due date agreed with the customer before creating an Order.";
  }

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
  if (action === "set_due_date") return "SAVING...";
  if (action === "require_payment") return "REQUESTING...";
  if (action === "confirm_payment" || action === "confirm_cash_payment") return "CONFIRMING...";
  if (action === "request_new_payment_proof") return "REQUESTING...";
  return "SAVING...";
}

function getOpsActionSavingMessage(action) {
  if (action === "publish_quote") return "SENDING QUOTE...";
  if (action === "set_due_date") return "SAVING AGREED DUE DATE...";
  if (action === "require_payment") return "REQUESTING PAYMENT...";
  if (action === "confirm_payment" || action === "confirm_cash_payment") return "CONFIRMING PAYMENT...";
  if (action === "request_new_payment_proof") return "REQUESTING NEW RECEIPT...";
  return "SAVING CUSTOMER ACTION...";
}

function getOpsActionSuccessMessage(action) {
  if (action === "save_quote_draft") return "QUOTE DRAFT SAVED.";
  if (action === "publish_quote") return "QUOTE PUBLISHED FOR CUSTOMER.";
  if (action === "set_due_date") return "AGREED DUE DATE SAVED.";
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

}
function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}
function renderOpsOdooAction(item) {
  const orderText = item.orderReference || item.orderCode || item.reference || "";
  return `<div class="ops-so-editor ops-order-confirm-card"><strong>NATIVE ORDER REQUIRED</strong><p>${orderText ? `Linked native order: ${escapeHtml(orderText)}` : "Create native TRRY Orders from the Inquiry drawer."}</p></div>`;
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
  mergeNativeOrderPayload(payload.order);
  return payload;
}

async function requestNativeOrderConversion(inquiryId) {
  const response = await fetch(`/api/inquiries/${encodeURIComponent(inquiryId)}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(adminAuthSession?.access_token ? { Authorization: `Bearer ${adminAuthSession.access_token}` } : {}),
    },
    body: JSON.stringify({}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok || !payload?.order) {
    const message = payload?.error || "Native Order creation failed.";
    const code = payload?.code ? ` (${payload.code})` : "";
    throw new Error(`${message}${code}`);
  }
  return payload;
}

async function createNativeOrderFromInquiry(inquiryId) {
  const id = String(inquiryId || "").trim();
  if (!id || nativeOrderConversionRequests[id]?.status === "loading") return;
  const existing = findNativeOrderRowBySourceInquiryId(id);
  if (existing) {
    navigateTo(`/orders?order=${encodeURIComponent(existing.order_reference || existing.orderReference || existing.id)}`);
    render();
    return;
  }

  nativeOrderConversionRequests = {
    ...nativeOrderConversionRequests,
    [id]: { status: "loading", message: "" },
  };
  render();

  try {
    const payload = await requestNativeOrderConversion(id);
    const row = normalizeNativeOrderResponseToRow(payload.order);
    let optimisticNativeRows = nativeOrderRows;
    if (row) {
      optimisticNativeRows = [
        row,
        ...nativeOrderRows.filter((item) => String(item?.source_inquiry_id || item?.sourceInquiryId || "").trim().toLowerCase() !== id.toLowerCase()),
      ];
      nativeOrderRows = optimisticNativeRows;
    }
    const refresh = await loadNativeOrderRows().catch(() => null);
    if (!refresh || ["error", "missing-table"].includes(refresh.status)) nativeOrderRows = optimisticNativeRows;
    nativeOrderConversionRequests = {
      ...nativeOrderConversionRequests,
      [id]: { status: "success", message: payload.created ? "Native Order created." : "Native Order already exists." },
    };
    const order = payload.order;
    const routeIdentity = order.orderReference || order.id || id;
    navigateTo(`/orders?order=${encodeURIComponent(routeIdentity)}`);
  } catch (error) {
    console.error("Unable to create native TRRY Order.", error);
    nativeOrderConversionRequests = {
      ...nativeOrderConversionRequests,
      [id]: { status: "error", message: error.message || "Native Order creation failed." },
    };
  } finally {
    render();
  }
}

async function requestMvpPaymentConfirmation(inquiryId, body) {
  const response = await fetch(`/api/inquiries/${encodeURIComponent(inquiryId)}/payment-confirmations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(adminAuthSession?.access_token ? { Authorization: `Bearer ${adminAuthSession.access_token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Payment confirmation failed.");
  mergeNativeOrderPayload(payload.order);
  return payload;
}

function mergeNativeOrderPayload(order) {
  const row = normalizeNativeOrderResponseToRow(order);
  if (!row) return;
  const sourceId = String(row.source_inquiry_id || row.sourceInquiryId || "").trim().toLowerCase();
  const orderId = String(row.id || "").trim().toLowerCase();
  nativeOrderRows = [
    row,
    ...nativeOrderRows.filter((item) => {
      const itemSourceId = String(item?.source_inquiry_id || item?.sourceInquiryId || "").trim().toLowerCase();
      const itemOrderId = String(item?.id || "").trim().toLowerCase();
      return itemSourceId !== sourceId && itemOrderId !== orderId;
    }),
  ];
}

async function confirmMvpOrderPayment(inquiryId, form) {
  if (!inquiryId || mvpPaymentConfirmationRequests[inquiryId]?.status === "loading") return;
  const amountReceived = Number(String(form.amountReceived || "").replace(/,/g, ""));
  if (!Number.isFinite(amountReceived) || amountReceived <= 0) {
    mvpPaymentConfirmationRequests = { ...mvpPaymentConfirmationRequests, [inquiryId]: { status: "error", message: "Enter a positive amount received." } };
    return;
  }

  mvpPaymentConfirmationRequests = { ...mvpPaymentConfirmationRequests, [inquiryId]: { status: "loading", message: "Saving payment confirmation..." } };
  render();

  try {
    const payload = await requestMvpPaymentConfirmation(inquiryId, {
      ...form,
      amountReceived,
      idempotencyKey: `admin-payment-${inquiryId}-${amountReceived}-${Date.now()}`,
    });
    if (!payload?.inquiry) throw new Error("Payment confirmation returned no saved order.");
    opsInquiries = opsInquiries.map((item) => item.id === inquiryId ? { ...item, ...payload.inquiry } : item);
    mvpPaymentConfirmationRequests = { ...mvpPaymentConfirmationRequests, [inquiryId]: { status: "success", message: "Payment confirmation saved." } };
  } catch (error) {
    mvpPaymentConfirmationRequests = { ...mvpPaymentConfirmationRequests, [inquiryId]: { status: "error", message: error.message || "Payment confirmation failed." } };
  }
}

function getAssignmentUserById(userId) {
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
  const editorRoute = getCatalogProductEditorRoute();
  if (editorRoute) {
    return renderCatalogProductEditorPage(editorRoute);
  }
  if (getRoutePath() === "/catalog/brands") {
    return renderCatalogBrandsPage();
  }
  if (getRoutePath() === "/catalog/categories") {
    return renderCatalogCategoriesPage();
  }

  const visibleProducts = getVisibleCatalogProducts();
  const canWriteCatalog = canWriteCatalogProducts();
  const brandOptions = getCatalogBrandOptions();
  const categoryOptions = getCatalogCategoryOptions();
  const summaryCards = getCatalogProductSummaryCards(visibleProducts);

  return `
    <main class="orders-page catalog-page admin-saas-page">
      <div class="page-heading catalog-heading">
        <div>
          <h1>Master Catalog</h1>
          <p class="subtitle">Manage products, variants, cost, and selling price from one source of truth.</p>
        </div>
        ${canWriteCatalog ? `<button class="catalog-add-button" data-catalog-add-product type="button">+ New Product</button>` : ""}
      </div>

      <section class="catalog-summary-grid" aria-label="Product catalog summary">
        ${summaryCards.map((card) => renderCatalogSummaryCard(card)).join("")}
      </section>

      <section class="catalog-controls" aria-label="Catalog controls">
        <div class="catalog-filter-row">
          <label class="search-field catalog-search">
            ${renderIcon("search", "search-icon")}
            <input id="product-search" value="${escapeHtml(productQuery)}" placeholder="Search catalog" type="search" />
          </label>
          <select class="catalog-status-filter" id="catalog-brand-filter" aria-label="Brand filter">
            ${brandOptions.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === catalogBrandFilter ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
          </select>
          <select class="catalog-status-filter" id="catalog-category-filter" aria-label="Category filter">
            ${categoryOptions.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === catalogCategoryFilter ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
          </select>
          <select class="catalog-status-filter" id="catalog-product-type-filter" aria-label="Product type filter">
            <option value="all" ${catalogProductTypeFilter === "all" ? "selected" : ""}>All Types</option>
            ${productTypeOptions.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === catalogProductTypeFilter ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
          </select>
          <select class="catalog-status-filter" id="catalog-status-filter" aria-label="Publish status filter">
            ${getCatalogFilterOptions().map((option) => `<option value="${option.value}" ${option.value === catalogStatusFilter ? "selected" : ""}>${option.label}</option>`).join("")}
          </select>
          <select class="catalog-status-filter" id="catalog-featured-filter" aria-label="Featured filter">
            <option value="all" ${catalogFeaturedFilter === "all" ? "selected" : ""}>All featured</option>
            <option value="featured" ${catalogFeaturedFilter === "featured" ? "selected" : ""}>Featured only</option>
            <option value="standard" ${catalogFeaturedFilter === "standard" ? "selected" : ""}>Not featured</option>
          </select>
          <button class="note-button catalog-reset-button" data-catalog-reset-filters type="button">Reset Filters</button>
        </div>
      </section>

      ${renderCatalogNotice()}

      <article class="content-card table-card catalog-table-card">
        <p class="table-helper-text catalog-count-label">${visibleProducts.length} ${visibleProducts.length === 1 ? "CATALOG ITEM" : "CATALOG ITEMS"}</p>
        <table class="products-table catalog-table catalog-products-table">
          <thead>
            <tr>
              <th></th>
              <th>Product</th>
              <th>Brand</th>
              <th>Category</th>
              <th>SKU</th>
              <th>Variants</th>
              <th>Unit Cost</th>
              <th>Selling Price</th>
              <th>Margin</th>
              <th>Updated</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${visibleProducts.map(renderCatalogProductRow).join("")}
          </tbody>
        </table>
        ${renderCatalogEmptyState(visibleProducts)}
      </article>
    </main>
  `;
}

function renderCatalogCategoriesPage() {
  const visibleCategories = getVisibleProductCategories();
  const selectedCategory = productCategories.find((item) => item.id === selectedCategoryId);
  const canWriteCategories = canManageProductCategories();
  const summaryCards = getCategorySummaryCards();

  return `
    <main class="orders-page catalog-page catalog-categories-page admin-saas-page">
      <div class="page-heading catalog-heading">
        <div>
          <h1>Categories</h1>
          <p class="subtitle">Manage product taxonomy, hierarchy, product-type binding, assignments, and archive status.</p>
        </div>
        ${canWriteCategories ? `<button class="catalog-add-button" data-category-add type="button">+ New Category</button>` : ""}
      </div>

      <section class="catalog-summary-grid" aria-label="Category governance summary">
        ${summaryCards.map((card) => renderCatalogSummaryCard(card)).join("")}
      </section>

      <section class="catalog-controls category-controls" aria-label="Category controls">
        <div class="catalog-filter-row">
          <label class="search-field catalog-search">
            ${renderIcon("search", "search-icon")}
            <input id="product-search" value="${escapeHtml(productQuery)}" placeholder="Search category name or code" type="search" />
          </label>
          <select class="catalog-status-filter" id="category-product-type-filter" aria-label="Product type filter">
            <option value="all" ${categoryProductTypeFilter === "all" ? "selected" : ""}>All Product Types</option>
            ${productTypeOptions.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === categoryProductTypeFilter ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
          </select>
          <select class="catalog-status-filter" id="category-hierarchy-filter" aria-label="Hierarchy filter">
            <option value="all" ${categoryHierarchyFilter === "all" ? "selected" : ""}>All Hierarchy</option>
            <option value="root" ${categoryHierarchyFilter === "root" ? "selected" : ""}>Root Categories</option>
            <option value="child" ${categoryHierarchyFilter === "child" ? "selected" : ""}>Subcategories</option>
          </select>
          <select class="catalog-status-filter" id="category-status-filter" aria-label="Category status filter">
            <option value="active" ${categoryStatusFilter === "active" ? "selected" : ""}>Active categories</option>
            <option value="archived" ${categoryStatusFilter === "archived" ? "selected" : ""}>Archived categories</option>
            <option value="all" ${categoryStatusFilter === "all" ? "selected" : ""}>All categories</option>
          </select>
          <button class="note-button catalog-reset-button" data-category-reset-filters type="button">Reset Filters</button>
        </div>
      </section>

      ${renderCategoryNotice()}

      <article class="content-card table-card catalog-table-card">
        <p class="table-helper-text catalog-count-label">${visibleCategories.length} ${visibleCategories.length === 1 ? "CATEGORY" : "CATEGORIES"}</p>
        <table class="products-table catalog-table category-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Code</th>
              <th>Product Type</th>
              <th>Parent</th>
              <th>Children</th>
              <th>Products</th>
              <th>Status</th>
              <th>Updated</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${visibleCategories.map(renderProductCategoryRow).join("")}
          </tbody>
        </table>
        ${renderCategoryEmptyState(visibleCategories)}
      </article>
      ${categoryDrawerMode ? renderCategoryDrawer(selectedCategory) : ""}
    </main>
  `;
}

function renderCatalogBrandsPage() {
  const visibleBrands = getVisibleBrands();
  const selectedBrand = brands.find((item) => item.id === selectedBrandId);
  const canWriteBrands = canManageBrands();
  const summaryCards = getBrandSummaryCards();

  return `
    <main class="orders-page catalog-page catalog-brands-page admin-saas-page">
      <div class="page-heading catalog-heading">
        <div>
          <h1>Brands</h1>
          <p class="subtitle">Manage brand identity, ownership, storefront slug, and product assignment.</p>
        </div>
        ${canWriteBrands ? `<button class="catalog-add-button" data-brand-add type="button">+ New Brand</button>` : ""}
      </div>

      <section class="catalog-summary-grid" aria-label="Brand summary">
        ${summaryCards.map((card) => renderCatalogSummaryCard(card)).join("")}
      </section>

      <section class="catalog-controls brand-controls" aria-label="Brand controls">
        <div class="catalog-filter-row">
          <label class="search-field catalog-search">
            ${renderIcon("search", "search-icon")}
            <input id="product-search" value="${escapeHtml(productQuery)}" placeholder="Search brand, owner, or storefront" type="search" />
          </label>
          <select class="catalog-status-filter" id="brand-status-filter" aria-label="Brand status filter">
            <option value="active" ${brandStatusFilter === "active" ? "selected" : ""}>Active brands</option>
            <option value="archived" ${brandStatusFilter === "archived" ? "selected" : ""}>Archived brands</option>
            <option value="all" ${brandStatusFilter === "all" ? "selected" : ""}>All brands</option>
          </select>
          <button class="note-button catalog-reset-button" data-brand-reset-filters type="button">Reset Filters</button>
        </div>
      </section>

      ${renderBrandNotice()}

      <article class="content-card table-card catalog-table-card">
        <p class="table-helper-text catalog-count-label">${visibleBrands.length} ${visibleBrands.length === 1 ? "BRAND" : "BRANDS"}</p>
        <table class="products-table catalog-table brand-table">
          <thead>
            <tr>
              <th>Brand</th>
              <th>Owner</th>
              <th>Products</th>
              <th>Website Slug</th>
              <th>Status</th>
              <th>Updated</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${visibleBrands.map(renderBrandRow).join("")}
          </tbody>
        </table>
        ${renderBrandEmptyState(visibleBrands)}
      </article>
      ${brandDrawerMode ? renderBrandDrawer(selectedBrand) : ""}
    </main>
  `;
}

function getVisibleCatalogProducts() {
  const normalizedQuery = productQuery.trim().toLowerCase();

  return catalogProducts.filter((item) => {
    const matchesCatalog = Array.isArray(item.catalogKeys) ? item.catalogKeys.includes(activeCatalogKey) : item.catalogKey === activeCatalogKey;
    const matchesStatus =
      catalogStatusFilter === "active"
        ? item.status !== "archived"
        : catalogStatusFilter === "all"
          ? true
          : item.status === catalogStatusFilter;
    const matchesBrand = catalogBrandFilter === "all" || item.brandId === catalogBrandFilter;
    const matchesCategory = catalogCategoryFilter === "all" || item.category === catalogCategoryFilter;
    const itemProductType = item.productType || inferCatalogProductType(item) || "";
    const matchesProductType = catalogProductTypeFilter === "all" || itemProductType === catalogProductTypeFilter;
    const matchesFeatured =
      catalogFeaturedFilter === "all" ||
      (catalogFeaturedFilter === "featured" && item.isFeatured) ||
      (catalogFeaturedFilter === "standard" && !item.isFeatured);
    const sourceProduct = getCatalogSourceProduct(item);
    const matchesQuery =
      !normalizedQuery ||
      [item.name, item.productCode, item.slug, item.category, item.description, item.priceLabel, sourceProduct?.product, sourceProduct?.code]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);

    return matchesCatalog && matchesStatus && matchesBrand && matchesCategory && matchesProductType && matchesFeatured && matchesQuery;
  });
}

function getVisibleProductCategories() {
  const normalizedQuery = productQuery.trim().toLowerCase();

  return sortProductCategories(productCategories).filter((item) => {
    const matchesStatus =
      categoryStatusFilter === "active"
        ? item.active && !item.archivedAt
        : categoryStatusFilter === "archived"
          ? !item.active || Boolean(item.archivedAt)
          : true;
    const matchesProductType = categoryProductTypeFilter === "all" || item.productType === categoryProductTypeFilter;
    const matchesHierarchy =
      categoryHierarchyFilter === "all" ||
      (categoryHierarchyFilter === "root" && !item.parentCategoryId) ||
      (categoryHierarchyFilter === "child" && Boolean(item.parentCategoryId));
    const parent = getProductCategoryParent(item);
    const matchesQuery =
      !normalizedQuery ||
      [item.name, item.code, parent?.name, item.archiveReason]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);

    return matchesStatus && matchesProductType && matchesHierarchy && matchesQuery;
  });
}

function getVisibleBrands() {
  const normalizedQuery = productQuery.trim().toLowerCase();

  return sortBrands(brands).filter((item) => {
    const matchesStatus =
      brandStatusFilter === "active"
        ? item.status === "active"
        : brandStatusFilter === "archived"
          ? item.status === "archived"
          : true;
    const matchesQuery =
      !normalizedQuery ||
      [item.name, item.brandCode, item.ownerName, item.ownershipType, item.websiteSlug]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);

    return matchesStatus && matchesQuery;
  });
}

function getCatalogProductSummaryCards(effectiveProducts = getVisibleCatalogProducts()) {
  const ready = effectiveProducts.filter((item) => item.status === "published").length;
  const archived = effectiveProducts.filter((item) => item.status === "archived").length;
  const needsSetup = effectiveProducts.filter((item) => getCatalogProductHealthChecks(item).some((check) => !check.ready)).length;
  const categories = new Set(effectiveProducts.map((item) => item.category).filter(Boolean)).size;
  const variants = effectiveProducts.reduce((count, item) => count + getCatalogVariantCount(item), 0);

  return [
    { label: "Ready for Sale", value: ready, helper: "Published products" },
    { label: "Needs Setup", value: needsSetup, helper: "Incomplete checks" },
    { label: "Categories", value: categories, helper: "Used by products" },
    { label: "Variants", value: variants, helper: "Listed combinations" },
    { label: "Archived", value: archived, helper: "Hidden from active catalog" },
  ];
}

function getCategorySummaryCards() {
  const active = productCategories.filter((item) => item.active && !item.archivedAt).length;
  const roots = productCategories.filter((item) => !item.parentCategoryId).length;
  const children = productCategories.filter((item) => item.parentCategoryId).length;
  const assignedProducts = productCategories.reduce((sum, item) => sum + Number(item.productCount ?? 0), 0);
  const archived = productCategories.filter((item) => !item.active || Boolean(item.archivedAt)).length;

  return [
    { label: "Active Categories", value: active, helper: "Available for products" },
    { label: "Root Categories", value: roots, helper: "Top-level taxonomy" },
    { label: "Subcategories", value: children, helper: "Depth-two children" },
    { label: "Assigned Products", value: assignedProducts, helper: "Canonical products" },
    { label: "Archived", value: archived, helper: "Inactive taxonomy" },
  ];
}

function getBrandSummaryCards() {
  const active = brands.filter((item) => item.status === "active").length;
  const partners = brands.filter((item) => item.ownershipType === "partner").length;
  const assignedProducts = brands.reduce((sum, item) => sum + Number(item.productCount ?? 0), 0);
  const storefronts = brands.filter((item) => item.websiteSlug).length;
  const archived = brands.filter((item) => item.status === "archived").length;

  return [
    { label: "Active Brands", value: active, helper: "Ready for assignment" },
    { label: "External Owners", value: partners, helper: "Partner brands onboarded" },
    { label: "Products Assigned", value: assignedProducts, helper: "Canonical products" },
    { label: "Storefronts", value: storefronts, helper: "Live or planned slugs" },
    { label: "Archived", value: archived, helper: "Unavailable for products" },
  ];
}

function renderCatalogSummaryCard(card) {
  return `
    <article class="catalog-summary-card">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(String(card.value))}</strong>
      <small>${escapeHtml(card.helper)}</small>
    </article>
  `;
}

function renderCategoryNotice() {
  if (categorySaveState === "success") {
    return `<div class="catalog-notice success">Category saved successfully.</div>`;
  }

  if (categoryLoadState === "loading") {
    return `<div class="catalog-notice">Loading product category taxonomy...</div>`;
  }

  if (categoryLoadState === "error") {
    return `<div class="catalog-notice error">Unable to load product categories. Check Supabase access and M1 RLS policies.</div>`;
  }

  if (!canManageProductCategories()) {
    return `<div class="catalog-notice">Viewer access: product category taxonomy is read-only.</div>`;
  }

  return "";
}

function renderBrandNotice() {
  if (brandSaveState === "success") {
    return `<div class="catalog-notice success">Brand saved successfully.</div>`;
  }

  if (brandLoadState === "loading") {
    return `<div class="catalog-notice">Loading canonical Brands...</div>`;
  }

  if (brandLoadState === "error") {
    return `<div class="catalog-notice error">Unable to load Brands. Check Supabase grants and Brand RLS policies.</div>`;
  }

  if (!canManageBrands()) {
    return `<div class="catalog-notice">Viewer access: Brands are read-only.</div>`;
  }

  return "";
}

function renderBrandEmptyState(visibleBrands) {
  if (visibleBrands.length > 0) return "";

  if (brandLoadState === "loading") {
    return `<div class="empty-state compact-empty catalog-empty-state"><strong>Loading brands...</strong><span>Checking canonical Brand reference records.</span></div>`;
  }

  if (!brands.length) {
    return `<div class="empty-state compact-empty catalog-empty-state"><strong>No brands yet</strong><span>The Brand Foundation migration must create STLO, TRRY Apparel, and Generic / Unbranded.</span></div>`;
  }

  return `<div class="empty-state compact-empty catalog-empty-state"><strong>No brands match</strong><span>Try another search term or status filter.</span></div>`;
}

function renderBrandRow(brand) {
  const statusMarkup = brand.status === "active"
    ? `<span class="status-pill active">Active</span>`
    : `<span class="status-pill archived">Archived</span>`;
  const canWrite = canManageBrands();
  const archiveDisabled = !canWrite || brand.status === "archived" || Number(brand.productCount ?? 0) > 0;
  const actionLabel = brand.status === "archived" ? "Archived" : "Archive";
  return `
    <tr class="${brand.id === selectedBrandId ? "selected" : ""}" data-brand-edit="${escapeHtml(brand.id)}" role="button" tabindex="0" aria-label="Open ${escapeHtml(brand.name)} brand details">
      <td class="brand-main-cell" data-mobile-label="Brand"><div class="brand-row-stack"><strong title="${escapeHtml(brand.name)}">${escapeHtml(brand.name)}</strong><span title="Code: ${escapeHtml(brand.brandCode)}">Code: ${escapeHtml(brand.brandCode)}</span></div></td>
      <td class="brand-owner-cell" data-mobile-label="Owner"><div class="brand-row-stack"><strong title="${escapeHtml(brand.ownerName)}">${escapeHtml(brand.ownerName)}</strong><span>${escapeHtml(formatOwnershipType(brand.ownershipType))} owner</span></div></td>
      <td class="category-count-cell" data-mobile-label="Products">${Number(brand.productCount ?? 0)}</td>
      <td class="brand-slug-cell" data-mobile-label="Website Slug">${escapeHtml(brand.websiteSlug || "Not published")}</td>
      <td class="category-status-cell" data-mobile-label="Status">${statusMarkup}</td>
      <td class="category-updated-cell" data-mobile-label="Updated"><span class="mono-value">${escapeHtml(formatCatalogUpdated(brand.updatedAt))}</span></td>
      <td class="category-action-cell" data-mobile-label="Action">
        <button class="note-button compact-action" data-brand-edit="${escapeHtml(brand.id)}" type="button">${canWrite ? "Edit" : "View"}</button>
        <button class="note-button compact-action danger" data-brand-archive="${escapeHtml(brand.id)}" type="button" ${archiveDisabled ? "disabled" : ""}>${actionLabel}</button>
      </td>
    </tr>
  `;
}

function renderBrandDrawer(selectedBrand) {
  const draft = brandDraft ?? createBrandDraft(selectedBrand);
  const isSaving = brandSaveState === "saving";
  const canWrite = canManageBrands();
  const isEdit = brandDrawerMode === "edit";
  const assignedProducts = Number(draft.productCount ?? selectedBrand?.productCount ?? 0);
  const title = draft.name || (isEdit ? "Edit Brand" : "Create Brand");
  const normalizedDraft = normalizeBrandDraft(draft);
  const isDirty = !isEdit || isBrandDraftDirty(selectedBrand, normalizedDraft);
  const canSave = canWrite && !isSaving && isDirty && !validateBrand(normalizedDraft);

  return `
    <div class="catalog-drawer-backdrop" data-brand-close></div>
    <aside class="catalog-drawer brand-drawer" aria-label="${escapeHtml(title)} brand details">
      <header>
        <div>
          <span>BRAND DIRECTORY</span>
          <h2>${escapeHtml(isEdit ? title : "Create Brand")}</h2>
          <p>${isEdit ? "Update brand identity, owner, storefront slug, and assignment status." : "Create a brand identity for product assignment and future storefront publishing."}</p>
          ${draft.status === "archived" ? `<span class="status-pill archived">Archived</span>` : `<span class="status-pill active">Active</span>`}
        </div>
        <button class="catalog-drawer-close" data-brand-close type="button" aria-label="Close brand drawer">X</button>
      </header>
      <form class="catalog-form" id="brand-form">
        ${brandValidationError ? `<p class="catalog-form-error">${escapeHtml(brandValidationError)}</p>` : ""}
        ${brandSaveError ? `<p class="catalog-form-error">${escapeHtml(brandSaveError)}</p>` : ""}

        <section class="catalog-drawer-section" aria-label="Brand identity">
          <h3>Identity</h3>
          ${renderBrandInput("name", "Brand Name", draft.name, "text", true, isSaving || !canWrite, "Customer-facing label shown across catalog and storefront.")}
          ${renderBrandInput("brandCode", "Brand Code", draft.brandCode, "text", true, isSaving || !canWrite, isEdit ? "Stable and immutable after creation." : "Manually entered, normalized to uppercase, and never derived from slug.", { readonly: isEdit, locked: isEdit })}
          ${renderBrandInput("ownerName", "Brand Owner", draft.ownerName, "text", true, isSaving || !canWrite, "Internal team or partner owner name.")}
          ${renderBrandField("ownershipType", "Ownership Type", renderBrandOwnershipSelect(draft, isSaving || !canWrite))}
          ${renderBrandInput("websiteSlug", "Website Slug", draft.websiteSlug || "", "text", false, isSaving || !canWrite, "Optional; unique when present.")}
          ${renderBrandField("status", "Status", renderBrandStatusSelect(draft, isSaving || !canWrite || (assignedProducts > 0 && draft.status === "active")), assignedProducts > 0 ? "Archive is blocked while products are assigned." : "Active brands can be assigned to products.")}
        </section>

        <footer class="catalog-drawer-footer">
          <span>${assignedProducts} ${assignedProducts === 1 ? "product" : "products"} assigned</span>
          <div>
            <button class="note-button" data-brand-close type="button" ${isSaving ? "disabled" : ""}>Cancel</button>
            <button class="primary-button catalog-save-button" type="submit" ${canSave ? "" : "disabled"}>${isSaving ? "Saving..." : (isEdit ? "Save Changes" : "Create Brand")}</button>
          </div>
        </footer>
      </form>
    </aside>
  `;
}

function renderCategoryEmptyState(visibleCategories) {
  if (visibleCategories.length > 0) return "";

  if (categoryLoadState === "loading") {
    return `<div class="empty-state compact-empty catalog-empty-state"><strong>Loading categories...</strong><span>Checking Master Catalog taxonomy records.</span></div>`;
  }

  if (!productCategories.length) {
    return `<div class="empty-state compact-empty catalog-empty-state"><strong>No categories yet</strong><span>Add the first Master Catalog category before creating M1 products.</span></div>`;
  }

  return `<div class="empty-state compact-empty catalog-empty-state"><strong>No categories match</strong><span>Try another search term or status filter.</span></div>`;
}

function renderProductCategoryRow(category) {
  const parent = getProductCategoryParent(category);
  const children = productCategories.filter((item) => item.parentCategoryId === category.id).length;
  const indent = getCategoryDepth(category) * 18;
  const assignedProducts = Number(category.productCount ?? 0);
  const statusMarkup = category.active && !category.archivedAt
    ? `<span class="status-pill active">Active</span>`
    : `<span class="status-pill archived">Archived</span>`;

  return `
    <tr class="${category.id === selectedCategoryId ? "selected" : ""}" data-category-edit="${escapeHtml(category.id)}" role="button" tabindex="0" aria-label="Open ${escapeHtml(category.name)} category details">
      <td class="catalog-name-cell category-main-cell"><div class="category-name-stack" style="--category-indent: ${indent}px"><strong title="${escapeHtml(category.name)}">${escapeHtml(category.name)}</strong><span title="${escapeHtml(getCategoryPath(category))}">${escapeHtml(getCategoryPath(category))}</span></div></td>
      <td class="mono-value category-code-cell" data-mobile-label="Code" title="${escapeHtml(category.code)}">${escapeHtml(category.code)}</td>
      <td class="category-product-type-cell" data-mobile-label="Product Type" title="${escapeHtml(formatProductType(category.productType))}">${escapeHtml(formatProductType(category.productType))}</td>
      <td class="category-parent-cell" data-mobile-label="Parent" title="${escapeHtml(parent?.name || "Root")}">${escapeHtml(parent?.name || "Root")}</td>
      <td class="category-count-cell" data-mobile-label="Children">${children}</td>
      <td class="category-count-cell" data-mobile-label="Products">${assignedProducts}</td>
      <td class="category-status-cell" data-mobile-label="Status">${statusMarkup}</td>
      <td class="category-updated-cell" data-mobile-label="Updated"><span class="mono-value">${escapeHtml(formatCatalogUpdated(category.updatedAt))}</span></td>
      <td class="category-action-cell" data-mobile-label="Action"><button class="note-button compact-action" data-category-edit="${escapeHtml(category.id)}" type="button">Edit</button></td>
    </tr>
  `;
}

function renderCategoryDrawer(selectedCategory) {
  const draft = categoryDraft ?? createCategoryDraft(selectedCategory);
  const isSaving = categorySaveState === "saving";
  const canWrite = canManageProductCategories();
  const isArchived = !draft.active || Boolean(draft.archivedAt);
  const isEdit = categoryDrawerMode === "edit";
  const categoryChildren = getCategoryDirectChildren(draft.id).length;
  const assignedProducts = Number(draft.productCount ?? selectedCategory?.productCount ?? 0);
  const locksProductType = isEdit && (categoryChildren > 0 || assignedProducts > 0);
  const title = draft.name || (isEdit ? "Edit Category" : "New Category");
  const productTypeHelper = locksProductType
    ? "Product Type is locked while products or child categories exist."
    : "Select the product type before choosing a parent category.";
  const archiveRule = isEdit
    ? assignedProducts > 0
      ? "Blocked while assigned"
      : isArchived
        ? "Ready to restore"
        : "Available with archive reason"
    : "Available after creation";

  return `
    <div class="catalog-drawer-backdrop" data-category-close></div>
    <aside class="catalog-drawer category-drawer" aria-label="${escapeHtml(title)} category details">
      <header>
        <div>
          <span>MASTER CATALOG TAXONOMY</span>
          <h2>${escapeHtml(isEdit ? title : "New Category")}</h2>
          <p>${isEdit ? "Update taxonomy governance. Product Type is locked while products or child categories exist." : "Create a taxonomy record. Product Type must be selected before choosing a parent."}</p>
          ${isArchived ? `<span class="status-pill archived">Archived</span>` : `<span class="status-pill active">Active</span>`}
        </div>
        <button class="catalog-drawer-close" data-category-close type="button" aria-label="Close category drawer">X</button>
      </header>
      <form class="catalog-form" id="category-form">
        ${categoryValidationError ? `<p class="catalog-form-error">${escapeHtml(categoryValidationError)}</p>` : ""}
        ${categorySaveError ? `<p class="catalog-form-error">${escapeHtml(categorySaveError)}</p>` : ""}

        <section class="catalog-drawer-section" aria-label="Category identity">
          <h3>Identity</h3>
          ${renderCategoryInput("name", "Category name", draft.name, "text", true, isSaving || !canWrite, "Use the customer-facing category name.")}
          ${renderCategoryInput("code", "Category code", draft.code, "text", true, true, "Auto-generated from the category name and saved as the stable taxonomy reference.")}
          ${renderCatalogField("productType", "Product Type", renderCategoryProductTypeSelect(draft, isSaving || !canWrite || locksProductType), productTypeHelper)}
          ${renderCatalogField("parentCategoryId", "Parent category", renderCategoryParentSelect(draft, isSaving || !canWrite || !draft.productType), draft.productType ? "Only categories with the same product type are available." : "Select a product type before choosing a parent category.")}
        </section>

        <section class="catalog-drawer-section" aria-label="Governance">
          <h3>Governance</h3>
          <div class="catalog-kv-list">
            ${renderCatalogDetailRow("Hierarchy", getCategoryDepth(draft) > 0 ? "Subcategory" : "Root category")}
            ${renderCatalogDetailRow("Child categories", String(categoryChildren))}
            ${renderCatalogDetailRow("Assigned products", String(assignedProducts))}
            ${renderCatalogDetailRow("Status", isArchived ? "Archived" : "Active")}
            ${renderCatalogDetailRow("Archive rule", archiveRule)}
            ${renderCatalogDetailRow("Created", formatCatalogUpdated(draft.createdAt))}
            ${renderCatalogDetailRow("Updated", formatCatalogUpdated(draft.updatedAt))}
            ${renderCatalogDetailRow("Archived", draft.archivedAt ? formatCatalogUpdated(draft.archivedAt) : "Not archived")}
          </div>
          ${isArchived
            ? renderCategoryInput("restoreReason", "Restore note", draft.restoreReason, "text", false, isSaving || !canWrite)
            : renderCategoryInput("archiveReason", "Archive reason", draft.archiveReason, "text", false, isSaving || !canWrite)}
        </section>
        <section class="catalog-drawer-section" aria-label="Assignment rules">
          <h3>Product-type binding rule</h3>
          <p class="catalog-helper-text">A category belongs to exactly one product type. Parent and child categories must use the same type; hierarchy depth is limited to two levels. Parent options are active, non-archived, same Product Type, and cycle-safe. Product records are never reclassified automatically.</p>
        </section>
      </form>
      <div class="catalog-drawer-actions">
        <button class="note-button" data-category-close type="button">Cancel</button>
        ${draft.id && canWrite ? `<button class="note-button category-archive-button" data-category-archive-action="${isArchived ? "restore" : "archive"}" type="button" ${isSaving ? "disabled" : ""}>${isArchived ? "Restore" : "Archive"}</button>` : ""}
        <button class="primary-button catalog-save-button" form="category-form" type="submit" ${canWrite && !isSaving ? "" : "disabled"}>${isSaving ? "Saving..." : (isEdit ? "Save Changes" : "Create Category")}</button>
      </div>
    </aside>
  `;
}

function renderCategoryInput(field, label, value, type = "text", required = false, disabled = false, helperText = "") {
  return renderCatalogField(field, label, `<input id="catalog-${field}" data-category-field="${field}" value="${escapeHtml(value ?? "")}" type="${type}" ${required ? "required" : ""} ${disabled ? "disabled" : ""} />`, helperText);
}

function renderCategoryParentSelect(draft, disabled = false) {
  const options = getCategoryParentOptions(draft);
  return `<select id="catalog-parentCategoryId" data-category-field="parentCategoryId" ${disabled ? "disabled" : ""}><option value="">No parent - root category</option>${options.map((category) => `<option value="${escapeHtml(category.id)}" ${category.id === draft.parentCategoryId ? "selected" : ""}>${escapeHtml(getCategoryPath(category))}</option>`).join("")}</select>`;
}

function renderCategoryProductTypeSelect(draft, disabled = false) {
  return `<select id="catalog-productType" data-category-field="productType" required ${disabled ? "disabled" : ""}><option value="" ${draft.productType ? "" : "selected"}>Select product type</option>${productTypeOptions.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === draft.productType ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select>`;
}

function getCategoryParentOptions(draft) {
  const blockedIds = new Set(draft.id ? [draft.id, ...getCategoryDescendantIds(draft.id)] : []);
  return sortProductCategories(productCategories).filter((category) =>
    !blockedIds.has(category.id) &&
    category.active &&
    !category.archivedAt &&
    !category.parentCategoryId &&
    category.productType === draft.productType
  );
}

function getCategoryDirectChildren(categoryId) {
  if (!categoryId) return [];
  return productCategories.filter((item) => item.parentCategoryId === categoryId);
}

function getCategoryDescendantIds(categoryId) {
  const children = productCategories.filter((item) => item.parentCategoryId === categoryId);
  return children.flatMap((child) => [child.id, ...getCategoryDescendantIds(child.id)]);
}

function getProductCategoryParent(category) {
  return productCategories.find((item) => item.id === category?.parentCategoryId) ?? null;
}

function getCategoryPath(category) {
  const names = [];
  let current = category;
  const seen = new Set();
  while (current && !seen.has(current.id)) {
    names.unshift(current.name);
    seen.add(current.id);
    current = getProductCategoryParent(current);
  }
  return names.join(" / ");
}

function getCategoryDepth(category) {
  let depth = 0;
  let current = getProductCategoryParent(category);
  const seen = new Set([category?.id]);
  while (current && !seen.has(current.id)) {
    depth += 1;
    seen.add(current.id);
    current = getProductCategoryParent(current);
  }
  return depth;
}

function sortProductCategories(categories) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const pathFor = (category) => {
    const names = [];
    let current = category;
    const seen = new Set();
    while (current && !seen.has(current.id)) {
      names.unshift(current.name);
      seen.add(current.id);
      current = byId.get(current.parentCategoryId);
    }
    return names.join(" / ");
  };

  return [...categories].sort((a, b) => pathFor(a).localeCompare(pathFor(b)) || a.code.localeCompare(b.code));
}

function createCategoryDraft(category = null) {
  if (category) {
    return {
      ...category,
      productType: category.productType || "",
      originalProductType: category.productType || "",
      restoreReason: "",
    };
  }

  return {
    name: "",
    code: "",
    productType: "",
    originalProductType: "",
    parentCategoryId: "",
    active: true,
    archivedAt: "",
    archivedByUserId: "",
    archiveReason: "",
    restoreReason: "",
  };
}

function updateCategoryDraftField(field, value) {
  if (!categoryDraft) return;
  const nextValue = String(value ?? "");
  const shouldCreateCode = field === "name" && (!categoryDraft.code || categoryDraft.code === createCategoryCode(categoryDraft.name));
  categoryDraft = {
    ...categoryDraft,
    [field]: nextValue,
  };
  if (field === "productType") {
    categoryDraft.parentCategoryId = "";
  }
  if (shouldCreateCode) {
    categoryDraft.code = createCategoryCode(nextValue);
  }
  categoryValidationError = "";
  categorySaveError = "";
}

function normalizeCategoryDraft(draft) {
  return {
    ...draft,
    name: String(draft.name || "").trim(),
    code: createCategoryCode(draft.code || draft.name),
    productType: productTypeOptions.some((option) => option.value === draft.productType) ? draft.productType : "",
    originalProductType: String(draft.originalProductType || "").trim(),
    parentCategoryId: String(draft.parentCategoryId || "").trim(),
    active: draft.active !== false,
    archiveReason: String(draft.archiveReason || "").trim(),
    restoreReason: String(draft.restoreReason || "").trim(),
  };
}

function validateCategory(category) {
  if (!category.name) return "Category name is required.";
  if (!category.code) return "Category code is required.";
  if (!productTypeOptions.some((option) => option.value === category.productType)) return "Select a product type.";
  if (category.parentCategoryId && category.parentCategoryId === category.id) return "A category cannot be its own parent.";
  if (category.parentCategoryId && getCategoryDescendantIds(category.id).includes(category.parentCategoryId)) return "A category cannot be moved under its own child.";
  const parent = getProductCategoryParent(category);
  if (parent?.productType && parent.productType !== category.productType) return "Only categories with the same product type are available.";
  if (parent?.parentCategoryId) return "Hierarchy depth is limited to two levels.";
  if (category.id && category.originalProductType && category.originalProductType !== category.productType && (getCategoryDirectChildren(category.id).length > 0 || Number(category.productCount ?? 0) > 0)) {
    return "Product type cannot be changed while this category is in use.";
  }
  const duplicateCode = productCategories.find((item) => item.id !== category.id && item.code.toLowerCase() === category.code.toLowerCase());
  if (duplicateCode) return "Category code must be unique.";
  const duplicateName = productCategories.find((item) =>
    item.id !== category.id &&
    item.name.toLowerCase() === category.name.toLowerCase() &&
    item.productType === category.productType &&
    (item.parentCategoryId || "") === (category.parentCategoryId || "")
  );
  if (duplicateName) return "Category name must be unique within the selected product type and parent.";
  return "";
}

function formatProductType(value) {
  return productTypeOptions.find((option) => option.value === value)?.label ?? "";
}

function createCategoryCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function canManageProductCategories() {
  return ["owner", "admin"].includes(adminUser?.role);
}

function canManageBrands() {
  return ["owner", "admin"].includes(adminUser?.role);
}

function renderBrandInput(field, label, value, type = "text", required = false, disabled = false, helperText = "", options = {}) {
  const className = options.locked ? ` class="locked-field"` : "";
  return renderBrandField(field, label, `<input id="brand-${field}" data-brand-field="${field}" value="${escapeHtml(value ?? "")}" type="${type}"${className} ${required ? "required" : ""} ${disabled ? "disabled" : ""} ${options.readonly ? "readonly aria-readonly=\"true\"" : ""} />`, helperText);
}

function renderBrandField(id, label, control, helperText = "") {
  return `<label class="catalog-field" for="brand-${id}"><span>${label}</span>${control}${helperText ? `<small>${escapeHtml(helperText)}</small>` : ""}</label>`;
}

function renderBrandOwnershipSelect(draft, disabled = false) {
  return `<select id="brand-ownershipType" data-brand-field="ownershipType" required ${disabled ? "disabled" : ""}>
    <option value="internal" ${draft.ownershipType === "internal" ? "selected" : ""}>Internal</option>
    <option value="partner" ${draft.ownershipType === "partner" ? "selected" : ""}>Partner</option>
  </select>`;
}

function renderBrandStatusSelect(draft, disabled = false) {
  return `<select id="brand-status" data-brand-field="status" required ${disabled ? "disabled" : ""}>
    <option value="active" ${draft.status === "active" ? "selected" : ""}>Active</option>
    <option value="archived" ${draft.status === "archived" ? "selected" : ""}>Archived</option>
  </select>`;
}

function createBrandDraft(brand = null) {
  if (brand) return { ...brand };
  return {
    name: "",
    brandCode: "",
    ownershipType: "internal",
    ownerName: "",
    websiteSlug: "",
    status: "active",
    productCount: 0,
  };
}

function updateBrandDraftField(field, value) {
  if (!brandDraft) return;
  const nextValue = field === "brandCode" ? String(value ?? "").trim().toUpperCase() : String(value ?? "");
  brandDraft = {
    ...brandDraft,
    [field]: nextValue,
  };
  brandValidationError = "";
  brandSaveError = "";
}

function normalizeBrandDraft(draft) {
  return {
    ...draft,
    name: String(draft.name || "").trim(),
    brandCode: String(draft.brandCode || "").trim().toUpperCase(),
    ownershipType: ["internal", "partner"].includes(draft.ownershipType) ? draft.ownershipType : "internal",
    ownerName: String(draft.ownerName || "").trim(),
    websiteSlug: String(draft.websiteSlug || "").trim(),
    status: ["active", "archived"].includes(draft.status) ? draft.status : "active",
  };
}

function validateBrand(brand) {
  if (!brand.name) return "Brand name is required.";
  if (!brand.id && !brand.brandCode) return "Brand Code is required.";
  if (!brand.ownerName) return "Owner name is required.";
  if (!["internal", "partner"].includes(brand.ownershipType)) return "Choose a valid ownership type.";
  if (!["active", "archived"].includes(brand.status)) return "Choose a valid status.";
  const duplicateCode = brand.brandCode ? brands.find((item) => item.id !== brand.id && item.brandCode.toLowerCase() === brand.brandCode.toLowerCase()) : null;
  if (duplicateCode) return "Brand Code must be unique.";
  const duplicateName = brands.find((item) => item.id !== brand.id && item.name.toLowerCase() === brand.name.toLowerCase());
  if (duplicateName) return "Brand name must be unique.";
  const duplicateSlug = brand.websiteSlug ? brands.find((item) => item.id !== brand.id && item.websiteSlug && item.websiteSlug.toLowerCase() === brand.websiteSlug.toLowerCase()) : null;
  if (duplicateSlug) return "Website slug must be unique.";
  if (brand.status === "archived" && Number(brand.productCount ?? 0) > 0) return "Archive is blocked while products are assigned to this Brand.";
  return "";
}

function isBrandDraftDirty(originalBrand, draft) {
  if (!originalBrand) return true;
  const original = normalizeBrandDraft(originalBrand);
  return ["name", "brandCode", "ownerName", "ownershipType", "websiteSlug", "status"].some((field) =>
    String(original[field] ?? "") !== String(draft[field] ?? "")
  );
}

function sortBrands(items) {
  return [...items].sort((a, b) => {
    const statusRank = Number(a.status === "archived") - Number(b.status === "archived");
    return statusRank || a.name.localeCompare(b.name) || a.brandCode.localeCompare(b.brandCode);
  });
}

function upsertBrand(items, brand) {
  const nextItems = items.some((item) => item.id === brand.id)
    ? items.map((item) => item.id === brand.id ? { ...item, ...brand } : item)
    : [...items, brand];
  return sortBrands(nextItems);
}

function formatOwnershipType(value) {
  return value === "partner" ? "Partner owner" : "Internal owner";
}

function getAdminActorUserId() {
  return adminUser?.userId || adminUser?.user_id || adminAuthSession?.user?.id || "";
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
  const expanded = item.id === catalogExpandedProductId;
  const sku = getCatalogEditorSku(item);
  const variantCount = getCatalogVariantCount(item);
  const margin = getCatalogEditorMargin(item);

  return `
    <tr class="${expanded ? "selected" : ""}" data-catalog-toggle-product="${item.id}" role="button" tabindex="0" aria-expanded="${expanded ? "true" : "false"}" aria-label="Open ${escapeHtml(item.name)} product quick controls">
      <td class="catalog-expand-cell" data-mobile-label="Quick">${renderIcon(expanded ? "chevron-down" : "chevron-right", "catalog-expand-icon")}</td>
      <td class="catalog-name-cell"><div class="client-cell"><span class="catalog-product-image ${item.imageUrl ? "has-image" : "empty"}" ${item.imageUrl ? `style="background-image: url('${escapeHtml(item.imageUrl)}')" aria-label="Catalog image"` : `role="img" aria-label="No catalog image"`}>${item.imageUrl ? "" : renderIcon("package", "catalog-placeholder-icon")}</span><div><strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong><span title="${escapeHtml(secondary)}">${escapeHtml(secondary)}</span></div></div></td>
      <td class="catalog-category-cell" data-mobile-label="Brand">${escapeHtml(item.brandName || item.brand || "-")}</td>
      <td class="catalog-category-cell" data-mobile-label="Category">${escapeHtml(item.category || "-")}</td>
      <td class="mono-value" data-mobile-label="SKU">${escapeHtml(sku)}</td>
      <td class="catalog-moq-cell" data-mobile-label="Variants">${variantCount}</td>
      <td class="catalog-price-cell" data-mobile-label="Unit Cost">${escapeHtml(formatCatalogMoney(item.unitCost || ""))}</td>
      <td class="catalog-price-cell" data-mobile-label="Selling Price">${escapeHtml(formatCatalogPrice(item))}</td>
      <td class="catalog-price-cell" data-mobile-label="Margin">${escapeHtml(margin.label)}</td>
      <td class="catalog-updated-cell" data-mobile-label="Updated"><span class="mono-value">${escapeHtml(formatCatalogUpdated(item.updatedAt))}</span></td>
      <td class="catalog-status-cell" data-mobile-label="Status">${renderStatusPill(item.status)}</td>
    </tr>
    ${expanded ? renderCatalogProductQuickControl(item) : ""}
  `;
}

function renderCatalogProductQuickControl(item) {
  const canWrite = canWriteCatalogProducts();
  const checks = getCatalogProductHealthChecks(item);
  const readyCount = checks.filter((check) => check.ready).length;
  const margin = getCatalogEditorMargin(item);
  const saving = catalogQuickSaveState === item.id;
  const sku = getCatalogEditorSku(item);

  return `
    <tr class="catalog-product-quick-row">
      <td colspan="11">
        <section class="catalog-product-quick-control" aria-label="${escapeHtml(item.name)} quick control">
          ${catalogQuickSaveError ? `<p class="catalog-form-error">${escapeHtml(catalogQuickSaveError)}</p>` : ""}
          <div class="catalog-quick-health">
            <div>
              <span>Catalog Health</span>
              <strong>${readyCount}/${checks.length} complete</strong>
            </div>
            <div class="catalog-health-chip-row">
              ${checks.map((check) => `<span class="catalog-health-chip ${check.ready ? "ready" : "pending"}">${escapeHtml(check.label)}</span>`).join("")}
            </div>
          </div>
          <div class="catalog-quick-pricing">
            <div class="catalog-quick-metric"><span>Cost</span><strong>${escapeHtml(formatCatalogMoney(item.unitCost || ""))}</strong></div>
            <label class="catalog-quick-price-input">
              <span>Selling Price</span>
              <input data-catalog-quick-selling-price="${escapeHtml(item.id)}" type="number" min="0" step="0.01" value="${escapeHtml(item.startingPrice ?? "")}" ${canWrite && !saving ? "" : "disabled"} />
            </label>
            <div class="catalog-quick-metric"><span>Margin</span><strong>${escapeHtml(margin.label)}</strong><small>${escapeHtml(margin.helper)}</small></div>
            <button class="primary-button catalog-quick-button" data-catalog-quick-price-save="${escapeHtml(item.id)}" type="button" ${canWrite && !saving ? "" : "disabled"}>${saving ? "Updating..." : "Update Price"}</button>
          </div>
          <div class="catalog-quick-status">
            <label>
              <span>Status and visibility</span>
              <select data-catalog-quick-status="${escapeHtml(item.id)}" ${canWrite && !saving ? "" : "disabled"}>
                ${catalogStatusOptions.map((status) => `<option value="${status}" ${status === item.status ? "selected" : ""}>${status}</option>`).join("")}
              </select>
            </label>
            <span class="status-pill ${item.status === "published" ? "visible" : statusToClass(item.status)}">${item.status === "published" ? "Visible" : item.status}</span>
            <button class="note-button" data-catalog-archive-product="${escapeHtml(item.id)}" type="button" ${canWrite && !saving && item.status !== "archived" ? "" : "disabled"}>Archive</button>
          </div>
          <div class="catalog-quick-actions">
            <button class="note-button" data-catalog-copy-sku="${escapeHtml(sku)}" type="button">Copy SKU</button>
            <button class="note-button" data-catalog-duplicate="${escapeHtml(item.id)}" type="button" ${canWrite && !saving ? "" : "disabled"}>Duplicate</button>
            <label class="note-button catalog-quick-image-button ${canWrite && !saving ? "" : "disabled"}">
              Update Image
              <input data-catalog-quick-image-file="${escapeHtml(item.id)}" type="file" accept="image/jpeg,image/png,image/webp,image/avif" ${canWrite && !saving ? "" : "disabled"} />
            </label>
            <button class="primary-button catalog-quick-button" data-catalog-full-edit="${escapeHtml(item.id)}" type="button">Full Edit Product</button>
          </div>
        </section>
      </td>
    </tr>
  `;
}

function getCatalogProductHealthChecks(item) {
  return [
    { label: "Brand", ready: Boolean(item.brandId) },
    { label: "Image", ready: Boolean(item.imageUrl) },
    { label: "Category", ready: Boolean(item.category) },
    { label: "Cost", ready: Boolean(item.unitCost) },
    { label: "Price", ready: Boolean(item.startingPrice) },
    { label: "Variants", ready: getCatalogVariantCount(item) > 0 },
  ];
}

function getCatalogVariantCount(item) {
  const sizes = Array.isArray(item.availableSizes) ? item.availableSizes.filter(Boolean).length : 0;
  const colors = Array.isArray(item.availableColors) ? item.availableColors.filter(Boolean).length : 0;
  if (sizes && colors) return Math.min(sizes * colors, 99);
  return sizes || colors || 0;
}

function formatCatalogMoney(value) {
  if (value === "" || value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `PHP ${Number(value).toLocaleString("en-US")}`;
}

function renderCatalogProductEditorPage(editorRoute) {
  const selectedProduct = editorRoute.mode === "edit"
    ? catalogProducts.find((item) => item.id === editorRoute.productId) ?? null
    : null;
  if (editorRoute.mode === "edit" && !selectedProduct) {
    const isLoading = catalogLoadState === "loading";
    return `
      <main class="orders-page catalog-page admin-saas-page catalog-product-editor-page" data-catalog-product-editor data-editor-mode="edit">
        <section class="catalog-editor-denied">
          <span>MASTER CATALOG</span>
          <h1>${isLoading ? "Loading Product" : "Product not found"}</h1>
          <p>${isLoading ? "Loading the selected catalog product before opening the editor." : "Return to Master Catalog and select an available product."}</p>
          <button class="note-button" data-catalog-editor-cancel type="button">Back to Catalog</button>
        </section>
      </main>
    `;
  }
  const draft = prepareCatalogEditorDraft(editorRoute, selectedProduct);
  const isSaving = catalogSaveState === "saving" || catalogSaveState === "uploading";
  const canWrite = canWriteCatalogProducts();
  const isEdit = editorRoute.mode === "edit";
  const title = isEdit ? "Edit Product" : "New Product";
  const displayName = draft.name || "New Product";
  const typeLabel = formatProductType(draft.productType) || "Select type";
  const brandLabel = getCatalogEditorBrandLabel(draft) || "Brand required";
  const skuValue = getCatalogEditorSku(draft);
  const categoryValue = getCatalogEditorCategoryLabel(draft);
  const imageCount = getCatalogEditorImageCount(draft);
  const margin = getCatalogEditorMargin(draft);
  const readiness = getCatalogEditorReadiness(draft);
  const status = draft.status || "draft";
  const summaryMeta = isEdit ? `${brandLabel} - ${skuValue} - ${typeLabel}` : `${brandLabel} - Product code generated on save`;
  const heroImage = getCatalogEditorPrimaryImage(draft);
  const footerMessage = catalogValidationError
    ? "Fix required fields before creating this product."
    : isEdit
      ? "Unsaved changes will remain in this frame only."
      : "Creates as Draft. Ready stays locked until requirements pass.";

  if (!canWrite && !isEdit) {
    return `
      <main class="orders-page catalog-page admin-saas-page catalog-product-editor-page" data-catalog-product-editor>
        <section class="catalog-editor-denied">
          <span>MASTER CATALOG</span>
          <h1>Read-only access</h1>
          <p>Your account can view catalog records, but cannot create products.</p>
          <button class="note-button" data-catalog-editor-cancel type="button">Back to Catalog</button>
        </section>
      </main>
    `;
  }

  return `
    <main class="orders-page catalog-page admin-saas-page catalog-product-editor-page" data-catalog-product-editor data-editor-mode="${escapeHtml(editorRoute.mode)}">
      <div class="catalog-editor-mobile-topbar">
        <button class="catalog-editor-icon-button" data-catalog-editor-cancel type="button" aria-label="Back to Master Catalog">${renderIcon("chevron-right", "catalog-editor-back-icon")}</button>
        <div>
          <h2>${escapeHtml(title)}</h2>
          <span>${escapeHtml(typeLabel)}</span>
        </div>
        ${renderStatusPill(status)}
      </div>

      ${catalogValidationError ? `<div class="catalog-editor-toast error" role="alert"><strong>Fix required fields before creating product</strong><span>${escapeHtml(catalogValidationError)}</span></div>` : ""}
      ${catalogSaveState === "success" ? `<div class="catalog-editor-toast success" role="status"><strong>${isEdit ? "Changes saved successfully" : "Product created successfully"}</strong><span>${escapeHtml(displayName)} is ${isEdit ? "updated" : "ready to review"}.</span></div>` : ""}
      ${catalogSaveError ? `<div class="catalog-editor-toast error" role="alert"><strong>Save failed</strong><span>${escapeHtml(catalogSaveError)}</span></div>` : ""}

      <section class="catalog-editor-header">
        <nav class="catalog-editor-breadcrumb" aria-label="Breadcrumb">
          <span>Home</span><span>Master Catalog</span><strong>${escapeHtml(title)}</strong>
        </nav>
        <div class="catalog-editor-heading-row">
          <div>
            <h1>${escapeHtml(title)}</h1>
            <p class="subtitle">${isEdit ? "Update product images, catalog details, pricing, production information, variants, and status." : "Create a product draft. Required fields must pass before Ready for Sale."}</p>
          </div>
          <button class="note-button" data-catalog-editor-cancel type="button">Back to Catalog</button>
        </div>
      </section>

      <section class="catalog-editor-summary-strip" aria-label="Product draft summary">
        <div class="catalog-editor-summary-main">
          <span class="catalog-editor-product-thumb ${heroImage ? "has-image" : "empty"}">${heroImage ? `<img src="${escapeHtml(heroImage)}" alt="${escapeHtml(displayName)}" />` : renderIcon("package", "catalog-placeholder-icon")}</span>
          <div>
            <strong>${escapeHtml(displayName)}</strong>
            <span>${escapeHtml(summaryMeta)}</span>
          </div>
          ${renderStatusPill(status)}
        </div>
        <div class="catalog-editor-summary-stat">
          <span>${isEdit ? "CURRENT MARGIN" : "PRODUCT STATUS"}</span>
          <strong>${isEdit ? escapeHtml(margin.label) : escapeHtml(status.toUpperCase())}</strong>
          <small>${escapeHtml(isEdit ? margin.helper : readiness.every((item) => item.ready) ? "Ready checks passed" : "Not ready for sale")}</small>
        </div>
      </section>

      <form class="catalog-editor-form" id="catalog-product-form">
        <section class="catalog-editor-grid">
          <div class="catalog-editor-main-column">
            ${renderCatalogEditorProductInformation(draft, isSaving || !canWrite)}
            ${renderCatalogEditorImages(draft, canWrite, isSaving)}
            ${renderCatalogEditorPricing(draft, isSaving || !canWrite)}
            ${renderCatalogEditorProduction(draft, isSaving || !canWrite)}
            ${renderCatalogEditorVariants(draft, isSaving || !canWrite)}
          </div>
          <aside class="catalog-editor-side-column">
            ${renderCatalogEditorStatusCard(draft, isSaving || !canWrite)}
            ${renderCatalogEditorSummaryCard(draft, skuValue, categoryValue, imageCount)}
            ${renderCatalogEditorReadinessCard(readiness)}
            ${renderCatalogEditorAvailabilityCard(draft)}
          </aside>
        </section>
      </form>

      <div class="catalog-editor-footer">
        <span class="${catalogValidationError ? "error" : ""}">${escapeHtml(footerMessage)}</span>
        <div>
          <button class="note-button" data-catalog-editor-cancel type="button" ${isSaving ? "disabled" : ""}>Cancel</button>
          <button class="primary-button catalog-save-button" form="catalog-product-form" type="submit" ${canWrite && !isSaving ? "" : "disabled"}>${catalogSaveState === "uploading" ? "Uploading..." : isSaving ? "Saving..." : isEdit ? "Save Changes" : "Create Product"}</button>
        </div>
      </div>
    </main>
  `;
}

function renderCatalogEditorProductInformation(draft, disabled = false) {
  return `
    <article class="catalog-editor-card" id="catalog-section-product-identity" tabindex="-1" aria-label="Product Information">
      <header><h2>Product Information</h2><p>Customer-facing identity and category binding.</p></header>
      <div class="catalog-editor-field-grid">
        ${renderCatalogInput("name", "Product Name", draft.name, "text", true, disabled, "Enter product name")}
        ${renderCatalogField("brandId", "Brand", renderCatalogBrandSelect(draft, disabled), "Required. Only active Brands can be assigned.")}
        ${renderCatalogField("productType", "Product Type", renderCatalogProductTypeSelect(draft, disabled), "Required before choosing a parent category.")}
        ${renderCatalogField("category", "Category", renderCatalogCategorySelect(draft, disabled || !draft.productType), draft.productType ? "Only categories with the same product type are available." : "Select Product Type first.")}
        ${renderCatalogInput("subcategory", "Subcategory", draft.subcategory || "", "text", false, disabled, "Select subcategory")}
        ${renderCatalogField("productCode", "Product Code", `<input id="catalog-productCode" value="${escapeHtml(getCatalogEditorSku(draft))}" type="text" readonly />`, draft.productCode ? "Generated canonical Product Code." : "Generated on save.")}
        ${renderCatalogField("catalog", "Destination", renderCatalogSelect(draft, disabled))}
      </div>
    </article>
  `;
}

function renderCatalogEditorImages(draft, canWrite, isSaving) {
  const images = getCatalogEditorImages(draft);
  const slots = Array.from({ length: CATALOG_PRODUCT_IMAGE_LIMIT }, (_, index) => {
    const image = images[index] ?? null;
    const isPrimary = Boolean(image?.isPrimary);
    return `
      <div class="catalog-editor-image-slot ${image ? "has-image" : "empty"}" data-image-slot="${index}" ${image && canWrite ? `draggable="true" data-catalog-image-drag="${index}"` : ""}>
        <div class="catalog-editor-image-preview">
          ${image ? `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.altText || draft.name || "Product image")}" />` : renderIcon("package-plus", "catalog-placeholder-icon")}
          ${isPrimary ? `<span class="catalog-primary-badge">PRIMARY</span>` : ""}
        </div>
        <div class="catalog-editor-image-actions">
          <span>${image ? `${index + 1} of ${CATALOG_PRODUCT_IMAGE_LIMIT}` : "ADD IMAGE"}</span>
          ${image && canWrite ? `<div class="catalog-image-card-actions">${isPrimary ? "" : `<button class="catalog-set-primary-button" type="button" data-catalog-set-primary-image="${index}" ${isSaving ? "disabled" : ""}>Primary</button>`}<button class="catalog-remove-image-button" type="button" data-catalog-remove-image="${index}" ${isSaving ? "disabled" : ""}>Remove</button></div>` : ""}
        </div>
      </div>
    `;
  }).join("");
  const disabled = !canWrite || isSaving || images.length >= CATALOG_PRODUCT_IMAGE_LIMIT;

  return `
    <article class="catalog-editor-card ${catalogValidationError && images.length === 0 ? "has-error" : ""}" id="catalog-section-images" tabindex="-1" aria-label="Product Images">
      <header>
        <div><h2>Product Images</h2><p>Maximum ${CATALOG_PRODUCT_IMAGE_LIMIT} images per product. Choose one PRIMARY image independently from order.</p></div>
        <strong>${images.length} of ${CATALOG_PRODUCT_IMAGE_LIMIT} uploaded</strong>
      </header>
      <div class="catalog-editor-image-grid">${slots}</div>
      <label class="catalog-editor-upload ${disabled ? "disabled" : ""}">
        <span>${images.length ? "Add another image" : "Upload primary image"}</span>
        <input data-catalog-image-file type="file" accept="image/jpeg,image/png,image/webp,image/avif" ${disabled ? "disabled" : ""} />
      </label>
      ${images.length >= CATALOG_PRODUCT_IMAGE_LIMIT ? `<p class="catalog-image-limit-note">Maximum ${CATALOG_PRODUCT_IMAGE_LIMIT} images reached.</p>` : ""}
      ${draft.imageError ? `<p class="catalog-form-error">${escapeHtml(draft.imageError)}</p>` : ""}
    </article>
  `;
}

function renderCatalogEditorPricing(draft, disabled = false) {
  const margin = getCatalogEditorMargin(draft);
  return `
    <article class="catalog-editor-card" id="catalog-section-pricing" tabindex="-1" aria-label="Pricing">
      <header><h2>Pricing</h2><p>Base cost, selling price, and calculated margin.</p></header>
      <div class="catalog-editor-field-grid">
        ${renderCatalogInput("unitCost", "Unit Cost", draft.unitCost || "", "number", false, disabled, "0.00")}
        ${renderCatalogInput("startingPrice", "Selling Price", draft.startingPrice, "number", false, disabled, "0.00")}
        ${renderCatalogInput("priceLabel", "Price Label", draft.priceLabel, "text", false, disabled, "Shown in catalog")}
        ${renderCatalogInput("minimumQuantity", "Minimum Qty", draft.minimumQuantity, "number", true, disabled)}
      </div>
      <div class="catalog-editor-calculated-row"><span>Calculated Margin</span><strong>${escapeHtml(margin.label)}</strong><small>${escapeHtml(margin.helper)}</small></div>
    </article>
  `;
}

function renderCatalogEditorProduction(draft, disabled = false) {
  return `
    <article class="catalog-editor-card ${catalogValidationError && !draft.productionUse ? "has-error" : ""}" aria-label="Production Information">
      <header><h2>Production Information</h2><p>Manufacturing notes used by admin and production teams.</p></header>
      <div class="catalog-editor-field-grid">
        ${renderCatalogInput("material", "Material / Fabric", draft.material || "", "text", false, disabled)}
        ${renderCatalogInput("weightGsm", "Weight / GSM", draft.weightGsm || "", "text", false, disabled)}
        ${renderCatalogInput("fitCut", "Fit / Cut", draft.fitCut || "", "text", false, disabled)}
        ${renderCatalogInput("productionUse", "Production Use", draft.productionUse || "", "text", false, disabled)}
        ${renderCatalogInput("printMethodsText", "Compatible Methods", draft.printMethodsText, "text", false, disabled)}
        ${renderCatalogTextarea("productionNotes", "Production Notes", draft.productionNotes || "", disabled)}
      </div>
    </article>
  `;
}

function renderCatalogEditorVariants(draft, disabled = false) {
  const sizes = splitCatalogList(draft.availableSizesText);
  const colors = splitCatalogList(draft.availableColorsText);
  const variants = sizes.length || colors.length
    ? (sizes.length ? sizes : ["Default"]).flatMap((size) => (colors.length ? colors : ["Default"]).map((color) => ({ size, color }))).slice(0, 6)
    : [];
  const rows = variants.map((variant, index) => `
    <tr>
      <td>${escapeHtml(variant.color)}</td>
      <td>${escapeHtml(variant.size)}</td>
      <td class="mono-value">${escapeHtml(`${getCatalogEditorSku(draft)}-${index + 1}`)}</td>
      <td>${escapeHtml(formatCatalogPrice(draft))}</td>
      <td>${renderStatusPill("draft")}</td>
    </tr>
  `).join("");

  return `
    <article class="catalog-editor-card ${catalogValidationError && variants.length === 0 ? "has-error" : ""}" id="catalog-section-variants" tabindex="-1" aria-label="Variants">
      <header>
        <div><h2>Variants</h2><p>Size and color combinations for this catalog product.</p></div>
        <button class="note-button" type="button" disabled>Add Variant</button>
      </header>
      <div class="catalog-editor-field-grid">
        ${renderCatalogInput("availableSizesText", "Available Sizes", draft.availableSizesText, "text", false, disabled)}
        ${renderCatalogInput("availableColorsText", "Available Colors", draft.availableColorsText, "text", false, disabled)}
      </div>
      ${rows
        ? `<table class="catalog-editor-variant-table"><thead><tr><th>Color</th><th>Size</th><th>Variant SKU</th><th>Price</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`
        : `<div class="catalog-editor-empty"><strong>No variants yet</strong><span>Add size and color combinations when this product needs variants.</span></div>`}
    </article>
  `;
}

function renderCatalogEditorStatusCard(draft, disabled = false) {
  const statuses = [
    { value: "draft", label: "Draft" },
    { value: "published", label: "Ready" },
    { value: "archived", label: "Archived" },
  ];
  return `
    <article class="catalog-editor-card compact" aria-label="Catalog Status">
      <header><h2>Catalog Status</h2></header>
      <div class="catalog-editor-status-options">
        ${statuses.map((status) => `<button class="${draft.status === status.value ? "active" : ""}" data-catalog-status-choice="${status.value}" type="button" ${disabled ? "disabled" : ""}>${escapeHtml(status.label)}</button>`).join("")}
      </div>
      ${renderStatusPill(draft.status || "draft")}
    </article>
  `;
}

function renderCatalogEditorSummaryCard(draft, skuValue, categoryValue, imageCount) {
  return `
    <article class="catalog-editor-card compact" aria-label="Product Summary">
      <header><h2>Product Summary</h2></header>
      <div class="catalog-kv-list">
        ${renderCatalogDetailRow("SKU", skuValue)}
        ${renderCatalogDetailRow("Brand", getCatalogEditorBrandLabel(draft) || "Not selected")}
        ${renderCatalogDetailRow("Type", formatProductType(draft.productType) || "Not selected")}
        ${renderCatalogDetailRow("Category", categoryValue || "Not selected")}
        ${renderCatalogDetailRow("Variants", String(splitCatalogList(draft.availableSizesText).length || splitCatalogList(draft.availableColorsText).length || 0))}
        ${renderCatalogDetailRow("Last updated", draft.updatedAt ? formatCatalogUpdated(draft.updatedAt) : "Not saved")}
        ${renderCatalogDetailRow("Images", `${imageCount} of ${CATALOG_PRODUCT_IMAGE_LIMIT}`)}
        ${renderCatalogDetailRow("Production info", draft.productionUse ? "Complete" : "Incomplete")}
      </div>
    </article>
  `;
}

function renderCatalogEditorReadinessCard(readiness) {
  const completeCount = readiness.filter((item) => item.ready).length;
  return `
    <article class="catalog-editor-card compact" aria-label="Catalog Readiness">
      <header><h2>Catalog Readiness</h2><p>${completeCount} of ${readiness.length} requirements complete</p></header>
      <div class="catalog-editor-readiness-list" role="list">
        ${readiness.map((item) => `
          <button class="catalog-readiness-item ${item.ready ? "ready" : "pending"}" type="button" data-catalog-readiness-target="${escapeHtml(item.target)}" ${item.ready ? "disabled" : ""} role="listitem">
            ${renderIcon(item.ready ? "circle-check" : "alert-circle", "catalog-readiness-icon")}
            <span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.ready ? "Complete" : item.missing)}</small></span>
          </button>
        `).join("")}
      </div>
    </article>
  `;
}

function renderCatalogEditorAvailabilityCard(draft) {
  const brand = brands.find((item) => item.id === draft.brandId);
  const websiteLabel = brand?.websiteSlug ? `${brand.name} storefront` : "Admin only";
  return `
    <article class="catalog-editor-card compact" aria-label="Sales & Availability">
      <header><h2>Sales & Availability</h2></header>
      <div class="catalog-kv-list">
        ${renderCatalogDetailRow("POS", "Available")}
        ${renderCatalogDetailRow("Website", websiteLabel)}
        ${renderCatalogDetailRow("Inquiry / Quotation", "Available")}
        ${renderCatalogDetailRow("Reorder", "Available")}
      </div>
    </article>
  `;
}

function getCatalogProductEditorRoute() {
  if (getRoutePath() !== "/catalog") return null;
  const productParam = new URLSearchParams(window.location.search).get("product");
  if (!productParam) return null;
  return productParam === "new"
    ? { mode: "create", productId: "" }
    : { mode: "edit", productId: productParam };
}

function prepareCatalogEditorDraft(editorRoute, selectedProduct) {
  const routeKey = `${editorRoute.mode}:${editorRoute.productId || "new"}`;
  if (catalogEditorRouteKey !== routeKey) {
    clearCatalogImagePreview();
    catalogEditorMode = editorRoute.mode;
    catalogEditorRouteKey = routeKey;
    catalogDraft = createCatalogDraft(selectedProduct);
    catalogValidationError = "";
    catalogSaveError = "";
    catalogSaveState = "idle";
    selectedCatalogProductId = selectedProduct?.id ?? selectedCatalogProductId;
  }

  return catalogDraft ?? createCatalogDraft(selectedProduct);
}

function openCatalogProductEditor(mode, productId = "") {
  if (mode === "create" && !canWriteCatalogProducts()) return;
  navigateTo(mode === "create" ? "/catalog?product=new" : `/catalog?product=${encodeURIComponent(productId)}`);
  render();
}

function closeCatalogProductEditor() {
  clearCatalogImagePreview();
  catalogEditorMode = "";
  catalogEditorRouteKey = "";
  catalogDraft = null;
  catalogValidationError = "";
  catalogSaveError = "";
  catalogSaveState = "idle";
  navigateTo("/catalog");
  render();
}

function toggleCatalogProductQuickControl(productId) {
  catalogExpandedProductId = catalogExpandedProductId === productId ? null : productId;
  selectedCatalogProductId = productId;
  catalogQuickSaveError = "";
  render();
}

function getCatalogEditorActiveCategories(draft) {
  return sortProductCategories(productCategories).filter((category) =>
    category.active &&
    !category.archivedAt &&
    (!draft.productType || category.productType === draft.productType)
  );
}

function getCatalogEditorActiveBrands(draft) {
  return sortBrands(brands).filter((brand) =>
    brand.status === "active" || brand.id === draft.brandId
  );
}

function renderCatalogBrandSelect(draft, disabled = false) {
  const options = getCatalogEditorActiveBrands(draft);
  return `<select id="catalog-brandId" data-catalog-field="brandId" required ${disabled ? "disabled" : ""}><option value="" ${draft.brandId ? "" : "selected"}>${brandLoadState === "loading" ? "Loading brands" : "Select brand"}</option>${options.map((brand) => `<option value="${escapeHtml(brand.id)}" ${brand.id === draft.brandId ? "selected" : ""}>${escapeHtml(brand.name)} (${escapeHtml(brand.brandCode)})</option>`).join("")}</select>`;
}

function getCatalogEditorBrandLabel(draft) {
  const brand = brands.find((item) => item.id === draft.brandId);
  return brand?.name || draft.brandName || draft.brand || "";
}

function renderCatalogProductTypeSelect(draft, disabled = false) {
  return `<select id="catalog-productType" data-catalog-field="productType" required ${disabled ? "disabled" : ""}><option value="" ${draft.productType ? "" : "selected"}>Select Product Type</option>${productTypeOptions.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === draft.productType ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select>`;
}

function renderCatalogCategorySelect(draft, disabled = false) {
  const options = getCatalogEditorActiveCategories(draft);
  return `<select id="catalog-category" data-catalog-field="category" ${disabled ? "disabled" : ""}><option value="" ${draft.category ? "" : "selected"}>${draft.productType ? "Select category" : "Select Product Type first"}</option>${options.map((category) => `<option value="${escapeHtml(category.name)}" ${category.name === draft.category ? "selected" : ""}>${escapeHtml(getCategoryPath(category))}</option>`).join("")}</select>`;
}

function getCatalogEditorCategoryLabel(draft) {
  const category = productCategories.find((item) => item.name === draft.category);
  return category ? getCategoryPath(category) : draft.category || "";
}

function getCatalogEditorSku(draft) {
  return draft.productCode || draft.slug || "Generated on save.";
}

function normalizeCatalogDraftImages(images) {
  const normalized = (Array.isArray(images) ? images : [])
    .map((image, index) => ({
      id: image.id || "",
      storagePath: image.storagePath || image.storage_path || "",
      publicUrl: image.publicUrl || image.public_url || image.url || "",
      url: image.url || image.publicUrl || image.public_url || image.previewUrl || "",
      previewUrl: image.previewUrl || "",
      altText: image.altText || image.alt_text || "",
      file: image.file || null,
      isNew: image.isNew === true,
      position: index,
      isPrimary: image.isPrimary === true || image.is_primary === true,
    }))
    .slice(0, CATALOG_PRODUCT_IMAGE_LIMIT);
  const primaryIndex = normalized.findIndex((image) => image.isPrimary);
  const resolvedPrimaryIndex = normalized.length ? Math.max(0, primaryIndex) : -1;
  return normalized.map((image, index) => ({
    ...image,
    position: index,
    isPrimary: index === resolvedPrimaryIndex,
  }));
}

function getCatalogEditorImages(draft) {
  return normalizeCatalogDraftImages(draft.images);
}

function getCatalogEditorImageCount(draft) {
  return getCatalogEditorImages(draft).length;
}

function getCatalogEditorPrimaryImage(draft) {
  const images = getCatalogEditorImages(draft);
  return (images.find((image) => image.isPrimary) ?? images[0])?.url || "";
}

function getCatalogEditorMargin(draft) {
  const unitCost = Number(draft.unitCost || 0);
  const sellingPrice = Number(draft.startingPrice || 0);
  if (!unitCost || !sellingPrice) return { label: "Pending", helper: "Calculated after cost and price" };
  const margin = Math.round(((sellingPrice - unitCost) / sellingPrice) * 100);
  return { label: `${margin}%`, helper: margin >= 35 ? "Healthy margin" : "Review pricing" };
}

function getCatalogEditorReadiness(draft) {
  return [
    { label: "Brand and product identity", ready: Boolean(draft.name && draft.brandId && draft.productType && draft.category), target: "catalog-section-product-identity", missing: "Add name, Brand, product type, and category." },
    { label: "Cost and selling price", ready: Boolean(draft.unitCost && draft.startingPrice), target: "catalog-section-pricing", missing: "Enter unit cost and selling price." },
    { label: "Variants", ready: Boolean(splitCatalogList(draft.availableSizesText).length || splitCatalogList(draft.availableColorsText).length), target: "catalog-section-variants", missing: "Add at least one size or color." },
    { label: "At least one product image", ready: getCatalogEditorImageCount(draft) > 0, target: "catalog-section-images", missing: "Upload a product image." },
  ];
}

function validateCatalogProductEditor(draft, product) {
  const baseError = validateCatalogProduct(product);
  if (baseError) return baseError;
  if (!draft.brandId) return "Brand is required.";
  const brand = brands.find((item) => item.id === draft.brandId);
  if (!brand) return "Choose a valid Brand.";
  if (brand.status !== "active") return "Only active Brands can be assigned to products.";
  if (!draft.productType) return "Product Type is required.";
  const category = productCategories.find((item) => item.name === draft.category);
  if (!draft.category) return "Category is required.";
  if (category && category.productType !== draft.productType) return "Category must match the selected Product Type.";
  return "";
}

function getCatalogDestinationCounts() {
  return catalogOptions.reduce((counts, catalog) => {
    counts[catalog.key] = catalogProducts.filter((item) => Array.isArray(item.catalogKeys) ? item.catalogKeys.includes(catalog.key) : item.catalogKey === catalog.key).length;
    return counts;
  }, {});
}

function getCatalogBrandOptions() {
  const usedBrandIds = new Set(catalogProducts.map((item) => item.brandId).filter(Boolean));
  const options = sortBrands(brands)
    .filter((brand) => usedBrandIds.has(brand.id))
    .map((brand) => ({ value: brand.id, label: brand.name }));
  return [{ value: "all", label: "All brands" }, ...options];
}

function getCatalogCategoryOptions() {
  const categories = Array.from(new Set(catalogProducts
    .filter((item) => catalogProductTypeFilter === "all" || (item.productType || inferCatalogProductType(item) || "") === catalogProductTypeFilter)
    .map((item) => item.category)
    .filter(Boolean))).sort((a, b) => a.localeCompare(b));
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
  });
}

function renderCatalogSelect(draft, disabled = false) {
  return `<select data-catalog-field="catalogKey" ${disabled ? "disabled" : ""}>${catalogOptions.map((catalog) => `<option value="${catalog.key}" ${catalog.key === draft.catalogKey ? "selected" : ""}>${catalog.label}</option>`).join("")}</select>`;
}

function renderCatalogStatusSelect(draft, disabled = false) {
  return `<select data-catalog-field="status" ${disabled ? "disabled" : ""}>${catalogStatusOptions.map((status) => `<option value="${status}" ${status === draft.status ? "selected" : ""}>${status}</option>`).join("")}</select>`;
}

function renderCatalogField(id, label, control, helperText = "") {
  return `<label class="catalog-field" for="catalog-${id}"><span>${label}</span>${control}${helperText ? `<small>${escapeHtml(helperText)}</small>` : ""}</label>`;
}

function renderCatalogInput(field, label, value, type = "text", required = false, disabled = false, placeholder = "") {
  return renderCatalogField(field, label, `<input id="catalog-${field}" data-catalog-field="${field}" value="${escapeHtml(value ?? "")}" type="${type}" ${required ? "required" : ""} ${disabled ? "disabled" : ""} ${placeholder ? `placeholder="${escapeHtml(placeholder)}"` : ""} />`);
}

function renderCatalogTextarea(field, label, value, disabled = false) {
  return renderCatalogField(field, label, `<textarea id="catalog-${field}" data-catalog-field="${field}" rows="3" ${disabled ? "disabled" : ""}>${escapeHtml(value ?? "")}</textarea>`);
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
  return ["owner", "admin"].includes(adminUser?.role);
}

function canManageStaffAccounts() {
  return ["owner", "admin"].includes(adminUser?.role);
}

function createCatalogDraft(product = null) {
  if (product) {
    const images = normalizeCatalogDraftImages(product.images?.length ? product.images : (product.imageUrl ? [{ url: product.imageUrl, publicUrl: product.imageUrl, storagePath: "", isPrimary: true }] : []));
    return {
      ...product,
      productCode: product.productCode || product.slug || "",
      slug: product.productCode || product.slug || "",
      imageDraftId: product.id,
      images,
      imageFile: null,
      imageFilePreviewUrl: "",
      imageError: "",
      removeImage: false,
      availableSizesText: product.availableSizes.join(", "),
      availableColorsText: product.availableColors.join(", "),
      printMethodsText: product.printMethods.join(", "),
      brandId: product.brandId || "",
      brandName: product.brandName || product.brand || "",
      productType: product.productType || inferCatalogProductType(product) || "PHYSICAL",
      subcategory: product.subcategory || "",
      unitCost: product.unitCost || "",
      material: product.material || "",
      weightGsm: product.weightGsm || "",
      fitCut: product.fitCut || "",
      productionUse: product.productionUse || "",
      productionNotes: product.productionNotes || "",
    };
  }

  return {
    imageDraftId: createDraftImageId(),
    catalogKey: activeCatalogKey,
    catalogKeys: [activeCatalogKey],
    name: "",
    slug: "",
    productCode: "",
    category: "",
    categoryId: "",
    brandId: "",
    brandName: "",
    brand: "",
    description: "",
    imageUrl: "",
    images: [],
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
    productType: "",
    subcategory: "",
    unitCost: "",
    material: "",
    weightGsm: "",
    fitCut: "",
    productionUse: "",
    productionNotes: "",
  };
}

function createDraftImageId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function inferCatalogProductType(product) {
  const category = productCategories.find((item) => item.name === product?.category);
  return category?.productType || "";
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
          <button disabled type="button">Products module parked</button>
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
  const routePath = getRoutePath();
  const topNavItems = [
    { label: "Overview", path: "/overview" },
    { label: "Inquiries", path: "/inquiries", icon: "clipboard-list" },
    { label: "Orders", path: "/orders", icon: "package" },
    { label: "Production", path: "/production", icon: "factory" },
  ];
  const catalogSupplyItems = [
    { label: "Products", path: "/catalog", icon: "package", activePaths: ["/catalog"] },
    { label: "Brands", path: "/catalog/brands", icon: "tag", activePaths: ["/catalog/brands"] },
    { label: "Categories", path: "/catalog/categories", icon: "layers", activePaths: ["/catalog/categories"] },
    { label: "Suppliers", path: "/catalog/suppliers", icon: "truck", disabled: true },
    { label: "Purchasing", path: "/catalog/purchasing", icon: "shopping-cart", disabled: true },
    { label: "Inventory", path: "/catalog/inventory", icon: "boxes", disabled: true },
  ];
  const workflowNavItems = [
    ...(canViewWorkboardRoute() ? [{ label: "Workboard", path: "/workboard", icon: "clipboard-list" }] : []),
    ...(canViewCalendarRoute() ? [{ label: "Calendar", path: "/calendar", icon: "calendar-check" }] : []),
    ...(canViewMyTasksRoute() ? [{ label: "My Tasks", path: "/my-tasks", icon: "clipboard-list" }] : []),
  ];
  const renderNavItem = (item) => {
    const isActive = item.activePaths ? item.activePaths.includes(routePath) : item.label === currentRoute;
    const itemLabel = item.label === "Staff" ? "Staff Access" : item.label;
    if (item.disabled) {
      return `<div class="sidebar-nav-group">
        <span class="catalog-supply-link disabled" aria-disabled="true" title="${itemLabel}" aria-label="${itemLabel}">${renderIcon(item.icon || getNavIcon(item.label), "nav-icon")}<span class="nav-label">${itemLabel}</span></span>
      </div>`;
    }
    return `<div class="sidebar-nav-group">
      <a class="${isActive ? "active" : ""}" href="${item.path}" data-route-link title="${itemLabel}" aria-label="${itemLabel}">${renderIcon(item.icon || getNavIcon(item.label), "nav-icon")}<span class="nav-label">${itemLabel}</span></a>
    </div>`;
  };

  return `
    <aside class="sidebar ${isSidebarCollapsed ? "is-collapsed" : ""}">
      <button class="sidebar-close-button" type="button" aria-label="Close navigation">X</button>
      <div class="brand-lockup"><strong>TRRY</strong><span>ADMIN PORTAL</span></div>
      <nav>
        ${topNavItems.map(renderNavItem).join("")}
        <div class="sidebar-section-label">CATALOG &amp; SUPPLY</div>
        <div class="catalog-supply-nav" role="group" aria-label="Catalog and supply">
          ${catalogSupplyItems.map(renderNavItem).join("")}
        </div>
        ${workflowNavItems.map(renderNavItem).join("")}
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
          <input id="global-search" value="${escapeHtml(globalSearchQuery)}" placeholder="Search orders..." type="search" />
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
    { label: "Catalog", path: "/catalog", icon: "package" },
    ...(canViewWorkboardRoute() ? [{ label: "Workboard", path: "/workboard", icon: "clipboard-list" }] : []),
    ...(canViewCalendarRoute() ? [{ label: "Calendar", path: "/calendar", icon: "calendar-check" }] : []),
    ...(canViewMyTasksRoute() ? [{ label: "My Tasks", path: "/my-tasks", icon: "clipboard-list" }] : []),
  ];
  return `<nav class="mobile-bottom-nav" aria-label="Mobile navigation">${navItems.map((item) => `<a class="${item.label === currentRoute ? "active" : ""}" href="${item.path}" data-route-link>${renderIcon(item.icon || getNavIcon(item.label), "nav-icon")}<small>${item.label}</small></a>`).join("")}</nav>`;
}
function renderGlobalSearchHint() {
  const normalized = globalSearchQuery.trim().toLowerCase();
  if (!normalized) return "";

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

function openCategoryDrawer(mode, categoryId = null) {
  if (mode === "create" && !canManageProductCategories()) return;
  const category = productCategories.find((item) => item.id === categoryId) ?? null;
  categoryDrawerMode = mode;
  selectedCategoryId = category?.id ?? selectedCategoryId;
  categoryDraft = createCategoryDraft(category);
  categoryValidationError = "";
  categorySaveError = "";
  categorySaveState = "idle";
  render();
}

function closeCategoryDrawer() {
  categoryDrawerMode = "";
  categoryDraft = null;
  categoryValidationError = "";
  categorySaveError = "";
  categorySaveState = "idle";
  render();
}

function openBrandDrawer(mode, brandId = null) {
  if (mode === "create" && !canManageBrands()) return;
  const brand = brands.find((item) => item.id === brandId) ?? null;
  brandDrawerMode = mode;
  selectedBrandId = brand?.id ?? selectedBrandId;
  brandDraft = createBrandDraft(brand);
  brandValidationError = "";
  brandSaveError = "";
  brandSaveState = "idle";
  render();
}

function closeBrandDrawer() {
  brandDrawerMode = "";
  brandDraft = null;
  brandValidationError = "";
  brandSaveError = "";
  brandSaveState = "idle";
  render();
}

async function saveBrandDraft() {
  if (!canManageBrands() || !brandDraft || brandSaveState === "saving") return;

  const brand = normalizeBrandDraft(brandDraft);
  const validationError = validateBrand(brand);
  if (validationError) {
    brandValidationError = validationError;
    render();
    return;
  }

  brandSaveState = "saving";
  brandSaveError = "";
  brandValidationError = "";
  render();

  try {
    const savedBrand = brandDrawerMode === "edit" && brand.id
      ? await updateAdminBrand(brand.id, brand, adminAuthSession)
      : await createAdminBrand(brand, adminAuthSession);

    if (savedBrand) {
      brands = upsertBrand(brands, { ...savedBrand, productCount: brand.productCount ?? savedBrand.productCount ?? 0 });
      selectedBrandId = savedBrand.id;
    }

    brandDrawerMode = "";
    brandDraft = null;
    brandSaveState = "success";
    hasLoadedBrands = false;
    await loadBrands();
    window.setTimeout(() => {
      if (brandSaveState === "success") {
        brandSaveState = "idle";
        render();
      }
    }, 1800);
    render();
  } catch (error) {
    console.error("Unable to save brand.", error);
    brandSaveState = "idle";
    brandSaveError = error.message || "Save failed. Check Brand RLS and constraints.";
    render();
  }
}

async function archiveBrand(brandId) {
  if (!canManageBrands() || brandSaveState === "saving") return;
  const brand = brands.find((item) => item.id === brandId);
  if (!brand || brand.status === "archived") return;
  if (Number(brand.productCount ?? 0) > 0) {
    brandSaveError = "Archive is blocked while products are assigned to this Brand.";
    render();
    return;
  }

  brandSaveState = "saving";
  brandSaveError = "";
  render();

  try {
    const savedBrand = await updateAdminBrand(brand.id, { ...brand, status: "archived" }, adminAuthSession);
    if (savedBrand) brands = upsertBrand(brands, { ...brand, ...savedBrand, status: "archived" });
    brandSaveState = "success";
    window.setTimeout(() => {
      if (brandSaveState === "success") {
        brandSaveState = "idle";
        render();
      }
    }, 1800);
    render();
  } catch (error) {
    console.error("Unable to archive brand.", error);
    brandSaveState = "idle";
    brandSaveError = error.message || "Archive failed. Check Brand assignment guard.";
    render();
  }
}

async function saveCategoryDraft() {
  if (!canManageProductCategories() || !categoryDraft || categorySaveState === "saving") return;

  const category = normalizeCategoryDraft(categoryDraft);
  const validationError = validateCategory(category);
  if (validationError) {
    categoryValidationError = validationError;
    render();
    return;
  }

  categorySaveState = "saving";
  categorySaveError = "";
  categoryValidationError = "";
  render();

  try {
    const savedCategory = categoryDrawerMode === "edit" && category.id
      ? await updateAdminProductCategory(category.id, category, adminAuthSession)
      : await createAdminProductCategory(category, adminAuthSession);

    if (savedCategory) {
      productCategories = upsertProductCategory(productCategories, savedCategory);
      selectedCategoryId = savedCategory.id;
    }

    categoryDrawerMode = "";
    categoryDraft = null;
    categorySaveState = "success";
    window.setTimeout(() => {
      if (categorySaveState === "success") {
        categorySaveState = "idle";
        render();
      }
    }, 1800);
    render();
  } catch (error) {
    console.error("Unable to save product category.", error);
    categorySaveState = "idle";
    categorySaveError = error.message || "Save failed. Check M1 category RLS and constraints.";
    render();
  }
}

async function archiveOrRestoreCategory(action) {
  if (!canManageProductCategories() || !categoryDraft?.id || categorySaveState === "saving") return;

  const isRestore = action === "restore";
  const reason = String(isRestore ? categoryDraft.restoreReason : categoryDraft.archiveReason).trim();
  if (!isRestore && !reason) {
    categoryValidationError = "Archive reason is required.";
    render();
    return;
  }

  const nextCategory = normalizeCategoryDraft({
    ...categoryDraft,
    active: isRestore,
    archivedAt: isRestore ? "" : new Date().toISOString(),
    archivedByUserId: isRestore ? "" : getAdminActorUserId(),
    archiveReason: isRestore ? "" : reason,
  });

  categorySaveState = "saving";
  categorySaveError = "";
  categoryValidationError = "";
  render();

  try {
    const savedCategory = await updateAdminProductCategory(nextCategory.id, nextCategory, adminAuthSession);
    if (savedCategory) {
      productCategories = upsertProductCategory(productCategories, savedCategory);
      selectedCategoryId = savedCategory.id;
    }
    categoryDrawerMode = "";
    categoryDraft = null;
    categorySaveState = "success";
    render();
  } catch (error) {
    console.error("Unable to update category archive state.", error);
    categorySaveState = "idle";
    categorySaveError = error.message || "Archive update failed. Check linked products and category state.";
    render();
  }
}

function upsertProductCategory(items, category) {
  const nextItems = items.some((item) => item.id === category.id)
    ? items.map((item) => item.id === category.id ? category : item)
    : [...items, category];

  return sortProductCategories(nextItems);
}

function clearCatalogImagePreview() {
  if (!catalogDraft?.images) return;
  catalogDraft.images.forEach((image) => {
    if (image.previewUrl && image.isNew) URL.revokeObjectURL(image.previewUrl);
  });
}

async function updateCatalogImageFile(file) {
  if (!catalogDraft || !canWriteCatalogProducts()) return;

  const images = getCatalogEditorImages(catalogDraft);
  if (images.length >= CATALOG_PRODUCT_IMAGE_LIMIT) {
    catalogDraft = { ...catalogDraft, imageError: `Maximum ${CATALOG_PRODUCT_IMAGE_LIMIT} images per product.` };
    render();
    return;
  }

  const validationError = await validateCatalogImageFileWithDimensions(file);
  if (validationError) {
    catalogDraft = { ...catalogDraft, imageError: validationError };
    render();
    return;
  }

  const previewUrl = URL.createObjectURL(file);
  catalogDraft = {
    ...catalogDraft,
    images: normalizeCatalogDraftImages([
      ...images,
      {
        id: "",
        storagePath: "",
        publicUrl: "",
        url: previewUrl,
        previewUrl,
        altText: catalogDraft.name || "Product image",
        file,
        isNew: true,
      },
    ]),
    imageFile: file,
    imageFilePreviewUrl: "",
    imageError: "",
    removeImage: false,
  };
  catalogSaveError = "";
  render();
}

function removeCatalogImageFromDraft(index = 0) {
  if (!catalogDraft || !canWriteCatalogProducts()) return;

  const images = getCatalogEditorImages(catalogDraft);
  const removed = images[index];
  if (removed?.previewUrl && removed.isNew) URL.revokeObjectURL(removed.previewUrl);
  catalogDraft = {
    ...catalogDraft,
    images: normalizeCatalogDraftImages(images.filter((_, imageIndex) => imageIndex !== index)),
    imageFile: null,
    imageFilePreviewUrl: "",
    imageError: "",
    removeImage: images.length === 1,
  };
  catalogSaveError = "";
  render();
}

function moveCatalogImageInDraft(index, direction) {
  if (!catalogDraft || !canWriteCatalogProducts()) return;
  const images = getCatalogEditorImages(catalogDraft);
  const nextIndex = direction === "left" ? index - 1 : index + 1;
  if (index < 0 || nextIndex < 0 || index >= images.length || nextIndex >= images.length) return;
  const reordered = [...images];
  const [moved] = reordered.splice(index, 1);
  reordered.splice(nextIndex, 0, moved);
  catalogDraft = { ...catalogDraft, images: normalizeCatalogDraftImages(reordered), imageError: "" };
  catalogSaveError = "";
  render();
}

function setCatalogPrimaryImageInDraft(index) {
  if (!catalogDraft || !canWriteCatalogProducts()) return;
  const images = getCatalogEditorImages(catalogDraft);
  if (index < 0 || index >= images.length) return;
  catalogDraft = {
    ...catalogDraft,
    images: normalizeCatalogDraftImages(images.map((image, imageIndex) => ({
      ...image,
      isPrimary: imageIndex === index,
    }))),
    imageError: "",
  };
  catalogSaveError = "";
  render();
}

async function updateCatalogQuickPrice(productId) {
  if (!canWriteCatalogProducts() || catalogQuickSaveState !== "idle") return;
  const product = catalogProducts.find((item) => item.id === productId);
  if (!product) return;
  const priceInput = document.querySelector(`[data-catalog-quick-selling-price="${cssEscape(productId)}"]`);
  const nextPrice = String(priceInput?.value ?? "").trim();
  if (nextPrice && Number(nextPrice) < 0) {
    catalogQuickSaveError = "Selling price cannot be negative.";
    render();
    return;
  }

  await saveCatalogQuickProduct(productId, { startingPrice: nextPrice });
}

async function updateCatalogQuickStatus(productId, status) {
  if (!canWriteCatalogProducts() || catalogQuickSaveState !== "idle" || !catalogStatusOptions.includes(status)) return;
  await saveCatalogQuickProduct(productId, { status });
}

async function archiveCatalogQuickProduct(productId) {
  if (!canWriteCatalogProducts() || catalogQuickSaveState !== "idle") return;
  await saveCatalogQuickProduct(productId, { status: "archived" });
}

async function saveCatalogQuickProduct(productId, updates) {
  const product = catalogProducts.find((item) => item.id === productId);
  if (!product) return;

  catalogQuickSaveState = productId;
  catalogQuickSaveError = "";
  render();

  try {
    const savedProduct = await updateAdminProduct(productId, { ...product, ...updates }, adminAuthSession);
    if (savedProduct) catalogProducts = upsertCatalogProduct(catalogProducts, savedProduct);
    catalogQuickSaveState = "idle";
    catalogSaveState = "success";
    window.setTimeout(() => {
      if (catalogSaveState === "success") {
        catalogSaveState = "idle";
        render();
      }
    }, 1400);
    render();
  } catch (error) {
    console.error("Unable to update catalog product quick control.", error);
    catalogQuickSaveState = "idle";
    catalogQuickSaveError = error.message || "Quick update failed. Check catalog product permissions.";
    render();
  }
}

async function updateCatalogQuickImage(productId, file) {
  if (!canWriteCatalogProducts() || !file || catalogQuickSaveState !== "idle") return;
  const product = catalogProducts.find((item) => item.id === productId);
  if (!product) return;

  const validationError = await validateCatalogImageFileWithDimensions(file);
  if (validationError) {
    catalogQuickSaveError = validationError;
    render();
    return;
  }

  let uploadedImage = null;
  catalogQuickSaveState = productId;
  catalogQuickSaveError = "";
  render();

  try {
    uploadedImage = await uploadCatalogImage(file, product, adminAuthSession);
    const nextImages = normalizeCatalogDraftImages([
      {
        storagePath: uploadedImage.path,
        publicUrl: uploadedImage.publicUrl,
        url: uploadedImage.publicUrl,
        altText: product.name || "Product image",
        isPrimary: true,
      },
      ...(product.images ?? [])
        .filter((image) => image.storagePath)
        .slice(0, CATALOG_PRODUCT_IMAGE_LIMIT - 1)
        .map((image) => ({ ...image, isPrimary: false })),
    ]);
    const savedProduct = await updateAdminProduct(productId, { ...product, images: nextImages }, adminAuthSession);
    if (savedProduct) catalogProducts = upsertCatalogProduct(catalogProducts, savedProduct);
    catalogQuickSaveState = "idle";
    catalogSaveState = "success";
    render();
  } catch (error) {
    console.error("Unable to update catalog product image.", error);
    if (uploadedImage?.path) {
      deleteCatalogImagePath(uploadedImage.path, adminAuthSession).catch((cleanupError) => console.warn("Unable to clean up failed quick image upload.", cleanupError));
    }
    catalogQuickSaveState = "idle";
    catalogQuickSaveError = error.message || "Image update failed. Check catalog image storage permissions.";
    render();
  }
}

async function duplicateCatalogProduct(productId) {
  if (!canWriteCatalogProducts() || catalogQuickSaveState !== "idle") return;
  const product = catalogProducts.find((item) => item.id === productId);
  if (!product) return;

  catalogQuickSaveState = productId;
  catalogQuickSaveError = "";
  render();

  try {
    const savedProduct = await duplicateAdminProduct(product, adminAuthSession);
    if (savedProduct) {
      catalogProducts = upsertCatalogProduct(catalogProducts, savedProduct);
      catalogExpandedProductId = savedProduct.id;
      selectedCatalogProductId = savedProduct.id;
    }
    catalogQuickSaveState = "idle";
    render();
  } catch (error) {
    console.error("Unable to duplicate catalog product.", error);
    catalogQuickSaveState = "idle";
    catalogQuickSaveError = error.message || "Duplicate failed. Check catalog product permissions.";
    render();
  }
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}
function updateCatalogDraftField(field, value, inputType = "text") {
  if (!catalogDraft) return;
  const nextValue = inputType === "checkbox" ? Boolean(value) : value;

  catalogDraft = {
    ...catalogDraft,
    [field]: nextValue,
  };

  if (field === "catalogKey") {
    catalogDraft.catalogKeys = [nextValue];
  }

  if (field === "brandId") {
    const brand = brands.find((item) => item.id === nextValue);
    catalogDraft.brandName = brand?.name || "";
    catalogDraft.brand = brand?.name || "";
  }

  if (field === "category") {
    const category = productCategories.find((item) => item.name === nextValue);
    catalogDraft.categoryId = category?.id || "";
  }

  if (field === "productType") {
    const category = productCategories.find((item) => item.name === catalogDraft.category);
    if (category && category.productType !== nextValue) {
      catalogDraft.category = "";
      catalogDraft.categoryId = "";
    }
  }

  catalogValidationError = "";
  catalogSaveError = "";
}

function focusCatalogEditorSection(sectionId) {
  if (!sectionId) return;
  const section = document.getElementById(sectionId);
  if (!section) return;
  section.scrollIntoView({ behavior: "smooth", block: "start" });
  section.focus({ preventScroll: true });
  const control = section.querySelector("input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])");
  if (control) control.focus({ preventScroll: true });
}

async function saveCatalogDraft() {
  if (!canWriteCatalogProducts() || !catalogDraft || catalogSaveState === "saving" || catalogSaveState === "uploading") return;

  const draft = catalogDraft;
  const product = normalizeCatalogDraft(draft);
  const validationError = validateCatalogProductEditor(draft, product);
  if (validationError) {
    catalogValidationError = validationError;
    render();
    return;
  }

  const draftImages = getCatalogEditorImages(draft);
  for (const image of draftImages) {
    if (!image.file) continue;
    const imageValidationError = await validateCatalogImageFileWithDimensions(image.file);
    if (imageValidationError) {
      catalogDraft = { ...draft, imageError: imageValidationError };
      render();
      return;
    }
  }

  const uploadedImages = [];
  const isEdit = catalogEditorMode === "edit" && draft.id;
  catalogSaveState = draftImages.some((image) => image.file) ? "uploading" : "saving";
  catalogSaveError = "";
  catalogValidationError = "";
  catalogDraft = { ...draft, imageError: "" };
  render();

  try {
    const baseProduct = { ...product };
    delete baseProduct.images;
    let savedProduct = isEdit
      ? await updateAdminProduct(draft.id, baseProduct, adminAuthSession)
      : await createAdminProduct(baseProduct, adminAuthSession);

    const finalImages = [];
    for (const image of draftImages) {
      if (image.file) {
        catalogSaveState = "uploading";
        render();
        const uploadedImage = await uploadCatalogImage(image.file, savedProduct, adminAuthSession);
        uploadedImages.push(uploadedImage);
        finalImages.push({
          storagePath: uploadedImage.path,
          publicUrl: uploadedImage.publicUrl,
          url: uploadedImage.publicUrl,
          altText: image.altText || savedProduct.name || "Product image",
          isPrimary: image.isPrimary === true,
        });
      } else if (image.storagePath) {
        finalImages.push(image);
      }
    }

    catalogSaveState = "saving";
    render();
    savedProduct = await updateAdminProduct(savedProduct.id, { ...savedProduct, images: normalizeCatalogDraftImages(finalImages) }, adminAuthSession);

    if (savedProduct) {
      catalogProducts = upsertCatalogProduct(catalogProducts, savedProduct);
      selectedCatalogProductId = savedProduct.id;
      activeCatalogKey = savedProduct.catalogKey;
    }

    clearCatalogImagePreview();
    catalogEditorMode = savedProduct?.id ? "edit" : catalogEditorMode;
    catalogEditorRouteKey = savedProduct?.id ? `edit:${savedProduct.id}` : catalogEditorRouteKey;
    catalogDraft = createCatalogDraft(savedProduct ?? product);
    catalogSaveState = "success";
    if (savedProduct?.id && !isEdit) {
      window.history.replaceState({}, "", `/catalog?product=${encodeURIComponent(savedProduct.id)}`);
    }
    window.setTimeout(() => {
      if (catalogSaveState === "success") {
        catalogSaveState = "idle";
        render();
      }
    }, 1800);
    render();
  } catch (error) {
    for (const uploadedImage of uploadedImages) {
      if (uploadedImage?.path) {
        try {
          await deleteCatalogImagePath(uploadedImage.path, adminAuthSession);
        } catch (cleanupError) {
          console.warn("Unable to clean up uploaded catalog image after failed save.", cleanupError);
        }
      }
    }

    console.error("Unable to save catalog product.", error);
    catalogSaveState = "idle";
    catalogSaveError = error.message || "Save failed. Check RLS and catalog product fields.";
    if (catalogDraft) {
      catalogDraft = {
        ...catalogDraft,
        imageError: catalogSaveError,
      };
    }
    render();
  }
}

function normalizeCatalogDraft(draft) {
  const category = productCategories.find((item) => item.name === draft.category);
  return {
    ...draft,
    name: String(draft.name || "").trim(),
    productCode: String(draft.productCode || "").trim(),
    slug: String(draft.productCode || draft.slug || "").trim(),
    catalogKeys: [draft.catalogKey].filter(Boolean),
    brandId: String(draft.brandId || "").trim(),
    brandName: getCatalogEditorBrandLabel(draft),
    category: String(draft.category || "").trim(),
    categoryId: draft.categoryId || category?.id || "",
    description: String(draft.description || "").trim(),
    imageUrl: getCatalogEditorPrimaryImage(draft),
    images: getCatalogEditorImages(draft),
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
  if (!catalogStatusOptions.includes(product.status)) return "Choose a valid status.";
  if (!Number.isFinite(product.minimumQuantity) || product.minimumQuantity < 1) return "Minimum quantity must be at least 1.";
  if (product.startingPrice !== "" && (!Number.isFinite(product.startingPrice) || product.startingPrice < 0)) return "Starting price cannot be negative.";
  if (!Number.isFinite(product.sortOrder) || product.sortOrder < 0) return "Sort order cannot be negative.";
  if (getCatalogEditorImageCount(product) > CATALOG_PRODUCT_IMAGE_LIMIT) return `Maximum ${CATALOG_PRODUCT_IMAGE_LIMIT} images per product.`;
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
  if (isEditableElement(event.target)) return;
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
  document.querySelector("[data-auto-plan-submit]")?.addEventListener("click", submitAutoPlanToday);
  document.querySelector("[data-auto-plan-drafts]")?.addEventListener("click", openAutoPlanDraftView);
  document.getElementById("auto-plan-quick-direction")?.addEventListener("input", (event) => {
    autoPlanQuickDirection = event.target.value;
    autoPlanError = "";
  });
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
  document.querySelectorAll("[data-workboard-approve-assign]").forEach((button) => button.addEventListener("click", () => runWorkboardCommand(button.dataset.workboardApproveAssign, "approve-and-assign")));
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

function bindCalendarEvents() {
  document.querySelector("[data-calendar-login-again]")?.addEventListener("click", async () => {
    await logoutAdminUser();
  });
  document.querySelector("[data-calendar-prev]")?.addEventListener("click", () => shiftCalendarMonth(-1));
  document.querySelector("[data-calendar-next]")?.addEventListener("click", () => shiftCalendarMonth(1));
  document.querySelector("[data-calendar-today]")?.addEventListener("click", () => {
    calendarSelectedDate = getManilaTodayKey();
    calendarVisibleMonth = getMonthKey(calendarSelectedDate);
    calendarSelectedTask = null;
    loadTaskCalendar();
  });
  document.querySelectorAll("[data-calendar-date]").forEach((button) => {
    button.addEventListener("click", () => {
      calendarSelectedDate = button.dataset.calendarDate;
      calendarSelectedTask = null;
      render();
    });
  });
  document.querySelectorAll("[data-calendar-event]").forEach((button) => {
    button.addEventListener("click", () => {
      calendarSelectedTask = calendarEvents.find((event) => event.key === button.dataset.calendarEvent) || null;
      render();
    });
  });
  document.querySelectorAll("[data-calendar-close]").forEach((button) => button.addEventListener("click", () => {
    calendarSelectedTask = null;
    render();
  }));
  document.getElementById("calendar-assignee-filter")?.addEventListener("change", (event) => {
    calendarAssigneeFilter = event.target.value;
    calendarSelectedTask = null;
    loadTaskCalendar();
  });
  document.getElementById("calendar-source-filter")?.addEventListener("change", (event) => {
    calendarSourceFilter = event.target.value;
    calendarSelectedTask = null;
    loadTaskCalendar();
  });
  document.getElementById("calendar-status-filter")?.addEventListener("change", (event) => {
    calendarStatusFilter = event.target.value;
    calendarSelectedTask = null;
    loadTaskCalendar();
  });
  document.querySelector("[data-calendar-clear]")?.addEventListener("click", () => {
    calendarAssigneeFilter = "";
    calendarSourceFilter = "";
    calendarStatusFilter = "";
    calendarSelectedTask = null;
    loadTaskCalendar();
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
    createOrder: createNativeOrderFromInquiry,
    saveProduction: saveMvpProductionFields,
    approveOrderArtwork: approveMvpOrderArtwork,
    confirmPayment: confirmMvpOrderPayment,
    saveFulfillment: saveMvpFulfillmentFields,
    saveInquiryFollowUp: saveMvpInquiryFollowUp,
    handleInquiryFollowUpOutcome: handleMvpInquiryFollowUpOutcome,
  });
  document.body.classList.toggle("mvp-drawer-open", Boolean(document.querySelector(".mvp-drawer")));
  document.body.classList.toggle("catalog-drawer-open", Boolean(document.querySelector(".catalog-drawer")));
  document.body.classList.toggle("my-task-drawer-open", Boolean(document.querySelector(".my-task-drawer")));
  bindOpsBoardEvents();
  bindOrderDashboardEvents();
  bindWorkboardEvents();
  bindMyTasksEvents();
  bindCalendarEvents();

  document.getElementById("category-status-filter")?.addEventListener("change", (event) => {
    categoryStatusFilter = event.target.value;
    render();
  });

  document.getElementById("category-product-type-filter")?.addEventListener("change", (event) => {
    categoryProductTypeFilter = event.target.value;
    render();
  });

  document.getElementById("category-hierarchy-filter")?.addEventListener("change", (event) => {
    categoryHierarchyFilter = event.target.value;
    render();
  });

  document.querySelector("[data-category-reset-filters]")?.addEventListener("click", () => {
    productQuery = "";
    categoryProductTypeFilter = "all";
    categoryHierarchyFilter = "all";
    categoryStatusFilter = "active";
    render();
  });

  document.getElementById("brand-status-filter")?.addEventListener("change", (event) => {
    brandStatusFilter = event.target.value;
    render();
  });

  document.querySelector("[data-brand-reset-filters]")?.addEventListener("click", () => {
    productQuery = "";
    brandStatusFilter = "active";
    render();
  });

  document.querySelector("[data-brand-add]")?.addEventListener("click", () => {
    openBrandDrawer("create");
  });

  document.querySelectorAll("[data-brand-edit]").forEach((element) => {
    const openBrandRow = () => openBrandDrawer("edit", element.dataset.brandEdit);

    element.addEventListener("click", (event) => {
      event.stopPropagation();
      openBrandRow();
    });

    element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openBrandRow();
    });
  });

  document.querySelectorAll("[data-brand-close]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.preventDefault();
      closeBrandDrawer();
    });
  });

  document.querySelectorAll("[data-brand-field]").forEach((field) => {
    field.addEventListener("input", (event) => {
      updateBrandDraftField(field.dataset.brandField, event.target.value);
    });
    field.addEventListener("change", (event) => {
      updateBrandDraftField(field.dataset.brandField, event.target.value);
    });
  });

  document.querySelectorAll("[data-brand-archive]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      await archiveBrand(button.dataset.brandArchive);
    });
  });

  document.getElementById("brand-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveBrandDraft();
  });

  document.querySelector("[data-category-add]")?.addEventListener("click", () => {
    openCategoryDrawer("create");
  });

  document.querySelectorAll("[data-category-edit]").forEach((element) => {
    const openCategoryRow = () => openCategoryDrawer("edit", element.dataset.categoryEdit);

    element.addEventListener("click", (event) => {
      event.stopPropagation();
      openCategoryRow();
    });

    element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openCategoryRow();
    });
  });

  document.querySelectorAll("[data-category-close]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.preventDefault();
      closeCategoryDrawer();
    });
  });

  document.querySelectorAll("[data-category-field]").forEach((field) => {
    field.addEventListener("input", (event) => {
      updateCategoryDraftField(field.dataset.categoryField, event.target.value);
      if (field.dataset.categoryField === "name") {
        const codeInput = document.getElementById("catalog-code");
        if (codeInput && categoryDraft?.code) codeInput.value = categoryDraft.code;
      }
    });
    field.addEventListener("change", (event) => {
      updateCategoryDraftField(field.dataset.categoryField, event.target.value);
    });
  });

  document.querySelector("[data-category-archive-action]")?.addEventListener("click", async (event) => {
    await archiveOrRestoreCategory(event.currentTarget.dataset.categoryArchiveAction);
  });

  document.getElementById("category-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveCategoryDraft();
  });

  document.querySelectorAll("[data-catalog-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeCatalogKey = button.dataset.catalogTab;
      catalogStatusFilter = catalogStatusFilter || "active";
      selectedCatalogProductId = catalogProducts.find((item) => item.catalogKey === activeCatalogKey)?.id ?? null;
      clearCatalogImagePreview();
      catalogEditorMode = "";
      catalogEditorRouteKey = "";
      catalogDraft = null;
      render();
    });
  });

  document.getElementById("catalog-status-filter")?.addEventListener("change", (event) => {
    catalogStatusFilter = event.target.value;
    render();
  });

  document.getElementById("catalog-brand-filter")?.addEventListener("change", (event) => {
    catalogBrandFilter = event.target.value;
    render();
  });

  document.getElementById("catalog-category-filter")?.addEventListener("change", (event) => {
    catalogCategoryFilter = event.target.value;
    render();
  });

  document.getElementById("catalog-product-type-filter")?.addEventListener("change", (event) => {
    catalogProductTypeFilter = event.target.value;
    const category = productCategories.find((item) => item.name === catalogCategoryFilter);
    if (catalogProductTypeFilter !== "all" && category && category.productType !== catalogProductTypeFilter) {
      catalogCategoryFilter = "all";
    }
    render();
  });

  document.getElementById("catalog-featured-filter")?.addEventListener("change", (event) => {
    catalogFeaturedFilter = event.target.value;
    render();
  });

  document.querySelector("[data-catalog-reset-filters]")?.addEventListener("click", () => {
    productQuery = "";
    catalogStatusFilter = "active";
    catalogBrandFilter = "all";
    catalogCategoryFilter = "all";
    catalogProductTypeFilter = "all";
    catalogFeaturedFilter = "all";
    render();
  });


  document.querySelector("[data-catalog-add-product]")?.addEventListener("click", () => {
    openCatalogProductEditor("create");
  });

  document.querySelectorAll("[data-catalog-edit-product]").forEach((element) => {
    const openCatalogRow = () => openCatalogProductEditor("edit", element.dataset.catalogEditProduct);

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

  document.querySelectorAll("[data-catalog-toggle-product]").forEach((element) => {
    const toggleRow = () => toggleCatalogProductQuickControl(element.dataset.catalogToggleProduct);

    element.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleRow();
    });

    element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggleRow();
    });
  });

  document.querySelectorAll("[data-catalog-full-edit]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openCatalogProductEditor("edit", button.dataset.catalogFullEdit);
    });
  });

  document.querySelectorAll("[data-catalog-copy-sku]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      await copyToClipboard(button.dataset.catalogCopySku);
      showFeedback("SKU copied.");
    });
  });

  document.querySelectorAll("[data-catalog-quick-price-save]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      await updateCatalogQuickPrice(button.dataset.catalogQuickPriceSave);
    });
  });

  document.querySelectorAll("[data-catalog-quick-status]").forEach((select) => {
    select.addEventListener("change", async (event) => {
      event.stopPropagation();
      await updateCatalogQuickStatus(select.dataset.catalogQuickStatus, event.target.value);
    });
  });

  document.querySelectorAll("[data-catalog-archive-product]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      await archiveCatalogQuickProduct(button.dataset.catalogArchiveProduct);
    });
  });

  document.querySelectorAll("[data-catalog-duplicate]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      await duplicateCatalogProduct(button.dataset.catalogDuplicate);
    });
  });

  document.querySelectorAll("[data-catalog-quick-image-file]").forEach((field) => {
    field.addEventListener("change", async (event) => {
      event.stopPropagation();
      const file = event.target.files?.[0] ?? null;
      if (file) await updateCatalogQuickImage(field.dataset.catalogQuickImageFile, file);
    });
  });

  document.querySelectorAll("[data-catalog-editor-cancel]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.preventDefault();
      closeCatalogProductEditor();
    });
  });

  document.querySelectorAll("[data-catalog-field]").forEach((field) => {
    const eventName = field.type === "checkbox" ? "change" : "input";
    field.addEventListener(eventName, (event) => {
      updateCatalogDraftField(field.dataset.catalogField, field.type === "checkbox" ? field.checked : event.target.value, field.type);
      if (field.dataset.catalogField === "productType") render();
    });
  });

  document.querySelectorAll("[data-catalog-status-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      updateCatalogDraftField("status", button.dataset.catalogStatusChoice);
      render();
    });
  });

  document.querySelector("[data-catalog-image-file]")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0] ?? null;
    if (file) await updateCatalogImageFile(file);
  });

  document.querySelectorAll("[data-catalog-remove-image]").forEach((button) => {
    button.addEventListener("click", () => removeCatalogImageFromDraft(Number(button.dataset.catalogRemoveImage || 0)));
  });

  document.querySelectorAll("[data-catalog-move-image]").forEach((button) => {
    button.addEventListener("click", () => moveCatalogImageInDraft(Number(button.dataset.catalogMoveImage || 0), button.dataset.direction));
  });

  document.querySelectorAll("[data-catalog-set-primary-image]").forEach((button) => {
    button.addEventListener("click", () => setCatalogPrimaryImageInDraft(Number(button.dataset.catalogSetPrimaryImage || 0)));
  });

  document.querySelectorAll("[data-catalog-image-drag]").forEach((slot) => {
    slot.addEventListener("dragstart", (event) => { event.dataTransfer?.setData("text/plain", slot.dataset.catalogImageDrag); });
    slot.addEventListener("dragover", (event) => event.preventDefault());
    slot.addEventListener("drop", (event) => {
      event.preventDefault();
      const fromIndex = Number(event.dataTransfer?.getData("text/plain") || -1);
      const toIndex = Number(slot.dataset.catalogImageDrag || -1);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex || !catalogDraft) return;
      const images = getCatalogEditorImages(catalogDraft);
      const reordered = [...images];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moved);
      catalogDraft = { ...catalogDraft, images: normalizeCatalogDraftImages(reordered), imageError: "" };
      catalogSaveError = "";
      render();
    });
  });

  document.querySelectorAll("[data-catalog-readiness-target]").forEach((button) => {
    button.addEventListener("click", () => {
      focusCatalogEditorSection(button.dataset.catalogReadinessTarget);
    });
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
    return { ok: true };
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
    return { ok: true, inquiry: savedInquiry };
  } catch (error) {
    console.error("Unable to save inquiry follow-up fields.", error);
    showFeedback(error.message || "Unable to save inquiry follow-up.");
    return { ok: false, error: error.message || "Unable to save inquiry follow-up." };
  }
}
async function saveMvpProductionFields(id, changes) {
  const inquiryId = resolveMvpOrderInquiryId(id);
  const current = opsInquiries.find((item) => item.id === inquiryId);
  if (!current || !hasNativeOrderAuthority(nativeOrderRows, inquiryId)) return { ok: false, error: "Confirmed native Order required." };
  if (shouldLoadSupabaseOps && !current.productionFieldsReady) {
    orderDashboardSaveError = "Production fields are not ready. Apply the pending migration before saving.";
    return { ok: false, error: orderDashboardSaveError };
  }

  const updates = {
    ...changes,
    productionUpdatedAt: new Date().toISOString(),
  };
  if (changes.startProduction) updates.productionStartedAt = updates.productionUpdatedAt;
  if (changes.productionStage === "qc" && !current.qcStartedAt) {
    updates.qcStartedAt = updates.productionUpdatedAt;
    updates.qcStartedBy = adminUser?.userId || null;
  }
  if (changes.productionStage === "ready" && String(current.productionStage || "").toLowerCase() === "qc" && !current.qcCompletedAt) {
    updates.qcCompletedAt = updates.productionUpdatedAt;
    updates.qcCompletedBy = adminUser?.userId || null;
  }
  let savedInquiry = null;

  if (shouldLoadSupabaseOps) {
    try {
      const payload = await requestOpsWorkflowAction(inquiryId, {
        action: changes.releaseProduction ? "release_production" : changes.startProduction ? "start_production" : changes.productionStage ? "advance_production" : Object.prototype.hasOwnProperty.call(changes, "qcNote") ? "save_qc_note" : "save_production",
        productionStage: changes.productionStage,
        assignedUserId: changes.assignedUserId,
        dueDate: changes.dueDate,
        productionNote: changes.productionNote,
        qcNote: changes.qcNote,
        blockedReason: changes.blockedReason,
      });
      savedInquiry = payload.inquiry;
      if (!savedInquiry) throw new Error("Production update returned no saved inquiry.");
      orderDashboardSaveError = "";
    } catch (error) {
      console.error("Unable to save MVP production fields.", error);
      orderDashboardSaveError = error.message || "Unable to save production fields.";
      return { ok: false, error: orderDashboardSaveError };
    }
  }

  opsInquiries = opsInquiries.map((item) => item.id === inquiryId ? { ...item, ...(savedInquiry || updates) } : item);
  return savedInquiry || updates;
}

async function approveMvpOrderArtwork(id) {
  const inquiryId = resolveMvpOrderInquiryId(id);
  const current = opsInquiries.find((item) => item.id === inquiryId);
  if (!current || !isConfirmedOpsOrder(current)) return { ok: false, error: "Confirmed native Order required." };

  if (shouldLoadSupabaseOps) {
    try {
      const payload = await requestOpsCustomerAction(inquiryId, { action: "approve_artwork" });
      if (!payload?.inquiry) throw new Error("Artwork approval returned no saved inquiry.");
      opsInquiries = opsInquiries.map((item) => item.id === inquiryId ? { ...item, ...payload.inquiry } : item);
      return { ok: true, inquiry: payload.inquiry };
    } catch (error) {
      console.error("Unable to approve Order artwork.", error);
      return { ok: false, error: error.message || "Unable to approve artwork." };
    }
  }

  const updates = { artworkStatus: "approved", artworkApprovedAt: new Date().toISOString() };
  opsInquiries = opsInquiries.map((item) => item.id === inquiryId ? { ...item, ...updates } : item);
  return { ok: true, inquiry: updates };
}

async function saveMvpFulfillmentFields(id, changes) {
  const inquiryId = resolveMvpOrderInquiryId(id);
  const current = opsInquiries.find((item) => item.id === inquiryId);
  if (!current || !hasNativeOrderAuthority(nativeOrderRows, inquiryId)) return { ok: false, error: "Confirmed native Order required." };

  const trackingSubstatus = String(changes?.trackingSubstatus || "").trim();
  const method = String(current.fulfillmentMethod || "").trim().toLowerCase();
  const allowed = {
    pickup: new Set(["ready_for_pickup", "completed"]),
    delivery: new Set(["out_for_delivery", "delivered", "completed"]),
  }[method];
  if (!allowed || !allowed.has(trackingSubstatus)) {
    return { ok: false, error: "Fulfillment action is not valid for this Order." };
  }

  const updates = {
    trackingSubstatus,
    trackingNote: changes?.trackingNote === undefined ? current.trackingNote || null : changes.trackingNote || null,
    trackingUpdatedAt: new Date().toISOString(),
  };
  let savedInquiry = null;

  if (shouldLoadSupabaseOps) {
    try {
      savedInquiry = await updateOpsInquiryFields(inquiryId, updates, adminAuthSession);
      if (!savedInquiry) throw new Error("Fulfillment update returned no saved inquiry.");
    } catch (error) {
      console.error("Unable to save MVP fulfillment fields.", error);
      return { ok: false, error: error.message || "Unable to save fulfillment fields." };
    }
  }

  opsInquiries = opsInquiries.map((item) => item.id === inquiryId ? { ...item, ...(savedInquiry || updates) } : item);
  return { ok: true, inquiry: savedInquiry || updates };
}

function resolveMvpOrderInquiryId(value) {
  const target = String(value || "").trim().toLowerCase();
  if (!target) return "";
  const direct = opsInquiries.find((item) => String(item.id || "").trim().toLowerCase() === target);
  if (direct) return direct.id;
  const native = nativeOrderRows.find((row) => [
    row?.id,
    row?.order_reference,
    row?.orderReference,
    row?.source_inquiry_id,
    row?.sourceInquiryId,
  ].some((candidate) => String(candidate || "").trim().toLowerCase() === target));
  return native?.source_inquiry_id || native?.sourceInquiryId || value;
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
      opsArtworkRequests = {};
      opsCustomerActionRequests = {};
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

function isPasswordResetRoute() {
  return window.location.pathname.replace(/\/+$/, "") === "/reset-password";
}

function isForgotPasswordRoute() {
  return window.location.pathname.replace(/\/+$/, "") === "/forgot-password";
}

function isLoginRoute() {
  return window.location.pathname.replace(/\/+$/, "") === "/login";
}
function getCurrentRoute() {
  return routes[getRoutePath()] ?? routes[defaultRoutePath];
}

function getRoutePath() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === legacyOrderDashboardPath) return activeOrdersPath;
  if (path === "/my-tasks" && !canViewMyTasksRoute()) return defaultRoutePath;
  if (path === "/workboard" && !canViewWorkboardRoute()) return defaultRoutePath;
  if (path === "/calendar" && !canViewCalendarRoute()) return defaultRoutePath;
  return routes[path] ? path : defaultRoutePath;
}

function navigateTo(path) {
  const normalizedPath = normalizeRoutePath(path);
  window.history.pushState({}, "", normalizedPath);
}

function normalizeRoutePath(path) {
  const url = new URL(String(path || defaultRoutePath), window.location.origin);
  const routePath = url.pathname.replace(/\/+$/, "") || "/";
  if (routePath === legacyOrderDashboardPath) return `${activeOrdersPath}${url.search}`;
  if (["/forgot-password", "/reset-password", "/set-password", "/login"].includes(routePath)) {
    return `${routePath}${url.search}${url.hash}`;
  }
  if (routePath === "/my-tasks" && !canViewMyTasksRoute()) return defaultRoutePath;
  if (routePath === "/workboard" && !canViewWorkboardRoute()) return defaultRoutePath;
  if (routePath === "/calendar" && !canViewCalendarRoute()) return defaultRoutePath;
  return routes[routePath] ? `${routePath}${url.search}` : defaultRoutePath;
}

function normalizeLegacyOrderDashboardRoute() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path !== legacyOrderDashboardPath) return false;
  window.history.replaceState({}, "", `${activeOrdersPath}${window.location.search}`);
  render();
  return true;
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

