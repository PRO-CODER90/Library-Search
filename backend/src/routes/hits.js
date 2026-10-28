// Public visit counter shown under the search box ("Hit count").
// The browser posts once per session; reads are free.

const read = (db) => db.prepare("SELECT value FROM counters WHERE name = 'hits'").get()?.value ?? 0;

export function registerHitRoutes(router, { db }) {
  router.add("GET", "/api/hits", () => ({ hits: read(db) }));

  router.add(
    "POST",
    "/api/hits",
    () => {
      db.prepare("INSERT INTO counters (name, value) VALUES ('hits', 1) ON CONFLICT(name) DO UPDATE SET value = value + 1").run();
      return { hits: read(db) };
    },
    { rateLimit: "hits" }
  );
}
