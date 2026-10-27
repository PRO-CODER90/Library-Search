// Spec section 11: upload, dynamic fields, search rules, auth, robustness.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { TOKEN, sample, startApp } from "./helpers.js";

const titles = (res) => res.data.results.map((r) => r.data.title);

describe("dynamic fields via CSV upload", () => {
  let app;
  before(async () => (app = await startApp()));
  after(() => app.close());

  test("upload sample-books.csv: 25 rows and the expected fields", async () => {
    const res = await app.upload(sample("sample-books.csv"));
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.rowsRead, 25);
    assert.equal(res.data.rowsImported, 25);
    assert.equal(res.data.detected.titleField, "title");
    const keys = (await app.call("/api/fields")).data.fields.map((f) => f.key);
    for (const key of ["title", "author", "shelf", "isbn", "rack", "floor"]) assert.ok(keys.includes(key), key);
    assert.equal((await app.call("/api/health")).data.books, 25);
  });

  test("roles, types and location flags are guessed", async () => {
    const fields = Object.fromEntries((await app.call("/api/fields")).data.fields.map((f) => [f.key, f]));
    assert.equal(fields.title.role, "title");
    assert.equal(fields.author.role, "author");
    assert.equal(fields.category.role, "category");
    assert.equal(fields.available.type, "boolean");
    assert.equal(fields.copies.type, "number");
    assert.ok(fields.floor.is_location && fields.rack.is_location && fields.shelf.is_location);
    assert.equal(fields.title.is_location, false);
    assert.equal(fields.id.searchable, false);
  });

  test("results carry a location label built from location fields", async () => {
    const res = await app.call("/api/search?q=algorithms");
    assert.equal(res.data.results[0].location, "Floor 2 · Rack R-07 · Shelf C");
    assert.deepEqual(res.data.results[0].matched, ["title"]);
  });

  test("dryRun reports the diff but saves nothing", async () => {
    const res = await app.upload(sample("sample-books-v2.csv"), { mode: "replace", dryRun: "true" });
    assert.equal(res.status, 200);
    assert.equal(res.data.dryRun, true);
    assert.deepEqual(res.data.fields.added.sort(), ["language", "publisher", "section", "year"]);
    assert.equal((await app.call("/api/health")).data.books, 25);
    const keys = (await app.call("/api/fields")).data.fields.map((f) => f.key);
    assert.ok(keys.includes("isbn") && !keys.includes("publisher"));
  });

  test("replace with v2: fields auto-added and auto-removed, old rows gone", async () => {
    const res = await app.upload(sample("sample-books-v2.csv"), { mode: "replace" });
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.fields.added.sort(), ["language", "publisher", "section", "year"]);
    assert.deepEqual(res.data.fields.removed.sort(), ["available", "copies", "isbn"]);
    assert.ok(res.data.fields.kept.includes("title") && res.data.fields.kept.includes("author"));
    const fields = Object.fromEntries((await app.call("/api/fields")).data.fields.map((f) => [f.key, f]));
    assert.equal(fields.isbn, undefined);
    assert.equal(fields.section.is_location, true);
    assert.equal(fields.year.type, "number");
    assert.equal((await app.call("/api/health")).data.books, 8);
    assert.equal((await app.call("/api/search?q=harry")).data.total, 0);
    assert.deepEqual(titles(await app.call("/api/search?q=gita press")).sort(), ["Mahabharata", "Ramayana"]);
  });

  test("append keeps old fields active and both datasets searchable", async () => {
    const res = await app.upload(sample("sample-books.csv"), { mode: "append" });
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.fields.removed, []);
    assert.deepEqual(res.data.fields.added.sort(), ["available", "copies", "isbn"]);
    assert.ok(res.data.fields.notInFile.includes("publisher"));
    const keys = (await app.call("/api/fields")).data.fields.map((f) => f.key);
    assert.ok(keys.includes("publisher") && keys.includes("isbn"));
    assert.equal((await app.call("/api/health")).data.books, 33);
    assert.ok((await app.call("/api/search?q=harry")).data.total > 0);
    assert.ok((await app.call("/api/search?q=premchand")).data.total > 0);
  });

  test("upsert updates matching rows and inserts new ones", async () => {
    const csv = "id,title,shelf\n1,Harry Potter and the Philosopher's Stone (new ed.),Z\n999,Brand New Book,Q\n";
    const res = await app.upload(Buffer.from(csv), { mode: "upsert", keyField: "id" });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.rowsUpdated, 1);
    assert.equal(res.data.rowsInserted, 1);
    const hit = (await app.call("/api/search?q=new ed")).data.results[0];
    assert.equal(hit.data.shelf, "Z");
    assert.equal(hit.data.author, "J.K. Rowling", "untouched fields are kept");
    assert.equal((await app.call("/api/health")).data.books, 34);
  });

  test("upsert needs a keyField that exists", async () => {
    const res = await app.upload(Buffer.from("id,title\n1,X\n"), { mode: "upsert", keyField: "isbn" });
    assert.equal(res.status, 422);
  });
});

