// Spec "Duplicate handling and the placeholder warning".

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { authorSignature, dupKey, normalizeTitle } from "../src/services/duplicates.js";
import { TOKEN, startApp } from "./helpers.js";

const CSV = (rows) => Buffer.from(["Title,First Author Full Name,Floor,Rack,Shelf", ...rows].join("\n"));
const upload = (app, rows, opts = {}) => app.upload(CSV(rows), { filename: "books.csv", ...opts });
const count = async (app) => (await app.call("/api/books?limit=1", { token: TOKEN })).data.total;

describe("match key", () => {
  test("title normalised; author order- and initials-tolerant", () => {
    assert.equal(normalizeTitle("The  Analog Communication-Systems!"), "analog communication systems");
    assert.equal(authorSignature("Sharma, Sanjay"), authorSignature("Sanjay Sharma"));
    assert.equal(authorSignature("Sharma, Sanjay"), authorSignature("Sharma S."));
    const roles = { titleKey: "title", authorKey: "author" };
    const a = dupKey({ title: "Analog Communication Systems", author: "Sharma, Sanjay" }, roles);
    assert.equal(a, dupKey({ title: "analog communication systems", author: "Sanjay Sharma" }, roles));
    assert.notEqual(a, dupKey({ title: "Digital Communication", author: "Sharma, Sanjay" }, roles), "another book by the same author");
    assert.equal(dupKey({ title: "X", entity_id: "E-1" }, roles), "id:e-1");
  });
});

describe("upload", () => {
  test("same file twice with Smart adds 0 books and says it was uploaded before", async () => {
    const app = await startApp();
    const rows = ["Analog Communication Systems,\"Sharma, Sanjay\",3,R-14,B", "Machine Design,\"Bhandari, V. B.\",2,R-03,A"];
    assert.equal((await upload(app, rows, { mode: "append" })).data.rowsInserted, 2);
    const again = await upload(app, rows, { mode: "append" });
    assert.equal(again.data.rowsInserted, 0);
    assert.equal(again.data.duplicates.exact, 2);
    assert.ok(again.data.alreadyUploaded, "same file recognised");
    assert.match(again.data.warnings[0], /already uploaded/);
    assert.equal(await count(app), 2);
    await app.close();
  });

  test("a row repeated inside the file is imported once; another shelf becomes another copy", async () => {
    const app = await startApp();
    const res = await upload(app, [
      "Strength of Materials,\"Rajput, R. K.\",2,R-05,C",
      "Strength of Materials,\"R. K. Rajput\",2,R-05,C",
      "Strength of Materials,\"Rajput R.K.\",3,R-09,A",
    ]);
    assert.deepEqual(res.data.duplicates, { new: 1, exact: 1, differentPlace: 1 });
    assert.equal(await count(app), 2);
    const skip = await upload(app, ["Machine Design,\"Bhandari, V. B.\",2,R-03,A", "Machine Design,\"Bhandari, V. B.\",4,R-01,B"], { onDuplicate: "skip" });
    assert.equal(skip.data.rowsInserted, 1);
    const all = await upload(app, ["Machine Design,\"Bhandari, V. B.\",2,R-03,A", "Machine Design,\"Bhandari, V. B.\",2,R-03,A"], { onDuplicate: "all" });
    assert.equal(all.data.rowsInserted, 2);
    await app.close();
  });

  test("Smart never overwrites an admin-edited location", async () => {
    const app = await startApp();
    await app.upload(Buffer.from("Title,First Author Full Name,Floor,Rack,Shelf\nThermodynamics,\"Nag, P. K.\",,,\n"), { filename: "a.csv" });
    const id = (await app.call("/api/books?limit=1", { token: TOKEN })).data.results[0].id;
    await app.call("/api/books/location", { method: "PATCH", body: { ids: [id], values: { floor: "1", rack: "R-01", shelf: "A" } }, token: TOKEN });
    await app.upload(Buffer.from("Title,First Author Full Name,Floor,Rack,Shelf\nThermodynamics,\"P. K. Nag\",,,\n"), { filename: "b.csv", mode: "append" });
    const book = (await app.call(`/api/books/${id}`, { token: TOKEN })).data;
    assert.deepEqual([book.data.floor, book.data.rack, book.data.shelf], ["1", "R-01", "A"]);
    assert.equal(await count(app), 1);
    await app.close();
  });
});

