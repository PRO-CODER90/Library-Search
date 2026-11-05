// Write operations: CSV / Excel dataset import (replace / append / upsert) and
// single-record add / edit / delete. Every write runs in one transaction.

import { transaction } from "../db.js";
import { CsvError, readCsv, tabulate } from "./csvImport.js";
import { PREFERRED_SHEET, isXlsx, readXlsx } from "./xlsxImport.js";
import { LOCATION_KEYS, PLACEHOLDER_KEY, fillPlaceholders } from "./placeholder.js";
import { normalize } from "../utils/normalize.js";
import { toKey } from "./columnMapper.js";
import { indexRecord, listFields, rebuildIndex, registerRecordKeys, syncColumns } from "./fieldRegistry.js";
import { sanitizeCell } from "../utils/sanitize.js";
import { createHash } from "node:crypto";
import { dupKey, sameCopy } from "./duplicates.js";

export const MODES = ["replace", "append", "upsert"];
/** What to do with rows that match a book already in the catalogue (or earlier in the file). */
export const ON_DUPLICATE = ["smart", "skip", "all"];

function insertRows(db, records, datasetId) {
  const fields = listFields(db);
  const insert = db.prepare("INSERT INTO books (data, search_text, title_text, dataset_id) VALUES (?, ?, ?, ?)");
  for (const record of records) {
    const { search_text, title_text } = indexRecord(record, fields);
    insert.run(JSON.stringify(record), search_text, title_text, datasetId);
  }
}

/** Parse an uploaded .xlsx or .csv into the common table shape. */
export function readTable(buffer, filename = "") {
  if (isXlsx(buffer) || /\.xlsx$/i.test(filename)) {
    const book = readXlsx(buffer);
    const table = tabulate(book.rows, { requireTitle: true, dropBlankColumns: true, raggedWarnings: false });
    if (!book.preferred) {
      table.warnings.unshift(`No “${PREFERRED_SHEET}” sheet; read the sheet “${book.sheetName}” instead.`);
    }
    return { ...table, format: "xlsx", sheet: book.sheetName, delimiter: null, encoding: "utf-8" };
  }
  return { ...readCsv(buffer), format: "csv", sheet: null };
}

const PREVIEW_ROWS = 20;

/** Key used to match a row in upsert mode: entity_id when present, else title + author. */
function matchKey(data, keyField, titleKey, authorKey) {
  if (keyField) return String(data[keyField] ?? "").trim().toLowerCase();
  const id = String(data.entity_id ?? "").trim();
  if (id) return `id:${id.toLowerCase()}`;
  const title = normalize(data[titleKey] ?? "").trim();
  if (!title) return "";
  return `ta:${title}\u0001${normalize(data[authorKey] ?? "").trim()}`;
}

/** Copy non-blank values over `base`; blank cells never erase existing data. */
function mergeNonBlank(base, record) {
  const merged = { ...base };
  for (const [k, v] of Object.entries(record)) if (String(v ?? "").trim() !== "") merged[k] = v;
  return merged;
}

/**
 * Import an .xlsx or .csv buffer. With dryRun the whole import runs and is
 * rolled back, so the report (field diff, counts, preview, warnings) is exactly
 * what a real upload would do.
 *
 * Upsert matches on `keyField` if given, else entity_id, else Title + first
 * author. Blank Floor/Rack/Shelf cells get deterministic placeholder values.
 */
