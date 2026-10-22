// Turns arbitrary CSV headers into safe keys and guesses what each column is
// (title, author, category, location part…) without hard-coding a schema.

import { normalize } from "../utils/normalize.js";

export const ROLES = ["title", "author", "category", "availability"];

const ROLE_ALIASES = {
  title: ["title", "book_title", "name", "book_name", "book"],
  author: ["author", "authors", "writer", "by", "author_name", "first_author_full_name", "author_full_name", "first_author"],
  category: ["category", "subject", "genre", "section", "department", "class"],
  availability: ["available", "availability", "status", "in_stock"],
};

const LOCATION_ALIASES = new Set([
  "floor", "section", "room", "hall", "rack", "shelf", "shelf_no",
  "row", "bay", "location", "almirah", "cupboard", "position",
]);

// Columns that identify a record but are noise in search results.
const ID_KEYS = new Set(["id", "sr_no", "srno", "s_no", "serial", "serial_no", "entity_id"]);

// Internal fields: kept with the book but never shown or searched publicly.
const HIDDEN_KEYS = new Set(["location_is_placeholder"]);
export const isHiddenKey = (key) => HIDDEN_KEYS.has(key);

// Friendlier labels for known template columns.
export const LABEL_OVERRIDES = {
  first_author_full_name: "First author",
  second_author_full_name: "Second author",
  location_is_placeholder: "Placeholder location",
};

/** "  ISBN-13 " -> "isbn_13"; non-Latin letters are kept. */
export function toKey(header) {
  return normalize(header)
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

const ACRONYMS = new Set(["id", "isbn", "issn", "url", "ddc", "lcc", "no"]);

/**
 * Display label. Headers the librarian capitalised are kept as written
 * ("Shelf No."); all-lowercase or snake_case ones are tidied ("shelf_no" ->
 * "Shelf No").
 */
export function humanLabel(header) {
  const text = String(header ?? "").trim();
  if (!text || /\p{Lu}/u.test(text)) return text;
  return text
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w) ? (w === "no" ? "No" : w.toUpperCase()) : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Keys and labels for a header row: blanks become column_N, duplicates get _2, _3… */
export function headerKeys(headerRow) {
  const used = new Set();
  return headerRow.map((raw, i) => {
    const label = humanLabel(raw) || `Column ${i + 1}`;
    const base = toKey(label) || `column_${i + 1}`;
    let key = base;
    for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
    used.add(key);
    return { key, label };
  });
}

const BOOLEAN_VALUES = new Set(["yes", "no", "true", "false", "1", "0", "y", "n"]);
const NUMBER = /^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/;
const DATE = /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})([ T]\d{1,2}:\d{2}(:\d{2})?)?$/;

/** Detect a column type from up to 200 non-empty sample values. */
export function detectType(values) {
  const sample = [];
  for (const v of values) {
    const text = String(v ?? "").trim();
    if (text) sample.push(text);
    if (sample.length >= 200) break;
  }
  if (!sample.length) return "text";
  if (sample.every((v) => BOOLEAN_VALUES.has(v.toLowerCase()))) return "boolean";
  if (sample.every((v) => NUMBER.test(v))) return "number";
  if (sample.every((v) => DATE.test(v))) return "date";
  return "text";
}

/** Which role a key would take, by alias priority (lower = stronger). */
export function roleCandidates(key) {
  const out = [];
  for (const [role, aliases] of Object.entries(ROLE_ALIASES)) {
    const rank = aliases.indexOf(key);
    if (rank !== -1) out.push({ role, rank });
  }
  return out;
}

export function isLocationKey(key) {
  return LOCATION_ALIASES.has(key);
}

export function isIdKey(key) {
  return ID_KEYS.has(key);
}

/**
 * Pick role holders among `fields` (in order) for roles nobody holds yet.
 * Returns a map key -> role.
 */
export function assignRoles(fields, takenRoles) {
  const assigned = {};
  for (const role of ROLES) {
    if (takenRoles.has(role)) continue;
    let best = null;
    for (const field of fields) {
      if (assigned[field.key]) continue;
      const match = roleCandidates(field.key).find((c) => c.role === role);
      if (match && (!best || match.rank < best.rank)) best = { key: field.key, rank: match.rank };
    }
    if (best) assigned[best.key] = role;
  }
  return assigned;
}

/** Plain-language boolean reading for display and availability badges. */
export function truthy(value) {
  return ["yes", "true", "1", "y", "available"].includes(String(value ?? "").trim().toLowerCase());
}
