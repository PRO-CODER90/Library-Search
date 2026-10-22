import { HttpError, intParam } from "../http.js";
import { search } from "../services/searchEngine.js";

export function registerSearchRoutes(router, { db }) {
  router.add(
    "GET",
    "/api/search",
    ({ url }) => {
      const p = url.searchParams;
      const q = p.get("q") ?? "";
      if (q.length > 200) throw new HttpError(400, "Search text is too long (200 characters max).");
      const fields = (p.get("fields") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      return search(db, {
        q,
        fields,
        page: intParam(p.get("page"), 1, 1, 100000),
        limit: intParam(p.get("limit"), 20, 1, 100),
      });
    },
    { rateLimit: "search" }
  );
}
