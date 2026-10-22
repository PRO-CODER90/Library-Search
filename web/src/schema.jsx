// The field registry from /api/fields, shaped for rendering. Nothing in the
// frontend names a column directly; it asks which field plays which role.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api.js";

const SPECIAL_ROLES = new Set(["title", "author", "category", "availability"]);

export function buildSchema(fields) {
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
  const role = {};
  for (const f of fields) if (f.role && f.active !== false) role[f.role] = f;
  const active = fields.filter((f) => f.active !== false);
  return {
    fields: active,
    byKey,
    role,
    cardFields: active.filter(
      (f) => f.show_in_card && !f.is_location && !SPECIAL_ROLES.has(f.role) && f.key !== "id" && !f.key.startsWith("location_is")
    ),
    detailFields: active.filter((f) => f.role !== "title" && !f.key.startsWith("location_is")),
  };
}

export const titleOf = (data, schema) => (schema.role.title && data[schema.role.title.key]) || "Untitled";

export const isTruthy = (value) =>
  ["yes", "true", "1", "y", "available"].includes(String(value ?? "").trim().toLowerCase());

export function formatValue(field, value) {
  if (value === undefined || value === null || value === "") return "";
  if (field?.type === "boolean") return isTruthy(value) ? "Yes" : "No";
  return String(value);
}

const SchemaContext = createContext({ schema: null, error: null, reload: () => {} });

export function SchemaProvider({ children }) {
  const [state, setState] = useState({ schema: null, error: null });
  const reload = useCallback(() => {
    api("/api/fields")
      .then(({ fields }) => setState({ schema: buildSchema(fields), error: null }))
      .catch((error) => setState((s) => ({ ...s, error })));
  }, []);
  useEffect(reload, [reload]);
  return <SchemaContext.Provider value={{ ...state, reload }}>{children}</SchemaContext.Provider>;
}

export const useSchema = () => useContext(SchemaContext);
