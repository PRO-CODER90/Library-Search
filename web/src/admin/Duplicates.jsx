// Admin → Books → Duplicates: groups of books that look the same, with
// Keep as copies / Merge into one / Keep one, delete others / Not a duplicate,
// and Undo after every change.

import { useCallback, useEffect, useState } from "react";
import { titleOf } from "../schema.jsx";
import { useAdmin } from "./AdminApp.jsx";
import { Confirm, useToast } from "./parts.jsx";

const PLACEHOLDER = "location_is_placeholder";
const LEVELS = [
  ["", "All"],
  ["exact", "Exact"],
  ["place", "Different place"],
  ["possible", "Possible"],
];
const LEVEL_TEXT = {
  exact: "Exact duplicate: same book, same place",
  place: "Same book on different shelves",
  possible: "Possible: same title, different author",
};

const place = (row) => row.locationParts.map((p) => p.value).join(" / ") || "—";
const when = (t) => (t ? new Date(`${String(t).replace(" ", "T")}Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");

function Group({ group, schema, onAction, onEdit }) {
  const [master, setMaster] = useState(group.rows[0].id);
  const author = schema.role.author;
  const places = new Set(group.rows.map(place));
  const authors = new Set(group.rows.map((r) => (author ? r.data[author.key] ?? "" : "")));
  const others = group.rows.filter((r) => r.id !== master).map((r) => r.id);
  return (
    <article className={`dup-group dup-${group.level}`}>
      <header className="dup-head">
        <h3>{titleOf(group.rows[0].data, schema)}</h3>
        <span className="dup-level">{LEVEL_TEXT[group.level]}</span>
      </header>
      <div className="table-wrap">
        <table className="table dup-table">
          <thead>
            <tr>
              <th scope="col">Keep</th>
              <th scope="col">Author</th>
              <th scope="col">Floor / Rack / Shelf</th>
              <th scope="col">Added</th>
              <th scope="col">
                <span className="visually-hidden">Edit</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {group.rows.map((r) => (
              <tr key={r.id} className={r.id === master ? "is-master" : undefined}>
                <td>
                  <input type="radio" name={`master-${group.key}`} aria-label={`Keep book ${r.id}`} checked={r.id === master} onChange={() => setMaster(r.id)} />
                </td>
                <td className={authors.size > 1 ? "is-diff" : undefined}>{author ? r.data[author.key] : ""}</td>
                <td className={places.size > 1 ? "is-diff" : undefined}>
                  {place(r)}
                  {r.data[PLACEHOLDER] === "true" && <span className="tag tag-placeholder tag-small">Temporary</span>}
                </td>
                <td>{when(r.createdAt)}</td>
                <td>
                  <button type="button" className="link-button" onClick={() => onEdit(r)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="dup-actions">
        {group.level !== "possible" && (
          <>
            <button type="button" className="button button-small button-ghost" onClick={() => onAction("copies", group)}>
              Keep as copies
            </button>
            <button type="button" className="button button-small" onClick={() => onAction("merge", group, { keepId: master, removeIds: others })}>
              Merge into one
            </button>
            <button type="button" className="button button-small button-danger" onClick={() => onAction("delete", group, { ids: others })}>
              Keep one, delete others
            </button>
          </>
        )}
        <button type="button" className="button button-small button-ghost" onClick={() => onAction("ignore", group)}>
          Not a duplicate
        </button>
      </div>
    </article>
  );
}

export default function DuplicatesReview({ schema, version, onEdit, onChanged }) {
  const { call } = useAdmin();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [level, setLevel] = useState("");
  const [undo, setUndo] = useState(null); // { actionId, text }
  const [confirmAll, setConfirmAll] = useState(false);

  const load = useCallback(() => {
    call("/api/duplicates")
      .then(setData)
      .catch((error) => toast(error.message, "error"));
  }, [call, toast]);
  useEffect(() => {
    load();
  }, [load, version]);

  async function act(kind, group, body) {
    try {
      let result;
      if (kind === "copies" || kind === "ignore") {
        result = await call("/api/duplicates/resolve", { method: "POST", body: { key: group.key, kind } });
        toast(kind === "copies" ? "Kept as separate copies." : "Marked as not a duplicate.");
      } else if (kind === "merge") {
        result = await call("/api/duplicates/merge", { method: "POST", body });
        setUndo({ actionId: result.actionId, text: `Merged ${result.removed + 1} books into one.` });
      } else if (kind === "delete") {
        result = await call("/api/duplicates/delete", { method: "POST", body });
        setUndo({ actionId: result.actionId, text: `Deleted ${result.removed} duplicate${result.removed === 1 ? "" : "s"}.` });
      }
      load();
      onChanged?.();
    } catch (error) {
      toast(error.message, "error");
    }
  }
  async function mergeAllExact() {
    try {
      const result = await call("/api/duplicates/merge-exact", { method: "POST" });
      setUndo({ actionId: result.actionId, text: `Merged ${result.groups} exact groups (${result.removed} extra rows removed).` });
      load();
      onChanged?.();
    } catch (error) {
      toast(error.message, "error");
    }
  }
  async function runUndo() {
    try {
      await call(`/api/undo/${undo.actionId}`, { method: "POST" });
      toast("Undone.");
      setUndo(null);
      load();
      onChanged?.();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  if (!data) return <p className="muted">Checking for duplicates…</p>;
  const groups = [...data.groups, ...data.possible].filter((g) => !level || g.level === level);
  return (
    <section className="dup-review" aria-label="Duplicate books">
      <div className="dup-toolbar">
        <p className="dup-summary">
          <strong>{data.summary.groups}</strong> duplicate group{data.summary.groups === 1 ? "" : "s"} · <strong>{data.summary.books}</strong> books
          {data.possible.length > 0 && <> · {data.possible.length} possible</>}
        </p>
        <div className="chips" role="group" aria-label="Confidence">
          {LEVELS.map(([key, label]) => (
            <button key={key} type="button" className={`chip${level === key ? " is-on" : ""}`} aria-pressed={level === key} onClick={() => setLevel(key)}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="button button-small button-ghost" onClick={load}>
          Run check now
        </button>
        {data.summary.exact > 0 && (
          <button type="button" className="button button-small" onClick={() => setConfirmAll(true)}>
            Auto-merge all exact ({data.summary.exact})
          </button>
        )}
      </div>
      {undo && (
        <p className="undo-bar" role="status">
          {undo.text}
          <button type="button" className="button button-small button-ghost" onClick={runUndo}>
            Undo
          </button>
          <button type="button" className="link-button" aria-label="Dismiss" onClick={() => setUndo(null)}>
            ✕
          </button>
        </p>
      )}
      {!groups.length && <p className="muted">No duplicates found{level ? " at this level" : ""}.</p>}
      {groups.map((g) => (
        <Group key={g.key} group={g} schema={schema} onAction={act} onEdit={onEdit} />
      ))}
      {confirmAll && (
        <Confirm
          title="Merge every exact duplicate?"
          body={`${data.summary.exact} groups of identical books (same title, author and place) become one book each. You can undo this.`}
          confirmLabel="Merge all exact"
          onConfirm={mergeAllExact}
          onClose={() => setConfirmAll(false)}
        />
      )}
    </section>
  );
}
