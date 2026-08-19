import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { deflateSync } from "node:zlib";

const root = process.cwd();
const screenshotDir = "C:\\tmp\\trry-product-images-owner-review";
const filterReviewDir = "C:\\tmp\\trry-admin-filter-quick-control-review";
const port = Number(process.env.PRODUCT_IMAGES_BROWSER_PORT || 58420);
const remotePort = port + 100;
const edgePath = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const ownerUserId = "95000000-0000-4000-8000-000000000010";
const staffUserId = "95000000-0000-4000-8000-000000000011";
const productId = "10000000-0000-4000-8000-000000000001";
const categoryId = "20000000-0000-4000-8000-000000000001";
const brandId = "30000000-0000-4000-8000-000000000001";
const productImagePath = join(tmpdir(), "trry-product-image-qa-800.png");
const browserConsole = [];

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
};

const appRoutes = new Set(["/", "/catalog", "/catalog/brands", "/catalog/categories"]);

let products = [{
  id: productId,
  master_product_id: "MP-IMG-001",
  product_code: "TRRY-IMG-001",
  category_id: categoryId,
  brand_id: brandId,
  name: "Image QA Tee",
  description: "Synthetic Product Images QA record",
  brand: "TRRY Apparel",
  product_type: "PHYSICAL",
  eligible_channels: [],
  typed_config: {
    price_label: "Starts at",
    minimum_quantity: 12,
    print_methods: ["DTF"],
    material: "Cotton",
    production_use: "Apparel",
    is_featured: false,
    sort_order: 1,
  },
  active: true,
  readiness_status: "NEEDS_SETUP",
  sellable: false,
  purchasable: false,
  archived_at: null,
  archive_reason: null,
  created_at: "2026-08-18T00:00:00.000Z",
  updated_at: "2026-08-18T00:00:00.000Z",
}];

let variants = [{
  id: "40000000-0000-4000-8000-000000000001",
  product_id: productId,
  master_variant_id: "MV-IMG-001",
  sku: "TRRY-IMG-001-STD",
  global_sku: "TRRY-IMG-001-STD",
  size: "M",
  color: "Black",
  selling_price: 499,
  unit_cost: 220,
  variant_type: "STANDARD",
  active: true,
  archived_at: null,
  created_at: "2026-08-18T00:00:00.000Z",
}];

let images = [1, 2, 3, 4].map((number, index) => imageRow(number, index, index === 0));
let expiredProductWriteFailures = 0;
let authRefreshCount = 0;

const categories = [{
  id: categoryId,
  name: "Shirts",
  code: "SHIRTS",
  product_type: "PHYSICAL",
  parent_category_id: null,
  active: true,
  archived_at: null,
}];

const brands = [{
  id: brandId,
  brand_code: "TRRY",
  name: "TRRY Apparel",
  ownership_type: "IN_HOUSE",
  owner_name: "TRRY",
  website_slug: "trry-apparel",
  status: "active",
}];

await mkdir(screenshotDir, { recursive: true });
await mkdir(filterReviewDir, { recursive: true });
await writeFile(productImagePath, createSolidPng(800, 800, 190, 242, 100));

const server = createServer(handleRequest);
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const browser = spawn(edgePath, [
  "--headless=new",
  `--remote-debugging-port=${remotePort}`,
  `--user-data-dir=${join(tmpdir(), `trry-product-images-edge-${Date.now()}`)}`,
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "about:blank",
], { stdio: "ignore" });

try {
  const wsUrl = await waitForBrowser(remotePort);
  const cdp = await createCdp(wsUrl);
  const page = await newPage(remotePort);
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: page.id, flatten: true });
  cdp.sessionId = sessionId;
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("DOM.enable");

  await setViewport(cdp, { width: 1440, height: 900 });
  await seedSession(cdp, "owner");
  await navigate(cdp, "/catalog");
  await waitFor(cdp, `document.body.innerText.includes("Image QA Tee")`);
  await verifyCanonicalProductVisibleWithoutChannel(cdp);
  await verifyCatalogProductsExpandColumn(cdp);
  await verifyUnsavedProductVariantGate(cdp);
  await navigate(cdp, "/catalog");
  await waitFor(cdp, `document.body.innerText.includes("Image QA Tee")`);
  await captureReview(cdp, "01-products-compact-filters.png");
  await evaluate(cdp, `document.querySelector("[data-catalog-toggle-product]")?.click()`);
  await waitFor(cdp, `Boolean(document.querySelector(".catalog-product-quick-control"))`);
  await captureReview(cdp, "02-products-quick-control.png");
  await navigate(cdp, "/catalog/categories");
  await waitFor(cdp, `document.body.innerText.includes("Shirts")`);
  await verifyCategoryTableGeometry(cdp);
  await captureReview(cdp, "06-categories-compact-filters.png");
  await navigate(cdp, "/catalog/brands");
  await waitFor(cdp, `document.body.innerText.includes("TRRY Apparel")`);
  await captureReview(cdp, "07-brands-compact-filters.png");
  await navigate(cdp, `/catalog?product=${productId}`);
  await waitFor(cdp, `document.querySelector("#catalog-section-images") && document.body.innerText.includes("Image QA Tee")`);
  await verifyNoHorizontalOverflow(cdp, "desktop product editor");
  await verifyVariantAddAndSessionRefresh(cdp);
  await assertImageState(cdp, { count: 4, primaryAlt: "Image 1" });
  await assertPrimaryMarkerOnly(cdp);

  await setPrimary(cdp, 2);
  await assertImageState(cdp, { count: 4, primaryAlt: "Image 3" });
  await assertPrimaryMarkerOnly(cdp);
  await addImage(cdp);
  await addImage(cdp);
  await waitFor(cdp, `document.querySelectorAll(".catalog-editor-image-slot.has-image").length === 6`);
  await verifyMaxLimit(cdp);
  await scrollImagesIntoView(cdp);
  await verifyResponsiveImageGrid(cdp, { label: "desktop", columns: 6, firstRowCount: 6, allCardsVisible: true });
  await verifyCompactControls(cdp);
  await capture(cdp, "01-desktop-product-images.png");
  await capture(cdp, "04-six-image-limit.png");
  await captureDesktopLowerAndBottom(cdp);

  await setViewport(cdp, { width: 1024, height: 820 });
  await verifyNoHorizontalOverflow(cdp, "tablet product images");
  await scrollImagesIntoView(cdp);
  await verifyResponsiveImageGrid(cdp, { label: "tablet", columns: 3, firstRowCount: 3 });
  await setViewport(cdp, { width: 1440, height: 900 });
  await scrollImagesIntoView(cdp);
  await verifyResponsiveImageGrid(cdp, { label: "desktop restored", columns: 6, firstRowCount: 6, allCardsVisible: true });

  await dragImage(cdp, 3, 1);
  await assertOrder(cdp, ["Image 1", "Image 4", "Image 2", "Image 3", "Image QA Tee", "Image QA Tee"]);
  await assertImageState(cdp, { count: 6, primaryAlt: "Image 3" });
  await verifyCompactControls(cdp);
  await scrollImagesIntoView(cdp);
  await capture(cdp, "02-desktop-product-images-reordered.png");

  await saveProduct(cdp);
  await navigate(cdp, "/catalog");
  await navigate(cdp, `/catalog?product=${productId}`);
  await waitFor(cdp, `document.querySelector("#catalog-section-images") && document.body.innerText.includes("Catalog item saved successfully") === false`);
  await assertImageState(cdp, { count: 6, primaryAlt: "Image 3" });
  await assertOrder(cdp, ["Image 1", "Image 4", "Image 2", "Image 3", "Image QA Tee", "Image QA Tee"]);

  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor(cdp, `document.querySelector("#catalog-section-images") && document.body.innerText.includes("Image QA Tee")`);
  await assertImageState(cdp, { count: 6, primaryAlt: "Image 3" });
  await assertOrder(cdp, ["Image 1", "Image 4", "Image 2", "Image 3", "Image QA Tee", "Image QA Tee"]);

  await navigate(cdp, "/catalog");
  await waitFor(cdp, `document.body.innerText.includes("Image QA Tee")`);
  await setViewport(cdp, { width: 390, height: 844 });
  await evaluate(cdp, `document.querySelector(".app-shell.mobile-sidebar-open .sidebar-close-button")?.click()`);
  await delay(250);
  await captureReview(cdp, "08-mobile-products-compact-filters-390x844.png");
  await navigate(cdp, `/catalog?product=${productId}`);
  await waitFor(cdp, `document.querySelector("#catalog-section-images") && document.body.innerText.includes("Image QA Tee")`);
  await verifyNoHorizontalOverflow(cdp, "mobile product images");
  await waitFor(cdp, `document.querySelector("#catalog-section-images")`);
  await scrollImagesIntoView(cdp);
  await verifyMobileCompactImageLayout(cdp);
  await capture(cdp, "03-mobile-product-images-390x844.png");
  await captureMobileLowerAndBottom(cdp);
  await verifyPrimaryDeletionFallback(cdp);

  await seedSession(cdp, "staff");
  await navigate(cdp, "/catalog");
  await waitFor(cdp, `document.body.innerText.includes("Image QA Tee")`);
  await verifyCanonicalProductVisibleWithoutChannel(cdp);
  await navigate(cdp, `/catalog?product=${productId}`);
  await waitFor(cdp, `document.querySelector("#catalog-section-images") && document.body.innerText.includes("Image QA Tee")`);
  const staffReadOnly = await evaluate(cdp, `(() => ({
    hasUpload: Boolean(document.querySelector("[data-catalog-image-file]:not([disabled])")),
    hasSetPrimary: Boolean(document.querySelector("[data-catalog-set-primary-image]:not([disabled])")),
    hasRemove: Boolean(document.querySelector("[data-catalog-remove-image]:not([disabled])")),
    hasMoveLeft: Boolean([...document.querySelectorAll("button")].some((button) => button.offsetParent !== null && button.textContent.trim() === "Move Left")),
    hasMoveRight: Boolean([...document.querySelectorAll("button")].some((button) => button.offsetParent !== null && button.textContent.trim() === "Move Right")),
    draggable: Boolean(document.querySelector("[data-catalog-image-drag]")),
  }))()`);
  assert.deepEqual(staffReadOnly, { hasUpload: false, hasSetPrimary: false, hasRemove: false, hasMoveLeft: false, hasMoveRight: false, draggable: false }, "Staff image controls remain read-only");

  console.log("PASS Product Images browser QA for six-image limit, seventh prevention, drag reorder, independent PRIMARY, save/reopen persistence, mobile overflow, and Staff read-only");
} finally {
  browser.kill();
  await new Promise((resolve) => server.close(resolve));
}

