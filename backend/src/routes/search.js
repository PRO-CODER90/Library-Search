import { HttpError, intParam } from "../http.js";
import { search, suggest } from "../services/searchEngine.js";

export function registerSearchRoutes(router, { db, auth }) {
  router.add(
    "GET",
    "/api/search",
    ({ req, url }) => {
      const p = url.searchParams;
      const q = p.get("q") ?? "";
      if (q.length > 200) throw new HttpError(400, "Search text is too long (200 characters max).");
      const fields = (p.get("fields") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      return search(db, {
        q,
        fields,
        page: intParam(p.get("page"), 1, 1, 100000),
        limit: intParam(p.get("limit"), 20, 1, 100),
        includeHidden: Boolean(auth.session(req)),
      });
    },
    { rateLimit: "search" }
  );

  // Live title chips: every match (safety ceiling 5,000) in one light response.
  router.add(
    "GET",
    "/api/suggest",
    ({ url }) => {
      const q = url.searchParams.get("q") ?? "";
      if (q.length > 200) throw new HttpError(400, "Search text is too long (200 characters max).");
      return suggest(db, { q });
    },
    { rateLimit: "search" }
  );
}
