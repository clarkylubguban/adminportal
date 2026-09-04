export const PRICE_ENGINE_V1 = Object.freeze({
  version: "2026-09-04-v1",
  dtf: Object.freeze({
    materialPerMeter: 125,
    wasteRate: 0.10,
    laborPerMinute: 1.25,
    setupMinutesPerJob: 60,
    cuttingMinutesPerPiece: 1,
    heatPressMinutesPerPiece: 2,
    protectedFloorPerPiece: 150,
    tiers: Object.freeze([
      { min: 1, max: 5, pricePerPiece: 250 },
      { min: 6, max: 11, pricePerPiece: 220 },
      { min: 12, max: 22, pricePerPiece: 190 },
      { min: 23, max: 29, pricePerPiece: 170 },
      { min: 30, max: null, pricePerPiece: 150 },
    ]),
  }),
  embroidery: Object.freeze({
    status: "PROVISIONAL",
    stitchBands: Object.freeze([
      {
        minStitches: 0,
        maxStitches: 15000,
        tiers: Object.freeze([
          { min: 1, max: 5, pricePerPiece: 250 },
          { min: 6, max: 11, pricePerPiece: 220 },
          { min: 12, max: 29, pricePerPiece: 200 },
          { min: 30, max: null, pricePerPiece: 150 },
        ]),
      },
      {
        minStitches: 15001,
        maxStitches: 25000,
        tiers: Object.freeze([
          { min: 1, max: 5, pricePerPiece: 350 },
          { min: 6, max: 11, pricePerPiece: 320 },
          { min: 12, max: 29, pricePerPiece: 300 },
          { min: 30, max: null, pricePerPiece: 250 },
        ]),
      },
      {
        minStitches: 25001,
        maxStitches: 35000,
        tiers: Object.freeze([
          { min: 1, max: 5, pricePerPiece: 450 },
          { min: 6, max: 11, pricePerPiece: 420 },
          { min: 12, max: 29, pricePerPiece: 400 },
          { min: 30, max: null, pricePerPiece: 350 },
        ]),
      },
    ]),
    customAboveStitches: 35000,
    digitizing: Object.freeze({ simple: 350, complex: 500 }),
  }),
  screenPrint: Object.freeze({
    status: "PARTIALLY_VERIFIED",
    standardMinimumQuantity: 30,
    standardOneColorPricePerPiece: 150,
    protectedFloorPerPiece: 150,
  }),
});

function assertPositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
  return parsed;
}

function findTier(tiers, quantity) {
  return tiers.find((tier) => quantity >= tier.min && (tier.max == null || quantity <= tier.max)) || null;
}

export function getDtfApprovedPrice(quantity) {
  const qty = assertPositiveInteger(quantity, "quantity");
  const tier = findTier(PRICE_ENGINE_V1.dtf.tiers, qty);
  return {
    method: "DTF",
    quantity: qty,
    pricePerPiece: tier.pricePerPiece,
    subtotal: tier.pricePerPiece * qty,
    protectedFloorPerPiece: PRICE_ENGINE_V1.dtf.protectedFloorPerPiece,
    approvalRequired: false,
    version: PRICE_ENGINE_V1.version,
  };
}

export function estimateDtfDirectCost({ quantity, metersUsed, garmentCostPerPiece = 0 }) {
  const qty = assertPositiveInteger(quantity, "quantity");
  const meters = Number(metersUsed);
  const garment = Number(garmentCostPerPiece || 0);
  if (!Number.isFinite(meters) || meters <= 0) throw new RangeError("metersUsed must be greater than 0.");
  if (!Number.isFinite(garment) || garment < 0) throw new RangeError("garmentCostPerPiece cannot be negative.");

  const materialBeforeWaste = meters * PRICE_ENGINE_V1.dtf.materialPerMeter;
  const waste = materialBeforeWaste * PRICE_ENGINE_V1.dtf.wasteRate;
  const laborMinutes = PRICE_ENGINE_V1.dtf.setupMinutesPerJob
    + qty * PRICE_ENGINE_V1.dtf.cuttingMinutesPerPiece
    + qty * PRICE_ENGINE_V1.dtf.heatPressMinutesPerPiece;
  const labor = laborMinutes * PRICE_ENGINE_V1.dtf.laborPerMinute;
  const garmentCost = garment * qty;
  const directCost = materialBeforeWaste + waste + labor + garmentCost;

  return {
    quantity: qty,
    metersUsed: meters,
    garmentCost,
    materialBeforeWaste,
    waste,
    laborMinutes,
    labor,
    directCost,
    directCostPerPiece: directCost / qty,
    confidence: "LOCKED",
    version: PRICE_ENGINE_V1.version,
  };
}

