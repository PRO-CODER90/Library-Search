// Search over whatever fields are currently searchable.
// 1) coarse filter in SQL: every query word must appear in search_text (LIKE)
// 2) score candidates in JS using the title field
// 3) sort by score then title, slice the page, load only that page's data

import { jsonPath } from "../db.js";
import { compactVariant, normalize, tokenize } from "../utils/normalize.js";
import { listFields, locationOf, roleMap } from "./fieldRegistry.js";

const escapeLike = (text) => text.replace(/[\\%_]/g, "\\$&");

function scoreTitle(title, words) {
  const phrase = words.join(" ");
  if (!title) return 10;
  if (title === phrase) return 150;
  if (title.startsWith(phrase)) return 100;
  if (title.split(/[^\p{L}\p{N}]+/u).some((w) => w && w.startsWith(phrase))) return 60;
  if (title.includes(phrase)) return 40;
  if (words.every((w) => title.includes(w))) return 30;
  return 10;
}

const byScoreThenTitle = (a, b) =>
  b.score - a.score || (a.title < b.title ? -1 : a.title > b.title ? 1 : a.row_id - b.row_id);

function valueMatches(value, word) {
  const text = normalize(value ?? "");
  if (text.includes(word)) return true;
  const compact = compactVariant(text);
  return Boolean(compact) && compact.includes(word);
}

/** Shape one stored row for API responses. */
export function presentRow(row, fields, extra = {}, { includeHidden = false } = {}) {
  const data = JSON.parse(row.data);
  // Only expose active fields; inactive ones may linger in appended rows.
  // Internal fields (the placeholder flag) only for the signed-in admin.
  const visible = {};
  for (const f of fields) {
    if (f.hidden && !includeHidden) continue;
    if (data[f.key] !== undefined && data[f.key] !== "") visible[f.key] = data[f.key];
  }
  return { id: row.row_id, ...extra, data: visible, ...locationOf(data, fields) };
}

function loadRows(db, ids) {
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`SELECT row_id, data FROM books WHERE row_id IN (${placeholders})`).all(...ids);
  return new Map(rows.map((r) => [r.row_id, r]));
}

export function search(db, { q, fields: onlyFields, page = 1, limit = 20, includeHidden = false }) {
  const words = tokenize(q);
  const fields = listFields(db);
  if (!words.length) return { query: q ?? "", total: 0, page, limit, results: [] };

  const searchable = fields.filter((f) => f.searchable);
  let restrictTo = null;
  if (onlyFields?.length) {
    const allowed = new Set(onlyFields);
    restrictTo = searchable.filter((f) => allowed.has(f.key));
    if (!restrictTo.length) return { query: q, total: 0, page, limit, results: [] };
  }

  const where = words.map(() => "search_text LIKE ? ESCAPE '\\'").join(" AND ");
  const params = words.map((w) => `%${escapeLike(w)}%`);
  // With a field restriction, read the data in the same query: search_text
  // covers all searchable fields, so candidates are re-checked against the
  // chosen ones (and an IN (...) list could exceed SQLite's variable limit).
  const columns = restrictTo ? "row_id, title_text, data" : "row_id, title_text";
  let candidates = db.prepare(`SELECT ${columns} FROM books WHERE ${where}`).all(...params);

  if (restrictTo) {
    candidates = candidates.filter((c) => {
      const data = JSON.parse(c.data);
      return words.every((w) => restrictTo.some((f) => valueMatches(data[f.key], w)));
    });
  }

  const scored = candidates.map((c) => ({ row_id: c.row_id, title: c.title_text, score: scoreTitle(c.title_text, words) }));
  scored.sort(byScoreThenTitle);

  const start = (page - 1) * limit;
  const pageItems = scored.slice(start, start + limit);
  const rows = loadRows(db, pageItems.map((s) => s.row_id));
  const matchFields = restrictTo ?? searchable;

  const results = pageItems.map((s) => {
    const row = rows.get(s.row_id);
    const data = JSON.parse(row.data);
    const matched = matchFields.filter((f) => words.some((w) => valueMatches(data[f.key], w))).map((f) => f.key);
    return presentRow(row, fields, { score: s.score, matched }, { includeHidden });
  });

  return { query: q, total: scored.length, page, limit, results };
}

/**
 * Every matching title for the live chips: light rows ({ id, text, type }),
 * same matching and order as search(), up to `ceiling` items.
 */
