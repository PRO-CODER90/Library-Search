import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api, toQuery } from "../api.js";
import { useDebounced, useDocumentTitle } from "../hooks.js";
import { useSchema } from "../schema.jsx";
import SearchBar from "../components/SearchBar.jsx";
import { BookCard, EmptyState, ErrorState } from "../components/ui.jsx";

const PAGE_SIZE = 20;
const BATCH = 200; // chips rendered at a time; more appear as the box scrolls

/** One book opens its page; a title shared by several books lists them all. */
const chipTarget = (item) => (item.count > 1 ? `/search${toQuery({ q: item.text })}` : `/book/${item.id}`);

/** Every title matching `q` (one light request), or null while loading. */
function useSuggest(q) {
  const [state, setState] = useState({ q: "", total: 0, items: [] });
  useEffect(() => {
    if (!q) return undefined;
    const controller = new AbortController();
    api(`/api/suggest${toQuery({ q })}`, { signal: controller.signal })
      .then((data) => setState({ q, total: data.total, items: data.items }))
      .catch(() => {});
    return () => controller.abort();
  }, [q]);
  return q && state.q === q ? state : null;
}

/** Live title chips: all matches, scrolling inside their own box (no visible bar). */
function Suggestions({ q, result, active, onActive }) {
  const box = useRef(null);
  const sentinel = useRef(null);
  const [shown, setShown] = useState(BATCH);

  useEffect(() => setShown(BATCH), [result]);
  useEffect(() => {
    if (active >= shown) setShown(Math.ceil((active + 1) / BATCH) * BATCH);
  }, [active, shown]);

  // Render the next batch when the end of the list scrolls into view.
  useEffect(() => {
    const end = sentinel.current;
    if (!end || !box.current) return undefined;
    const observer = new IntersectionObserver((entries) => entries[0].isIntersecting && setShown((n) => n + BATCH), {
      root: box.current,
      rootMargin: "200px",
    });
    observer.observe(end);
    return () => observer.disconnect();
  }, [result, shown]);

  // Keep the highlighted chip visible inside the box.
  useEffect(() => {
    box.current?.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!result) return null;
  const { total, items } = result;
  return (
    <>
      <p className="suggest-count" aria-live="polite">
        {total ? `${total.toLocaleString("en-IN")} ${total === 1 ? "title" : "titles"}` : `No titles match “${q}”.`}
      </p>
      {total > 0 && (
        <div className="suggest" ref={box}>
          <ul className="chips-list" id="title-chips" role="listbox" aria-label="Matching titles">
            {items.slice(0, shown).map((item, i) => (
              <li key={item.id} role="none">
                <Link
                  id={`chip-${item.id}`}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? "suggest-chip is-active" : "suggest-chip"}
                  to={chipTarget(item)}
                  onMouseEnter={() => onActive(i)}
                >
                  {item.text}
                  {item.count > 1 && <span className="chip-count">{item.count} books</span>}
                </Link>
              </li>
            ))}
            {shown < items.length && <li ref={sentinel} className="chips-sentinel" aria-hidden="true" />}
          </ul>
        </div>
      )}
    </>
  );
}

// One count per full page load, even if React mounts the component twice.
let visit = null;

/** "Hit count": the number always comes from the server; "—" if it can't be read. */
function HitCount() {
  const [total, setTotal] = useState(undefined); // undefined = loading, null = failed
  useEffect(() => {
    visit ??= api("/api/visit", { method: "POST" }).then((data) => data.total);
    let alive = true;
    visit.then(
      (n) => alive && setTotal(n),
      () => alive && setTotal(null)
    );
    return () => {
      alive = false;
    };
  }, []);
  return (
    <p className="hit-count">
      Hit count :{" "}
      {total === undefined ? <span className="shimmer">0,000</span> : <strong>{total === null ? "—" : total.toLocaleString("en-IN")}</strong>}
    </p>
  );
}

function Hero({ query, onQuery, onSubmit, onKeyDown, inputProps, searching, children }) {
  return (
    <section className={searching ? "hero is-searching" : "hero"}>
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
        <SearchBar value={query} onChange={onQuery} onSubmit={onSubmit} onKeyDown={onKeyDown} inputProps={inputProps} autoFocus />
        {children}
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

// A page refresh starts with an empty search box: drop ?q= before the router
// reads the URL. Back from a book (same page load) still returns to the query.
try {
  const reload = performance.getEntriesByType?.("navigation")?.[0]?.type === "reload";
  if (reload && location.pathname === "/" && location.search) history.replaceState(history.state, "", "/");
} catch {
  /* no Navigation Timing: keep the URL as is */
}

const resultsPageOf = (pathname) => pathname === "/search";

export default function Home() {
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const urlQuery = params.get("q") ?? "";
  const resultsPage = resultsPageOf(pathname); // old "all results" links still work
  const [query, setQuery] = useState(urlQuery);
  const debounced = useDebounced(query.trim(), 150);
  const typed = resultsPage && debounced === urlQuery ? "" : debounced;
  const result = useSuggest(typed);
  const [active, setActive] = useState(0);
  useDocumentTitle(urlQuery ? `“${urlQuery}”` : "");

  // Keep the input in step with back/forward navigation.
  useEffect(() => {
    setQuery((current) => (current.trim() === urlQuery ? current : urlQuery));
  }, [urlQuery]);

  // The query lives in the URL (/?q=…) as you type, so Back from a book keeps it.
  useEffect(() => {
    const q = query.trim();
    if (q === urlQuery) return;
    navigate(q ? `/${toQuery({ q })}` : "/", { replace: true });
    // eslint-disable-next-line
  }, [query]);

  useEffect(() => setActive(0), [result]);

  const items = result?.items ?? [];

  // Enter (or the arrow button) opens the highlighted book; nothing if no match.
  const submit = () => {
    const item = items[active];
    if (!item) return;
    const q = query.trim();
    if (q !== urlQuery || resultsPage) navigate(`/${toQuery({ q })}`, { replace: true });
    navigate(chipTarget(item));
  };

  const onKeyDown = (event) => {
    if (!items.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.min(items.length - 1, Math.max(0, i + (event.key === "ArrowDown" ? 1 : -1))));
    }
  };

  const activeItem = items[active];
  return (
    <>
      <Hero
        query={query}
        onQuery={setQuery}
        onSubmit={submit}
        onKeyDown={onKeyDown}
        searching={Boolean(result)}
        inputProps={{
          role: "combobox",
          "aria-expanded": Boolean(items.length),
          "aria-controls": "title-chips",
          "aria-activedescendant": activeItem ? `chip-${activeItem.id}` : undefined,
        }}
      >
        <Suggestions q={typed} result={result} active={active} onActive={setActive} />
      </Hero>
      {resultsPage && urlQuery && !result && <Results q={urlQuery} />}
    </>
  );
}
