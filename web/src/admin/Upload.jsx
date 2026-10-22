import { useState } from "react";
import { Icon } from "../components/Icon.jsx";
import { useAdmin } from "./AdminApp.jsx";
import { Confirm, Tags, useToast } from "./parts.jsx";

const MODES = [
  ["replace", "Replace", "The file becomes the whole catalogue. Columns not in the file are removed."],
  ["append", "Add", "Add these rows to the existing books."],
  ["upsert", "Update matching", "Match rows by a key column, update them, add the rest."],
];

function Report({ r }) {
  return (
    <div className={`report${r.dryRun ? "" : " report-done"}`}>
      <p className="report-title">{r.dryRun ? "Preview: nothing has been saved yet." : "Upload complete."}</p>
      <dl className="report-grid">
        <div>
          <dt>Rows read</dt>
          <dd>{r.rowsRead.toLocaleString()}</dd>
        </div>
        <div>
          <dt>{r.dryRun ? "Would import" : "Imported"}</dt>
          <dd>{r.rowsImported.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Skipped</dt>
          <dd>{r.rowsSkipped}</dd>
        </div>
        <div>
          <dt>Title field</dt>
          <dd>{r.detected.titleField ?? "none"}</dd>
        </div>
        <div>
          <dt>Delimiter</dt>
          <dd>
            <code>{r.detected.delimiter}</code>
          </dd>
        </div>
        <div>
          <dt>Encoding</dt>
          <dd>{r.detected.encoding}</dd>
        </div>
      </dl>
      <p>
        <strong>Fields added:</strong> <Tags keys={r.fields.added} tone="add" />
      </p>
      <p>
        <strong>Fields removed:</strong> <Tags keys={r.fields.removed} tone="remove" />
      </p>
      <p>
        <strong>Fields kept:</strong> <Tags keys={r.fields.kept} tone="keep" />
      </p>
      {r.warnings.length > 0 && (
        <ul className="report-warnings">
          {r.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Upload() {
  const { call, me } = useAdmin();
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState("replace");
  const [keyField, setKeyField] = useState("");
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function send(dryRun, chosen = file, chosenMode = mode) {
    if (!chosen) return;
    setError("");
    setBusy(true);
    const body = new FormData();
    body.append("file", chosen);
    body.append("mode", chosenMode);
    body.append("keyField", keyField.trim());
    body.append("dryRun", String(dryRun));
    try {
      const result = await call("/api/upload", { method: "POST", body });
      setReport(result);
      if (!dryRun) toast(`Imported ${result.rowsImported} rows.`);
    } catch (err) {
      setReport(null);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function choose(f) {
    if (!f) return;
    setFile(f);
    setReport(null);
    if (mode !== "upsert" || keyField.trim()) send(true, f); // preview immediately
  }

  return (
    <section className="upload">
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
        <span className="dropzone-title">{file ? file.name : "Drop your CSV here, or choose a file"}</span>
        <span className="muted">
          First row = column names. Any columns work; new ones become fields automatically. Max {me.maxUploadMb} MB.
        </span>
        <input type="file" accept=".csv,.tsv,.txt,text/csv" className="visually-hidden" onChange={(e) => choose(e.target.files[0])} />
      </label>

      <fieldset className="modes">
        <legend>How should it be loaded?</legend>
        {MODES.map(([value, label, help]) => (
          <label className="check" key={value}>
            <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} />
            <span>
              <strong>{label}</strong>: {help}
            </span>
          </label>
        ))}
      </fieldset>
      {mode === "upsert" && (
        <div className="field">
          <label htmlFor="keyField">Key column</label>
          <input id="keyField" placeholder="e.g. id or isbn" value={keyField} onChange={(e) => setKeyField(e.target.value)} />
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions dialog-actions-start">
        <button type="button" className="button button-ghost" disabled={!file || busy} onClick={() => send(true)}>
          Preview
        </button>
        <button type="button" className="button" disabled={!file || busy} onClick={() => (mode === "replace" ? setConfirming(true) : send(false))}>
          Confirm upload
        </button>
      </div>
      <div aria-live="polite">{busy ? <p className="muted">Working…</p> : report && <Report r={report} />}</div>
      {confirming && (
        <Confirm
          title="Replace the whole catalogue?"
          body={`Every current book will be replaced by the rows in “${file?.name}”.`}
          confirmLabel="Replace catalogue"
          onConfirm={() => send(false)}
          onClose={() => setConfirming(false)}
        />
      )}
    </section>
  );
}
