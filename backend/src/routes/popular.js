// "Popular Searches": the most frequent searches, live. The browser reports a
// search when a visitor opens a result; only searches that find books count.

import { HttpError, intParam, readJson } from "../http.js";
import { suggest } from "../services/searchEngine.js";

const clean = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

export function registerPopularRoutes(router, { db }) {
  const bump = db.prepare(`
    INSERT INTO search_log (query, display, count) VALUES (?, ?, 1)
    ON CONFLICT(query) DO UPDATE SET count = count + 1,
      -- keep a capitalised label ("Harry Potter") over an all-lowercase one
      display = CASE WHEN excluded.display <> lower(excluded.display) THEN excluded.display ELSE display END,
      last_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`);

  router.add(
    "POST",
    "/api/searches",
    async ({ req }) => {
      let body;
      try {
        body = await readJson(req, 1024);
      } catch {
        throw new HttpError(400, "Send { q }.");
      }
      const display = clean(body?.q);
      if (display.length < 2 || display.length > 60) throw new HttpError(400, "Search must be 2–60 characters.");
      if (!suggest(db, { q: display, ceiling: 1 }).total) return { counted: false }; // no books: not popular
      bump.run(display.toLowerCase(), display);
      return { counted: true };
    },
    { rateLimit: "searches" }
  );

  router.add("GET", "/api/searches/popular", ({ url, res }) => {
    res.setHeader("Cache-Control", "no-store");
    const limit = intParam(url.searchParams.get("limit"), 3, 1, 10);
    const rows = db.prepare("SELECT display, count FROM search_log ORDER BY count DESC, last_at DESC LIMIT ?").all(limit);
    return { items: rows.map((r) => ({ q: r.display, count: r.count })) };
  });
}