export function importTable(db, { buffer, filename = "upload.csv", mode = "replace", keyField = "", dryRun = false, onDuplicate = "smart", uploadedBy = "" }) {
  if (!MODES.includes(mode)) throw new CsvError(`Unknown mode “${mode}”. Use replace, append or upsert.`);
  if (!ON_DUPLICATE.includes(onDuplicate)) throw new CsvError(`Unknown duplicate option “${onDuplicate}”. Use smart, skip or all.`);
  // The same file uploaded before? (SHA-256 of the bytes.)
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const previous = db.prepare("SELECT filename, created_at FROM uploads WHERE sha256 = ? ORDER BY id DESC LIMIT 1").get(sha256);
  const parsed = readTable(buffer, filename);
  const key = keyField ? toKey(keyField) : "";
  // Headers that match an existing field's label map to that field (so an
  // exported file, with display labels as headers, re-imports cleanly).
  const known = listFields(db, { includeInactive: true });
  const byKey = new Set(known.map((f) => f.key));
  const byLabel = new Map(known.map((f) => [f.label.trim().toLowerCase(), f.key]));
  const taken = new Set(parsed.columns.map((c) => c.key));
  for (const column of parsed.columns) {
    const target = byLabel.get(column.label.trim().toLowerCase());
    if (!byKey.has(column.key) && target && !taken.has(target)) {
      for (const r of parsed.records) {
        r[target] = r[column.key];
        delete r[column.key];
      }
      taken.delete(column.key);
      taken.add(target);
      column.key = target;
    }
  }
  if (key && mode === "upsert" && !parsed.columns.some((c) => c.key === key)) {
    throw new CsvError(`keyField “${keyField}” is not a column in this file.`);
  }
  const locationKeys = LOCATION_KEYS.filter((k) => parsed.columns.some((c) => c.key === k));
  if (locationKeys.length && !parsed.columns.some((c) => c.key === PLACEHOLDER_KEY)) {
    parsed.columns.push({ key: PLACEHOLDER_KEY, label: "Temporary location" });
  }

  return transaction(
    db,
    () => {
      const diff = syncColumns(db, parsed.columns, parsed.records, mode);
      const fieldsNow = listFields(db, { includeInactive: true });
      const titleKey = fieldsNow.find((f) => f.active && f.role === "title")?.key;
      const authorKey = fieldsNow.find((f) => f.active && f.role === "author")?.key;
      const datasetId = Number(
        db.prepare("INSERT INTO datasets (filename, mode, row_count) VALUES (?, ?, ?)").run(filename, mode, parsed.records.length)
          .lastInsertRowid
      );

      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      let placeholders = 0;
      const dupCounts = { new: 0, exact: 0, differentPlace: 0 };
      const warnings = [...parsed.warnings, ...diff.warnings];
      const preview = [];
      const note = (record, filled) => {
        if (filled.length) placeholders++;
        if (preview.length < PREVIEW_ROWS) preview.push({ data: record, placeholder: filled });
      };
      const withPlaceholders = (record) => {
        if (!locationKeys.length) return record;
        const filled = fillPlaceholders(record, titleKey, locationKeys);
        if (!filled.length && record[PLACEHOLDER_KEY] !== "true") record[PLACEHOLDER_KEY] = "";
        note(record, filled);
        return record;
      };

      // Validation warnings (never block the upload).
      if (titleKey) {
        const missing = parsed.records.filter((r) => !String(r[titleKey] ?? "").trim()).length;
        if (missing) warnings.push(`${missing} row${missing === 1 ? " has" : "s have"} no title (mandatory).`);
      }
      if (titleKey) {
        // A Latin title with a stray character from another script (e.g. "The白 Silk Road").
        const odd = parsed.records.filter((r) => mixedScripts(String(r[titleKey] ?? ""))).length;
        if (odd) warnings.push(`${odd} title${odd === 1 ? " contains" : "s contain"} unexpected characters (mixed scripts).`);
      }
      if (authorKey) {
        const missing = parsed.records.filter((r) => !String(r[authorKey] ?? "").trim()).length;
        if (missing) warnings.push(`${missing} row${missing === 1 ? " has" : "s have"} no first author (mandatory).`);
      }
      if (titleKey) {
        const seen = new Set();
        let dupes = 0;
        for (const r of parsed.records) {
          const k = `${normalize(r[titleKey] ?? "").trim()}\u0001${normalize(authorKey ? r[authorKey] ?? "" : "").trim()}`;
          if (seen.has(k)) dupes++;
          seen.add(k);
        }
        if (dupes) warnings.push(`${dupes} row${dupes === 1 ? " repeats" : "s repeat"} the title and author of an earlier row.`);
      }

      if (mode === "replace") db.exec("DELETE FROM books");

      if (mode === "upsert") {
        const existing = new Map();
        for (const row of db.prepare("SELECT row_id, data FROM books").iterate()) {
          const k = matchKey(JSON.parse(row.data), key, titleKey, authorKey);
          if (k && !existing.has(k)) existing.set(k, row.row_id);
        }
        const fields = listFields(db);
        const read = db.prepare("SELECT data FROM books WHERE row_id = ?");
        const update = db.prepare("UPDATE books SET data = ?, search_text = ?, title_text = ?, dataset_id = ?, updated_at = CURRENT_TIMESTAMP WHERE row_id = ?");
        const fresh = [];
        for (const record of parsed.records) {
          const value = matchKey(record, key, titleKey, authorKey);
          if (!value) {
            skipped++;
            continue;
          }
          const rowId = existing.get(value);
          if (rowId === undefined) {
            fresh.push(withPlaceholders(record));
            existing.set(value, -1); // duplicate keys inside the file: first wins
          } else if (rowId === -1) {
            skipped++;
          } else {
            const merged = withPlaceholders(mergeNonBlank(JSON.parse(read.get(rowId).data), record));
            const { search_text, title_text } = indexRecord(merged, fields);
            update.run(JSON.stringify(merged), search_text, title_text, datasetId, rowId);
            updated++;
          }
        }
        insertRows(db, fresh, datasetId);
        inserted = fresh.length;
        if (skipped) warnings.push(`${skipped} row${skipped === 1 ? " was" : "s were"} skipped (no key, or repeated in the file).`);
      } else {
        // Duplicates: inside the file always; against the catalogue in append mode.
        const roles = { titleKey, authorKey };
        const known = new Map(); // key -> [{ rowId | null, data }]
        if (mode === "append" && onDuplicate !== "all") {
          for (const row of db.prepare("SELECT row_id, data FROM books").iterate()) {
            const k = dupKey(JSON.parse(row.data), roles);
            if (!k) continue;
            if (!known.has(k)) known.set(k, []);
            known.get(k).push({ rowId: row.row_id, data: JSON.parse(row.data) });
          }
        }
        const fields = listFields(db);
        const fill = db.prepare("UPDATE books SET data = ?, search_text = ?, title_text = ?, updated_at = CURRENT_TIMESTAMP WHERE row_id = ?");
        const accepted = [];
        for (const record of parsed.records) {
          const k = onDuplicate === "all" ? "" : dupKey(record, roles);
          const matches = k ? known.get(k) ?? [] : [];
          if (!matches.length) {
            dupCounts.new++;
            const row = withPlaceholders(record);
            accepted.push(row);
            if (k) known.set(k, [{ rowId: null, data: row }]);
            continue;
          }
          const same = matches.find((m) => sameCopy(record, m.data));
          if (same) {
            dupCounts.exact++;
            skipped++;
            if (onDuplicate === "smart") {
              // Fill only blank fields of the existing book; never overwrite a value.
              let changed = false;
              for (const [field, value] of Object.entries(record)) {
                if (field === PLACEHOLDER_KEY || LOCATION_KEYS.includes(field)) continue;
                if (String(same.data[field] ?? "").trim() === "" && String(value ?? "").trim() !== "") {
                  same.data[field] = value;
                  changed = true;
                }
              }
              if (changed && same.rowId) {
                const { search_text, title_text } = indexRecord(same.data, fields);
                fill.run(JSON.stringify(same.data), search_text, title_text, same.rowId);
                updated++;
              }
            }
            continue;
          }
          dupCounts.differentPlace++;
          if (onDuplicate === "skip") {
            skipped++;
            continue;
          }
          const row = withPlaceholders(record); // same book on another shelf: another copy
          accepted.push(row);
          matches.push({ rowId: null, data: row });
        }
        insertRows(db, accepted, datasetId);
        inserted = accepted.length;
        if (dupCounts.exact) warnings.push(`${dupCounts.exact} row${dupCounts.exact === 1 ? " is" : "s are"} already in the catalogue (same book, same place) and ${onDuplicate === "smart" ? "were skipped; only blank details were filled in" : "were skipped"}.`);
      }
      if (previous) {
        warnings.unshift(`This exact file was already uploaded on ${istTime(previous.created_at)}.`);
      }
      if (!dryRun) {
        db.prepare("INSERT INTO uploads (filename, sha256, mode, counts, uploaded_by) VALUES (?, ?, ?, ?, ?)").run(
          filename,
          sha256,
          mode,
          JSON.stringify({ inserted, updated, skipped, ...dupCounts }),
          uploadedBy
        );
      }

      // Rows inserted above were indexed with the new field set. Older rows kept
      // by append/upsert need re-indexing only if the field set changed.
      if (mode !== "replace" && (diff.added.length || diff.removed.length)) rebuildIndex(db);

      const fields = listFields(db).filter((f) => !f.hidden);
      return {
        datasetId: dryRun ? null : datasetId,
        dryRun,
        mode,
        rowsRead: parsed.records.length,
        rowsImported: inserted + updated,
        rowsInserted: inserted,
        rowsUpdated: updated,
        rowsSkipped: skipped,
        placeholdersFilled: placeholders,
        onDuplicate,
        duplicates: dupCounts,
        alreadyUploaded: previous ? { filename: previous.filename, at: previous.created_at } : null,
        fields: { added: diff.added, removed: diff.removed, kept: diff.kept, notInFile: diff.notInFile },
        detected: {
          format: parsed.format,
          sheet: parsed.sheet,
          headerRow: parsed.headerRow,
          dataRow: parsed.dataRow,
          delimiter: parsed.delimiter === "\t" ? "\\t" : parsed.delimiter,
          encoding: parsed.encoding,
          titleField: titleKey ?? null,
          matchKey: mode === "upsert" ? key || "entity_id, else title + first author" : null,
        },
        preview: {
          fields,
          rows: (preview.length ? preview : parsed.records.slice(0, PREVIEW_ROWS).map((d) => ({ data: d, placeholder: [] }))),
        },
        warnings,
      };
    },
    { rollback: dryRun }
  );
}

