// The field registry: which columns exist, how they're labelled, and whether
// they're searchable, shown on cards, or part of the location.

import { LABEL_OVERRIDES, assignRoles, detectType, humanLabel, isHiddenKey, isIdKey, isLocationKey, ROLES } from "./columnMapper.js";
import { compactVariant, normalize } from "../utils/normalize.js";

const FIELD_COLUMNS = "key, label, type, searchable, show_in_card, is_location, role, sort_order, active";

function toField(row) {
  return {
    key: row.key,
    label: row.label,
    type: row.type,
    searchable: Boolean(row.searchable),
    show_in_card: Boolean(row.show_in_card),
    is_location: Boolean(row.is_location),
    role: row.role ?? null,
    sort_order: row.sort_order,
    active: Boolean(row.active),
    hidden: isHiddenKey(row.key),
  };
}

export function listFields(db, { includeInactive = false } = {}) {
  const where = includeInactive ? "" : "WHERE active = 1";
  return db
    .prepare(`SELECT ${FIELD_COLUMNS} FROM fields ${where} ORDER BY sort_order, key`)
    .all()
    .map(toField);
}

export function getField(db, key) {
  const row = db.prepare(`SELECT ${FIELD_COLUMNS} FROM fields WHERE key = ?`).get(key);
  return row ? toField(row) : null;
}

/** Role -> key lookup for active fields. */
export function roleMap(fields) {
  const map = {};
  for (const f of fields) if (f.role && f.active) map[f.role] = f.key;
  return map;
}

function insertField(db, field) {
  db.prepare(
    `INSERT INTO fields (${FIELD_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    field.key,
    field.label,
    field.type,
    field.searchable ? 1 : 0,
    field.show_in_card ? 1 : 0,
    field.is_location ? 1 : 0,
    field.role ?? null,
    field.sort_order,
    1
  );
}

function newFieldDefaults(key, label, type, sortOrder) {
  const quiet = isIdKey(key) || isHiddenKey(key);
  return {
    key,
    label: LABEL_OVERRIDES[key] ?? label,
    type,
    searchable: !quiet && (type === "text" || type === "number"),
    show_in_card: !quiet,
    is_location: !isHiddenKey(key) && isLocationKey(key),
    role: null,
    sort_order: sortOrder,
  };
}

/**
 * Make sure every role that can be filled is filled, and that a title exists.
 * Returns warnings for the caller.
 */
function settleRoles(db, preferredOrder = []) {
  const warnings = [];
  const active = listFields(db);
  const taken = new Set(active.filter((f) => f.role).map((f) => f.role));
  const free = active.filter((f) => !f.role);
  for (const [key, role] of Object.entries(assignRoles(free, taken))) {
    db.prepare("UPDATE fields SET role = ? WHERE key = ?").run(role, key);
    taken.add(role);
  }
  if (!taken.has("title")) {
    // Prefer the uploaded file's own column order, and non-location columns.
    const rank = (f) => {
      const i = preferredOrder.indexOf(f.key);
      return (i === -1 ? 1000 + f.sort_order : i) + (f.is_location ? 10000 : 0);
    };
    const fallback = listFields(db)
      .filter((f) => !f.role && f.type === "text" && !isIdKey(f.key))
      .sort((a, b) => rank(a) - rank(b))[0];
    if (fallback) {
      db.prepare("UPDATE fields SET role = 'title' WHERE key = ?").run(fallback.key);
      warnings.push(`No title column found; using “${fallback.label}” as the title. Change it under Fields if that's wrong.`);
    } else {
      warnings.push("No title column found and no text column to use instead. Results will show without titles.");
    }
  }
  return warnings;
}

/**
 * Apply a CSV header to the registry (Section 5.2 of the spec).
 * Returns { added, removed, kept, notInFile, warnings }.
 */
export function syncColumns(db, columns, records, mode) {
  const existing = new Map(listFields(db, { includeInactive: true }).map((f) => [f.key, f]));
  const activeBefore = new Set([...existing.values()].filter((f) => f.active).map((f) => f.key));
  const incoming = new Set(columns.map((c) => c.key));
  let nextOrder = Math.max(-1, ...[...existing.values()].map((f) => f.sort_order)) + 1;

  const added = [];
  const kept = [];
  for (const { key, label } of columns) {
    if (activeBefore.has(key)) {
      kept.push(key);
      continue;
    }
    added.push(key);
    if (existing.has(key)) {
      // A column that was removed earlier is back: keep the admin's old settings.
      db.prepare("UPDATE fields SET active = 1 WHERE key = ?").run(key);
    } else {
      const type = detectType(records.map((r) => r[key]));
      insertField(db, newFieldDefaults(key, label, type, nextOrder++));
    }
  }

  const missing = [...activeBefore].filter((key) => !incoming.has(key));
  let removed = [];
  if (mode === "replace") {
    removed = missing;
    for (const key of removed) db.prepare("UPDATE fields SET active = 0, role = NULL WHERE key = ?").run(key);
  }

  const warnings = settleRoles(db, columns.map((c) => c.key));
  return { added, removed, kept, notInFile: mode === "replace" ? [] : missing, warnings };
}

