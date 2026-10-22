import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, toQuery } from "../api.js";
import { useApi, useDocumentTitle } from "../hooks.js";
import { useSchema } from "../schema.jsx";
import { BookCard, CategoryTiles, EmptyState, ErrorState, Skeleton } from "../components/ui.jsx";

const PAGE_SIZE = 20;

function BrowseIndex() {
  const { schema, error: schemaError } = useSchema();
  const category = schema?.role.category;
  const { data: facet, error, loading } = useApi(category ? `/api/facets/${encodeURIComponent(category.key)}` : null);
  useDocumentTitle("Browse");
  return (
    <div className="page">
      <h1 className="page-title">Browse</h1>
      {schemaError || error ? (
        <ErrorState error={schemaError || error} />
      ) : !schema || loading ? (
        <Skeleton lines={4} />
      ) : facet?.values.length ? (
        <>
          <h2 className="section-title">By {facet.label.toLowerCase()}</h2>
          <CategoryTiles facet={facet} />
        </>
      ) : (
        <EmptyState title="Nothing to browse yet." />
      )}
    </div>
  );
}

function BrowseList({ field, value }) {
  const { schema } = useSchema();
  const [state, setState] = useState({ items: [], total: 0, page: 0, loading: true, error: null });
  useDocumentTitle(value);

  async function load(page) {
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await api(`/api/books${toQuery({ [field]: value, page, limit: PAGE_SIZE })}`);
      setState((s) => ({ items: page === 1 ? data.results : [...s.items, ...data.results], total: data.total, page, loading: false, error: null }));
    } catch (error) {
      setState((s) => ({ ...s, loading: false, error }));
    }
  }
  useEffect(() => {
    load(1);
    // eslint-disable-next-line
  }, [field, value]);

  return (
    <div className="page">
      <Link className="back" to="/browse">
        ← Browse
      </Link>
      <p className="eyebrow eyebrow-plain">{schema?.byKey[field]?.label ?? field}</p>
      <h1 className="page-title">{value}</h1>
      <p className="status" aria-live="polite">
        {state.total ? `${state.total.toLocaleString()} ${state.total === 1 ? "book" : "books"}` : ""}
      </p>
      {state.error && <ErrorState error={state.error} />}
      {!state.loading && !state.error && !state.total && <EmptyState title="No books here." />}
      {schema && (
        <ol className="results">
          {state.items.map((b) => (
            <BookCard key={b.id} book={b} schema={schema} />
          ))}
        </ol>
      )}
      {state.items.length < state.total && (
        <div className="more">
          <button type="button" className="button button-ghost" disabled={state.loading} onClick={() => load(state.page + 1)}>
            Show more
          </button>
        </div>
      )}
    </div>
  );
}

export default function Browse() {
  const { field, value } = useParams();
  return field && value ? <BrowseList field={field} value={value} /> : <BrowseIndex />;
}
