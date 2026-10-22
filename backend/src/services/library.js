// Write operations: CSV dataset import (replace / append / upsert) and
// single-record add / edit / delete. Every write runs in one transaction.

import { jsonPath, transaction } from "../db.js";
import { CsvError, readCsv } from "./csvImport.js";
import { toKey } from "./columnMapper.js";
import { indexRecord, listFields, rebuildIndex, registerRecordKeys, syncColumns } from "./fieldRegistry.js";
import { sanitizeCell } from "../utils/sanitize.js";

export const MODES = ["replace", "append", "upsert"];

function insertRows(db, records, datasetId) {
  const fields = listFields(db);
  const insert = db.prepare("INSERT INTO books (data, search_text, title_text, dataset_id) VALUES (?, ?, ?, ?)");
  for (const record of records) {
    const { search_text, title_text } = indexRecord(record, fields);
    insert.run(JSON.stringify(record), search_text, title_text, datasetId);
  }
}

/**
 * Import a CSV buffer. With dryRun the whole import runs and is rolled back,
 * so the report (field diff, counts, warnings) is exactly what a real upload
 * would do.
 */
export function importCsv(db, { buffer, filename = "upload.csv", mode = "replace", keyField = "", dryRun = false }) {
  if (!MODES.includes(mode)) throw new CsvError(`Unknown mode “${mode}”. Use replace, append or upsert.`);
  const parsed = readCsv(buffer);
  const key = keyField ? toKey(keyField) : "";
  if (mode === "upsert") {
    if (!key) throw new CsvError("Upsert needs keyField: the column that identifies a book (e.g. id or isbn).");
    if (!parsed.columns.some((c) => c.key === key)) {
      throw new CsvError(`keyField “${keyField}” is not a column in this file.`);
    }
  }

  return transaction(
    db,
    () => {
      const diff = syncColumns(db, parsed.columns, parsed.records, mode);
      const datasetId = Number(
        db.prepare("INSERT INTO datasets (filename, mode, row_count) VALUES (?, ?, ?)").run(filename, mode, parsed.records.length)
          .lastInsertRowid
      );

      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      const warnings = [...parsed.warnings, ...diff.warnings];

      if (mode === "replace") db.exec("DELETE FROM books");

      if (mode === "upsert") {
        const existing = new Map();
        for (const row of db.prepare("SELECT row_id, json_extract(data, ?) AS k FROM books").iterate(jsonPath(key))) {
          if (row.k !== null && row.k !== "") existing.set(String(row.k).trim().toLowerCase(), row.row_id);
        }
        const fields = listFields(db);
        const read = db.prepare("SELECT data FROM books WHERE row_id = ?");
        const update = db.prepare("UPDATE books SET data = ?, search_text = ?, title_text = ?, dataset_id = ? WHERE row_id = ?");
        const fresh = [];
        for (const record of parsed.records) {
          const value = String(record[key] ?? "").trim().toLowerCase();
          if (!value) {
            skipped++;
            continue;
          }
          const rowId = existing.get(value);
          if (rowId === undefined) {
            fresh.push(record);
            existing.set(value, -1); // duplicate keys inside the file: first wins
          } else if (rowId === -1) {
            skipped++;
          } else {
            const merged = { ...JSON.parse(read.get(rowId).data), ...record };
            const { search_text, title_text } = indexRecord(merged, fields);
            update.run(JSON.stringify(merged), search_text, title_text, datasetId, rowId);
            updated++;
          }
        }
        insertRows(db, fresh, datasetId);
        inserted = fresh.length;
        if (skipped) warnings.push(`${skipped} row${skipped === 1 ? " was" : "s were"} skipped (empty or repeated ${key}).`);
      } else {
        insertRows(db, parsed.records, datasetId);
        inserted = parsed.records.length;
      }

      // Rows inserted above were indexed with the new field set. Older rows kept
      // by append/upsert need re-indexing only if the field set changed.
      if (mode !== "replace" && (diff.added.length || diff.removed.length)) rebuildIndex(db);

      return {
        datasetId: dryRun ? null : datasetId,
        dryRun,
        mode,
        rowsRead: parsed.records.length,
        rowsImported: inserted + updated,
        rowsInserted: inserted,
        rowsUpdated: updated,
        rowsSkipped: skipped,
        fields: { added: diff.added, removed: diff.removed, kept: diff.kept, notInFile: diff.notInFile },
        detected: {
          delimiter: parsed.delimiter === "\t" ? "\\t" : parsed.delimiter,
          encoding: parsed.encoding,
          titleField: listFields(db).find((f) => f.role === "title")?.key ?? null,
        },
        warnings,
      };
    },
    { rollback: dryRun }
  );
}

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
    if (!db.prepare("SELECT 1 FROM books WHERE row_id = ?").get(rowId)) return null;
    const newKeys = registerRecordKeys(db, record);
    requireTitle(db, record);
    const { search_text, title_text } = indexRecord(record, listFields(db));
    db.prepare("UPDATE books SET data = ?, search_text = ?, title_text = ? WHERE row_id = ?").run(
      JSON.stringify(record),
      search_text,
      title_text,
      rowId
    );
    if (newKeys.length) rebuildIndex(db);
    return { rowId, newFields: newKeys };
  });
}

export function deleteRecord(db, rowId) {
  return db.prepare("DELETE FROM books WHERE row_id = ?").run(rowId).changes > 0;
}

export function wipeLibrary(db) {
  return Number(db.prepare("DELETE FROM books").run().changes);
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