/** Register keys that appear in a single edited/added record. Returns new keys. */
export function registerRecordKeys(db, record) {
  const existing = new Map(listFields(db, { includeInactive: true }).map((f) => [f.key, f]));
  let nextOrder = Math.max(-1, ...[...existing.values()].map((f) => f.sort_order)) + 1;
  const added = [];
  for (const [key, value] of Object.entries(record)) {
    const field = existing.get(key);
    if (field?.active) continue;
    if (field) db.prepare("UPDATE fields SET active = 1 WHERE key = ?").run(key);
    else insertField(db, newFieldDefaults(key, labelFromKey(key), detectType([value]), nextOrder++));
    added.push(key);
  }
  if (added.length) settleRoles(db);
  return added;
}

export function labelFromKey(key) {
  return humanLabel(key) || key;
}

/** Update admin-editable settings. Returns { field, reindex }. */
export function updateField(db, key, patch) {
  const field = getField(db, key);
  if (!field) return null;
  const sets = [];
  const values = [];
  let reindex = false;

  if (patch.label !== undefined) {
    sets.push("label = ?");
    values.push(String(patch.label).trim().slice(0, 80) || field.label);
  }
  for (const flag of ["searchable", "show_in_card", "is_location"]) {
    if (patch[flag] !== undefined) {
      sets.push(`${flag} = ?`);
      values.push(patch[flag] ? 1 : 0);
      if (flag === "searchable" && Boolean(patch[flag]) !== field.searchable) reindex = true;
    }
  }
  if (patch.sort_order !== undefined) {
    sets.push("sort_order = ?");
    values.push(Number.parseInt(patch.sort_order, 10) || 0);
    reindex = true; // search_text order follows sort_order
  }
  if (patch.role !== undefined) {
    const role = patch.role || null;
    if (role !== field.role) {
      // One field per role: take it away from whoever had it.
      if (role) db.prepare("UPDATE fields SET role = NULL WHERE role = ?").run(role);
      sets.push("role = ?");
      values.push(role);
      if (role === "title" || field.role === "title") reindex = true;
    }
  }
  if (sets.length) db.prepare(`UPDATE fields SET ${sets.join(", ")} WHERE key = ?`).run(...values, key);
  return { field: getField(db, key), reindex };
}

export function validRole(role) {
  return role === null || role === "" || ROLES.includes(role);
}

// ---------------------------------------------------------------- row index

/** Normalized search text + title text for one record. */
export function indexRecord(data, fields) {
  const parts = [];
  const compacts = [];
  for (const f of fields) {
    if (!f.active || !f.searchable) continue;
    const value = normalize(data[f.key] ?? "").trim();
    if (!value) continue;
    parts.push(value);
    const compact = compactVariant(value);
    if (compact) compacts.push(compact);
  }
  const titleKey = fields.find((f) => f.active && f.role === "title")?.key;
  return {
    search_text: parts.join(" | ") + (compacts.length ? ` || ${compacts.join(" ")}` : ""),
    title_text: titleKey ? normalize(data[titleKey] ?? "").trim() : "",
  };
}

/** Recompute search_text/title_text for every row (after field changes). */
export function rebuildIndex(db) {
  const fields = listFields(db);
  const update = db.prepare("UPDATE books SET search_text = ?, title_text = ? WHERE row_id = ?");
  for (const row of db.prepare("SELECT row_id, data FROM books").iterate()) {
    const { search_text, title_text } = indexRecord(JSON.parse(row.data), fields);
    update.run(search_text, title_text, row.row_id);
  }
}

/** "Floor 1 · Rack R-02 · Shelf A" plus the parts, in registry order. */
export function locationOf(data, fields) {
  const parts = fields
    .filter((f) => f.active && f.is_location && String(data[f.key] ?? "").trim())
    .map((f) => ({ key: f.key, label: f.label, value: String(data[f.key]).trim() }));
  return { location: parts.map((p) => `${p.label} ${p.value}`).join(" · "), locationParts: parts };
}