describe("review screen actions", () => {
  async function seeded() {
    const app = await startApp();
    await upload(
      app,
      [
        "Analog Communication Systems,\"Sharma, Sanjay\",3,R-14,B",
        "Analog Communication Systems,\"Sanjay Sharma\",3,R-14,B",
        "Basic Electrical And Electronics Engineering,\"Gupta, J.B.\",3,R-16,F",
        "Basic Electrical And Electronics Engineering,\"J. B. Gupta\",3,R-16,F",
        "Basic Electrical And Electronics Engineering,\"Gupta J B\",1,R-02,A",
        "Digital Communication,\"Sharma, Sanjay\",2,R-01,C",
      ],
      { onDuplicate: "all" }
    );
    return app;
  }

  test("groups the screenshot's examples correctly; admin only", async () => {
    const app = await seeded();
    assert.equal((await app.call("/api/duplicates")).status, 401);
    const { groups, summary } = (await app.call("/api/duplicates", { token: TOKEN })).data;
    assert.equal(summary.groups, 2);
    assert.equal(summary.books, 5);
    const levels = Object.fromEntries(groups.map((g) => [g.rows[0].data.title, [g.level, g.rows.length]]));
    assert.deepEqual(levels["Analog Communication Systems"], ["exact", 2]);
    assert.deepEqual(levels["Basic Electrical And Electronics Engineering"], ["place", 3]);
    await app.close();
  });

  test("merge, undo, keep as copies, delete and merge-all-exact", async () => {
    const app = await seeded();
    const list = async () => (await app.call("/api/duplicates", { token: TOKEN })).data;
    const analog = (await list()).groups.find((g) => g.level === "exact");
    const merged = await app.call("/api/duplicates/merge", { method: "POST", body: { keepId: analog.rows[0].id, removeIds: [analog.rows[1].id] }, token: TOKEN });
    assert.equal(merged.data.removed, 1);
    assert.equal(await count(app), 5);
    assert.equal((await app.call(`/api/undo/${merged.data.actionId}`, { method: "POST", token: TOKEN })).data.restored, 2);
    assert.equal(await count(app), 6, "undo brings the merged book back");

    const place = (await list()).groups.find((g) => g.level === "place");
    await app.call("/api/duplicates/resolve", { method: "POST", body: { key: place.key, kind: "copies" }, token: TOKEN });
    assert.equal((await list()).groups.length, 1, "copies are not flagged again");

    const all = await app.call("/api/duplicates/merge-exact", { method: "POST", token: TOKEN });
    assert.equal(all.data.removed, 1);
    assert.equal((await list()).groups.length, 0);

    const del = await app.call("/api/duplicates/delete", { method: "POST", body: { ids: [place.rows[2].id] }, token: TOKEN });
    assert.equal(del.data.removed, 1);
    await app.call(`/api/undo/${del.data.actionId}`, { method: "POST", token: TOKEN });
    assert.equal(await count(app), 5);
    assert.ok(app.logs.some((l) => l.audit === "merge_duplicates") && app.logs.some((l) => l.audit === "undo"));
    await app.close();
  });

  test("a book page lists the other copies' locations", async () => {
    const app = await seeded();
    const id = (await app.call("/api/search?q=basic%20electrical")).data.results[0].id;
    const book = (await app.call(`/api/books/${id}`)).data;
    assert.equal(book.copies.length, 2);
    assert.ok(book.copies.every((c) => c.locationParts.length === 3));
    await app.close();
  });
});

describe("temporary locations", () => {
  test("verify clears the flag (one or all); visitors never see it", async () => {
    const app = await startApp();
    await app.upload(Buffer.from("Title,First Author Full Name,Floor,Rack,Shelf\nA Book,\"X, Y\",,,\nB Book,\"Z, W\",,,\n"), { filename: "t.csv" });
    const flagged = async () => (await app.call("/api/books?location_is_placeholder=true&limit=5", { token: TOKEN })).data.total;
    assert.equal(await flagged(), 2);
    const id = (await app.call("/api/books?limit=1", { token: TOKEN })).data.results[0].id;
    assert.equal((await app.call(`/api/books/${id}`)).data.data.location_is_placeholder, undefined, "public record omits the flag");
    await app.call("/api/books/verify-location", { method: "POST", body: { ids: [id] }, token: TOKEN });
    assert.equal(await flagged(), 1);
    await app.call("/api/books/verify-location", { method: "POST", body: { all: true }, token: TOKEN });
    assert.equal(await flagged(), 0);
    await app.close();
  });
});