describe("search rules", () => {
  let app;
  before(async () => {
    app = await startApp();
    await app.upload(sample("sample-books.csv"));
  });
  after(() => app.close());

  test("q=a returns every book containing 'a' in a searchable field", async () => {
    const res = await app.call("/api/search?q=a&limit=100");
    const fields = (await app.call("/api/fields")).data.fields.filter((f) => f.searchable).map((f) => f.key);
    const all = (await app.call("/api/books?limit=100")).data.results;
    const expected = all.filter((b) => fields.some((k) => String(b.data[k] ?? "").toLowerCase().includes("a")));
    assert.equal(res.data.total, expected.length);
    assert.ok(res.data.total < 25 || expected.length === 25);
    assert.ok(res.data.results[0].data.title.toLowerCase().startsWith("a"), "titles starting with A rank first");
  });

  test("single-letter results are paged", async () => {
    const page1 = await app.call("/api/search?q=a&limit=5");
    const page2 = await app.call("/api/search?q=a&limit=5&page=2");
    assert.equal(page1.data.results.length, 5);
    assert.notEqual(page1.data.results[0].id, page2.data.results[0].id);
  });

  test("case-insensitive: HARRY = harry", async () => {
    assert.deepEqual(titles(await app.call("/api/search?q=HARRY")), titles(await app.call("/api/search?q=harry")));
    assert.equal((await app.call("/api/search?q=harry")).data.total, 2);
  });

  test("multi-word AND: rowling potter", async () => {
    const res = await app.call("/api/search?q=rowling%20potter");
    assert.equal(res.data.total, 2);
    assert.equal((await app.call("/api/search?q=rowling%20physics")).data.total, 0);
  });

  test("% and _ are literal, not wildcards", async () => {
    const res = await app.call("/api/search?q=100%25");
    assert.equal(res.status, 200);
    assert.equal(res.data.total, 0);
    assert.equal((await app.call("/api/search?q=_")).data.total, 0);
  });

  test("Unicode title is searchable and returned unchanged", async () => {
    const res = await app.call(`/api/search?q=${encodeURIComponent("白")}`);
    assert.deepEqual(titles(res), ["The白 Silk Road"]);
  });

  test("shelf codes match with or without punctuation", async () => {
    const dashed = await app.call("/api/search?q=R-07");
    const compact = await app.call("/api/search?q=r07");
    assert.equal(dashed.data.total, 2);
    assert.deepEqual(titles(compact), titles(dashed));
  });

  test("fields= limits which fields are searched", async () => {
    assert.ok((await app.call("/api/search?q=kalam")).data.total === 2);
    assert.equal((await app.call("/api/search?q=kalam&fields=title")).data.total, 0);
    assert.equal((await app.call("/api/search?q=kalam&fields=author")).data.total, 2);
  });

  test("fields= works on large catalogues (no SQL variable limit)", async () => {
    const big = await startApp();
    const lines = ["title,author,shelf"];
    for (let i = 0; i < 40000; i++) lines.push(`Book ${i} alpha,Writer ${i},A`);
    assert.equal((await big.upload(Buffer.from(lines.join("\n")))).status, 200);
    const res = await big.call("/api/search?q=a&fields=title&limit=5");
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.total, 40000);
    assert.deepEqual(res.data.results[0].matched, ["title"]);
    await big.close();
  });

  test("empty query returns nothing", async () => {
    assert.equal((await app.call("/api/search?q=")).data.total, 0);
  });

  test("PATCH searchable:false removes a field from search", async () => {
    assert.ok((await app.call("/api/search?q=9780262046305")).data.total === 1);
    const res = await app.call("/api/fields/isbn", { method: "PATCH", body: { searchable: false }, token: TOKEN });
    assert.equal(res.status, 200);
    assert.equal(res.data.reindexed, true);
    assert.equal((await app.call("/api/search?q=9780262046305")).data.total, 0);
  });

  test("browse: exact filters and facets", async () => {
    const fiction = await app.call("/api/books?category=fiction&limit=100");
    assert.ok(fiction.data.total >= 5 && fiction.data.results.every((r) => r.data.category === "Fiction"));
    const both = await app.call("/api/books?shelf=A&floor=1");
    assert.ok(both.data.results.every((r) => r.data.shelf === "A" && r.data.floor === "1"));
    // The A–Z browse was removed: ?letter= is not a filter (no field has that key).
    const ignored = await app.call("/api/books?letter=Z&limit=100");
    assert.equal(ignored.data.total, 25);
    const facets = await app.call("/api/facets/category");
    assert.deepEqual(facets.data.values.slice(0, 2), [
      { value: "Fiction", count: 6 },
      { value: "Computer Science", count: 5 },
    ]);
    assert.equal((await app.call("/api/facets/nope")).status, 404);
  });
});