function imageRow(number, position, isPrimary = false) {
  const path = `products/${productId}/image-${number}.png`;
  return {
    id: `50000000-0000-4000-8000-00000000000${number}`,
    product_id: productId,
    storage_path: path,
    public_url: `http://127.0.0.1:${port}/storage/v1/object/public/catalog-images/${path}`,
    alt_text: `Image ${number}`,
    position,
    is_primary: isPrimary,
    active: true,
    archived_at: null,
    created_at: `2026-08-18T00:00:0${number}.000Z`,
  };
}

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === "/src/env.js") {
      jsonJs(response, {
        VITE_USE_SUPABASE_DATA: "true",
        VITE_SUPABASE_URL: `http://127.0.0.1:${port}`,
        VITE_SUPABASE_ANON_KEY: "local-product-images-anon",
      });
      return;
    }
    if (pathname === "/auth/v1/token") {
      const body = await readJson(request);
      if (url.searchParams.get("grant_type") !== "refresh_token" || body.refresh_token !== "owner-refresh-token") {
        return json(response, { message: "invalid refresh token" }, 401);
      }
      authRefreshCount += 1;
      return json(response, {
        access_token: "owner-token",
        refresh_token: "owner-refresh-token",
        expires_in: 3600,
        user: { id: ownerUserId, email: "owner@trry.invalid" },
      });
    }
    if (pathname.startsWith("/rest/v1/")) {
      await handleRest(url, request, response);
      return;
    }
    if (pathname.startsWith("/storage/v1/object/public/catalog-images/")) {
      const body = await readFile(productImagePath);
      response.writeHead(200, { "Content-Type": "image/png" });
      response.end(body);
      return;
    }
    if (pathname.startsWith("/storage/v1/object/catalog-images/")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ Key: pathname }));
      return;
    }
    const routePath = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");
    const requestedPath = appRoutes.has(routePath) ? "/index.html" : pathname;
    const filePath = normalize(join(root, requestedPath));
    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    const body = await readFile(filePath);
    response.writeHead(200, { "Content-Type": contentTypes[extname(filePath)] ?? "text/plain" });
    response.end(body);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain" });
    response.end(String(error?.stack || error));
  }
}

async function handleRest(url, request, response) {
  const table = url.pathname.replace("/rest/v1/", "");
  if (table === "rpc/set_product_images_for_product") {
    const body = await readJson(request);
    const payload = Array.isArray(body.p_images) ? body.p_images : [];
    if (payload.length > 6) return json(response, { message: "PRODUCT_IMAGE_LIMIT_EXCEEDED" }, 400);
    const primaryCount = payload.filter((image) => image.isPrimary === true || image.is_primary === true).length;
    if (primaryCount > 1) return json(response, { message: "PRODUCT_IMAGE_ONE_PRIMARY_REQUIRED" }, 400);
    images = payload.map((image, index) => ({
      id: image.id || `50000000-0000-4000-8000-0000000001${index}`,
      product_id: body.p_product_id,
      storage_path: image.storagePath || image.storage_path,
      public_url: image.publicUrl || image.public_url,
      alt_text: image.altText || image.alt_text || "",
      position: index,
      is_primary: primaryCount === 0 ? index === 0 : image.isPrimary === true || image.is_primary === true,
      active: true,
      archived_at: null,
      created_at: `2026-08-18T00:01:${String(index).padStart(2, "0")}.000Z`,
    }));
    return json(response, images);
  }
  if (request.method === "GET") {
    if (table === "admin_users") return json(response, [adminUserForToken(request.headers.authorization)]);
    if (table === "products") return json(response, filterByEq(products, url, "id"));
    if (table === "product_categories") return json(response, categories);
    if (table === "brands") return json(response, brands);
    if (table === "product_variants") return json(response, filterByEq(variants, url, "product_id"));
    if (table === "product_images") return json(response, filterByEq(images, url, "product_id").sort((a, b) => a.position - b.position));
    if (["ops_inquiries", "orders", "reorder_requests", "clients", "employees", "approved_products"].includes(table)) return json(response, []);
  }
  if (request.method === "PATCH") {
    const body = await readJson(request);
    if (table === "products") {
      if (request.headers.authorization?.includes("expired-owner-token") && expiredProductWriteFailures === 0) {
        expiredProductWriteFailures += 1;
        return json(response, { code: "PGRST303", message: "JWT expired", details: null, hint: null }, 401);
      }
      const id = getEq(url, "id");
      products = products.map((row) => row.id === id ? { ...row, ...body } : row);
      return json(response, products.filter((row) => row.id === id));
    }
    if (table === "product_variants") {
      const id = getEq(url, "id");
      variants = variants.map((row) => row.id === id ? { ...row, ...body } : row);
      return json(response, variants.filter((row) => row.id === id));
    }
  }
  if (request.method === "POST" && table === "product_variants") {
    const body = await readJson(request);
    const row = { id: `40000000-0000-4000-8000-0000000000${variants.length + 1}`, ...body, created_at: new Date().toISOString() };
    variants.push(row);
    return json(response, [row]);
  }
  return json(response, { message: `Unhandled ${request.method} ${table}` }, 404);
}

function adminUserForToken(authorization = "") {
  const isStaff = authorization.includes("staff-token");
  const userId = isStaff ? staffUserId : ownerUserId;
  return {
    id: isStaff ? "admin-profile-staff" : "admin-profile-owner",
    user_id: userId,
    email: isStaff ? "staff@trry.invalid" : "owner@trry.invalid",
    display_name: isStaff ? "Synthetic Staff" : "Synthetic Owner",
    role: isStaff ? "staff" : "owner",
    is_active: true,
  };
}

