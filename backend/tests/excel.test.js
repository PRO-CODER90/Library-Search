// EXCEL_DRIVEN_BACKEND_AND_ADMIN_UPLOAD.md §5: .xlsx import, header detection,
// placeholder locations, aliases, hidden flag, exports.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TOKEN, startApp } from "./helpers.js";
import { readXlsx, writeXlsx } from "../src/services/xlsxImport.js";
import { tabulate } from "../src/services/csvImport.js";
import { fillPlaceholders } from "../src/services/placeholder.js";
import { headerKeys, roleCandidates } from "../src/services/columnMapper.js";

const TEMPLATE = readFileSync(new URL("./fixtures/Catalog_and_Holding_Creation_Template_1.xlsx", import.meta.url));
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const upload = (app, buf, opts = {}) => app.upload(buf, { filename: "catalogue.xlsx", type: XLSX, ...opts });
const all = async (app, query = "") => {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await app.call(`/api/books?limit=100&page=${page}${query}`, { token: TOKEN });
    out.push(...r.data.results);
    if (out.length >= r.data.total) return out;
  }
};

describe("xlsx reader and header detection", () => {
  test("reads only Holding_Creation; header at row 3; data from row 8", () => {
    const book = readXlsx(TEMPLATE);
    assert.equal(book.sheetName, "Holding_Creation");
    assert.ok(book.sheetNames.includes("Glossary"));
    const t = tabulate(book.rows, { requireTitle: true, dropBlankColumns: true, raggedWarnings: false });
    assert.equal(t.headerRow, 3);
    assert.equal(t.dataRow, 8);
    assert.equal(t.records.length, 85);
    assert.deepEqual(
      t.columns.map((c) => c.key),
      ["title", "first_author_full_name", "second_author_full_name", "floor", "rack", "shelf", "entity_id"]
    );
    assert.equal(t.records[0].title, "Transportation Engineering");
  });

  test("header row not found → clear error", () => {
    const rows = [["Name", "Writer"], ["a", "b"]];
    assert.throws(() => tabulate(rows, { requireTitle: true }), /Header row not found/);
  });

  test("template meta rows are skipped, but a book called “Text” is not", () => {
    const rows = [["Title", "Author"], ["M", "O"], ["Text", "Text"], ["Start entering data from Row 5"], ["Text", "Someone"]];
    const t = tabulate(rows);
    assert.deepEqual(t.records, [{ title: "Text", author: "Someone" }]);
  });

  test("writer round-trips, including special characters", () => {
    const back = readXlsx(writeXlsx("Sheet A", [["Title", "Note"], ["A & B <C>", "Zoë \"q\""]]));
    assert.deepEqual(back.rows, [["Title", "Note"], ["A & B <C>", 'Zoë "q"']]);
    assert.equal(back.preferred, false);
  });

  test("aliases: first author → author role; labels; entity_id quiet", () => {
    assert.ok(roleCandidates("first_author_full_name").some((c) => c.role === "author"));
    assert.ok(!roleCandidates("second_author_full_name").length);
    assert.equal(headerKeys(["First Author Full Name"])[0].key, "first_author_full_name");
  });

  test("placeholders are deterministic, valid and never overwrite", () => {
    const a = { title: "Dynamics", floor: "", rack: "", shelf: "" };
    const b = { title: "Dynamics", floor: "", rack: "", shelf: "" };
    fillPlaceholders(a, "title", ["floor", "rack", "shelf"]);
    fillPlaceholders(b, "title", ["floor", "rack", "shelf"]);
    assert.deepEqual(a, b);
    assert.match(a.floor, /^[1-4]$/);
    assert.match(a.rack, /^R-(0[1-9]|1\d|20)$/);
    assert.match(a.shelf, /^[A-F]$/);
    assert.equal(a.location_is_placeholder, "true");
    const c = { title: "X", floor: "9", rack: "", shelf: "" };
    assert.deepEqual(fillPlaceholders(c, "title", ["floor", "rack", "shelf"]), ["rack", "shelf"]);
    assert.equal(c.floor, "9");
  });
});