/** "05 Nov 2026, 4:12 pm" in India time. */
function istTime(iso) {
  const d = new Date(String(iso).includes("T") ? iso : `${String(iso).replace(" ", "T")}Z`);
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Latin letters mixed with letters from another script in one title. */
export function mixedScripts(text) {
  return /\p{Script=Latin}/u.test(text) && /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}\s]/u.test(text);
}

/** Backwards-compatible name. */
export const importCsv = importTable;

// ---------------------------------------------------------------- records

export class RecordError extends Error {}

const MAX_KEYS = 100;
const MAX_VALUE = 2000;

/** Clean an incoming {key: value} object from the admin UI or API. */
export function cleanRecord(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new RecordError("Send the book as a JSON object.");
  const source = input.data && typeof input.data === "object" ? input.data : input;
  const record = {};
  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = toKey(rawKey);
    if (!key) continue;
    if (rawValue !== null && typeof rawValue === "object") throw new RecordError(`“${rawKey}” must be text.`);
    const value = sanitizeCell(String(rawValue ?? "").trim());
    if (value.length > MAX_VALUE) throw new RecordError(`“${rawKey}” is longer than ${MAX_VALUE} characters.`);
    record[key] = value;
  }
  if (Object.keys(record).length > MAX_KEYS) throw new RecordError(`A book can have at most ${MAX_KEYS} fields.`);
  if (!Object.values(record).some(Boolean)) throw new RecordError("The book has no values.");
  return record;
}

