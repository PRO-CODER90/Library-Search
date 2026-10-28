import { test } from "node:test";
import assert from "node:assert/strict";
import { detectDelimiter, parseRows, readCsv } from "../src/services/csvImport.js";
import { detectType, headerKeys, toKey } from "../src/services/columnMapper.js";
import { sanitizeCell, csvCell } from "../src/utils/sanitize.js";
import { parseMultipart } from "../src/utils/multipart.js";
import { mixedScripts } from "../src/services/library.js";
import { compactVariant, highlightSegments, normalize } from "../../shared/search.js";

test("header normalization (spec 5.3)", () => {
  assert.deepEqual(headerKeys(["Book Title", "  ISBN-13 ", "Shelf No.", "", "Author", "Author"]), [
    { key: "book_title", label: "Book Title" },
    { key: "isbn_13", label: "ISBN-13" },
    { key: "shelf_no", label: "Shelf No." },
    { key: "column_4", label: "Column 4" },
    { key: "author", label: "Author" },
    { key: "author_2", label: "Author" },
  ]);
  assert.equal(toKey("शीर्षक"), "शीर्षक");
  assert.equal(headerKeys(["shelf_no"])[0].label, "Shelf No");
});

test("type detection (spec 5.4)", () => {
  assert.equal(detectType(["yes", "no", "YES"]), "boolean");
  assert.equal(detectType(["1936", "2006", "1,200", "3.5"]), "number");
  assert.equal(detectType(["2024-01-05", "05/01/2024"]), "date");
  assert.equal(detectType(["R-07", "R-08"]), "text");
  assert.equal(detectType(["", ""]), "text");
});

test("delimiter detection", () => {
  assert.equal(detectDelimiter("a;b;c\n1;2;3"), ";");
  assert.equal(detectDelimiter("a\tb\n1\t2"), "\t");
  assert.equal(detectDelimiter("a|b\n1|2"), "|");
  assert.equal(detectDelimiter('"x,y";b\n"1,2";3'), ";", "commas inside quotes don't count");
});

test("parser: quotes, embedded newlines, escaped quotes, blank lines", () => {
  assert.deepEqual(parseRows('a,b\r\n"line1\nline2","say ""hi"""\r\n\r\n3,4', ","), [
    ["a", "b"],
    ["line1\nline2", 'say "hi"'],
    ["3", "4"],
  ]);
  assert.throws(() => parseRows('a\n"open', ","), /Unclosed quote starting on line 2/);
});

test("readCsv limits columns", () => {
  const header = Array.from({ length: 101 }, (_, i) => `c${i}`).join(",");
  assert.throws(() => readCsv(Buffer.from(`${header}\n1`)), /Too many columns/);
});

test("CSV injection guard", () => {
  assert.equal(sanitizeCell("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(sanitizeCell("@cmd"), "'@cmd");
  assert.equal(sanitizeCell("-5"), "-5");
  assert.equal(sanitizeCell("+91 98"), "'+91 98");
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
});

test("multipart parser", () => {
  const body = Buffer.from(
    "--XX\r\nContent-Disposition: form-data; name=\"mode\"\r\n\r\nappend\r\n" +
      "--XX\r\nContent-Disposition: form-data; name=\"file\"; filename=\"b.csv\"\r\nContent-Type: text/csv\r\n\r\ntitle\r\nA\r\n" +
      "--XX--\r\n"
  );
  const { fields, files } = parseMultipart(body, "multipart/form-data; boundary=XX");
  assert.equal(fields.mode, "append");
  assert.equal(files.file.filename, "b.csv");
  assert.equal(files.file.buffer.toString(), "title\r\nA");
});

test("shared text helpers", () => {
  assert.equal(normalize("Café"), "cafe");
  assert.equal(compactVariant("r-07 shelf 005.1"), "r07 0051");
  assert.equal(compactVariant("philosopher's stone"), "philosophers");
  assert.deepEqual(highlightSegments("Café Society", "cafe").filter((s) => s.match).map((s) => s.text), ["Café"]);
});

test("mixedScripts flags a stray character from another script", () => {
  assert.equal(mixedScripts("The白 Silk Road"), true);
  assert.equal(mixedScripts("The Silk Road"), false);
  assert.equal(mixedScripts("Café: Ünïcode — 2nd ed."), false);
  assert.equal(mixedScripts("道德经"), false);
});
