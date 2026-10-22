import { useCallback, useEffect, useState } from "react";
import { useAdmin } from "./AdminApp.jsx";
import { Tags, useToast } from "./parts.jsx";

const ROLES = [
  ["", "—"],
  ["title", "Title"],
  ["author", "Author"],
  ["category", "Category"],
  ["availability", "Availability"],
];

export default function Fields() {
  const { call } = useAdmin();
  const toast = useToast();
  const [fields, setFields] = useState(null);

  const load = useCallback(() => call("/api/fields?all=true").then((d) => setFields(d.fields)), [call]);
  useEffect(() => {
    load().catch((e) => toast(e.message, "error"));
  }, [load, toast]);

  async function save(key, patch) {
    try {
      const result = await call(`/api/fields/${encodeURIComponent(key)}`, { method: "PATCH", body: patch });
      toast(`Saved ${result.field.label}.${result.reindexed ? " Search index updated." : ""}`);
      await load();
    } catch (e) {
      toast(e.message, "error");
      load();
    }
  }

  if (!fields) return <div className="page-loading" aria-busy="true" />;
  const active = fields.filter((f) => f.active);
  const removed = fields.filter((f) => !f.active);

  return (
    <section>
      <p className="muted">Choose which columns are searched, shown on result cards, or make up the book&apos;s location (in order).</p>
      <p className="location-preview">
        <span className="muted">Location reads as:</span>{" "}
        <strong>{active.filter((f) => f.is_location).map((f) => f.label).join(" · ") || "—"}</strong>
      </p>
      <div className="table-wrap">
        <table className="table fields-table">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Role</th>
              <th scope="col">Search</th>
              <th scope="col">Card</th>
              <th scope="col">Location</th>
              <th scope="col">Order</th>
            </tr>
          </thead>
          <tbody>
            {active.map((f) => (
              <tr key={f.key}>
                <td>
                  <input
                    className="inline-input"
                    aria-label={`Label for ${f.key}`}
                    defaultValue={f.label}
                    onBlur={(e) => e.target.value !== f.label && save(f.key, { label: e.target.value })}
                  />
                  <span className="muted mono">
                    {f.key} · {f.type}
                  </span>
                </td>
                <td>
                  <select aria-label={`Role for ${f.label}`} value={f.role ?? ""} onChange={(e) => save(f.key, { role: e.target.value })}>
                    {ROLES.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </td>
                {["searchable", "show_in_card", "is_location"].map((prop) => (
                  <td key={prop}>
                    <input type="checkbox" aria-label={`${prop} for ${f.label}`} checked={f[prop]} onChange={(e) => save(f.key, { [prop]: e.target.checked })} />
                  </td>
                ))}
                <td>
                  <input
                    type="number"
                    className="inline-input inline-number"
                    aria-label={`Order of ${f.label}`}
                    defaultValue={f.sort_order}
                    onBlur={(e) => Number(e.target.value) !== f.sort_order && save(f.key, { sort_order: e.target.value })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {removed.length > 0 && (
        <p className="muted">
          Removed fields (they come back with their settings if a later file has them): <Tags keys={removed.map((f) => f.key)} tone="remove" />
        </p>
      )}
    </section>
  );
}
