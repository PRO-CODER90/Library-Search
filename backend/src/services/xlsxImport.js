// .xlsx reading (cell values, never formulas) and writing, on our own zip
// reader. Only the chosen sheet is parsed; other sheets (e.g. a 24,000-row
// Glossary) are never inflated.

import { readZip, writeZip } from "../utils/zip.js";
import { CsvError } from "./csvImport.js";

export const PREFERRED_SHEET = "Holding_Creation";

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function unescapeXml(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e] ?? m;
  });
}

const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** Text of a <si> or <is> node: plain <t> or rich-text runs. Phonetic hints are skipped. */
function richText(xml) {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of clean.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1];
  return unescapeXml(out);
}

function columnIndex(ref) {
  let n = 0;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

function resolvePath(target) {
  const clean = target.replace(/^\/+/, "");
  return clean.startsWith("xl/") ? clean : `xl/${clean}`;
}

/**
 * Read one sheet as rows of strings. Returns { sheetName, sheetNames, preferred, rows }
 * where preferred tells whether the Holding_Creation sheet was found.
 */
export function readXlsx(buffer) {
  let zip;
  try {
    zip = readZip(buffer);
  } catch (error) {
    throw new CsvError(error.message);
  }
  const workbook = zip.read("xl/workbook.xml")?.toString("utf8");
  if (!workbook) throw new CsvError("This .xlsx file has no workbook.");
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*\/?>/g)].map((m) => ({
    name: unescapeXml(attr(m[0], "name") ?? ""),
    rid: attr(m[0], "r:id"),
    hidden: /state="(hidden|veryHidden)"/.test(m[0]),
  }));
  if (!sheets.length) throw new CsvError("This .xlsx file has no sheets.");
  const rels = zip.read("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const targets = Object.fromEntries(
    [...rels.matchAll(/<Relationship\b[^>]*\/?>/g)].map((m) => [attr(m[0], "Id"), attr(m[0], "Target")])
  );

  const preferredSheet = sheets.find((s) => s.name.toLowerCase() === PREFERRED_SHEET.toLowerCase());
  const sheet = preferredSheet ?? sheets.find((s) => !s.hidden) ?? sheets[0];
  const path = targets[sheet.rid] ? resolvePath(targets[sheet.rid]) : "xl/worksheets/sheet1.xml";
  const xml = zip.read(path)?.toString("utf8");
  if (!xml) throw new CsvError(`Sheet “${sheet.name}” could not be read.`);

  let shared = null;
  const sharedStrings = () => {
    if (shared) return shared;
    const ss = zip.read("xl/sharedStrings.xml")?.toString("utf8") ?? "";
    shared = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => richText(m[1]));
    return shared;
  };

  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(attr(rowMatch[1], "r")) || rows.length + 1;
    const cells = [];
    for (const c of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(c[1], "r") ?? "";
      const type = attr(c[1], "t") ?? "n";
      const inner = c[2] ?? "";
      let value = "";
      if (type === "inlineStr") value = richText(/<is>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? "");
      else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        if (v !== undefined) {
          if (type === "s") value = sharedStrings()[Number(v)] ?? "";
          else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
          else value = unescapeXml(v);
        }
      }
      const index = ref ? columnIndex(ref) : cells.length;
      cells[index] = value.trim();
    }
    rows[rowNumber - 1] = Array.from(cells, (v) => v ?? "");
  }
  return {
    sheetName: sheet.name,
    sheetNames: sheets.map((s) => s.name),
    preferred: Boolean(preferredSheet),
    rows: Array.from(rows, (r) => r ?? []),
  };
}

export const isXlsx = (buffer) => buffer.length > 4 && buffer.readUInt32LE(0) === 0x04034b50;

function cellRef(col, row) {
  let s = "";
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return `${s}${row}`;
}
const escapeXml = (v) =>
  String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/** Single-sheet workbook; first row bold. Values are written as text. */
export function writeXlsx(sheetName, rows) {
  const sheetRows = rows
    .map(
      (cells, r) =>
        `<row r="${r + 1}">${cells
          .map((v, c) => `<c r="${cellRef(c, r + 1)}" t="inlineStr"${r === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${escapeXml(v ?? "")}</t></is></c>`)
          .join("")}</row>`
    )
    .join("");
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  return writeZip([
    {
      name: "[Content_Types].xml",
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${ns} xmlns:r="${rel}"><sheets><sheet name="${escapeXml(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: "xl/styles.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet ${ns}><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${ns}><sheetData>${sheetRows}</sheetData></worksheet>`,
    },
  ]);
}