async function seedSession(cdp, role) {
  const isStaff = role === "staff";
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `localStorage.setItem("trry_admin_supabase_auth_session_v1", ${JSON.stringify(JSON.stringify({
      access_token: isStaff ? "staff-token" : "owner-token",
      refresh_token: "",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: isStaff ? staffUserId : ownerUserId, email: isStaff ? "staff@trry.invalid" : "owner@trry.invalid" },
    }))});`,
  });
}

async function addImage(cdp) {
  const input = await getNodeId(cdp, "[data-catalog-image-file]:not([disabled])");
  await cdp.send("DOM.setFileInputFiles", { nodeId: input, files: [productImagePath] });
  await waitFor(cdp, `document.querySelectorAll(".catalog-editor-image-slot.has-image").length > 4`);
}

async function setPrimary(cdp, index) {
  await evaluate(cdp, `document.querySelector('[data-catalog-set-primary-image="${index}"]')?.click()`);
  await delay(100);
}

async function dragImage(cdp, from, to) {
  await evaluate(cdp, `(() => {
    const fromNode = document.querySelector('[data-catalog-image-drag="${from}"]');
    const toNode = document.querySelector('[data-catalog-image-drag="${to}"]');
    const data = new DataTransfer();
    fromNode.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: data }));
    toNode.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: data }));
    toNode.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
  })()`);
  await delay(150);
}

async function saveProduct(cdp) {
  await evaluate(cdp, `document.querySelector("#catalog-product-form").requestSubmit()`);
  await waitFor(cdp, `document.body.innerText.includes("Changes saved successfully")`);
}

async function verifyUnsavedProductVariantGate(cdp) {
  await navigate(cdp, "/catalog?product=new");
  await waitFor(cdp, `document.querySelector("#catalog-section-variants")`);
  const state = await evaluate(cdp, `(() => {
    const addButton = document.querySelector("[data-catalog-add-variant]");
    return {
      addDisabled: Boolean(addButton?.disabled),
      helper: document.querySelector(".catalog-editor-helper")?.textContent.trim() || "",
      hasPanel: Boolean(document.querySelector("[data-catalog-variant-panel]")),
      hasTable: Boolean(document.querySelector(".catalog-editor-variant-table")),
      emptyCopy: document.body.innerText.includes("No variants yet") && document.body.innerText.includes("Add size and color combinations for this product."),
    };
  })()`);
  assert.deepEqual(state, {
    addDisabled: true,
    helper: "Save this Product before adding variants.",
    hasPanel: false,
    hasTable: false,
    emptyCopy: true,
  }, "unsaved Product explains why Add Variant is disabled without rendering a spreadsheet table");
}

async function verifyVariantAddAndSessionRefresh(cdp) {
  const initialState = await evaluate(cdp, `(() => {
    const addButton = document.querySelector("[data-catalog-add-variant]");
    const addRect = addButton?.getBoundingClientRect();
    const cardRect = document.querySelector("#catalog-section-variants")?.getBoundingClientRect();
    const cards = [...document.querySelectorAll(".catalog-variant-card")];
    return {
      addButtonText: addButton?.textContent.trim() || "",
      addDisabled: Boolean(addButton?.disabled),
      helper: document.querySelector(".catalog-editor-helper")?.textContent.trim() || "",
      variantRows: document.querySelectorAll("[data-catalog-variant-row]").length,
      hasTable: Boolean(document.querySelector(".catalog-editor-variant-table")),
      sizeChips: [...document.querySelectorAll(".catalog-attribute-chip")].map((chip) => chip.textContent.trim()),
      skuReadonly: [...document.querySelectorAll(".catalog-variant-sku-note")].every((node) => !node.querySelector("input")),
      addContained: Boolean(addRect && cardRect && addRect.right <= cardRect.right + 1),
      hasManualSkuField: Boolean(document.querySelector('[data-catalog-field="sku"], [data-catalog-field="globalSku"]')),
      savedDelete: Boolean(document.querySelector("[data-catalog-delete-variant]")),
    };
  })()`);
  assert.equal(initialState.addButtonText, "Add Variant", "saved Product Add Variant label");
  assert.equal(initialState.addDisabled, false, "saved Product Add Variant enabled");
  assert.equal(initialState.helper, "Use Add Variant to add the next size or color option, then save.", "saved Product Add Variant helper");
  assert.equal(initialState.variantRows, 1, "compact Variant rows replace table/card workflow");
  assert.equal(initialState.hasTable, false, "spreadsheet Variant table removed");
  assert.deepEqual(initialState.sizeChips, ["M", "Black"], "size/color chips render current attributes");
  assert.equal(initialState.skuReadonly, true, "SKU renders as read-only metadata");
  assert.equal(initialState.addContained, true, "Add Variant button is contained in the Variants card");
  assert.equal(initialState.hasManualSkuField, false, "generated SKU is not exposed as a primary manual field");
  assert.equal(initialState.savedDelete, true, "saved Variant row exposes safe Delete/Archive action");
  await verifyVariantInlineGeometry(cdp, "desktop");

  await forceExpiredOwnerSession(cdp);
  await evaluate(cdp, `document.querySelector("[data-catalog-add-variant]")?.click()`);
  await waitFor(cdp, `Boolean(document.querySelector("[data-catalog-variant-panel]"))`);
  const blankRowState = await evaluate(cdp, `(() => ({
    color: document.querySelector('[data-catalog-variant-field="color"]')?.value || "",
    size: document.querySelector('[data-catalog-variant-field="size"]')?.value || "",
    price: document.querySelector('[data-catalog-variant-field="sellingPrice"]')?.value || "",
    sku: document.querySelector("[data-catalog-variant-panel] .catalog-variant-sku-note strong")?.textContent.trim() || "",
    saveDisabled: Boolean(document.querySelector("[data-catalog-submit-variant]")?.disabled),
    hasTrash: Boolean(document.querySelector("[data-catalog-variant-panel] [data-catalog-delete-variant]")),
    hasCancel: Boolean(document.querySelector("[data-catalog-cancel-variant]")),
  }))()`);
  assert.deepEqual(blankRowState, {
    color: "",
    size: "",
    price: "",
    sku: "Auto-generated on save",
    saveDisabled: true,
    hasTrash: false,
    hasCancel: true,
  }, "Add Variant inserts one blank editable row with locked generated SKU and Cancel");
  await setVariantPanelValue(cdp, "size", "M");
  await setVariantPanelValue(cdp, "color", "Black");
  await setVariantPanelValue(cdp, "sellingPrice", "499");
  await evaluate(cdp, `document.querySelector("[data-catalog-submit-variant]")?.click()`);
  await waitFor(cdp, `document.body.innerText.toLowerCase().includes("this size and color combination already exists.")`);
  await setVariantPanelValue(cdp, "size", "XL");
  await evaluate(cdp, `document.querySelector("[data-catalog-submit-variant]")?.click()`);
  await waitFor(cdp, `document.querySelectorAll("[data-catalog-variant-row]").length === 2`);
  const draftState = await evaluate(cdp, `(() => ({
    hasSpreadsheetInputs: Boolean(document.querySelector('[data-catalog-field="availableSizesText"], [data-catalog-field="availableColorsText"]')),
    rows: [...document.querySelectorAll("[data-catalog-variant-row]")].map((row) => row.textContent.trim()),
    sizeChips: [...document.querySelectorAll(".catalog-attribute-chip")].map((chip) => chip.textContent.trim()),
    hasOptionGenerated: document.body.innerText.includes("Option 2") || document.body.innerText.includes("Option 5"),
    skuReadonly: [...document.querySelectorAll(".catalog-variant-sku-note")].every((node) => !node.querySelector("input")),
  }))()`);
  assert.equal(draftState.hasSpreadsheetInputs, false, "comma-separated Variant attribute inputs are not displayed");
  assert.equal(draftState.rows.length, 2, "Variant preview adds one new inline row");
  assert.ok(draftState.sizeChips.includes("M") && draftState.sizeChips.includes("XL") && draftState.sizeChips.includes("Black"), "chips reflect real size/color values");
  assert.equal(draftState.hasOptionGenerated, false, "Add Variant does not generate Option N placeholders");
  assert.equal(draftState.skuReadonly, true, "saved and unsaved Variant SKU displays remain read-only");

  await saveProduct(cdp);
  assert.equal(expiredProductWriteFailures, 1, "expired Product write was detected once");
  assert.equal(authRefreshCount, 1, "auth refresh was performed once");
  assert.equal(variants.filter((variant) => variant.product_id === productId && variant.active !== false && !variant.archived_at).length, 2, "one QA Variant persisted without duplicates");
  assert.equal(new Set(variants.filter((variant) => variant.product_id === productId).map((variant) => variant.id)).size, variants.filter((variant) => variant.product_id === productId).length, "variant IDs remain unique");

  await navigate(cdp, "/catalog");
  await navigate(cdp, `/catalog?product=${productId}`);
  await waitFor(cdp, `document.querySelector("#catalog-section-variants") && document.querySelectorAll("[data-catalog-variant-row]").length === 2`);
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor(cdp, `document.querySelector("#catalog-section-variants") && document.querySelectorAll("[data-catalog-variant-row]").length === 2`);
  await setViewport(cdp, { width: 390, height: 844 });
  await waitFor(cdp, `document.querySelector("#catalog-section-variants")`);
  await verifyNoHorizontalOverflow(cdp, "mobile variants");
  const mobileState = await evaluate(cdp, `(() => {
    const rows = [...document.querySelectorAll("[data-catalog-variant-row]")];
    return {
      rows: rows.length,
      rowFits: rows.every((row) => row.getBoundingClientRect().left >= -1 && row.getBoundingClientRect().right <= window.innerWidth + 1),
      addContained: document.querySelector("[data-catalog-add-variant]")?.getBoundingClientRect().right <= document.querySelector("#catalog-section-variants")?.getBoundingClientRect().right + 1,
    };
  })()`);
  assert.equal(mobileState.rows, 2, "mobile Variant rows remain visible");
  assert.equal(mobileState.rowFits, true, "mobile Variant rows fit viewport");
  assert.equal(mobileState.addContained, true, "mobile Add Variant button does not clip");
  await setViewport(cdp, { width: 1440, height: 900 });
}

