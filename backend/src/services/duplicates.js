// Duplicate books: the match key, grouping for the admin review screen, and
// merge / keep-as-copies / ignore / delete with a 30-day undo history.
//
// Match key: a unique identifier when the file has one (entity_id), else
// Title + First Author, normalised so "Sharma, Sanjay" = "Sanjay Sharma" =
// "Sharma S." (the author part is the sorted initials of the name).

import { randomBytes } from "node:crypto";
import { transaction } from "../db.js";
import { indexRecord, listFields, locationOf } from "./fieldRegistry.js";
import { LOCATION_KEYS, PLACEHOLDER_KEY } from "./placeholder.js";

const ARTICLES = new Set(["the", "a", "an"]);

/** Lowercase, no accents or punctuation, single spaces, no leading "the/a/an". */
export function normalizeTitle(text) {
  const words = String(text ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  while (words.length > 1 && ARTICLES.has(words[0])) words.shift();
  return words.join(" ");
}

/** Order- and initials-tolerant author signature: sorted first letters of each name part. */
export function authorSignature(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean)
    .map((part) => part[0])
    .sort()
    .join("");
}

/** The duplicate key of one record ("" when it has no title). */
export function dupKey(data, { titleKey, authorKey }) {
  const id = String(data.entity_id ?? "").trim().toLowerCase();
  if (id) return `id:${id}`;
  const title = normalizeTitle(titleKey ? data[titleKey] : "");
  if (!title) return "";
  return `ta:${title}|${authorSignature(authorKey ? data[authorKey] : "")}`;
}

export const roleKeys = (fields) => ({
  titleKey: fields.find((f) => f.active !== false && f.role === "title")?.key,
  authorKey: fields.find((f) => f.active !== false && f.role === "author")?.key,
});

const locationSig = (data) => LOCATION_KEYS.map((k) => String(data[k] ?? "").trim().toLowerCase()).join("/");
const hasLocation = (data) => LOCATION_KEYS.some((k) => String(data[k] ?? "").trim() !== "");

/** Is the incoming row the same copy as the stored one? Blank location counts as the same place. */
export function sameCopy(incoming, stored) {
  if (!hasLocation(incoming)) return true;
  if (incoming[PLACEHOLDER_KEY] === "true") return true; // generated, not real
  return locationSig(incoming) === locationSig(stored);
}

function ignoredKeys(db) {
  return new Set(db.prepare("SELECT key FROM duplicate_ignores").all().map((r) => r.key));
}

/**
 * Groups of rows sharing a key. level "exact" = same place everywhere,
 * "place" = same book on different shelves. "possible" = same title with a
 * different or missing author (a hint only).
 */
export function findDuplicates(db) {
  const fields = listFields(db, { includeInactive: true });
  const roles = roleKeys(fields);
  const ignored = ignoredKeys(db);
  const byKey = new Map();
  const byTitle = new Map();
  for (const row of db.prepare("SELECT row_id, data, created_at FROM books ORDER BY row_id").iterate()) {
    const data = JSON.parse(row.data);
    const key = dupKey(data, roles);
    if (!key) continue;
    const item = { id: row.row_id, data, createdAt: row.created_at, ...locationOf(data, fields) };
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(item);
    const title = normalizeTitle(roles.titleKey ? data[roles.titleKey] : "");
    if (title) {
      if (!byTitle.has(title)) byTitle.set(title, new Map());
      byTitle.get(title).set(key, item);
    }
  }
  const groups = [];
  for (const [key, rows] of byKey) {
    if (rows.length < 2 || ignored.has(key)) continue;
    const places = new Set(rows.map((r) => locationSig(r.data)));
    groups.push({ key, level: places.size === 1 ? "exact" : "place", rows });
  }
  const possible = [];
  for (const [title, keys] of byTitle) {
    if (keys.size < 2 || ignored.has(`title:${title}`)) continue;
    possible.push({ key: `title:${title}`, level: "possible", rows: [...keys.values()] });
  }
  groups.sort((a, b) => (a.level === b.level ? b.rows.length - a.rows.length : a.level === "exact" ? -1 : 1));
  return {
    groups,
    possible,
    summary: { groups: groups.length, books: groups.reduce((n, g) => n + g.rows.length, 0), exact: groups.filter((g) => g.level === "exact").length },
  };
}

/** Other copies of a book (same key), for the public book page. */
export function copiesOf(db, id) {
  const fields = listFields(db, { includeInactive: true });
  const roles = roleKeys(fields);
  const row = db.prepare("SELECT data FROM books WHERE row_id = ?").get(id);
  if (!row) return [];
  const key = dupKey(JSON.parse(row.data), roles);
  if (!key) return [];
  const out = [];
  for (const other of db.prepare("SELECT row_id, data FROM books WHERE row_id != ?").iterate(id)) {
    const data = JSON.parse(other.data);
    if (dupKey(data, roles) === key) out.push({ id: other.row_id, ...locationOf(data, fields) });
  }
  return out;
}

// ---- actions with undo ----------------------------------------------------

const newActionId = () => randomBytes(9).toString("base64url");

function snapshot(db, actionId, kind, ids) {
  const get = db.prepare("SELECT row_id, data, dataset_id, created_at FROM books WHERE row_id = ?");
  const put = db.prepare("INSERT INTO book_history (action_id, kind, row_id, data, dataset_id, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  for (const id of ids) {
    const r = get.get(id);
    if (r) put.run(actionId, kind, r.row_id, r.data, r.dataset_id, r.created_at);
  }
}

function prune(db) {
  db.prepare("DELETE FROM book_history WHERE at < datetime('now', '-30 days')").run();
}

