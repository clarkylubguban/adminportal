import assert from "node:assert/strict";
import {
  estimateDtfDirectCost,
  evaluateRequestedPrice,
  getDtfApprovedPrice,
  getEmbroideryApprovedPrice,
  getScreenPrintApprovedPrice,
} from "../src/priceEngineV1.js";

assert.equal(getDtfApprovedPrice(1).pricePerPiece, 250);
assert.equal(getDtfApprovedPrice(6).pricePerPiece, 220);
assert.equal(getDtfApprovedPrice(12).pricePerPiece, 190);
assert.equal(getDtfApprovedPrice(23).pricePerPiece, 170);
assert.equal(getDtfApprovedPrice(30).pricePerPiece, 150);

const dtf30 = estimateDtfDirectCost({ quantity: 30, metersUsed: 6, garmentCostPerPiece: 200 });
assert.equal(dtf30.materialBeforeWaste, 750);
assert.equal(dtf30.waste, 75);
assert.equal(dtf30.laborMinutes, 150);
assert.equal(dtf30.labor, 187.5);
assert.equal(dtf30.directCost, 7012.5);
assert.equal(dtf30.directCostPerPiece, 233.75);

assert.equal(getEmbroideryApprovedPrice({ quantity: 30, stitchCount: 15000 }).pricePerPiece, 150);
assert.equal(getEmbroideryApprovedPrice({ quantity: 30, stitchCount: 25000 }).pricePerPiece, 250);
assert.equal(getEmbroideryApprovedPrice({ quantity: 30, stitchCount: 35000 }).pricePerPiece, 350);
assert.equal(getEmbroideryApprovedPrice({ quantity: 10, stitchCount: 36000 }).mode, "CUSTOM");
assert.equal(getEmbroideryApprovedPrice({ quantity: 5, stitchCount: 15000, digitizing: "simple" }).digitizingFee, 350);

assert.equal(getScreenPrintApprovedPrice({ quantity: 30 }).pricePerPiece, 150);
assert.equal(getScreenPrintApprovedPrice({ quantity: 29 }).mode, "CUSTOM");
assert.equal(getScreenPrintApprovedPrice({ quantity: 30, colors: 2 }).mode, "CUSTOM");
assert.equal(getScreenPrintApprovedPrice({ quantity: 30, placements: 2 }).mode, "CUSTOM");

assert.equal(evaluateRequestedPrice({ approvedPricePerPiece: 170, requestedPricePerPiece: 160, protectedFloorPerPiece: 150 }).approvalRequired, false);
assert.equal(evaluateRequestedPrice({ approvedPricePerPiece: 170, requestedPricePerPiece: 140, protectedFloorPerPiece: 150 }).approvalRequired, true);

console.log("PRICE_ENGINE_V1_CORE_OK");
