import { Link, useNavigate, useParams } from "react-router-dom";
import { useApi, useDocumentTitle } from "../hooks.js";
import { formatValue, isTruthy, titleOf, useSchema } from "../schema.jsx";
import { AvailabilityBadge, Directions, ErrorState, LocationSlip, ShelfDiagram, Skeleton } from "../components/ui.jsx";

export default function Book() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { schema } = useSchema();
  const { data: book, error, loading } = useApi(`/api/books/${encodeURIComponent(id)}`);
  const title = book && schema ? titleOf(book.data, schema) : "";
  useDocumentTitle(title);

  if (error) {
    return (
      <div className="page">
        <ErrorState error={error.status === 404 ? { message: "That book isn't in the catalogue any more." } : error} />
        <p className="center">
          <Link className="button" to="/">
            Back to search
          </Link>
        </p>
      </div>
    );
  }
  if (loading || !book || !schema) {
    return (
      <div className="page">
        <Skeleton lines={6} />
      </div>
    );
  }

  const { author, category, availability } = schema.role;
  const unavailable = availability && book.data[availability.key] !== undefined && !isTruthy(book.data[availability.key]);
  const facts = schema.detailFields.filter((f) => book.data[f.key] !== undefined && book.data[f.key] !== "");

  return (
    <article className="page book">
      <button type="button" className="back" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}>
        ← Back
      </button>
      <header className="book-head">
        <div className="book-cover" aria-hidden="true">
          {[...title][0] ?? "?"}
        </div>
        <div>
          {category && book.data[category.key] && <p className="eyebrow eyebrow-plain">{book.data[category.key]}</p>}
          <h1 className="book-title">{title}</h1>
          {author && book.data[author.key] && <p className="book-author">by {book.data[author.key]}</p>}
          <p>
            <AvailabilityBadge book={book} schema={schema} />
          </p>
        </div>
      </header>

      <section className="where">
        <h2 className="section-title">Where to find it</h2>
        <LocationSlip parts={book.locationParts} large />
        {book.locationParts.length > 0 && (
          <div className="where-body">
            <Directions parts={book.locationParts} />
            <ShelfDiagram parts={book.locationParts} />
          </div>
        )}
        {unavailable && <p className="note">This book is not available right now. Ask at the help desk.</p>}
      </section>

      <section>
        <h2 className="section-title">Details</h2>
        <dl className="facts">
          {facts.map((f) => (
            <div key={f.key}>
              <dt>{f.label}</dt>
              <dd>{formatValue(f, book.data[f.key])}</dd>
            </div>
          ))}
        </dl>
      </section>
    </article>
  );
}