describe("CSV robustness", () => {
  let app;
  before(async () => (app = await startApp()));
  after(() => app.close());

  test("semicolon delimiter, BOM and quoted commas", async () => {
    const csv = '﻿Title;Author;Shelf\n"Hello; World, Again";"Doe, Jane";A\nPlain;X;B\n';
    const res = await app.upload(Buffer.from(csv));
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.detected.delimiter, ";");
    const book = (await app.call("/api/search?q=hello")).data.results[0];
    assert.equal(book.data.title, "Hello; World, Again");
    assert.equal(book.data.author, "Doe, Jane");
  });

  test("tab-delimited and Windows-1252 files", async () => {
    const latin = Buffer.concat([Buffer.from("title\tshelf\nCaf"), Buffer.from([0xe9]), Buffer.from(" Society\tC\n")]);
    const res = await app.upload(latin, { filename: "books.tsv" });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.detected.encoding, "windows-1252");
    assert.equal(res.data.detected.delimiter, "\\t");
    assert.deepEqual(titles(await app.call("/api/search?q=cafe")), ["Café Society"]);
  });

  test("duplicate and blank headers get unique keys", async () => {
    const res = await app.upload(Buffer.from("Title,Author,Author,,Shelf No.\nBook,A1,A2,x,S1\n"));
    assert.equal(res.status, 200);
    const keys = (await app.call("/api/fields")).data.fields.map((f) => f.key);
    for (const key of ["title", "author", "author_2", "column_4", "shelf_no"]) assert.ok(keys.includes(key), key);
  });

  test("ragged rows are padded with a warning", async () => {
    const res = await app.upload(Buffer.from("title,author,shelf\nOne,A\nTwo,B,C\nThree\n"));
    assert.equal(res.status, 200);
    assert.equal(res.data.rowsImported, 3);
    assert.ok(res.data.warnings.some((w) => /2 rows had fewer columns/.test(w)), res.data.warnings.join());
  });

  test("CSV injection is neutralized", async () => {
    await app.upload(Buffer.from('title,shelf\n"=HYPERLINK(""http://x"")",A\nNegative,-5\n'));
    const books = (await app.call("/api/books")).data.results;
    assert.ok(books.find((b) => b.data.title.startsWith("'=HYPERLINK")));
    assert.equal(books.find((b) => b.data.title === "Negative").data.shelf, "-5");
  });

  test("no title column: first text column is used, with a warning", async () => {
    const res = await app.upload(Buffer.from("Keyword,Rack,Shelf\nPhysics,R-1,A\nChemistry,R-2,B\n"));
    assert.equal(res.status, 200);
    assert.equal(res.data.detected.titleField, "keyword");
    assert.ok(res.data.warnings.some((w) => /No title column/.test(w)));
    assert.equal((await app.call("/api/search?q=phys")).data.results[0].data.keyword, "Physics");
  });

  test("a corrupt upload leaves the old data intact", async () => {
    await app.upload(sample("sample-books.csv"));
    const before = (await app.call("/api/health")).data.books;
    const res = await app.upload(Buffer.from('title,shelf\nGood,A\n"Broken,B\n'));
    assert.equal(res.status, 422);
    assert.match(res.data.error, /Unclosed quote/);
    assert.equal((await app.call("/api/health")).data.books, before);
    assert.ok((await app.call("/api/search?q=harry")).data.total > 0);
  });

  test("non-CSV files and oversize uploads are rejected", async () => {
    assert.equal((await app.upload(Buffer.from("x"), { filename: "books.exe", type: "application/x-msdownload" })).status, 415);
    const small = await startApp({ maxUploadBytes: 1024 });
    const res = await small.upload(Buffer.alloc(4096, "a"));
    assert.equal(res.status, 413);
    await small.close();
  });

  test("raw text/csv body with query options also works", async () => {
    const res = await app.call("/api/upload?mode=replace&dryRun=true", {
      method: "POST",
      body: "title,shelf\nRaw,A\n",
      headers: { "Content-Type": "text/csv" },
      token: TOKEN,
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.rowsRead, 1);
  });
});

