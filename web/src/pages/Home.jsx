import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, toQuery } from "../api.js";
import { useApi, useDebounced, useDocumentTitle } from "../hooks.js";
import { useSchema } from "../schema.jsx";
import SearchBar from "../components/SearchBar.jsx";
import { Icon } from "../components/Icon.jsx";
import { BookCard, EmptyState, ErrorState, SectionHeading, Skeleton, ViewAllLink, formatDate } from "../components/ui.jsx";

const PAGE_SIZE = 20;

function StatsRow() {
  const { data, loading } = useApi("/api/stats");
  const items = [
    ["book-open", data?.books, "Books"],
    ["database", data?.categories, "Categories"],
    ["users", data?.available, "Available now"],
  ].filter(([, value]) => loading || (value !== null && value !== undefined));
  return (
    <ul className="stats" aria-live="polite">
      {items.map(([icon, value, label]) => (
        <li key={label}>
          <Icon name={icon} size={34} />
          <span>
            <strong>{loading ? <span className="shimmer">00</span> : value.toLocaleString()}</strong>
            <span>{label}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Hero({ query, onQuery, onSubmit }) {
  return (
    <section className="hero">
      <img className="decor decor-botanical" src="/art/botanical-left.png" alt="" aria-hidden="true" loading="lazy" />
      <div className="hero-copy">
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
        <img className="decor decor-campus" src="/art/campus-sketch.png" alt="" aria-hidden="true" loading="lazy" />
        <SearchBar value={query} onChange={onQuery} onSubmit={onSubmit} autoFocus />
        <StatsRow />
      </div>
      <div className="hero-photo">
        <picture>
          <source srcSet="/art/hero-library.webp" type="image/webp" />
          <img src="/art/hero-library.jpg" width="490" height="452" alt="Reading room of the central library" fetchPriority="high" />
        </picture>
      </div>
    </section>
  );
}

function UpdateCard({ notice }) {
  return (
    <li>
      <Link className="update-card" to="/updates">
        <picture className="update-thumb">
          <source srcSet="/art/notice-books.webp" type="image/webp" />
          <img src="/art/notice-books.jpg" width="250" height="118" alt="" loading="lazy" />
        </picture>
        <span className="update-body">
          <span className="update-meta">
            <span className="pill">{notice.kind || "UPDATE"}</span>
            <time dateTime={notice.createdAt}>{formatDate(notice.createdAt)}</time>
          </span>
          <span className="update-title">{notice.title}</span>
          {notice.body && <span className="update-text">{notice.body}</span>}
        </span>
        <Icon name="arrow-right" size={24} className="update-arrow" />
      </Link>
    </li>
  );
}

function LatestUpdates() {
  const { data, error, loading } = useApi("/api/notices");
  if (error) return null;
  if (!loading && !data?.length) return null;
  return (
    <section className="section updates-section">
      <img className="decor decor-books" src="/art/book-stack.png" alt="" aria-hidden="true" loading="lazy" />
      <SectionHeading action={<ViewAllLink to="/updates">View all updates</ViewAllLink>}>Library updates</SectionHeading>
      {loading ? <Skeleton lines={2} /> : <ul className="update-list">{data.slice(0, 3).map((n) => <UpdateCard key={n.id} notice={n} />)}</ul>}
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

  // Typing searches live: the URL is the source of truth for results.
  useEffect(() => {
    if (debounced === urlQuery) return;
    navigate(debounced ? `/search${toQuery({ q: debounced })}` : "/", { replace: true });
    // eslint-disable-next-line
  }, [debounced]);

  const submit = (value) => {
    const q = value.trim();
    navigate(q ? `/search${toQuery({ q })}` : "/", { replace: true });
  };

  return (
    <>
      <Hero query={query} onQuery={setQuery} onSubmit={submit} />
      {urlQuery ? <Results q={urlQuery} /> : <LatestUpdates />}
    </>
  );
}