/** Merge rows into `keepId`: non-empty beats empty, a real location beats a temporary one. */
export function mergeBooks(db, keepId, removeIds) {
  const ids = [...new Set(removeIds.map(Number))].filter((id) => id !== Number(keepId));
  if (!ids.length) throw new Error("Choose at least one other book to merge.");
  return transaction(db, () => {
    prune(db);
    const read = db.prepare("SELECT data FROM books WHERE row_id = ?");
    const keep = read.get(keepId);
    if (!keep) throw new Error("The book to keep no longer exists.");
    const actionId = newActionId();
    snapshot(db, actionId, "update", [keepId]);
    snapshot(db, actionId, "delete", ids);
    let merged = JSON.parse(keep.data);
    for (const id of ids) {
      const other = read.get(id);
      if (!other) continue;
      const data = JSON.parse(other.data);
      const keepTemporary = merged[PLACEHOLDER_KEY] === "true";
      const otherReal = data[PLACEHOLDER_KEY] !== "true" && hasLocation(data);
      for (const [k, v] of Object.entries(data)) {
        if (LOCATION_KEYS.includes(k) || k === PLACEHOLDER_KEY) continue;
        if (String(merged[k] ?? "").trim() === "" && String(v ?? "").trim() !== "") merged[k] = v;
      }
      if (keepTemporary && otherReal) {
        for (const k of LOCATION_KEYS) if (data[k] !== undefined) merged[k] = data[k];
        merged[PLACEHOLDER_KEY] = "";
      }
    }
    const fields = listFields(db);
    const { search_text, title_text } = indexRecord(merged, fields);
    db.prepare("UPDATE books SET data = ?, search_text = ?, title_text = ?, updated_at = CURRENT_TIMESTAMP WHERE row_id = ?").run(
      JSON.stringify(merged),
      search_text,
      title_text,
      keepId
    );
    const del = db.prepare("DELETE FROM books WHERE row_id = ?");
    for (const id of ids) del.run(id);
    return { actionId, kept: Number(keepId), removed: ids.length };
  });
}

/** Merge every exact group into its oldest row. */
export function mergeAllExact(db) {
  const { groups } = findDuplicates(db);
  const exact = groups.filter((g) => g.level === "exact");
  return transaction(db, () => {
    const actionId = newActionId();
    let removed = 0;
    for (const g of exact) {
      const [keep, ...rest] = g.rows;
      snapshot(db, actionId, "delete", rest.map((r) => r.id));
      const del = db.prepare("DELETE FROM books WHERE row_id = ?");
      for (const r of rest) del.run(r.id);
      removed += rest.length;
      if (keep && rest.some((r) => r.data[PLACEHOLDER_KEY] !== "true") && keep.data[PLACEHOLDER_KEY] === "true") {
        // all exact copies share a place; if any was verified, the kept one is too
        const data = { ...keep.data, [PLACEHOLDER_KEY]: "" };
        db.prepare("UPDATE books SET data = ? WHERE row_id = ?").run(JSON.stringify(data), keep.id);
      }
    }
    return { actionId, groups: exact.length, removed };
  });
}

/** Delete some books (kept 30 days for undo). */
export function deleteBooks(db, ids) {
  return transaction(db, () => {
    prune(db);
    const actionId = newActionId();
    snapshot(db, actionId, "delete", ids);
    const del = db.prepare("DELETE FROM books WHERE row_id = ?");
    let removed = 0;
    for (const id of ids) removed += Number(del.run(Number(id)).changes);
    return { actionId, removed };
  });
}

/** Remember a group as real copies or as not-a-duplicate, so it is not flagged again. */
export function resolveGroup(db, key, kind) {
  if (!["copies", "ignore"].includes(kind)) throw new Error("kind must be copies or ignore.");
  db.prepare("INSERT INTO duplicate_ignores (key, kind) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET kind = excluded.kind").run(key, kind);
  return { key, kind };
}

/** Put back everything an action removed or changed. */
export function undoAction(db, actionId) {
  return transaction(db, () => {
    const rows = db.prepare("SELECT * FROM book_history WHERE action_id = ?").all(actionId);
    if (!rows.length) throw new Error("Nothing to undo (it may be older than 30 days).");
    const fields = listFields(db);
    for (const r of rows) {
      const { search_text, title_text } = indexRecord(JSON.parse(r.data), fields);
      if (r.kind === "delete") {
        db.prepare(
          "INSERT OR REPLACE INTO books (row_id, data, search_text, title_text, dataset_id, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(r.row_id, r.data, search_text, title_text, r.dataset_id, r.created_at);
      } else {
        db.prepare("UPDATE books SET data = ?, search_text = ?, title_text = ?, updated_at = CURRENT_TIMESTAMP WHERE row_id = ?").run(
          r.data,
          search_text,
          title_text,
          r.row_id
        );
      }
    }
    db.prepare("DELETE FROM book_history WHERE action_id = ?").run(actionId);
    return { restored: rows.length };
  });
}

/** "This location is correct": clear the temporary flag (given ids, or every book). */
export function verifyLocations(db, ids, all = false) {
  return transaction(db, () => {
    const rows = all
      ? db.prepare("SELECT row_id, data FROM books").all()
      : ids.map((id) => db.prepare("SELECT row_id, data FROM books WHERE row_id = ?").get(Number(id))).filter(Boolean);
    const put = db.prepare("UPDATE books SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE row_id = ?");
    let verified = 0;
    for (const r of rows) {
      const data = JSON.parse(r.data);
      if (data[PLACEHOLDER_KEY] !== "true") continue;
      data[PLACEHOLDER_KEY] = "";
      put.run(JSON.stringify(data), r.row_id);
      verified++;
    }
    return { verified };
  });
}