async function verifyVariantInlineGeometry(cdp, label) {
  const geometry = await evaluate(cdp, `(() => {
    const color = document.querySelector('[data-catalog-existing-variant-field="color"]')?.getBoundingClientRect();
    const size = document.querySelector('[data-catalog-existing-variant-field="size"]')?.getBoundingClientRect();
    const sku = document.querySelector('.catalog-variant-sku-note')?.getBoundingClientRect();
    const price = document.querySelector('[data-catalog-existing-variant-field="sellingPrice"]')?.getBoundingClientRect();
    const save = document.querySelector('[data-catalog-save-existing-variant]')?.getBoundingClientRect();
    const trash = document.querySelector('[data-catalog-delete-variant]')?.getBoundingClientRect();
    const headerCells = [...document.querySelectorAll('.catalog-variant-row-labels span')].map((item) => item.getBoundingClientRect());
    const rowCells = [...document.querySelector('[data-catalog-variant-row]')?.children || []].slice(0, 5).map((item) => item.getBoundingClientRect());
    return {
      colorWidth: Math.round(color?.width || 0),
      sizeWidth: Math.round(size?.width || 0),
      colorRight: Math.round(color?.right || 0),
      sizeLeft: Math.round(size?.left || 0),
      colorSizeGap: Math.round((size?.left || 0) - (color?.right || 0)),
      skuWidth: Math.round(sku?.width || 0),
      priceWidth: Math.round(price?.width || 0),
      saveWidth: Math.round(save?.width || 0),
      saveHeight: Math.round(save?.height || 0),
      trashWidth: Math.round(trash?.width || 0),
      trashHeight: Math.round(trash?.height || 0),
      headerLefts: headerCells.map((cell) => Math.round(cell.left)),
      rowLefts: rowCells.map((cell) => Math.round(cell.left)),
      headerAligned: headerCells.length === 5 && rowCells.length === 5 && headerCells.every((cell, index) => Math.abs(Math.round(cell.left) - Math.round(rowCells[index].left)) <= 2),
      horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > document.documentElement.clientWidth + 1,
    };
  })()`);
  assert.ok(geometry.colorWidth >= 200 && geometry.colorWidth <= 240, `${label} Color width: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.sizeWidth >= 80 && geometry.sizeWidth <= 100, `${label} Size width: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.colorSizeGap >= 12 && geometry.colorSizeGap <= 20, `${label} Color-to-Size gap: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.skuWidth >= 300, `${label} SKU receives remaining width: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.priceWidth >= 120 && geometry.priceWidth <= 150, `${label} Price width: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.saveWidth >= 72 && geometry.saveWidth <= 84 && geometry.saveHeight === 40, `${label} Save size: ${JSON.stringify(geometry)}`);
  assert.deepEqual({ width: geometry.trashWidth, height: geometry.trashHeight }, { width: 40, height: 40 }, `${label} Trash size`);
  assert.equal(geometry.headerAligned, true, `${label} header and row alignment: ${JSON.stringify(geometry)}`);
  assert.equal(geometry.horizontalOverflow, false, `${label} no horizontal overflow`);
  console.log(`Variant ${label} geometry: ${JSON.stringify(geometry)}`);
  return geometry;
}

async function setVariantPanelValue(cdp, field, value) {
  await evaluate(cdp, `(() => {
    const input = document.querySelector('[data-catalog-variant-field="${field}"]');
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
}

async function forceExpiredOwnerSession(cdp) {
  await evaluate(cdp, `localStorage.setItem("trry_admin_supabase_auth_session_v1", ${JSON.stringify(JSON.stringify({
    access_token: "expired-owner-token",
    refresh_token: "owner-refresh-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: ownerUserId, email: "owner@trry.invalid" },
  }))})`);
}

async function verifyMaxLimit(cdp) {
  const state = await evaluate(cdp, `(() => ({
    count: document.querySelectorAll(".catalog-editor-image-slot.has-image").length,
    uploadDisabled: Boolean(document.querySelector("[data-catalog-image-file][disabled]")),
    maxText: document.body.innerText.includes("6 of 6 uploaded") && document.body.innerText.includes("Maximum 6 images reached"),
  }))()`);
  assert.deepEqual(state, { count: 6, uploadDisabled: true, maxText: true }, "Six-image limit blocks seventh image with feedback");
}

async function verifyCanonicalProductVisibleWithoutChannel(cdp) {
  const result = await evaluate(cdp, `(() => {
    const rows = [...document.querySelectorAll(".catalog-products-table tbody tr")];
    const countLabel = document.querySelector(".catalog-count-label")?.textContent.trim() || "";
    return {
      rowCount: rows.length,
      countLabel,
      hasProduct: rows.some((row) => row.textContent.includes("Image QA Tee")),
      hasEmptyState: Boolean(document.querySelector(".catalog-empty-state")),
    };
  })()`);
  assert.equal(result.hasProduct, true, "canonical Product with no channel assignment is visible under default filters");
  assert.equal(result.rowCount > 0, true, "default Products table renders canonical rows without channel filtering");
  assert.match(result.countLabel, /^[1-9]/, "visible Products count derives from canonical rows");
  assert.equal(result.hasEmptyState, false, "canonical Products are not replaced by an empty state");
}

async function verifyCatalogProductsExpandColumn(cdp) {
  await setViewport(cdp, { width: 1440, height: 900 });
  const desktop = await getCatalogProductsTableGeometry(cdp);
  assert.deepEqual(desktop.headers, ["Product", "Brand", "Category", "SKU", "Selling Price", "Margin", "Status", ""], `desktop Products column order: ${JSON.stringify(desktop)}`);
  assert.equal(desktop.cellCount, 8, `desktop Products rows have no stale columns: ${JSON.stringify(desktop)}`);
  assert.equal(desktop.removedHeadersPresent, false, `desktop secondary Products columns removed: ${JSON.stringify(desktop)}`);
  assert.equal(desktop.firstCellIsProduct, true, `desktop Product starts in first cell: ${JSON.stringify(desktop)}`);
  assert.equal(desktop.firstCellHasExpand, false, `desktop first expand column removed: ${JSON.stringify(desktop)}`);
  assert.equal(desktop.lastCellHasExpand, true, `desktop expand control is last column: ${JSON.stringify(desktop)}`);
  assert.ok(desktop.expandColumnWidth >= 56 && desktop.expandColumnWidth <= 64, `desktop expand column width: ${JSON.stringify(desktop)}`);
  assert.deepEqual({ width: desktop.expandButtonWidth, height: desktop.expandButtonHeight }, { width: 40, height: 40 }, `desktop expand control size: ${JSON.stringify(desktop)}`);
  assert.ok(desktop.productWidth >= 315, `desktop Product width uses reclaimed space: ${JSON.stringify(desktop)}`);
  assert.ok(desktop.brandWidth >= 150, `desktop Brand remains readable: ${JSON.stringify(desktop)}`);
  assert.ok(desktop.categoryWidth >= 150, `desktop Category remains readable: ${JSON.stringify(desktop)}`);
  assert.ok(desktop.skuWidth >= 125, `desktop SKU remains usable with Copy control: ${JSON.stringify(desktop)}`);
  assert.ok(desktop.priceWidth >= 110, `desktop Selling Price remains readable: ${JSON.stringify(desktop)}`);
  assert.ok(desktop.marginWidth >= 76, `desktop Margin remains compact: ${JSON.stringify(desktop)}`);
  assert.ok(desktop.statusWidth >= 90, `desktop Status remains compact: ${JSON.stringify(desktop)}`);
  assert.equal(desktop.headerAligned, true, `desktop Products header/body alignment: ${JSON.stringify(desktop)}`);
  assert.equal(desktop.pageOverflow, false, `desktop Products page has no horizontal overflow: ${JSON.stringify(desktop)}`);
  assert.equal(desktop.cardScrolls, false, `desktop Products table does not need horizontal table scroll: ${JSON.stringify(desktop)}`);

  await evaluate(cdp, `document.querySelector("[data-catalog-toggle-product]")?.click()`);
  await waitFor(cdp, `Boolean(document.querySelector(".catalog-product-quick-control"))`);
  const expanded = await getCatalogProductsTableGeometry(cdp);
  assert.equal(expanded.chevronPath, "m6 9 6 6 6-6", `expanded row keeps existing down chevron behavior: ${JSON.stringify(expanded)}`);
  await evaluate(cdp, `document.querySelector("[data-catalog-toggle-product]")?.click()`);
  await waitFor(cdp, `!document.querySelector(".catalog-product-quick-control")`);
  const collapsed = await getCatalogProductsTableGeometry(cdp);
  assert.equal(collapsed.chevronPath, "m9 18 6-6-6-6", `collapsed row keeps existing right chevron behavior: ${JSON.stringify(collapsed)}`);

  await setViewport(cdp, { width: 390, height: 844 });
  const mobile = await getCatalogProductsTableGeometry(cdp);
  assert.equal(mobile.pageOverflow, false, `mobile Products table has no page overflow: ${JSON.stringify(mobile)}`);
  await setViewport(cdp, { width: 1440, height: 900 });
  console.log(`Products desktop expand geometry: ${JSON.stringify(desktop)}`);
  console.log(`Products mobile expand geometry: ${JSON.stringify(mobile)}`);
}

async function getCatalogProductsTableGeometry(cdp) {
  return evaluate(cdp, `(() => {
    const table = document.querySelector(".catalog-products-table");
    const card = document.querySelector(".catalog-table-card:has(.catalog-products-table)");
    const headers = [...document.querySelectorAll(".catalog-products-table thead th")].map((cell) => cell.textContent.trim());
    const row = document.querySelector(".catalog-products-table tbody tr[data-catalog-toggle-product]");
    const cells = [...row?.children || []].map((cell) => cell.getBoundingClientRect());
    const headerCells = [...document.querySelectorAll(".catalog-products-table thead th")].map((cell) => cell.getBoundingClientRect());
    const firstCell = row?.children?.[0];
    const lastCell = row?.children?.[row.children.length - 1];
    const expandButton = lastCell?.querySelector(".catalog-expand-button")?.getBoundingClientRect();
    const tableRect = table?.getBoundingClientRect();
    const cardRect = card?.getBoundingClientRect();
    const lastIndex = Math.max(0, (row?.children?.length || 1) - 1);
    return {
      headers,
      cellCount: row?.children?.length || 0,
      removedHeadersPresent: headers.some((header) => ["Variants", "Unit Cost", "Updated"].includes(header)),
      firstCellIsProduct: Boolean(firstCell?.classList.contains("catalog-name-cell")),
      firstCellHasExpand: Boolean(firstCell?.classList.contains("catalog-expand-cell")),
      lastCellHasExpand: Boolean(lastCell?.classList.contains("catalog-expand-cell")),
      firstCellLeft: Math.round(cells[0]?.left || 0),
      tableLeft: Math.round(tableRect?.left || 0),
      productWidth: Math.round(cells[0]?.width || 0),
      brandWidth: Math.round(cells[1]?.width || 0),
      categoryWidth: Math.round(cells[2]?.width || 0),
      skuWidth: Math.round(cells[3]?.width || 0),
      priceWidth: Math.round(cells[4]?.width || 0),
      marginWidth: Math.round(cells[5]?.width || 0),
      statusWidth: Math.round(cells[6]?.width || 0),
      expandColumnWidth: Math.round(cells[lastIndex]?.width || 0),
      expandButtonWidth: Math.round(expandButton?.width || 0),
      expandButtonHeight: Math.round(expandButton?.height || 0),
      expandRight: Math.round(cells[lastIndex]?.right || 0),
      tableRight: Math.round(tableRect?.right || 0),
      cardRight: Math.round(cardRect?.right || 0),
      chevronPath: lastCell?.querySelector("svg path")?.getAttribute("d") || "",
      headerAligned: headerCells.length === cells.length && headerCells.every((cell, index) => Math.abs(Math.round(cell.left) - Math.round(cells[index].left)) <= 2 && Math.abs(Math.round(cell.width) - Math.round(cells[index].width)) <= 2),
      pageOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > document.documentElement.clientWidth + 1,
      cardScrolls: Boolean(card && card.scrollWidth > card.clientWidth + 1),
    };
  })()`);
}

async function verifyCategoryTableGeometry(cdp) {
  await setViewport(cdp, { width: 1440, height: 900 });
  const desktop = await getCategoryTableGeometry(cdp);
  assert.ok(desktop.categoryWidth >= 240 && desktop.categoryWidth <= 290, `desktop Category width balanced: ${JSON.stringify(desktop)}`);
  assert.ok(desktop.codeWidth >= 140 && desktop.codeWidth <= 180, `desktop Code width: ${JSON.stringify(desktop)}`);
  assert.ok(desktop.actionWidth >= 100 && desktop.actionWidth <= 125, `desktop Action width: ${JSON.stringify(desktop)}`);
  assert.ok(desktop.editWidth >= 64 && desktop.editWidth <= 80 && desktop.editHeight === 40, `desktop Edit button size: ${JSON.stringify(desktop)}`);
  assert.ok(desktop.codeGap >= 8 && desktop.codeGap <= 28, `desktop Category-to-Code gap: ${JSON.stringify(desktop)}`);
  assert.equal(desktop.editContained, true, `desktop Edit button contained: ${JSON.stringify(desktop)}`);
  assert.equal(desktop.headerAligned, true, `desktop category headers align with row cells: ${JSON.stringify(desktop)}`);
  assert.equal(desktop.pageOverflow, false, `desktop page has no horizontal overflow: ${JSON.stringify(desktop)}`);

  await setViewport(cdp, { width: 1024, height: 820 });
  const tablet = await getCategoryTableGeometry(cdp);
  assert.equal(tablet.editContained, true, `tablet Edit button contained: ${JSON.stringify(tablet)}`);
  assert.equal(tablet.pageOverflow, false, `tablet uses contained table scroll, not page overflow: ${JSON.stringify(tablet)}`);
  assert.equal(tablet.cardScrolls, true, `tablet category table scrolls inside card when needed: ${JSON.stringify(tablet)}`);
  await setViewport(cdp, { width: 390, height: 844 });
  const mobile = await getCategoryTableGeometry(cdp);
  assert.equal(mobile.pageOverflow, false, `mobile keeps category table overflow inside the card: ${JSON.stringify(mobile)}`);
  assert.equal(mobile.cardScrolls, true, `mobile category table preserves contained responsive scrolling: ${JSON.stringify(mobile)}`);
  await setViewport(cdp, { width: 1440, height: 900 });
  console.log(`Category desktop geometry: ${JSON.stringify(desktop)}`);
  console.log(`Category tablet geometry: ${JSON.stringify(tablet)}`);
  console.log(`Category mobile geometry: ${JSON.stringify(mobile)}`);
}

async function getCategoryTableGeometry(cdp) {
  return evaluate(cdp, `(() => {
    const card = document.querySelector(".catalog-table-card:has(.category-table)");
    const table = document.querySelector(".category-table");
    const headers = [...document.querySelectorAll(".category-table thead th")].map((cell) => cell.getBoundingClientRect());
    const cells = [...document.querySelectorAll(".category-table tbody tr:first-child td")].map((cell) => cell.getBoundingClientRect());
    const edit = document.querySelector(".category-action-cell .compact-action")?.getBoundingClientRect();
    const cardRect = card?.getBoundingClientRect();
    return {
      categoryWidth: Math.round(cells[0]?.width || 0),
      codeWidth: Math.round(cells[1]?.width || 0),
      actionWidth: Math.round(cells[8]?.width || 0),
      editWidth: Math.round(edit?.width || 0),
      editHeight: Math.round(edit?.height || 0),
      categoryRight: Math.round(cells[0]?.right || 0),
      codeLeft: Math.round(cells[1]?.left || 0),
      codeGap: Math.round((cells[1]?.left || 0) - (cells[0]?.right || 0)),
      editRight: Math.round(edit?.right || 0),
      actionRight: Math.round(cells[8]?.right || 0),
      tableRight: Math.round(table?.getBoundingClientRect().right || 0),
      cardRight: Math.round(cardRect?.right || 0),
      editContained: Boolean(edit && cells[8] && edit.right <= cells[8].right + 1 && edit.left >= cells[8].left - 1),
      headerAligned: headers.length === cells.length && headers.every((cell, index) => Math.abs(Math.round(cell.left) - Math.round(cells[index].left)) <= 2 && Math.abs(Math.round(cell.width) - Math.round(cells[index].width)) <= 2),
      pageOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > document.documentElement.clientWidth + 1,
      cardScrolls: Boolean(card && card.scrollWidth > card.clientWidth + 1),
      cardClientWidth: Math.round(card?.clientWidth || 0),
      cardScrollWidth: Math.round(card?.scrollWidth || 0),
    };
  })()`);
}

async function assertImageState(cdp, { count, primaryAlt }) {
  const state = await evaluate(cdp, `(() => {
    const slots = [...document.querySelectorAll(".catalog-editor-image-slot.has-image")];
    const primarySlots = slots.filter((slot) => slot.querySelector(".catalog-primary-badge"));
    return {
      count: slots.length,
      primaryCount: primarySlots.length,
      primaryAlt: primarySlots[0]?.querySelector("img")?.getAttribute("alt") || "",
    };
  })()`);
  assert.equal(state.count, count, "image count");
  assert.equal(state.primaryCount, 1, "exactly one PRIMARY label");
  assert.equal(state.primaryAlt, primaryAlt, "PRIMARY image identity");
}

async function assertPrimaryMarkerOnly(cdp) {
  const state = await evaluate(cdp, `(() => ({
    dragHandles: document.querySelectorAll(".catalog-drag-handle").length,
    badges: [...document.querySelectorAll(".catalog-primary-badge")].map((item) => item.textContent.trim()),
  }))()`);
  assert.equal(state.dragHandles, 0, "no redundant thumbnail corner check/drag icon");
  assert.deepEqual(state.badges, ["PRIMARY"], "primary marker is text-only");
}

async function assertOrder(cdp, expected) {
  const order = await evaluate(cdp, `[...document.querySelectorAll(".catalog-editor-image-slot.has-image img")].map((img) => img.getAttribute("alt"))`);
  assert.deepEqual(order, expected, "image order");
}

async function verifyCompactControls(cdp) {
  const state = await evaluate(cdp, `(() => {
    const visibleButtons = [...document.querySelectorAll(".catalog-editor-image-slot.has-image button")]
      .filter((button) => button.offsetParent !== null);
    const slots = [...document.querySelectorAll(".catalog-editor-image-slot.has-image")];
    const primarySlot = slots.find((slot) => slot.querySelector(".catalog-primary-badge"));
    const nonPrimarySlots = slots.filter((slot) => !slot.querySelector(".catalog-primary-badge"));
    return {
      moveLeft: visibleButtons.filter((button) => button.textContent.trim() === "Move Left").length,
      moveRight: visibleButtons.filter((button) => button.textContent.trim() === "Move Right").length,
      remove: visibleButtons.filter((button) => button.textContent.trim() === "Remove").length,
      setPrimary: visibleButtons.filter((button) => button.textContent.trim() === "Set Primary").length,
      primary: visibleButtons.filter((button) => button.textContent.trim() === "Primary").length,
      primarySetPrimary: primarySlot ? Boolean(primarySlot.querySelector("[data-catalog-set-primary-image]")) : true,
      nonPrimarySetPrimary: nonPrimarySlots.every((slot) => Boolean(slot.querySelector("[data-catalog-set-primary-image]"))),
      removeNeutral: visibleButtons
        .filter((button) => button.textContent.trim() === "Remove")
        .every((button) => getComputedStyle(button).color === getComputedStyle(visibleButtons.find((item) => item.textContent.trim() === "Primary") || button).color),
      compactRows: slots.every((slot) => {
        const row = slot.querySelector(".catalog-image-card-actions");
        if (!row) return false;
        const rect = row.getBoundingClientRect();
        const buttons = [...row.querySelectorAll("button")].filter((button) => button.offsetParent !== null);
        return buttons.length >= 1 && buttons.every((button) => {
          const buttonRect = button.getBoundingClientRect();
          return buttonRect.top >= rect.top - 1 && buttonRect.bottom <= rect.bottom + 1;
        });
      }),
    };
  })()`);
  assert.equal(state.moveLeft, 0, "visible Move Left button count");
  assert.equal(state.moveRight, 0, "visible Move Right button count");
  assert.equal(state.remove, 6, "Remove remains available on image cards");
  assert.equal(state.setPrimary, 0, "Set Primary visible count");
  assert.equal(state.primary, 5, "non-primary images show Primary action");
  assert.equal(state.primarySetPrimary, false, "current Primary has no Primary action");
  assert.equal(state.nonPrimarySetPrimary, true, "all non-primary images have Primary action");
  assert.equal(state.removeNeutral, true, "Remove uses neutral action color");
  assert.equal(state.compactRows, true, "image actions render as compact rows");
}

async function verifyPrimaryDeletionFallback(cdp) {
  await evaluate(cdp, `(() => {
    const primarySlot = [...document.querySelectorAll(".catalog-editor-image-slot.has-image")]
      .find((slot) => slot.querySelector(".catalog-primary-badge"));
    primarySlot?.querySelector("[data-catalog-remove-image]")?.click();
  })()`);
  await delay(150);
  await assertImageState(cdp, { count: 5, primaryAlt: "Image 1" });
  await verifyCompactControlsAfterPrimaryDelete(cdp);
}

async function verifyCompactControlsAfterPrimaryDelete(cdp) {
  const state = await evaluate(cdp, `(() => {
    const visibleButtons = [...document.querySelectorAll(".catalog-editor-image-slot.has-image button")]
      .filter((button) => button.offsetParent !== null);
    const primarySlot = [...document.querySelectorAll(".catalog-editor-image-slot.has-image")]
      .find((slot) => slot.querySelector(".catalog-primary-badge"));
    return {
      moveLeft: visibleButtons.filter((button) => button.textContent.trim() === "Move Left").length,
      moveRight: visibleButtons.filter((button) => button.textContent.trim() === "Move Right").length,
      remove: visibleButtons.filter((button) => button.textContent.trim() === "Remove").length,
      setPrimary: visibleButtons.filter((button) => button.textContent.trim() === "Set Primary").length,
      primary: visibleButtons.filter((button) => button.textContent.trim() === "Primary").length,
      primarySetPrimary: primarySlot ? Boolean(primarySlot.querySelector("[data-catalog-set-primary-image]")) : true,
    };
  })()`);
  assert.deepEqual(state, { moveLeft: 0, moveRight: 0, remove: 5, setPrimary: 0, primary: 4, primarySetPrimary: false }, "primary deletion keeps compact controls and fallback primary");
}

async function verifyMobileCompactImageLayout(cdp) {
  const state = await getImageGridState(cdp, { checkBottomClearance: true });
  assert.equal(state.columns, 2, "mobile image grid uses two columns");
  assert.equal(state.firstRowCount, 2, "mobile first row shows two image cards");
  assert.equal(state.visibleSlots >= 2, true, "mobile viewport shows multiple image cards");
  assert.equal(state.maxHeight <= 240, true, `mobile image cards stay compact: ${JSON.stringify(state)}`);
  assert.equal(state.gridFitsViewport, true, `mobile image grid fits viewport: ${JSON.stringify(state)}`);
  assert.equal(state.secondCardFitsViewport, true, `mobile second image card is visible: ${JSON.stringify(state)}`);
  assert.equal(state.actionsFitViewport, true, `mobile image actions fit viewport: ${JSON.stringify(state)}`);
  assert.equal(state.uploadReachable, true, "mobile upload/save area remains reachable");
  assert.equal(state.lastClearsFooter, true, "mobile final image clears fixed footer");
}

async function verifyResponsiveImageGrid(cdp, { label, columns, firstRowCount, allCardsVisible = false }) {
  const state = await getImageGridState(cdp);
  assert.equal(state.columns, columns, `${label} image grid columns: ${JSON.stringify(state)}`);
  assert.equal(state.firstRowCount, firstRowCount, `${label} first row image count: ${JSON.stringify(state)}`);
  assert.equal(state.gridFitsViewport, true, `${label} image grid fits viewport: ${JSON.stringify(state)}`);
  assert.equal(state.actionsFitViewport, true, `${label} image actions fit viewport: ${JSON.stringify(state)}`);
  if (allCardsVisible) {
    assert.equal(state.visibleSlots, 6, `${label} shows all six image cards: ${JSON.stringify(state)}`);
  }
}

async function captureDesktopLowerAndBottom(cdp) {
  await setViewport(cdp, { width: 1440, height: 900 });
  await waitFor(cdp, `document.body.innerText.includes("PRICING") && document.body.innerText.includes("PRODUCTION INFORMATION")`);
  await evaluate(cdp, `(() => {
    const heading = [...document.querySelectorAll("h2")].find((item) => item.textContent.trim().toUpperCase() === "PRICING");
    heading?.closest(".catalog-editor-card")?.scrollIntoView({ block: "start" });
    window.scrollBy(0, -16);
  })()`);
  await delay(250);
  await verifyLowerEditorLayout(cdp, "desktop lower");
  await capture(cdp, "05-desktop-product-editor-lower.png");
  await evaluate(cdp, `window.scrollTo(0, document.documentElement.scrollHeight)`);
  await delay(250);
  await verifyBottomEditorLayout(cdp, "desktop bottom");
  await capture(cdp, "06-desktop-product-editor-bottom.png");
}

async function captureMobileLowerAndBottom(cdp) {
  await waitFor(cdp, `document.body.innerText.includes("PRICING") && document.body.innerText.includes("SALES & AVAILABILITY")`);
  await evaluate(cdp, `(() => {
    const heading = [...document.querySelectorAll("h2")].find((item) => item.textContent.trim().toUpperCase() === "PRICING");
    heading?.closest(".catalog-editor-card")?.scrollIntoView({ block: "start" });
    window.scrollBy(0, -8);
  })()`);
  await delay(250);
  await verifyNoHorizontalOverflow(cdp, "mobile product editor lower");
  await capture(cdp, "07-mobile-product-editor-lower-390x844.png");
  await evaluate(cdp, `window.scrollTo(0, document.documentElement.scrollHeight)`);
  await delay(250);
  await verifyBottomEditorLayout(cdp, "mobile bottom");
  await capture(cdp, "08-mobile-product-editor-bottom-390x844.png");
}

async function verifyLowerEditorLayout(cdp, label) {
  const state = await evaluate(cdp, `(() => {
    const activeImageSection = [...document.querySelectorAll("#catalog-section-images")]
      .find((item) => item.offsetParent !== null && item.querySelector(".catalog-editor-image-grid"));
    const grid = activeImageSection.closest(".catalog-editor-grid");
    const main = activeImageSection.closest(".catalog-editor-main-column");
    const side = grid.querySelector(".catalog-editor-side-column");
    const cardByHeading = (root, text) => [...root.querySelectorAll(".catalog-editor-card")]
      .find((card) => card.offsetParent !== null && card.querySelector("h2")?.textContent.trim().toUpperCase() === text);
    const pricing = cardByHeading(main, "PRICING");
    const production = cardByHeading(main, "PRODUCTION INFORMATION");
    const variants = cardByHeading(grid, "VARIANTS");
    const sideCards = [...document.querySelectorAll(".catalog-editor-side-column .catalog-editor-card")]
      .filter((card) => card.offsetParent !== null);
    const pricingRect = pricing?.getBoundingClientRect();
    const productionRect = production?.getBoundingClientRect();
    const variantsRect = variants?.getBoundingClientRect();
    const sideLeft = Math.min(...sideCards.map((card) => card.getBoundingClientRect().left));
    return {
      pricingReadable: Boolean(pricingRect && pricingRect.width > 320 && pricingRect.bottom > 0),
      productionReadable: Boolean(productionRect && productionRect.width > 320),
      variantsReadable: Boolean(variantsRect && variantsRect.width > 320),
      sidebarContained: Boolean(pricingRect && Number.isFinite(sideLeft) && pricingRect.right <= sideLeft - 8),
      pricingRight: pricingRect?.right,
      pricingWidth: pricingRect?.width,
      sideLeft,
      gridWidth: grid?.getBoundingClientRect().width,
      gridColumns: grid ? getComputedStyle(grid).gridTemplateColumns : "",
      mainWidth: main?.getBoundingClientRect().width,
      sideWidth: side?.getBoundingClientRect().width,
      horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > document.documentElement.clientWidth + 1,
    };
  })()`);
  assert.equal(state.pricingReadable, true, `${label} pricing readable: ${JSON.stringify(state)}`);
  assert.equal(state.productionReadable, true, `${label} production readable: ${JSON.stringify(state)}`);
  assert.equal(state.variantsReadable, true, `${label} variants readable: ${JSON.stringify(state)}`);
  assert.equal(state.sidebarContained, true, `${label} sidebar contained: ${JSON.stringify(state)}`);
  assert.equal(state.horizontalOverflow, false, `${label} horizontal overflow: ${JSON.stringify(state)}`);
}

async function verifyBottomEditorLayout(cdp, label) {
  const state = await evaluate(cdp, `(() => {
    const footer = document.querySelector(".catalog-editor-footer");
    const nav = document.querySelector(".mobile-bottom-nav");
    const footerRect = footer?.getBoundingClientRect();
    const navRect = nav?.getBoundingClientRect();
    const cancelRect = footer?.querySelector("[data-catalog-editor-cancel]")?.getBoundingClientRect();
    const saveRect = footer?.querySelector(".catalog-save-button")?.getBoundingClientRect();
    const finalCard = [...document.querySelectorAll(".catalog-editor-card")]
      .filter((card) => card.offsetParent !== null)
      .at(-1);
    const finalRect = finalCard?.getBoundingClientRect();
    const navVisible = Boolean(navRect && navRect.width > 0 && navRect.height > 0 && getComputedStyle(nav).display !== "none");
    const footerVisible = Boolean(footerRect && footerRect.top >= 0 && footerRect.bottom <= window.innerHeight + 1);
    const cancelVisible = Boolean(cancelRect && cancelRect.width > 0 && cancelRect.height > 0 && cancelRect.top >= 0 && cancelRect.bottom <= window.innerHeight + 1);
    const saveVisible = Boolean(saveRect && saveRect.width > 0 && saveRect.height > 0 && saveRect.top >= 0 && saveRect.bottom <= window.innerHeight + 1);
    const footerAboveNav = !navVisible || Boolean(footerRect && footerRect.bottom <= navRect.top + 1);
    const finalClearsFooter = Boolean(finalRect && footerRect && finalRect.bottom <= footerRect.top + 1);
    return {
      footerVisible,
      cancelVisible,
      saveVisible,
      footerAboveNav,
      finalClearsFooter,
      horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > document.documentElement.clientWidth + 1,
    };
  })()`);
  assert.equal(state.footerVisible, true, `${label} footer visible`);
  assert.equal(state.cancelVisible, true, `${label} cancel visible`);
  assert.equal(state.saveVisible, true, `${label} save visible`);
  assert.equal(state.footerAboveNav, true, `${label} footer above mobile nav`);
  assert.equal(state.finalClearsFooter, true, `${label} final content clears footer`);
  assert.equal(state.horizontalOverflow, false, `${label} horizontal overflow`);
}

async function getImageGridState(cdp, { checkBottomClearance = false } = {}) {
  return evaluate(cdp, `(() => {
    const section = [...document.querySelectorAll("#catalog-section-images")]
      .find((item) => item.offsetParent !== null && item.querySelector(".catalog-editor-image-grid"));
    const grid = section.querySelector(".catalog-editor-image-grid");
    const page = section.closest(".catalog-product-editor-page");
    const editorGrid = section.closest(".catalog-editor-grid");
    const mainColumn = section.closest(".catalog-editor-main-column");
    const slots = [...document.querySelectorAll(".catalog-editor-image-slot.has-image")];
    const rects = slots.map((slot) => slot.getBoundingClientRect());
    const actionRects = [...document.querySelectorAll(".catalog-editor-image-slot.has-image button")].map((button) => button.getBoundingClientRect());
    const pageRect = page.getBoundingClientRect();
    const editorGridRect = editorGrid.getBoundingClientRect();
    const mainColumnRect = mainColumn.getBoundingClientRect();
    const sectionRect = section.getBoundingClientRect();
    const gridRect = grid.getBoundingClientRect();
    const firstRowTop = Math.round(rects[0]?.top || 0);
    const firstRowCount = rects.filter((rect) => Math.abs(Math.round(rect.top) - firstRowTop) <= 3).length;
    const visibleSlots = rects.filter((rect) => rect.bottom > 0 && rect.top < window.innerHeight).length;
    const maxHeight = Math.max(...rects.map((rect) => rect.height));
    const upload = document.querySelector("[data-catalog-image-file]")?.closest(".catalog-editor-upload");
    const footer = document.querySelector(".catalog-editor-footer");
    const nav = document.querySelector(".mobile-bottom-nav");
    let lastClearsFooter = true;
    if (${JSON.stringify(checkBottomClearance)}) {
      slots.at(-1)?.scrollIntoView({ block: "end" });
      window.scrollBy(0, (footer?.getBoundingClientRect().height || 0) + (nav?.getBoundingClientRect().height || 0) + 24);
      const lastRect = slots.at(-1)?.getBoundingClientRect();
      const footerRect = footer?.getBoundingClientRect();
      const navRect = nav?.getBoundingClientRect();
      const clearanceLine = Math.min(footerRect?.top ?? window.innerHeight, navRect?.top ?? window.innerHeight);
      lastClearsFooter = Boolean(lastRect && lastRect.bottom <= clearanceLine + 1);
    }
    return {
      columns: getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length,
      firstRowCount,
      visibleSlots,
      maxHeight,
      viewportWidth: window.innerWidth,
      pageLeft: pageRect.left,
      pageRight: pageRect.right,
      pageWidth: pageRect.width,
      pageComputedWidth: getComputedStyle(page).width,
      pageMaxWidth: getComputedStyle(page).maxWidth,
      editorGridWidth: editorGridRect.width,
      editorGridComputedWidth: getComputedStyle(editorGrid).width,
      editorGridTemplateColumns: getComputedStyle(editorGrid).gridTemplateColumns,
      mainColumnWidth: mainColumnRect.width,
      mainColumnComputedWidth: getComputedStyle(mainColumn).width,
      sectionLeft: sectionRect.left,
      sectionRight: sectionRect.right,
      sectionWidth: sectionRect.width,
      sectionComputedWidth: getComputedStyle(section).width,
      sectionMaxWidth: getComputedStyle(section).maxWidth,
      sectionBoxSizing: getComputedStyle(section).boxSizing,
      sectionOverflow: getComputedStyle(section).overflow,
      gridLeft: gridRect.left,
      gridRight: gridRect.right,
      gridComputedWidth: getComputedStyle(grid).width,
      gridMaxWidth: getComputedStyle(grid).maxWidth,
      widestActionRight: actionRects.reduce((max, rect) => Math.max(max, rect.right), 0),
      gridFitsViewport: gridRect.left >= -1 && gridRect.right <= window.innerWidth + 1,
      secondCardFitsViewport: Boolean(rects[1] && rects[1].right <= window.innerWidth + 1),
      actionsFitViewport: actionRects.every((rect) => rect.left >= -1 && rect.right <= window.innerWidth + 1),
      uploadReachable: Boolean(upload),
      lastClearsFooter,
    };
  })()`);
}

async function verifyNoHorizontalOverflow(cdp, label) {
  const result = await evaluate(cdp, `(() => ({
    viewport: document.documentElement.clientWidth,
    scroll: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
  }))()`);
  assert.equal(result.scroll <= result.viewport + 1, true, `${label} has horizontal overflow`);
}

async function capture(cdp, name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(join(screenshotDir, name), Buffer.from(data, "base64"));
}

async function captureReview(cdp, name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(join(filterReviewDir, name), Buffer.from(data, "base64"));
}

async function scrollImagesIntoView(cdp) {
  await evaluate(cdp, `document.querySelector("#catalog-section-images")?.scrollIntoView({ block: "start" })`);
  await delay(250);
}

async function navigate(cdp, route) {
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${port}${route}` });
  await waitFor(cdp, `["interactive", "complete"].includes(document.readyState)`);
  await delay(300);
}

async function setViewport(cdp, { width, height }) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
}

async function waitFor(cdp, expression, timeout = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await evaluate(cdp, `Boolean(${expression})`).catch(() => false);
    if (value) return;
    await delay(100);
  }
  const bodyText = await evaluate(cdp, `document.body?.innerText?.slice(0, 2200) || ""`).catch(() => "");
  throw new Error(`Timed out waiting for: ${expression}\nVisible text: ${bodyText}\nConsole: ${browserConsole.slice(-8).join(" | ")}`);
}

async function getNodeId(cdp, selector) {
  const { root } = await cdp.send("DOM.getDocument", {});
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
  assert.ok(nodeId, `Missing selector ${selector}`);
  return nodeId;
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Evaluation failed");
  return result.result.value;
}

async function waitForBrowser(portNumber) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const version = await fetchJson(`http://127.0.0.1:${portNumber}/json/version`);
      if (version.webSocketDebuggerUrl) return version.webSocketDebuggerUrl;
    } catch {
      await delay(100);
    }
  }
  throw new Error("Timed out waiting for Edge remote debugging");
}

async function newPage(portNumber) {
  const response = await fetch(`http://127.0.0.1:${portNumber}/json/new?about:blank`, { method: "PUT" });
  if (!response.ok) throw new Error("Unable to create browser page");
  return response.json();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetch failed ${response.status}`);
  return response.json();
}

async function createCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.consoleAPICalled") {
      browserConsole.push(message.params.args.map((arg) => arg.value || arg.description || "").join(" "));
    }
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result || {});
    }
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return {
    send(method, params = {}) {
      const messageId = ++id;
      const payload = { id: messageId, method, params };
      if (this.sessionId) payload.sessionId = this.sessionId;
      ws.send(JSON.stringify(payload));
      return new Promise((resolve, reject) => pending.set(messageId, { resolve, reject }));
    },
  };
}

function filterByEq(rows, url, field) {
  const value = getEq(url, field);
  return value ? rows.filter((row) => row[field] === value) : rows;
}

function getEq(url, field) {
  const value = url.searchParams.get(field);
  return value?.startsWith("eq.") ? value.slice(3) : "";
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function json(response, body, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function jsonJs(response, env) {
  response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
  response.end(`window.TRRY_ADMIN_ENV = ${JSON.stringify(env, null, 2)};\n`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createSolidPng(width, height, r, g, b) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const index = row + 1 + x * 4;
      raw[index] = r;
      raw[index + 1] = g;
      raw[index + 2] = b;
      raw[index + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", Buffer.concat([uint32(width), uint32(height), Buffer.from([8, 6, 0, 0, 0])])),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  return Buffer.concat([uint32(data.length), typeBuffer, data, uint32(crc32(Buffer.concat([typeBuffer, data])) >>> 0)]);
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
