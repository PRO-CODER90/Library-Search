import { useCallback, useEffect, useState } from "react";
import { formatDate } from "../components/ui.jsx";
import { useAdmin } from "./AdminApp.jsx";
import { Confirm, useToast } from "./parts.jsx";

const EMPTY = { title: "", body: "", kind: "UPDATE" };

export default function Notices() {
  const { call } = useAdmin();
  const toast = useToast();
  const [notices, setNotices] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(() => call("/api/notices").then(setNotices), [call]);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      await call("/api/notices", { method: "POST", body: form });
      setForm(EMPTY);
      toast("Update posted.");
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(n) {
    try {
      await call(`/api/notices/${n.id}`, { method: "DELETE" });
      toast("Update deleted.");
      load();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  return (
    <section>
      <form className="card form" onSubmit={submit}>
        <h2>Post an update</h2>
        <div className="form-grid">
          <div className="field field-wide">
            <label htmlFor="n-title">Title</label>
            <input id="n-title" required maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="n-kind">Badge</label>
            <input id="n-kind" list="kinds" maxLength={24} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} />
            <datalist id="kinds">
              <option value="UPDATE" />
              <option value="NEW ARRIVAL" />
              <option value="NOTICE" />
              <option value="EVENT" />
            </datalist>
          </div>
          <div className="field field-wide">
            <label htmlFor="n-body">Message</label>
            <textarea id="n-body" rows={3} maxLength={2000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </div>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button">
          Post update
        </button>
      </form>

      <h2 className="section-title">Posted updates</h2>
      <ul className="notices">
        {notices.map((n) => (
          <li className="notice" key={n.id}>
            <p className="update-meta">
              <span className="pill">{n.kind || "UPDATE"}</span>
              <time dateTime={n.createdAt}>{formatDate(n.createdAt)}</time>
            </p>
            <h3>{n.title}</h3>
            {n.body && <p>{n.body}</p>}
            <button type="button" className="button button-small button-danger" onClick={() => setDeleting(n)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
      {deleting && (
        <Confirm
          title="Delete this update?"
          body={`“${deleting.title}” will no longer be shown to visitors.`}
          confirmLabel="Delete"
          onConfirm={() => remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </section>
  );
}
