import { HttpError, readJson } from "../http.js";
import { listFields, rebuildIndex, updateField, validRole } from "../services/fieldRegistry.js";
import { transaction } from "../db.js";

export function registerFieldRoutes(router, { db, auth }) {
  // Active fields for everyone. A signed-in admin can add ?all=true to include
  // removed ones; for anyone else the parameter is ignored.
  router.add("GET", "/api/fields", ({ req, url }) => {
    const all = url.searchParams.get("all") === "true" && Boolean(auth.session(req));
    return { fields: listFields(db, { includeInactive: all }) };
  });

  router.add(
    "PATCH",
    "/api/fields/:key",
    async ({ req, params }) => {
      const patch = await readJson(req);
      if (patch.role !== undefined && !validRole(patch.role)) {
        throw new HttpError(422, "role must be title, author, category, availability or empty.");
      }
      const result = transaction(db, () => {
        const updated = updateField(db, params.key, patch);
        if (updated?.reindex) rebuildIndex(db);
        return updated;
      });
      if (!result) throw new HttpError(404, `No field called “${params.key}”.`);
      return { field: result.field, reindexed: result.reindex, fields: listFields(db) };
    },
    { admin: true }
  );
}