describe("admin protection and records", () => {
  let app;
  before(async () => {
    app = await startApp();
    await app.upload(sample("sample-books.csv"));
  });
  after(() => app.close());

  test("admin endpoints need the token", async () => {
    // Admin-only endpoints need a session: 401.
    assert.equal((await app.upload(sample("sample-books.csv"), { token: "" })).status, 401);
    assert.equal((await app.upload(sample("sample-books.csv"), { token: "wrong" })).status, 401);
    assert.equal((await app.call("/api/books", { method: "POST", body: { title: "x" } })).status, 401);
    assert.equal((await app.call("/api/fields/title", { method: "PATCH", body: {} })).status, 401);
    assert.equal((await app.call("/api/export")).status, 401);
    assert.equal((await app.call("/api/books?confirm=yes", { method: "DELETE" })).status, 401);
    const all = await app.call("/api/fields?all=true");
    assert.equal(all.status, 200, "?all=true is ignored for visitors");
    assert.ok(all.data.fields.every((f) => f.active));
    assert.equal((await app.call("/api/auth/me", { token: TOKEN })).data.authenticated, true);
  });

  test("POST a book with a brand-new key registers the field", async () => {
    const res = await app.call("/api/books", {
      method: "POST",
      body: { title: "Field Guide to Ferns", author: "P. Leaf", shelf: "F", "Donated By": "Alumni 2010" },
      token: TOKEN,
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.deepEqual(res.data.newFields, ["donated_by"]);
    const field = (await app.call("/api/fields")).data.fields.find((f) => f.key === "donated_by");
    assert.equal(field.label, "Donated By");
    assert.equal((await app.call("/api/search?q=alumni")).data.results[0].data.title, "Field Guide to Ferns");
  });

  test("PUT replaces a record; title can't be blank; DELETE removes it", async () => {
    const id = (await app.call("/api/search?q=ferns")).data.results[0].id;
    const bad = await app.call(`/api/books/${id}`, { method: "PUT", body: { title: "", shelf: "F" }, token: TOKEN });
    assert.equal(bad.status, 422);
    const ok = await app.call(`/api/books/${id}`, { method: "PUT", body: { title: "Ferns, 2nd ed.", shelf: "G" }, token: TOKEN });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.data.shelf, "G");
    assert.equal(ok.data.data.author, undefined, "PUT replaces the whole record");
    assert.equal((await app.call(`/api/books/${id}`, { method: "DELETE", token: TOKEN })).status, 204);
    assert.equal((await app.call(`/api/books/${id}`)).status, 404);
  });

  test("PATCH field role moves the title and reindexes", async () => {
    const res = await app.call("/api/fields/author", { method: "PATCH", body: { role: "title", label: "Writer" }, token: TOKEN });
    assert.equal(res.status, 200);
    assert.equal(res.data.field.role, "title");
    assert.equal(res.data.field.label, "Writer");
    assert.equal(res.data.fields.find((f) => f.key === "title").role, null);
    const top = (await app.call("/api/search?q=paulo")).data.results[0];
    assert.equal(top.score, 100, "author is now ranked as the title");
    assert.equal((await app.call("/api/fields/author", { method: "PATCH", body: { role: "boss" }, token: TOKEN })).status, 422);
    await app.call("/api/fields/title", { method: "PATCH", body: { role: "title" }, token: TOKEN });
  });

  test("export returns the active fields as CSV", async () => {
    const res = await app.call("/api/export", { token: TOKEN });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/csv/);
    const lines = res.data.replace(/^﻿/, "").trim().split("\r\n");
    assert.match(lines[0], /^ID,Title,Writer,Category,ISBN,Floor,Rack,Shelf,Copies,Available/);
    assert.equal(lines.length, 26);
  });

  test("wipe needs confirm=yes", async () => {
    assert.equal((await app.call("/api/books", { method: "DELETE", token: TOKEN })).status, 400);
    const res = await app.call("/api/books?confirm=yes", { method: "DELETE", token: TOKEN });
    assert.equal(res.data.deleted, 25);
    assert.equal((await app.call("/api/health")).data.books, 0);
  });

  test("notices endpoints are gone", async () => {
    assert.equal((await app.call("/api/notices")).status, 404);
    assert.equal((await app.call("/api/notices", { method: "POST", body: { title: "x" }, token: TOKEN })).status, 404);
  });

});