function requireTitle(db, record) {
  const titleKey = listFields(db).find((f) => f.role === "title")?.key;
  if (titleKey && !record[titleKey]) throw new RecordError(`The title field (“${titleKey}”) can't be empty.`);
}

export function addRecord(db, input) {
  const record = cleanRecord(input);
  return transaction(db, () => {
    const newKeys = registerRecordKeys(db, record);
    requireTitle(db, record);
    const datasetId = Number(
      db.prepare("INSERT INTO datasets (filename, mode, row_count) VALUES ('(manual entry)', 'append', 1)").run().lastInsertRowid
    );
    const { search_text, title_text } = indexRecord(record, listFields(db));
    const rowId = Number(
      db.prepare("INSERT INTO books (data, search_text, title_text, dataset_id) VALUES (?, ?, ?, ?)")
        .run(JSON.stringify(record), search_text, title_text, datasetId).lastInsertRowid
    );
    if (newKeys.length) rebuildIndex(db);
    return { rowId, newFields: newKeys };
  });
}

/** Replace a record's data. Keys left out are removed from that record. */
export function updateRecord(db, rowId, input) {
  const record = cleanRecord(input);
  return transaction(db, () => {
    const current = db.prepare("SELECT data FROM books WHERE row_id = ?").get(rowId);
    if (!current) return null;
    // The placeholder flag isn't in the edit form: keep it unless the admin
    // changed a location field, which makes the location real.
    const before = JSON.parse(current.data);
    if (!(PLACEHOLDER_KEY in record) && before[PLACEHOLDER_KEY] === "true") {
      const moved = LOCATION_KEYS.some((k) => k in record && String(record[k] ?? "") !== String(before[k] ?? ""));
      record[PLACEHOLDER_KEY] = moved ? "" : "true";
    }
    const newKeys = registerRecordKeys(db, record);
    requireTitle(db, record);
    const { search_text, title_text } = indexRecord(record, listFields(db));
    db.prepare("UPDATE books SET data = ?, search_text = ?, title_text = ?, updated_at = CURRENT_TIMESTAMP WHERE row_id = ?").run(
      JSON.stringify(record),
      search_text,
      title_text,
      rowId
    );
    if (newKeys.length) rebuildIndex(db);
    return { rowId, newFields: newKeys };
  });
}

