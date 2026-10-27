// Small shared pieces of UI. Everything is driven by the field schema.

import { Link } from "react-router-dom";
import { highlightSegments } from "@shared/search.js";
import { formatValue, isTruthy, titleOf } from "../schema.jsx";

export function Highlight({ text, query }) {
  if (!query) return <>{text}</>;
  return highlightSegments(text, query).map((s, i) => (s.match ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>));
}

export function AvailabilityBadge({ book, schema }) {
  const field = schema.role.availability;
  const value = field ? book.data[field.key] : undefined;
  if (value === undefined || value === "") return null;
  return isTruthy(value) ? <span className="badge badge-ok">Available</span> : <span className="badge badge-off">Issued</span>;
}

/** The "call slip": every location field, in registry order. */
export function LocationSlip({ parts, query = "", large = false }) {
  if (!parts?.length) return <div className="slip slip-empty">Location not recorded</div>;
  return (
    <div className={`slip${large ? " slip-large" : ""}`} role="group" aria-label={`Location: ${parts.map((p) => `${p.label} ${p.value}`).join(", ")}`}>
      {parts.map((p) => (
        <div className="slip-cell" key={p.key}>
          <span className="slip-label">{p.label}</span>
          <span className="slip-value">
            <Highlight text={p.value} query={query} />
          </span>
        </div>
      ))}
    </div>
  );
}

export function BookCard({ book, schema, query = "" }) {
  const { author, category } = schema.role;
  const meta = [author, category].filter((f) => f && book.data[f.key]).map((f) => book.data[f.key]);
  const extras = schema.cardFields.filter((f) => book.data[f.key] !== undefined && book.data[f.key] !== "").slice(0, 4);
  return (
    <li className="result">
      <Link className="result-link" to={`/book/${book.id}`}>
        <div className="result-main">
          <h3 className="result-title">
            <Highlight text={titleOf(book.data, schema)} query={query} />
          </h3>
          {meta.length > 0 && (
            <p className="result-meta">
              {meta.map((m, i) => (
                <span key={i}>
                  {i > 0 && <span aria-hidden="true"> · </span>}
                  <Highlight text={m} query={query} />
                </span>
              ))}
            </p>
          )}
          <p className="result-extra">
            <AvailabilityBadge book={book} schema={schema} />
            {extras.map((f) => (
              <span key={f.key}>
                <span className="extra-label">{f.label}:</span> <Highlight text={formatValue(f, book.data[f.key])} query={query} />
              </span>
            ))}
          </p>
        </div>
        <LocationSlip parts={book.locationParts} query={query} />
      </Link>
    </li>
  );
}

/** A small bookcase drawing with the book's shelf lit up. */
export function ShelfDiagram({ parts }) {
  const shelfPart = parts.find((p) => /shelf/i.test(p.key) || /shelf/i.test(p.label));
  if (!shelfPart) return null;
  const rackPart = parts.find((p) => /rack|almirah|cupboard|bay/i.test(p.key));
  const shelf = shelfPart.value.trim().toUpperCase();
  let index;
  let labels;
  if (/^[A-Z]$/.test(shelf)) {
    index = shelf.charCodeAt(0) - 65;
    labels = Array.from({ length: Math.max(5, index + 1) }, (_, i) => String.fromCharCode(65 + i));
  } else if (/^\d{1,2}$/.test(shelf) && Number(shelf) >= 1 && Number(shelf) <= 12) {
    index = Number(shelf) - 1;
    labels = Array.from({ length: Math.max(5, index + 1) }, (_, i) => String(i + 1));
  } else {
    return null;
  }
  return (
    <figure className="bookcase" aria-label={`${shelfPart.label} ${shelf} is highlighted`}>
      <figcaption>{rackPart ? `${rackPart.label} ${rackPart.value}` : "Bookcase"}</figcaption>
      <ol className="bookcase-shelves">
        {labels.map((label, i) => (
          <li key={label} className={i === index ? "is-target" : undefined}>
            <span className="bookcase-label">{label}</span>
            <span className="bookcase-books" aria-hidden="true">
              {Array.from({ length: 9 }, (_, k) => (
                <i key={k} />
              ))}
            </span>
            {i === index && <span className="bookcase-here">Here</span>}
          </li>
        ))}
      </ol>
    </figure>
  );
}

export function Directions({ parts }) {
  return (
    <ol className="steps">
      {parts.map((p, i) => {
        const what = (
          <strong>
            {p.label} {p.value}
          </strong>
        );
        const last = parts.length > 1 && i === parts.length - 1;
        return <li key={p.key}>{last ? <>It&apos;s on {what}.</> : i === 0 ? <>Go to {what}.</> : <>Find {what}.</>}</li>;
      })}
    </ol>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <p>{children}</p>}
    </div>
  );
}

export function ErrorState({ error }) {
  return (
    <div className="empty empty-error" role="alert">
      <p className="empty-title">Something went wrong</p>
      <p>{error?.message ?? String(error)}</p>
    </div>
  );
}

export function Skeleton({ lines = 3 }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}

export function CategoryTiles({ facet }) {
  return (
    <ul className="tiles">
      {facet.values.map((v) => (
        <li key={v.value}>
          <Link className="tile" to={`/browse/${encodeURIComponent(facet.field)}/${encodeURIComponent(v.value)}`}>
            <span className="tile-name">{v.value}</span>
            <span className="tile-count">
              {v.count.toLocaleString()} {v.count === 1 ? "book" : "books"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
