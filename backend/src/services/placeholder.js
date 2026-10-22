// Placeholder Floor / Rack / Shelf for books whose location cells are blank.
// Deterministic: seeded by the title, so re-uploading the same file gives the
// same locations. Marked with a hidden flag the admin sees as "Placeholder".

import { createHash } from "node:crypto";
import { normalize } from "../utils/normalize.js";

export const PLACEHOLDER_KEY = "location_is_placeholder";

const GENERATORS = {
  floor: (n) => String(1 + (n % 4)),
  rack: (n) => `R-${String(1 + (n % 20)).padStart(2, "0")}`,
  shelf: (n) => "ABCDEF"[n % 6],
};
export const LOCATION_KEYS = Object.keys(GENERATORS);

function seeds(title) {
  const digest = createHash("sha256").update(normalize(title).trim()).digest();
  return { floor: digest.readUInt32BE(0), rack: digest.readUInt32BE(4), shelf: digest.readUInt32BE(8) };
}

/**
 * Fill blank floor/rack/shelf (only those columns present in `keys`) in place.
 * Never overwrites a value. Returns the keys that were filled.
 */
export function fillPlaceholders(record, titleKey, keys) {
  const blank = keys.filter((k) => GENERATORS[k] && !String(record[k] ?? "").trim());
  if (!blank.length) return [];
  const s = seeds(record[titleKey] ?? JSON.stringify(record));
  for (const k of blank) record[k] = GENERATORS[k](s[k]);
  record[PLACEHOLDER_KEY] = "true";
  return blank;
}
