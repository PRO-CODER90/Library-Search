import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, toQuery } from "../api.js";
import { useDebounced, useDocumentTitle } from "../hooks.js";
import { titleOf, useSchema } from "../schema.jsx";
import SearchBar from "../components/SearchBar.jsx";
import { BookCard, EmptyState, ErrorState } from "../components/ui.jsx";

const PAGE_SIZE = 20;
const SUGGEST_LIMIT = 40;

/** Live title chips while typing; each opens its book. Enter shows full results. */
function Suggestions({ q }) {
  const { schema } = useSchema();
  const [state, setState] = useState({ q: "", items: [] });

  useEffect(() => {
    if (!q) return undefined;
    const controller = new AbortController();
    api(`/api/search${toQuery({ q, limit: SUGGEST_LIMIT })}`, { signal: controller.signal })
      .then((data) => setState({ q, items: data.results }))
      .catch(() => {});
    return () => controller.abort();
  }, [q]);

  if (!q || !schema || state.q !== q) return null;
  const seen = new Set();
  const chips = state.items.filter((book) => {
    const title = titleOf(book.data, schema).toLowerCase();
    if (seen.has(title)) return false;
    seen.add(title);
    return true;
  });
  return (
    <div className="suggest" aria-live="polite">
      {chips.length ? (
        <ul className="chips-list" aria-label="Matching titles">
          {chips.map((book) => (
            <li key={book.id}>
              <Link className="suggest-chip" to={`/book/${book.id}`}>
                {titleOf(book.data, schema)}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="suggest-empty">No titles match “{q}”.</p>
      )}
    </div>
  );
}

/** "Hit count": counts one visit per browser session, then just reads. */
function HitCount() {
  const [hits, setHits] = useState(null);
  useEffect(() => {
    let counted = false;
    try {
      counted = sessionStorage.getItem("counted") === "1";
      sessionStorage.setItem("counted", "1");
    } catch {
      /* storage blocked: count this view */
    }
    api("/api/hits", counted ? {} : { method: "POST" })
      .then((data) => setHits(data.hits))
      .catch(() => {});
  }, []);
  if (hits === null) return null;
  return (
    <p className="hit-count">
      Hit count : <strong>{hits.toLocaleString("en-IN")}</strong>
    </p>
  );
}

function Hero({ query, onQuery, onSubmit, suggest }) {
  return (
    <section className={suggest ? "hero is-searching" : "hero"}>
      <img className="decor decor-botanical" src="/art/botanical-pink.png" width="140" height="320" alt="" aria-hidden="true" loading="lazy" />
      <div className="hero-copy">
        <img className="decor decor-campus" src="/art/campus-sketch-pink.png" width="472" height="238" alt="" aria-hidden="true" loading="lazy" />
        <p className="eyebrow">
          <span>PU Library · Book Index 01</span>
        </p>
        <h1 className="hero-title">
          Find the book.
          <br />
          Find <em>your</em> place.
        </h1>
        <p className="hero-sub">Search by title, author, subject or shelf code.</p>
        <p className="hero-hint">One letter is enough to get started.</p>
        <SearchBar value={query} onChange={onQuery} onSubmit={onSubmit} autoFocus />
        <Suggestions q={suggest} />
        <HitCount />
      </div>
      <div className="hero-photo">
        <picture>
          <source srcSet="/art/hero-building.webp" type="image/webp" />
          <img src="/art/hero-building.jpg" width="824" height="524" alt="The Poornima University central library building" fetchPriority="high" />
        </picture>
        <svg className="hero-photo-edge" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 0H62C24 26 40 64 0 100Z" fill="currentColor" />
          <path d="M62 0C24 26 40 64 0 100" fill="none" stroke="#e8348a" strokeWidth="3" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="petal" aria-hidden="true" />
        <span className="petal" aria-hidden="true" />
        <span className="petal" aria-hidden="true" />
        <span className="petal" aria-hidden="true" />
      </div>
      <svg className="hero-wave" viewBox="0 0 1440 150" preserveAspectRatio="none" aria-hidden="true">
        <path className="wave-pink" d="M0 38C300 104 620 122 930 100 1160 84 1320 34 1440 6V34C1300 64 1140 112 920 122 600 136 280 118 0 72Z" />
        <path className="wave-navy" d="M0 70C300 118 620 132 920 126 1150 120 1310 60 1440 30V140C1000 130 560 148 0 136Z" />
        <path className="wave-white" d="M0 134C520 150 1000 124 1440 134V150H0Z" />
      </svg>
      <img className="decor decor-cricket" src="/art/cricket-skyline.png" width="260" height="135" alt="" aria-hidden="true" loading="lazy" />
    </section>
  );
}

function Results({ q }) {
  const { schema } = useSchema();
  const [state, setState] = useState({ q: "", items: [], total: 0, page: 0, loading: false, error: null });

  async function load(page) {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api(`/api/search${toQuery({ q, page, limit: PAGE_SIZE })}`);
      setState((s) => ({
        q,
        items: page === 1 ? data.results : [...s.items, ...data.results],
        total: data.total,
        page,
        loading: false,
        error: null,
      }));
    } catch (error) {
      setState((s) => ({ ...s, loading: false, error }));
    }
  }

  useEffect(() => {
    load(1);
    // eslint-disable-next-line
  }, [q]);

  const stale = state.q !== q;
  return (
    <section className={`section results-section${state.loading && state.page === 0 ? " is-loading" : ""}`} aria-label="Search results">
      <p className="status" aria-live="polite">
        {!stale && !state.error && state.total > 0 ? `${state.total.toLocaleString()} ${state.total === 1 ? "book" : "books"} found` : ""}
      </p>
      {state.error && <ErrorState error={state.error} />}
      {!stale && !state.error && state.total === 0 && (
        <EmptyState title={`No books found for “${q}”`}>Try fewer letters or a different word.</EmptyState>
      )}
      {schema && (
        <ol className={`results${stale ? " is-stale" : ""}`}>
          {state.items.map((book) => (
            <BookCard key={book.id} book={book} schema={schema} query={q} />
          ))}
        </ol>
      )}
      {!stale && state.items.length < state.total && (
        <div className="more">
          <button type="button" className="button button-ghost" disabled={state.loading} onClick={() => load(state.page + 1)}>
            Show more ({(state.total - state.items.length).toLocaleString()} left)
          </button>
        </div>
      )}
    </section>
  );
}

export default function Home() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const urlQuery = params.get("q") ?? "";
  const [query, setQuery] = useState(urlQuery);
  const debounced = useDebounced(query.trim(), 150);
  useDocumentTitle(urlQuery ? `“${urlQuery}”` : "");

  // Keep the input in step with back/forward navigation.
  useEffect(() => {
    setQuery((current) => (current.trim() === urlQuery ? current : urlQuery));
  }, [urlQuery]);

  const submit = (value) => {
    const q = value.trim();
    navigate(q ? `/search${toQuery({ q })}` : "/", { replace: true });
  };

  return (
    <>
      <Hero query={query} onQuery={setQuery} onSubmit={submit} suggest={debounced === urlQuery ? "" : debounced} />
      {urlQuery && <Results q={urlQuery} />}
    </>
  );
}
