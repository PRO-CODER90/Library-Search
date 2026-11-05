// Admin-only duplicate review: list groups, merge, keep as copies, ignore,
// delete, undo, and mark temporary locations as verified.

import { HttpError, readJson } from "../http.js";
import { deleteBooks, findDuplicates, mergeAllExact, mergeBooks, resolveGroup, undoAction, verifyLocations } from "../services/duplicates.js";

const ids = (value) => {
  if (!Array.isArray(value) || !value.length || value.some((v) => !Number.isInteger(Number(v)))) {
    throw new HttpError(400, "Send a list of book ids.");
  }
  return value.map(Number);
};

export function registerDuplicateRoutes(router, { db, audit }) {
  const admin = { admin: true };
  const body = (req) => readJson(req, 64 * 1024).catch(() => ({}));
  const wrap = (fn) => {
    try {
      return fn();
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, error.message);
    }
  };

  router.add("GET", "/api/duplicates", () => findDuplicates(db), admin);

  router.add(
    "POST",
    "/api/duplicates/merge",
    async ({ req, session }) => {
      const b = await body(req);
      const result = wrap(() => mergeBooks(db, Number(b.keepId), ids(b.removeIds)));
      audit("merge_duplicates", req, { username: session.u, kept: result.kept, removed: result.removed });
      return result;
    },
    admin
  );

  router.add(
    "POST",
    "/api/duplicates/merge-exact",
    ({ req, session }) => {
      const result = mergeAllExact(db);
      audit("merge_all_exact", req, { username: session.u, groups: result.groups, removed: result.removed });
      return result;
    },
    admin
  );

  router.add(
    "POST",
    "/api/duplicates/delete",
    async ({ req, session }) => {
      const b = await body(req);
      const result = wrap(() => deleteBooks(db, ids(b.ids)));
      audit("delete_duplicates", req, { username: session.u, removed: result.removed });
      return result;
    },
    admin
  );

  router.add(
    "POST",
    "/api/duplicates/resolve",
    async ({ req, session }) => {
      const b = await body(req);
      if (typeof b.key !== "string" || !b.key) throw new HttpError(400, "Send the group key.");
      const result = wrap(() => resolveGroup(db, b.key, b.kind));
      audit(`duplicates_${result.kind}`, req, { username: session.u, key: b.key.slice(0, 120) });
      return result;
    },
    admin
  );

  router.add(
    "POST",
    "/api/undo/:actionId",
    ({ req, params, session }) => {
      const result = wrap(() => undoAction(db, params.actionId));
      audit("undo", req, { username: session.u, action: params.actionId });
      return result;
    },
    admin
  );

  router.add(
    "POST",
    "/api/books/verify-location",
    async ({ req, session }) => {
      const b = await body(req);
      const result = b.all === true ? verifyLocations(db, [], true) : verifyLocations(db, ids(b.ids));
      audit("verify_locations", req, { username: session.u, verified: result.verified });
      return result;
    },
    admin
  );
}
