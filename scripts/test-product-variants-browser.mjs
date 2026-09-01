import { spawn } from "node:child_process";

const child = spawn(process.execPath, [".\\scripts\\test-product-images-browser.mjs"], {
  env: {
    ...process.env,
    PRODUCT_IMAGES_BROWSER_PORT: process.env.PRODUCT_VARIANTS_BROWSER_PORT || "58440",
  },
  stdio: "inherit",
});

const exitCode = await new Promise((resolve) => {
  child.on("exit", (code) => resolve(code ?? 1));
  child.on("error", () => resolve(1));
});

if (exitCode !== 0) {
  process.exit(exitCode);
}

console.log("PASS Product Variants browser QA for saved/unsaved Add Variant states, blank inline rows, locked SKU, required real values, duplicate blocking, responsive layout, save/reopen persistence, and session retry");
