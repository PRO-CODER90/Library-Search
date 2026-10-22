import { useCallback, useEffect, useState } from "react";
import { toQuery } from "../api.js";
import { useDebounced } from "../hooks.js";
import { buildSchema, titleOf } from "../schema.jsx";
import { useAdmin } from "./AdminApp.jsx";
import { Confirm, Dialog, useToast } from "./parts.jsx";

const PAGE_SIZE = 50;
const PLACEHOLDER = "location_is_placeholder";
const CHIPS = [
  ["", "All"],
  ["placeholder", "Needs real location"],
  ["missing", "Missing author"],
  ["duplicates", "Duplicates"],
];
const CHIP_QUERY = { placeholder: { [PLACEHOLDER]: "true" }, missing: { missing: "author" }, duplicates: { duplicates: "1" } };

function BookForm({ book, schema, onSaved, onClose }) {
  const { call } = useAdmin();
  const editable = schema.fields.filter((f) => !f.hidden);
  const [values, setValues] = useState(() => Object.fromEntries(editable.map((f) => [f.key, book?.data[f.key] ?? ""])));
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
      onSaved(await call(book ? `/api/books/${book.id}` : "/api/books", { method: book ? "PUT" : "POST", body }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={book ? "Edit book" : "Add a book"} onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
        {book?.data[PLACEHOLDER] === "true" && <p className="placeholder-note">The location is a placeholder. Changing Floor, Rack or Shelf makes it real.</p>}
        <div className="form-grid">
          {editable.map((f) => (
            <div className={`field${f.role === "title" ? " field-wide" : ""}`} key={f.key}>
              <label htmlFor={`f-${f.key}`}>
                {f.label}
                {f.key === titleKey && <span className="req"> *</span>}
              </label>
              <input id={`f-${f.key}`} value={values[f.key]} required={f.key === titleKey} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
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

async function download(path, fallback) {
  const response = await fetch(path, { credentials: "same-origin" });
  if (!response.ok) throw new Error("Download failed.");
  const blob = await response.blob();
  const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? fallback;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/** Inline Floor/Rack/Shelf editor for one row; saves on Enter or blur. */
function LocationCells({ book, locationFields, onSave }) {
  const [values, setValues] = useState(() => Object.fromEntries(locationFields.map((f) => [f.key, book.data[f.key] ?? ""])));
  useEffect(() => setValues(Object.fromEntries(locationFields.map((f) => [f.key, book.data[f.key] ?? ""]))), [book, locationFields]);
  const dirty = locationFields.some((f) => (values[f.key] ?? "") !== (book.data[f.key] ?? ""));
  const save = () => dirty && onSave(book, values);
  return locationFields.map((f) => (
    <td key={f.key} className="loc-cell">
      <input
        className="inline-input loc-input"
        aria-label={`${f.label} for ${book.data.title ?? book.id}`}
        value={values[f.key]}
        onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </td>
  ));
}

export default function Books() {
  const { call } = useAdmin();
  const toast = useToast();
  const [schema, setSchema] = useState(null);
  const [filter, setFilter] = useState("");
  const [chip, setChip] = useState("");
  const q = useDebounced(filter.trim(), 200);
  const [list, setList] = useState({ items: [], total: 0, page: 0, error: null });
  const [selected, setSelected] = useState(new Set());
  const [bulk, setBulk] = useState({});
  const [dialog, setDialog] = useState(null);

  const loadSchema = useCallback(() => call("/api/fields").then(({ fields }) => setSchema(buildSchema(fields))), [call]);
  const load = useCallback(
    async (page = 1) => {
      try {
        const extra = CHIP_QUERY[chip] ?? {};
        const path = q ? `/api/search${toQuery({ q, page, limit: PAGE_SIZE })}` : `/api/books${toQuery({ ...extra, page, limit: PAGE_SIZE })}`;
        const data = await call(path);
        let items = data.results;
        if (q && chip === "placeholder") items = items.filter((b) => b.data[PLACEHOLDER] === "true");
        setList((s) => ({ items: page === 1 ? items : [...s.items, ...items], total: data.total, page, error: null }));
        if (page === 1) setSelected(new Set());
      } catch (error) {
        setList((s) => ({ ...s, error }));
      }
    },
    [call, q, chip]
  );
  useEffect(() => {
    loadSchema().catch(() => {});
  }, [loadSchema]);
  useEffect(() => {
    load(1);
  }, [load]);

  async function setLocation(ids, values) {
    try {
      const { updated } = await call("/api/books/location", { method: "PATCH", body: { ids, values } });
      toast(`Location saved for ${updated} book${updated === 1 ? "" : "s"}.`);
      load(1);
    } catch (error) {
      toast(error.message, "error");
    }
  }
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
  const { author } = schema.role;
  const second = schema.fields.find((f) => f.key === "second_author_full_name");
  const locationFields = schema.fields.filter((f) => f.is_location);
  const allSelected = list.items.length > 0 && list.items.every((b) => selected.has(b.id));
  const toggle = (id) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section>
      <div className="toolbar">
        <label htmlFor="filter" className="visually-hidden">
          Search books
        </label>
        <input id="filter" type="search" placeholder="Search books…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button type="button" className="button button-ghost" onClick={() => download("/api/export", "library.csv").catch((e) => toast(e.message, "error"))}>
          Export CSV
        </button>
        <button type="button" className="button button-ghost" onClick={() => download("/api/export?format=xlsx", "library.xlsx").catch((e) => toast(e.message, "error"))}>
          Export Excel
        </button>
        <button type="button" className="button" onClick={() => setDialog({ type: "edit", book: null })}>
          Add book
        </button>
      </div>
      <div className="chips" role="group" aria-label="Filter books">
        {CHIPS.map(([key, label]) => (
          <button key={key} type="button" className={`chip${chip === key ? " is-on" : ""}`} aria-pressed={chip === key} onClick={() => setChip(key)}>
            {label}
          </button>
        ))}
      </div>

      {selected.size > 0 && locationFields.length > 0 && (
        <form
          className="bulk-bar"
          onSubmit={(e) => {
            e.preventDefault();
            setLocation([...selected], bulk);
          }}
        >
          <strong>{selected.size} selected:</strong>
          {locationFields.map((f) => (
            <label key={f.key}>
              <span className="visually-hidden">{f.label}</span>
              <input className="inline-input loc-input" placeholder={f.label} value={bulk[f.key] ?? ""} onChange={(e) => setBulk({ ...bulk, [f.key]: e.target.value })} />
            </label>
          ))}
          <button type="submit" className="button button-small">
            Set location
          </button>
        </form>
      )}

      <p className="status" aria-live="polite">
        {list.total.toLocaleString()} {list.total === 1 ? "book" : "books"}
      </p>
      {list.error && <p className="form-error">{list.error.message}</p>}
      <div className="table-wrap">
        <table className="table books-table">
          <thead>
            <tr>
              <th scope="col">
                <input type="checkbox" aria-label="Select all on this page" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(list.items.map((b) => b.id)))} />
              </th>
              <th scope="col">Book</th>
              {locationFields.map((f) => (
                <th scope="col" key={f.key}>
                  {f.label}
                </th>
              ))}
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((b) => (
              <tr key={b.id}>
                <td>
                  <input type="checkbox" aria-label={`Select ${titleOf(b.data, schema)}`} checked={selected.has(b.id)} onChange={() => toggle(b.id)} />
                </td>
                <td>
                  <button type="button" className="table-title link-button" onClick={() => setDialog({ type: "edit", book: b })}>
                    {titleOf(b.data, schema)}
                  </button>
                  <span className="muted">{[author, second].filter((f) => f && b.data[f.key]).map((f) => b.data[f.key]).join(" · ")}</span>
                  {b.data[PLACEHOLDER] === "true" && <span className="tag tag-placeholder">Placeholder</span>}
                </td>
                <LocationCells book={b} locationFields={locationFields} onSave={(book, values) => setLocation([book.id], values)} />
                <td className="table-actions">
                  <button type="button" className="button button-small button-ghost" onClick={() => setDialog({ type: "edit", book: b })} aria-label={`Edit ${titleOf(b.data, schema)}`}>
                    ✎ Edit
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
          body="The whole catalogue will be emptied. Export first if you might need it."
          confirmLabel="Delete all books"
          typeToConfirm="DELETE"
          onConfirm={wipe}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}
