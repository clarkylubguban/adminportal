const LEFT_PATTERNS = {
  0: "0001101",
  1: "0011001",
  2: "0010011",
  3: "0111101",
  4: "0100011",
  5: "0110001",
  6: "0101111",
  7: "0111011",
  8: "0110111",
  9: "0001011",
};

const RIGHT_PATTERNS = {
  0: "1110010",
  1: "1100110",
  2: "1101100",
  3: "1000010",
  4: "1011100",
  5: "1001110",
  6: "1010000",
  7: "1000100",
  8: "1001000",
  9: "1110100",
};

export const EAN8_RAW_MODULES = 67;
export const EAN8_QUIET_ZONE_MODULES = 7;
export const EAN8_RENDERED_MODULES = EAN8_RAW_MODULES + EAN8_QUIET_ZONE_MODULES * 2;

export function calculateEan8CheckDigit(payload) {
  const text = String(payload ?? "");
  if (!/^\d{7}$/.test(text)) throw new Error("EAN-8 payload must contain exactly 7 digits.");
  const sum = text
    .split("")
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return String((10 - (sum % 10)) % 10);
}

export function isValidEan8(value) {
  const text = String(value ?? "");
  return /^\d{8}$/.test(text) && calculateEan8CheckDigit(text.slice(0, 7)) === text.at(-1);
}

export function makeInternalRcn8(sequence) {
  const reference = Number(sequence);
  if (!Number.isInteger(reference) || reference < 0 || reference > 999999) {
    throw new Error("Internal RCN-8 reference must be an integer from 0 to 999999.");
  }
  const payload = `2${String(reference).padStart(6, "0")}`;
  return `${payload}${calculateEan8CheckDigit(payload)}`;
}

export function getEan8Pattern(value) {
  const text = String(value ?? "");
  if (!isValidEan8(text)) throw new Error("EAN-8 value must be 8 digits with a valid checksum.");
  const left = text.slice(0, 4).split("").map((digit) => LEFT_PATTERNS[digit]).join("");
  const right = text.slice(4).split("").map((digit) => RIGHT_PATTERNS[digit]).join("");
  return `101${left}01010${right}101`;
}

export function renderEan8Svg(value, { width = 81, height = 41, showText = true } = {}) {
  const text = String(value ?? "");
  const pattern = getEan8Pattern(text);
  const textReserve = showText ? 8 : 0;
  const barHeight = height - textReserve;
  let bars = "";

  pattern.split("").forEach((module, index) => {
    if (module === "1") {
      bars += `<rect x="${index + EAN8_QUIET_ZONE_MODULES}" y="0" width="1" height="${barHeight}" />`;
    }
  });

  return `<svg class="ean8-svg" viewBox="0 0 ${EAN8_RENDERED_MODULES} ${height}" width="${width}" height="${height}" role="img" aria-label="EAN-8 ${escapeSvg(text)}" xmlns="http://www.w3.org/2000/svg"><g fill="#111111" shape-rendering="crispEdges">${bars}</g>${showText ? `<text x="${EAN8_RENDERED_MODULES / 2}" y="${height - 1.5}" text-anchor="middle" font-family="Arial, sans-serif" font-size="6" letter-spacing="0">${escapeSvg(text)}</text>` : ""}</svg>`;
}

function escapeSvg(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