describe("server behaviour", () => {
  test("rate limits search", async () => {
    const app = await startApp({ searchRateLimit: 3 });
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await app.call("/api/search?q=a")).status);
    assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
    await app.close();
  });

  test("frontend shell, static files, traversal blocked, CORS restricted", async () => {
    const app = await startApp({ corsOrigin: "http://localhost:5173" });
    const shell = await fetch(`${app.base}/book/1`);
    assert.equal(shell.status, 200);
    assert.match(await shell.text(), /<div id="root">/);
    assert.match(shell.headers.get("content-security-policy"), /default-src 'self'/);
    assert.equal((await fetch(`${app.base}/assets/app.js`)).status, 200);
    assert.equal((await fetch(`${app.base}/..%2fpackage.json`)).status, 403);
    assert.equal((await fetch(`${app.base}/missing.js`)).status, 404);
    const allowed = await fetch(`${app.base}/api/health`, { headers: { Origin: "http://localhost:5173" } });
    assert.equal(allowed.headers.get("access-control-allow-origin"), "http://localhost:5173");
    const denied = await fetch(`${app.base}/api/health`, { headers: { Origin: "http://evil.example" } });
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
    assert.equal((await app.call("/api/nope")).status, 404);
    assert.equal((await app.call("/api/health", { method: "DELETE" })).status, 405);
    await app.close();
  });
});