export function suggest(db, { q, ceiling = 5000 }) {
  const words = tokenize(q);
  if (!words.length) return { query: q ?? "", total: 0, items: [] };
  const titleKey = listFields(db).find((f) => f.role === "title")?.key;
  const where = words.map(() => "search_text LIKE ? ESCAPE '\\'").join(" AND ");
  const params = words.map((w) => `%${escapeLike(w)}%`);
  const text = titleKey ? "json_extract(data, ?)" : "''";
  const rows = db
    .prepare(`SELECT row_id, title_text, ${text} AS text FROM books WHERE ${where}`)
    .all(...(titleKey ? [jsonPath(titleKey)] : []), ...params);
  const scored = rows.map((r) => ({ ...r, score: scoreTitle(r.title_text, words), title: r.title_text }));
  scored.sort(byScoreThenTitle);
  return {
    query: q,
    total: scored.length,
    items: scored.slice(0, ceiling).map((r) => ({ id: r.row_id, text: String(r.text ?? "").trim() || "Untitled", type: "title" })),
  };
}

/**
 * Paged listing for browsing. `filters` is {fieldKey: value} (exact match,
 * case-insensitive).
 */
export function listBooks(db, { filters = {}, page = 1, limit = 20, includeHidden = false, missing = "", duplicates = false }) {
  const fields = listFields(db);
  const known = new Set(fields.filter((f) => includeHidden || !f.hidden).map((f) => f.key));
  const clauses = [];
  const params = [];
  const roleKey = (role) => fields.find((f) => f.role === role)?.key;
  // missing=<role or field>: books where that field is blank (e.g. missing=author).
  const missingKey = missing ? roleKey(missing) ?? (known.has(missing) ? missing : null) : null;
  if (missingKey) {
    clauses.push("trim(coalesce(json_extract(data, ?), '')) = ''");
    params.push(jsonPath(missingKey));
  }
  // duplicates: books sharing title + first author with another book.
  if (duplicates) {
    const authorPath = jsonPath(roleKey("author") ?? "__none__");
    clauses.push(
      `row_id IN (SELECT b.row_id FROM books b JOIN (SELECT title_text AS t, lower(trim(coalesce(json_extract(data, ?), ''))) AS a
        FROM books GROUP BY t, a HAVING count(*) > 1) d ON b.title_text = d.t AND lower(trim(coalesce(json_extract(b.data, ?), ''))) = d.a)`
    );
    params.push(authorPath, authorPath);
  }
  for (const [key, value] of Object.entries(filters)) {
    if (!known.has(key)) continue;
    clauses.push("lower(trim(json_extract(data, ?))) = lower(trim(?))");
    params.push(jsonPath(key), String(value));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = db.prepare(`SELECT count(*) AS n FROM books ${where}`).get(...params).n;
  const rows = db
    .prepare(`SELECT row_id, data FROM books ${where} ORDER BY title_text, row_id LIMIT ? OFFSET ?`)
    .all(...params, limit, (page - 1) * limit);
  return { total, page, limit, results: rows.map((r) => presentRow(r, fields, {}, { includeHidden })) };
}

/** Distinct values of one field with counts, most common first. */
export function facets(db, key, { limit = 200 } = {}) {
  const rows = db
    .prepare(
      `SELECT trim(json_extract(data, ?)) AS value, count(*) AS count FROM books
       WHERE trim(coalesce(json_extract(data, ?), '')) <> ''
       GROUP BY lower(trim(json_extract(data, ?)))
       ORDER BY count DESC, value LIMIT ?`
    )
    .all(jsonPath(key), jsonPath(key), jsonPath(key), limit);
  return rows.map((r) => ({ value: String(r.value), count: r.count }));
}

export function libraryStats(db) {
  const fields = listFields(db);
  const roles = roleMap(fields);
  const books = db.prepare("SELECT count(*) AS n FROM books").get().n;
  let available = null;
  if (roles.availability) {
    available = db
      .prepare(
        `SELECT count(*) AS n FROM books WHERE lower(trim(json_extract(data, ?))) IN ('yes','true','1','y','available')`
      )
      .get(jsonPath(roles.availability)).n;
  }
  const categories = roles.category
    ? db
        .prepare(
          `SELECT count(DISTINCT lower(trim(json_extract(data, ?)))) AS n FROM books WHERE trim(coalesce(json_extract(data, ?), '')) <> ''`
        )
        .get(jsonPath(roles.category), jsonPath(roles.category)).n
    : null;
  return { books, available, categories };
}
