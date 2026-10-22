// CSV import pipeline: decode -> detect delimiter -> parse -> clean headers ->
// tidy rows -> sanitize cells. Produces plain objects keyed by field key.

import { headerKeys } from "./columnMapper.js";
import { sanitizeCell } from "../utils/sanitize.js";

export class CsvError extends Error {}

export const LIMITS = { maxColumns: 100, maxRows: 200000 };

/** UTF-8 (BOM stripped); falls back to Windows-1252 for Excel "ANSI" files. */
export function decode(buffer) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return { text: text.replace(/^﻿/, ""), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(buffer), encoding: "windows-1252" };
  }
}

/** Pick , ; tab or | by counting occurrences (outside quotes) in the first lines. */
export function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 5).join("\n").replace(/"[^"]*"/g, "");
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = 0;
  for (const d of candidates) {
    const count = sample.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/**
 * RFC 4180 parser: quoted fields with embedded delimiters/newlines and ""
 * escapes. A quote inside an unquoted field is kept literally. Blank lines are
 * skipped. An unterminated quote is a hard error (the file is corrupt).
 */
export function parseRows(text, delimiter) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let quoteLine = 0;
  let line = 1;

  const endRow = () => {
    row.push(field);
    if (row.length > 1 || row[0].trim() !== "") rows.push(row);
    row = [];
    field = "";
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
    } else if (ch === '"' && field.trim() === "") {
      quoted = true;
      quoteLine = line;
      field = "";
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      line++;
      endRow();
    } else {
      field += ch;
    }
  }
  if (quoted) throw new CsvError(`Unclosed quote starting on line ${quoteLine}. Check the file for a stray " character.`);
  if (field !== "" || row.length) endRow();
  return rows;
}

/** Full pipeline. Returns { columns: [{key,label}], records, delimiter, encoding, warnings }. */
export function readCsv(buffer) {
  const { text, encoding } = decode(buffer);
  const delimiter = detectDelimiter(text);
  const rows = parseRows(text, delimiter);
  if (!rows.length) throw new CsvError("The file is empty.");

  const [headerRow, ...dataRows] = rows;
  if (headerRow.length > LIMITS.maxColumns) {
    throw new CsvError(`Too many columns (${headerRow.length}); the limit is ${LIMITS.maxColumns}.`);
  }
  if (dataRows.length > LIMITS.maxRows) {
    throw new CsvError(`Too many rows (${dataRows.length}); the limit is ${LIMITS.maxRows}.`);
  }
  const columns = headerKeys(headerRow);
  const warnings = [];
  let padded = 0;
  let trimmed = 0;
  let empty = 0;

  const records = [];
  for (const cells of dataRows) {
    if (cells.length < columns.length) padded++;
    else if (cells.length > columns.length && cells.slice(columns.length).some((c) => c.trim())) trimmed++;
    const record = {};
    let hasValue = false;
    columns.forEach(({ key }, i) => {
      const value = sanitizeCell((cells[i] ?? "").trim());
      record[key] = value;
      if (value) hasValue = true;
    });
    if (hasValue) records.push(record);
    else empty++;
  }

  if (padded) warnings.push(`${padded} row${padded === 1 ? " had" : "s had"} fewer columns than the header and ${padded === 1 ? "was" : "were"} padded.`);
  if (trimmed) warnings.push(`${trimmed} row${trimmed === 1 ? " had" : "s had"} extra cells beyond the header; they were dropped.`);
  if (empty) warnings.push(`${empty} empty row${empty === 1 ? " was" : "s were"} skipped.`);
  if (!records.length) throw new CsvError("The file has a header row but no data rows.");

  return { columns, records, delimiter, encoding, warnings };
}