describe("uploading the supplied template", () => {
  let app;
  before(async () => (app = await startApp()));
  after(() => app.close());

  test("dry run reports 85 books, the six fields and placeholders; nothing saved", async () => {
    const res = await upload(app, TEMPLATE, { mode: "replace", dryRun: "true" });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.rowsRead, 85);
    assert.equal(res.data.placeholdersFilled, 85);
    assert.equal(res.data.detected.format, "xlsx");
    assert.equal(res.data.detected.sheet, "Holding_Creation");
    assert.equal(res.data.detected.headerRow, 3);
    assert.equal(res.data.preview.rows.length, 20);
    assert.deepEqual(res.data.preview.rows[0].placeholder, ["floor", "rack", "shelf"]);
    const labels = res.data.preview.fields.map((f) => f.label);
    for (const l of ["Title", "First author", "Second author", "Floor", "Rack", "Shelf"]) assert.ok(labels.includes(l), l);
    assert.ok(!res.data.preview.fields.some((f) => f.key === "location_is_placeholder"), "hidden flag not listed");
    assert.equal((await app.call("/api/health")).data.books, 0);
  });

  test("real upload: 85 books, header rows never become books, roles right", async () => {
    const res = await upload(app, TEMPLATE, { mode: "replace" });
    assert.equal(res.data.rowsImported, 85);
    assert.equal((await app.call("/api/health")).data.books, 85);
    const titles = (await all(app)).map((b) => b.data.title);
    for (const junk of ["Title", "M", "Text", "Alphanumeric", "Catalog and Holding Creation"]) assert.ok(!titles.includes(junk), junk);
    assert.ok(!titles.some((t) => /^Start entering/.test(t)));
    const fields = Object.fromEntries((await app.call("/api/fields", { token: TOKEN })).data.fields.map((f) => [f.key, f]));
    assert.equal(fields.title.role, "title");
    assert.equal(fields.first_author_full_name.role, "author");
    assert.equal(fields.second_author_full_name.searchable, true);
    assert.equal(fields.second_author_full_name.show_in_card, true);
    assert.equal(fields.entity_id.searchable, false);
    assert.equal(fields.entity_id.show_in_card, false);
    const loc = Object.values(fields).filter((f) => f.is_location).map((f) => f.key);
    assert.deepEqual(loc, ["floor", "rack", "shelf"]);
  });

  test("searching either author finds the book; both shown", async () => {
    const first = await app.call("/api/search?q=vazirani");
    const second = await app.call("/api/search?q=chandola");
    assert.equal(first.data.results[0].data.title, "Transportation Engineering");
    assert.ok(second.data.results.some((r) => r.data.title === "Transportation Engineering"));
    const book = second.data.results.find((r) => r.data.title === "Transportation Engineering");
    assert.equal(book.data.first_author_full_name, "Vazirani, V.N");
    assert.equal(book.data.second_author_full_name, "Chandola, S. P");
    assert.deepEqual(book.matched, ["second_author_full_name"]);
  });

  test("every book has a valid location; the placeholder flag is admin-only", async () => {
    const pub = await app.call("/api/books?limit=100");
    assert.ok(pub.data.results.every((b) => /^[1-4]$/.test(b.data.floor) && /^R-\d\d$/.test(b.data.rack) && /^[A-F]$/.test(b.data.shelf)));
    assert.ok(pub.data.results.every((b) => !("location_is_placeholder" in b.data)), "hidden from public");
    assert.ok(!(await app.call("/api/fields")).data.fields.some((f) => f.key === "location_is_placeholder"));
    const adminView = await all(app, "&location_is_placeholder=true");
    assert.equal(adminView.length, 85, "admin filter: needs real location");
    assert.equal((await app.call("/api/books?location_is_placeholder=true")).data.total, 85 + 0, "public can't filter on it…");
    assert.ok((await app.call("/api/books?location_is_placeholder=true&limit=1")).data.results.every((b) => !("location_is_placeholder" in b.data)));
  });

  test("re-uploading gives identical locations", async () => {
    const before = Object.fromEntries((await all(app)).map((b) => [b.data.title + b.data.first_author_full_name, b.location]));
    await upload(app, TEMPLATE, { mode: "replace" });
    const after = Object.fromEntries((await all(app)).map((b) => [b.data.title + b.data.first_author_full_name, b.location]));
    assert.deepEqual(after, before);
  });

  test("admin edit clears the placeholder and survives an upsert re-upload", async () => {
    const book = (await app.call("/api/search?q=transportation%20engineering", { token: TOKEN })).data.results[0];
    assert.equal(book.data.location_is_placeholder, "true");
    // Editing a non-location field keeps the flag.
    const keep = await app.call(`/api/books/${book.id}`, {
      method: "PUT",
      token: TOKEN,
      body: { title: book.data.title, first_author_full_name: book.data.first_author_full_name, second_author_full_name: "Chandola, S. P.", floor: book.data.floor, rack: book.data.rack, shelf: book.data.shelf },
    });
    assert.equal(keep.data.data.location_is_placeholder, "true");
    // Changing the shelf makes it real.
    const edit = await app.call(`/api/books/${book.id}`, {
      method: "PUT",
      token: TOKEN,
      body: { ...keep.data.data, location_is_placeholder: undefined, floor: "2", rack: "R-07", shelf: "C" },
    });
    assert.equal(edit.status, 200, JSON.stringify(edit.data));
    assert.ok(!edit.data.data.location_is_placeholder);
    const up = await upload(app, TEMPLATE, { mode: "upsert" });
    assert.equal(up.status, 200, JSON.stringify(up.data));
    assert.equal(up.data.rowsUpdated, 85);
    assert.equal(up.data.rowsInserted, 0, "matched on title + first author");
    const again = (await app.call(`/api/books/${book.id}`, { token: TOKEN })).data;
    assert.equal(again.location, "Floor 2 · Rack R-07 · Shelf C");
    assert.ok(!again.data.location_is_placeholder);
    assert.equal((await app.call("/api/health")).data.books, 85);
  });

  test("bulk location update clears placeholders", async () => {
    const two = (await app.call("/api/books?limit=2&location_is_placeholder=true", { token: TOKEN })).data.results;
    const res = await app.call("/api/books/location", { method: "PATCH", token: TOKEN, body: { ids: two.map((b) => b.id), values: { floor: "3", rack: "R-11", shelf: "D" } } });
    assert.deepEqual(res.data, { updated: 2 });
    for (const b of two) {
      const now = (await app.call(`/api/books/${b.id}`, { token: TOKEN })).data;
      assert.equal(now.location, "Floor 3 · Rack R-11 · Shelf D");
      assert.ok(!now.data.location_is_placeholder);
    }
    assert.equal((await app.call("/api/books/location", { method: "PATCH", body: { ids: [1], values: { floor: "1" } } })).status, 401, "admin only");
  });

  test("filters: missing author, duplicates", async () => {
    const csv = "title,first author full name,floor,rack,shelf\nNo Author Book,,1,R-01,A\nTwin,Same Person,1,R-01,A\nTwin,Same Person,1,R-01,B\n";
    await app.upload(Buffer.from(csv), { mode: "append" });
    const missing = await app.call("/api/books?missing=author&limit=100", { token: TOKEN });
    assert.ok(missing.data.results.some((b) => b.data.title === "No Author Book"));
    assert.ok(missing.data.results.every((b) => !b.data.first_author_full_name));
    const dupes = await app.call("/api/books?duplicates=1&limit=100", { token: TOKEN });
    assert.deepEqual(dupes.data.results.map((b) => b.data.title).filter((t) => t === "Twin").length, 2);
  });

  test("exports: CSV and XLSX re-import cleanly; template has real headers", async () => {
    const xlsx = await fetch(`${app.base}/api/export?format=xlsx`, { headers: { Cookie: app.cookie } });
    assert.equal(xlsx.status, 200);
    assert.match(xlsx.headers.get("content-type"), /spreadsheetml/);
    const book = readXlsx(Buffer.from(await xlsx.arrayBuffer()));
    assert.deepEqual(book.rows[0].slice(0, 3), ["Title", "First author", "Second author"]);
    const fieldsBefore = (await app.call("/api/fields", { token: TOKEN })).data.fields.map((f) => f.key).sort();
    const re = await upload(app, writeXlsx("Holding_Creation", book.rows), { mode: "replace" });
    assert.equal(re.status, 200, JSON.stringify(re.data));
    assert.deepEqual(re.data.fields.added, [], "labels map back to the same fields");
    assert.deepEqual((await app.call("/api/fields", { token: TOKEN })).data.fields.map((f) => f.key).sort(), fieldsBefore);
    const template = await fetch(`${app.base}/api/template`, { headers: { Cookie: app.cookie } });
    const t = readXlsx(Buffer.from(await template.arrayBuffer()));
    assert.equal(t.sheetName, "Holding_Creation");
    assert.ok(t.rows[0].includes("Title") && t.rows[0].includes("Second author") && !t.rows[0].includes("Placeholder location"));
    assert.equal((await app.raw("/api/template")).status, 401, "admin only");
  });

  test("invalid files: clear errors, data untouched", async () => {
    const before = (await app.call("/api/health")).data.books;
    const notZip = await upload(app, Buffer.from("PK\u0003\u0004 not really a zip"), { mode: "replace" });
    assert.equal(notZip.status, 422);
    const noTitle = await upload(app, writeXlsx("Data", [["Name"], ["x"]]), { mode: "replace" });
    assert.equal(noTitle.status, 422);
    assert.match(noTitle.data.error, /Header row not found/);
    assert.equal((await app.call("/api/health")).data.books, before);
  });

  test("a file with a made-up column: appears in search, cards and admin fields", async () => {
    const csv = "Title,First Author Full Name,Donor Name,Floor,Rack,Shelf\nGift Book,A. Writer,Ramanujan Trust,1,R-01,A\n";
    const res = await app.upload(Buffer.from(csv), { mode: "append" });
    assert.ok(res.data.fields.added.includes("donor_name"));
    const hit = (await app.call("/api/search?q=ramanujan")).data.results[0];
    assert.equal(hit.data.donor_name, "Ramanujan Trust");
    const field = (await app.call("/api/fields")).data.fields.find((f) => f.key === "donor_name");
    assert.equal(field.show_in_card, true);
    assert.equal(field.searchable, true);
  });
});

test("the bundled catalogue (Holding_Creation template) loads into an empty database", async () => {
  const { openDatabase } = await import("../src/db.js");
  const { loadConfig } = await import("../src/config.js");
  const { loadSampleIfEmpty } = await import("../src/server.js");
  const db = openDatabase(":memory:");
  const config = { ...loadConfig({ ADMIN_DISABLED: "true" }), autoLoadSample: true };
  const report = loadSampleIfEmpty(db, config);
  assert.equal(report.rowsImported, 85);
  assert.equal(db.prepare("SELECT count(*) AS n FROM books").get().n, 85);
  assert.equal(loadSampleIfEmpty(db, config), null, "never reloads over existing data");
});
