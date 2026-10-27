import { HttpError, intParam, readJson } from "../http.js";
import { facets, libraryStats, listBooks, presentRow } from "../services/searchEngine.js";
import { getField, listFields } from "../services/fieldRegistry.js";
import { addRecord, deleteRecord, setLocations, updateRecord, wipeLibrary } from "../services/library.js";

const RESERVED = new Set(["page", "limit", "confirm", "missing", "duplicates"]);

function rowId(params) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(404, "Book not found.");
  return id;
}

function fetchBook(db, id, includeHidden = false) {
  const row = db.prepare("SELECT row_id, data FROM books WHERE row_id = ?").get(id);
  if (!row) throw new HttpError(404, "Book not found.");
  return presentRow(row, listFields(db), {}, { includeHidden });
}

export function registerBookRoutes(router, { db, config, audit, auth }) {
  const isAdmin = (req) => Boolean(auth.session(req));
  router.add("GET", "/api/health", () => ({
    status: "ok",
    books: db.prepare("SELECT count(*) AS n FROM books").get().n,
  }));

  // Public config: only what the public UI needs. Nothing about admin.
  router.add("GET", "/api/config", () => ({ libraryName: config.libraryName, adminEnabled: auth.enabled }));

  router.add("GET", "/api/stats", () => libraryStats(db));

  router.add("GET", "/api/books", ({ req, url }) => {
    const p = url.searchParams;
    const includeHidden = isAdmin(req);
    const filters = {};
    for (const [key, value] of p) if (!RESERVED.has(key) && value !== "") filters[key] = value;
    return listBooks(db, {
      filters,
      includeHidden,
      missing: includeHidden ? p.get("missing") ?? "" : "",
      duplicates: includeHidden && p.get("duplicates") === "1",
      page: intParam(p.get("page"), 1, 1, 100000),
      limit: intParam(p.get("limit"), 20, 1, 100),
    });
  });

  router.add("GET", "/api/books/:id", ({ req, params }) => fetchBook(db, rowId(params), isAdmin(req)));

  router.add("GET", "/api/facets/:fieldKey", ({ params }) => {
    const field = getField(db, params.fieldKey);
    if (!field || !field.active) throw new HttpError(404, `No field called “${params.fieldKey}”.`);
    return { field: field.key, label: field.label, values: facets(db, field.key) };
  });

  // ---- admin ----

  router.add(
    "POST",
    "/api/books",
    async ({ req }) => {
      const { rowId: id, newFields } = addRecord(db, await readJson(req));
      return { status: 201, body: { ...fetchBook(db, id, true), newFields } };
    },
    { admin: true }
  );

  // Bulk: set Floor/Rack/Shelf (any location field) for many books.
  router.add(
    "PATCH",
    "/api/books/location",
    async ({ req, session }) => {
      const body = await readJson(req);
      const updated = setLocations(db, body.ids, body.values);
      audit("bulk_location", req, { username: session.u, books: updated });
      return { updated };
    },
    { admin: true }
  );

  router.add(
    "PUT",
    "/api/books/:id",
    async ({ req, params }) => {
      const id = rowId(params);
      const result = updateRecord(db, id, await readJson(req));
      if (!result) throw new HttpError(404, "Book not found.");
      return { ...fetchBook(db, id, true), newFields: result.newFields };
    },
    { admin: true }
  );

  router.add(
    "DELETE",
    "/api/books/:id",
    ({ req, params, session }) => {
      const id = rowId(params);
      if (!deleteRecord(db, id)) throw new HttpError(404, "Book not found.");
      audit("delete_book", req, { username: session.u, bookId: id });
      return { status: 204 };
    },
    { admin: true }
  );

  router.add(
    "DELETE",
    "/api/books",
    ({ req, url, session }) => {
      if (url.searchParams.get("confirm") !== "yes") {
        throw new HttpError(400, "This deletes every book. Repeat with ?confirm=yes to proceed.");
      }
      const deleted = wipeLibrary(db);
      audit("delete_all_books", req, { username: session.u, deleted });
      return { deleted };
    },
    { admin: true }
  );
}