/** Set location fields on many books at once; their placeholder flag clears. */
export function setLocations(db, ids, values) {
  const fields = listFields(db);
  const locationKeys = new Set(fields.filter((f) => f.is_location).map((f) => f.key));
  const patch = {};
  for (const [k, v] of Object.entries(values ?? {})) {
    const key = toKey(k);
    const value = sanitizeCell(String(v ?? "").trim());
    if (locationKeys.has(key) && value) patch[key] = value;
  }
  if (!Object.keys(patch).length) throw new RecordError("Give at least one location value (e.g. floor, rack, shelf).");
  const clean = [...new Set((ids ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 5000);
  if (!clean.length) throw new RecordError("Select at least one book.");
  return transaction(db, () => {
    const read = db.prepare("SELECT data FROM books WHERE row_id = ?");
    const write = db.prepare("UPDATE books SET data = ?, search_text = ?, title_text = ?, updated_at = CURRENT_TIMESTAMP WHERE row_id = ?");
    let updated = 0;
    for (const id of clean) {
      const row = read.get(id);
      if (!row) continue;
      const data = { ...JSON.parse(row.data), ...patch };
      if (PLACEHOLDER_KEY in data) data[PLACEHOLDER_KEY] = "";
      const { search_text, title_text } = indexRecord(data, fields);
      write.run(JSON.stringify(data), search_text, title_text, id);
      updated++;
    }
    return updated;
  });
}

export function deleteRecord(db, rowId) {
  return db.prepare("DELETE FROM books WHERE row_id = ?").run(rowId).changes > 0;
}

export function wipeLibrary(db) {
  return Number(db.prepare("DELETE FROM books").run().changes);
}

/** Current data as rows (header = field labels), for CSV or XLSX export. */
export function exportRows(db) {
  const fields = listFields(db);
  const rows = [fields.map((f) => f.label)];
  for (const row of db.prepare("SELECT data FROM books ORDER BY title_text, row_id").iterate()) {
    const data = JSON.parse(row.data);
    rows.push(fields.map((f) => sanitizeCell(data[f.key] ?? "")));
  }
  return rows;
}

/** Blank template: one header row with the current field labels. */
export function templateRows(db) {
  return [listFields(db).filter((f) => !f.hidden).map((f) => f.label)];
}

/** Current data as CSV with the active fields as columns. */
export function* exportCsv(db, csvCell) {
  const fields = listFields(db);
  yield fields.map((f) => csvCell(f.label)).join(",") + "\r\n";
  for (const row of db.prepare("SELECT data FROM books ORDER BY title_text, row_id").iterate()) {
    const data = JSON.parse(row.data);
    yield fields.map((f) => csvCell(data[f.key] ?? "")).join(",") + "\r\n";
  }
}
