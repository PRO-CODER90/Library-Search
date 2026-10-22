import { HttpError, readJson } from "../http.js";

function cleanNotice(input) {
  const title = String(input?.title ?? "").replace(/\s+/g, " ").trim();
  const body = String(input?.body ?? "").trim();
  const kind = String(input?.kind ?? "").replace(/\s+/g, " ").trim().toUpperCase().slice(0, 24) || "UPDATE";
  const fields = {};
  if (!title) fields.title = "Required.";
  else if (title.length > 120) fields.title = "At most 120 characters.";
  if (body.length > 2000) fields.body = "At most 2000 characters.";
  if (Object.keys(fields).length) throw new HttpError(422, "Please fix the highlighted fields.", fields);
  return { title, body, kind };
}

export function registerNoticeRoutes(router, { db, audit }) {
  const list = () => db.prepare("SELECT id, title, body, kind, created_at AS createdAt FROM notices ORDER BY created_at DESC, id DESC").all();

  router.add("GET", "/api/notices", () => list());

  router.add(
    "POST",
    "/api/notices",
    async ({ req }) => {
      const { title, body, kind } = cleanNotice(await readJson(req));
      const id = Number(db.prepare("INSERT INTO notices (title, body, kind) VALUES (?, ?, ?)").run(title, body, kind).lastInsertRowid);
      return { status: 201, body: db.prepare("SELECT id, title, body, kind, created_at AS createdAt FROM notices WHERE id = ?").get(id) };
    },
    { admin: true }
  );

  router.add(
    "DELETE",
    "/api/notices/:id",
    ({ req, params, session }) => {
      if (!db.prepare("DELETE FROM notices WHERE id = ?").run(Number(params.id)).changes) throw new HttpError(404, "Notice not found.");
      audit("delete_notice", req, { username: session.u, noticeId: Number(params.id) });
      return { status: 204 };
    },
    { admin: true }
  );

}
