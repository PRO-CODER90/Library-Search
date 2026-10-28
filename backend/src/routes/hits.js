// Public visit counter ("Hit count" under the search box). The browser posts
// once per page load; the number always comes from the server.

import { HttpError } from "../http.js";
import { HitStoreUnavailable } from "../services/hitStore.js";

export function registerHitRoutes(router, { hits }) {
  async function run(fn) {
    try {
      return { total: await fn() };
    } catch (error) {
      if (error instanceof HitStoreUnavailable || error?.name === "TypeError") {
        throw new HttpError(503, "The hit counter is not available right now.");
      }
      throw error;
    }
  }

  router.add("GET", "/api/visits", () => run(() => hits.getHits()));
  router.add("POST", "/api/visit", () => run(() => hits.incrementHits()), { rateLimit: "hits" });
}