export function getEmbroideryApprovedPrice({ quantity, stitchCount, digitizing = "none" }) {
  const qty = assertPositiveInteger(quantity, "quantity");
  const stitches = assertPositiveInteger(stitchCount, "stitchCount");

  if (stitches > PRICE_ENGINE_V1.embroidery.customAboveStitches) {
    return {
      method: "EMBROIDERY",
      quantity: qty,
      stitchCount: stitches,
      mode: "CUSTOM",
      reason: "Above 35,000 stitches requires manual Owner/Admin review.",
      confidence: PRICE_ENGINE_V1.embroidery.status,
      version: PRICE_ENGINE_V1.version,
    };
  }

  const band = PRICE_ENGINE_V1.embroidery.stitchBands.find(
    (item) => stitches >= item.minStitches && stitches <= item.maxStitches,
  );
  const tier = findTier(band.tiers, qty);
  const digitizingFee = digitizing === "simple"
    ? PRICE_ENGINE_V1.embroidery.digitizing.simple
    : digitizing === "complex"
      ? PRICE_ENGINE_V1.embroidery.digitizing.complex
      : 0;

  return {
    method: "EMBROIDERY",
    quantity: qty,
    stitchCount: stitches,
    pricePerPiece: tier.pricePerPiece,
    digitizingFee,
    subtotal: tier.pricePerPiece * qty + digitizingFee,
    confidence: PRICE_ENGINE_V1.embroidery.status,
    version: PRICE_ENGINE_V1.version,
  };
}

export function getScreenPrintApprovedPrice({ quantity, colors = 1, placements = 1, specialGarment = false }) {
  const qty = assertPositiveInteger(quantity, "quantity");
  const colorCount = assertPositiveInteger(colors, "colors");
  const placementCount = assertPositiveInteger(placements, "placements");

  const standard = qty >= PRICE_ENGINE_V1.screenPrint.standardMinimumQuantity
    && colorCount === 1
    && placementCount === 1
    && !specialGarment;

  if (!standard) {
    return {
      method: "SCREEN_PRINT",
      quantity: qty,
      mode: "CUSTOM",
      reason: "Only standard 30+ pcs, 1-color, 1-placement jobs are auto-priced in V1.",
      confidence: PRICE_ENGINE_V1.screenPrint.status,
      version: PRICE_ENGINE_V1.version,
    };
  }

  const pricePerPiece = PRICE_ENGINE_V1.screenPrint.standardOneColorPricePerPiece;
  return {
    method: "SCREEN_PRINT",
    quantity: qty,
    pricePerPiece,
    subtotal: pricePerPiece * qty,
    protectedFloorPerPiece: PRICE_ENGINE_V1.screenPrint.protectedFloorPerPiece,
    confidence: PRICE_ENGINE_V1.screenPrint.status,
    version: PRICE_ENGINE_V1.version,
  };
}

export function evaluateRequestedPrice({ approvedPricePerPiece, requestedPricePerPiece, protectedFloorPerPiece }) {
  const approved = Number(approvedPricePerPiece);
  const requested = Number(requestedPricePerPiece);
  const floor = Number(protectedFloorPerPiece);
  if (![approved, requested, floor].every(Number.isFinite)) throw new TypeError("Pricing values must be numeric.");
  return {
    approvedPricePerPiece: approved,
    requestedPricePerPiece: requested,
    protectedFloorPerPiece: floor,
    isOverride: requested !== approved,
    approvalRequired: requested < floor,
  };
}
