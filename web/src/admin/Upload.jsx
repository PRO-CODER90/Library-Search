import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Icon } from "../components/Icon.jsx";
import { useAdmin } from "./AdminApp.jsx";
import { Confirm, Tags, useToast } from "./parts.jsx";

const MODES = [
  ["replace", "Replace", "The file becomes the whole catalogue. Columns not in the file are removed."],
  ["append", "Add", "Add these rows to the existing books."],
  ["upsert", "Update matching", "Match on entity_id (or title + first author), update those books, add the rest."],
];
const ROLES = [
  ["", "—"],
  ["title", "Title"],
  ["author", "Author"],
  ["category", "Category"],
  ["availability", "Availability"],
];
const FLAGS = [
  ["searchable", "Search"],
  ["show_in_card", "Card"],
  ["is_location", "Location"],
];

/** Detected fields; edits are applied right after the import is confirmed. */
function FieldsPreview({ fields, edits, setEdits }) {
  const value = (f, prop) => (edits[f.key]?.[prop] !== undefined ? edits[f.key][prop] : f[prop]);
  const change = (key, prop, v) => setEdits((e) => ({ ...e, [key]: { ...e[key], [prop]: v } }));
  return (
    <div className="table-wrap">
      <table className="table fields-table">
        <thead>
          <tr>
            <th scope="col">Column → label</th>
            <th scope="col">Type</th>
            <th scope="col">Role</th>
            {FLAGS.map(([, l]) => (
              <th scope="col" key={l}>
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <tr key={f.key}>
              <td>
                <input className="inline-input" aria-label={`Label for ${f.key}`} value={value(f, "label")} onChange={(e) => change(f.key, "label", e.target.value)} />
                <span className="muted mono">{f.key}</span>
              </td>
              <td>{f.type}</td>
              <td>
                <select aria-label={`Role for ${f.key}`} value={value(f, "role") ?? ""} onChange={(e) => change(f.key, "role", e.target.value)}>
                  {ROLES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </td>
              {FLAGS.map(([prop, l]) => (
                <td key={prop}>
                  <input type="checkbox" aria-label={`${l} for ${f.key}`} checked={Boolean(value(f, prop))} onChange={(e) => change(f.key, prop, e.target.checked)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RowsPreview({ fields, rows }) {
  return (
    <div className="table-wrap">
      <table className="table preview-table">
        <thead>
          <tr>
            {fields.map((f) => (
              <th scope="col" key={f.key}>
                {f.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {fields.map((f) => (
                <td key={f.key} className={r.placeholder.includes(f.key) ? "cell-placeholder" : undefined} title={r.placeholder.includes(f.key) ? "Placeholder (generated)" : undefined}>
                  {r.data[f.key] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Summary({ r }) {
  const fields = r.preview.fields.length;
  return (
    <p className="summary">
      <strong>{r.rowsRead.toLocaleString()}</strong> books · <strong>{fields}</strong> fields · <strong>{r.placeholdersFilled}</strong> placeholder
      locations filled · <strong>{r.warnings.length}</strong> warnings
    </p>
  );
}

export default function Upload() {
  const { call, me } = useAdmin();
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState(null);
  const [preview, setPreview] = useState(null);
  const [done, setDone] = useState(null);
  const [edits, setEdits] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [dragging, setDragging] = useState(false);

  // First load replaces; after that, update matching books by default.
  useEffect(() => {
    api("/api/health")
      .then((h) => setMode((m) => m ?? (h.books ? "upsert" : "replace")))
      .catch(() => setMode((m) => m ?? "replace"));
  }, []);

  async function send(dryRun, chosen = file, chosenMode = mode) {
    if (!chosen) return null;
    setError("");
    setBusy(true);
    const body = new FormData();
    body.append("file", chosen);
    body.append("mode", chosenMode);
    body.append("dryRun", String(dryRun));
    try {
      return await call("/api/upload", { method: "POST", body });
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function choose(f, chosenMode = mode) {
    if (!f) return;
    setFile(f);
    setDone(null);
    setEdits({});
    setPreview(await send(true, f, chosenMode));
  }

  async function confirm() {
    const result = await send(false);
    if (!result) return;
    // Apply the field tweaks made in the preview.
    const changed = Object.entries(edits);
    for (const [key, patch] of changed) {
      await call(`/api/fields/${encodeURIComponent(key)}`, { method: "PATCH", body: patch }).catch((e) => toast(e.message, "error"));
    }
    setDone(result);
    setPreview(null);
    setFile(null);
    setEdits({});
    toast(`Imported ${result.rowsImported} books.`);
  }

  return (
    <section className="upload">
      <div className="upload-head">
        <h1>Upload catalogue</h1>
        <a className="button button-ghost button-small" href="/api/template" download>
          Download template
        </a>
      </div>
      <label
        className={`dropzone${dragging ? " is-dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          choose(e.dataTransfer.files[0]);
        }}
      >
        <Icon name="upload" size={32} />
        <span className="dropzone-title">{file ? file.name : "Drop your Excel (.xlsx) or CSV here"}</span>
        <span className="muted">Or click to choose a file. A preview appears automatically; nothing is saved until you confirm. Max {me.maxUploadMb} MB.</span>
        <input type="file" accept=".xlsx,.csv,.tsv,.txt" className="visually-hidden" onChange={(e) => choose(e.target.files[0])} />
      </label>

      {mode && (
        <fieldset className="modes">
          <legend>How should it be loaded?</legend>
          {MODES.map(([value, label, help]) => (
            <label className="check" key={value}>
              <input
                type="radio"
                name="mode"
                value={value}
                checked={mode === value}
                onChange={() => {
                  setMode(value);
                  if (file) choose(file, value);
                }}
              />
              <span>
                <strong>{label}</strong>: {help}
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div aria-live="polite">{busy && <p className="muted">Reading the file…</p>}</div>

      {preview && (
        <div className="preview">
          <p className="muted">
            {preview.detected.format === "xlsx" ? (
              <>
                Sheet <strong>{preview.detected.sheet}</strong>, header row <strong>{preview.detected.headerRow}</strong>, data from row{" "}
                <strong>{preview.detected.dataRow}</strong>.
              </>
            ) : (
              <>
                CSV, header row <strong>{preview.detected.headerRow}</strong>, delimiter <code>{preview.detected.delimiter}</code>.
              </>
            )}{" "}
            {preview.detected.matchKey && <>Matching on {preview.detected.matchKey}.</>}
          </p>
          <Summary r={preview} />
          {preview.warnings.length > 0 && (
            <ul className="report-warnings">
              {preview.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <p>
            <strong>Fields added:</strong> <Tags keys={preview.fields.added} tone="add" /> · <strong>removed:</strong>{" "}
            <Tags keys={preview.fields.removed} tone="remove" /> · <strong>kept:</strong> <Tags keys={preview.fields.kept} tone="keep" />
          </p>
          <h2 className="section-title">Detected fields</h2>
          <FieldsPreview fields={preview.preview.fields} edits={edits} setEdits={setEdits} />
          <h2 className="section-title">First {preview.preview.rows.length} rows</h2>
          <p className="muted">
            <span className="cell-placeholder legend">Highlighted</span> cells are generated placeholder locations; correct them later in Books.
          </p>
          <RowsPreview fields={preview.preview.fields} rows={preview.preview.rows} />
          <div className="dialog-actions dialog-actions-start">
            <button type="button" className="button" disabled={busy} onClick={() => (mode === "replace" ? setConfirming(true) : confirm())}>
              Confirm upload
            </button>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => {
                setPreview(null);
                setFile(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {done && (
        <div className="report report-done">
          <p className="report-title">
            Imported {done.rowsImported.toLocaleString()} books ({done.rowsInserted} new, {done.rowsUpdated} updated).{" "}
            <Link to="../books" relative="path">
              Go to Books →
            </Link>
          </p>
          <p>
            <strong>Added:</strong> <Tags keys={done.fields.added} tone="add" /> · <strong>Removed:</strong> <Tags keys={done.fields.removed} tone="remove" /> ·{" "}
            <strong>Kept:</strong> <Tags keys={done.fields.kept} tone="keep" />
          </p>
          {done.warnings.length > 0 && (
            <ul className="report-warnings">
              {done.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {confirming && (
        <Confirm
          title="Replace the whole catalogue?"
          body={`Every current book will be replaced by the ${preview?.rowsRead ?? ""} rows in “${file?.name}”.`}
          confirmLabel="Replace catalogue"
          onConfirm={confirm}
          onClose={() => setConfirming(false)}
        />
      )}
    </section>
  );
}
