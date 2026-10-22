import { useCallback, useEffect, useState } from "react";
import { toQuery } from "../api.js";
import { useDebounced } from "../hooks.js";
import { buildSchema, titleOf } from "../schema.jsx";
import { useAdmin } from "./AdminApp.jsx";
import { Confirm, Dialog, useToast } from "./parts.jsx";

const PAGE_SIZE = 50;

function BookForm({ book, schema, onSaved, onClose }) {
  const { call } = useAdmin();
  const [values, setValues] = useState(() => Object.fromEntries(schema.fields.map((f) => [f.key, book?.data[f.key] ?? ""])));
  const [extra, setExtra] = useState({ name: "", value: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const titleKey = schema.role.title?.key;

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const body = { ...values };
    if (extra.name.trim()) body[extra.name.trim()] = extra.value;
    try {
      const saved = await call(book ? `/api/books/${book.id}` : "/api/books", { method: book ? "PUT" : "POST", body });
      onSaved(saved);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={book ? "Edit book" : "Add a book"} onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
        <div className="form-grid">
          {schema.fields.map((f) => (
            <div className={`field${f.role === "title" ? " field-wide" : ""}`} key={f.key}>
              <label htmlFor={`f-${f.key}`}>
                {f.label}
                {f.key === titleKey && <span className="req"> *</span>}
              </label>
              <input
                id={`f-${f.key}`}
                value={values[f.key]}
                required={f.key === titleKey}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              />
            </div>
          ))}
        </div>
        <details className="extra-fields">
          <summary>Add a new field</summary>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="x-name">Field name</label>
              <input id="x-name" placeholder="e.g. Donated by" value={extra.name} onChange={(e) => setExtra({ ...extra, name: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="x-value">Value</label>
              <input id="x-value" value={extra.value} onChange={(e) => setExtra({ ...extra, value: e.target.value })} />
            </div>
          </div>
        </details>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button button-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={busy}>
            {book ? "Save changes" : "Add book"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

async function downloadExport() {
  const response = await fetch("/api/export", { credentials: "same-origin" });
  if (!response.ok) throw new Error("Export failed.");
  const blob = await response.blob();
  const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "library.csv";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export default function Books() {
  const { call } = useAdmin();
  const toast = useToast();
  const [schema, setSchema] = useState(null);
  const [filter, setFilter] = useState("");
  const q = useDebounced(filter.trim(), 200);
  const [list, setList] = useState({ items: [], total: 0, page: 0, error: null });
  const [dialog, setDialog] = useState(null);

  const loadSchema = useCallback(() => call("/api/fields").then(({ fields }) => setSchema(buildSchema(fields))), [call]);
  const load = useCallback(
    async (page = 1) => {
      try {
        const path = q ? `/api/search${toQuery({ q, page, limit: PAGE_SIZE })}` : `/api/books${toQuery({ page, limit: PAGE_SIZE })}`;
        const data = await call(path);
        setList((s) => ({ items: page === 1 ? data.results : [...s.items, ...data.results], total: data.total, page, error: null }));
      } catch (error) {
        setList((s) => ({ ...s, error }));
      }
    },
    [call, q]
  );
  useEffect(() => {
    loadSchema().catch(() => {});
  }, [loadSchema]);
  useEffect(() => {
    load(1);
  }, [load]);

  async function remove(book) {
    try {
      await call(`/api/books/${book.id}`, { method: "DELETE" });
      toast("Book deleted.");
      load(1);
    } catch (error) {
      toast(error.message, "error");
    }
  }
  async function wipe() {
    try {
      const { deleted } = await call("/api/books?confirm=yes", { method: "DELETE" });
      toast(`Deleted ${deleted} books.`);
      load(1);
    } catch (error) {
      toast(error.message, "error");
    }
  }

  if (!schema) return <div className="page-loading" aria-busy="true" />;
  const { author, category } = schema.role;

  return (
    <section>
      <div className="toolbar">
        <label htmlFor="filter" className="visually-hidden">
          Search books
        </label>
        <input id="filter" type="search" placeholder="Search books…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button type="button" className="button button-ghost" onClick={() => downloadExport().catch((e) => toast(e.message, "error"))}>
          Export CSV
        </button>
        <button type="button" className="button" onClick={() => setDialog({ type: "edit", book: null })}>
          Add book
        </button>
      </div>
      <p className="status" aria-live="polite">
        {list.total.toLocaleString()} {list.total === 1 ? "book" : "books"}
      </p>
      {list.error && <p className="form-error">{list.error.message}</p>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Book</th>
              <th scope="col">Location</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((b) => (
              <tr key={b.id}>
                <td>
                  <a className="table-title" href={`/book/${b.id}`} target="_blank" rel="noreferrer">
                    {titleOf(b.data, schema)}
                  </a>
                  <span className="muted">{[author, category].filter((f) => f && b.data[f.key]).map((f) => b.data[f.key]).join(" · ")}</span>
                </td>
                <td>{b.location || "—"}</td>
                <td className="table-actions">
                  <button type="button" className="button button-small button-ghost" onClick={() => setDialog({ type: "edit", book: b })}>
                    Edit
                  </button>
                  <button type="button" className="button button-small button-danger" onClick={() => setDialog({ type: "delete", book: b })}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.items.length < list.total && (
        <div className="more">
          <button type="button" className="button button-ghost" onClick={() => load(list.page + 1)}>
            Show more
          </button>
        </div>
      )}

      <section className="danger-zone">
        <h2>Start over</h2>
        <p className="muted">Delete every book before loading a new catalogue. Fields and updates are kept.</p>
        <button type="button" className="button button-danger" onClick={() => setDialog({ type: "wipe" })}>
          Delete all books…
        </button>
      </section>

      {dialog?.type === "edit" && (
        <BookForm
          book={dialog.book}
          schema={schema}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            setDialog(null);
            toast(`${dialog.book ? "Saved" : "Added"} “${titleOf(saved.data, schema)}”.`);
            if (saved.newFields?.length) loadSchema();
            load(1);
          }}
        />
      )}
      {dialog?.type === "delete" && (
        <Confirm
          title="Delete this book?"
          body={`“${titleOf(dialog.book.data, schema)}” will be removed from the catalogue.`}
          confirmLabel="Delete"
          onConfirm={() => remove(dialog.book)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === "wipe" && (
        <Confirm
          title="Delete every book?"
          body="The whole catalogue will be emptied. Export a CSV first if you might need it."
          confirmLabel="Delete all books"
          typeToConfirm="DELETE"
          onConfirm={wipe}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}
