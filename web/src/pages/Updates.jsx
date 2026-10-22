import { useApi, useDocumentTitle } from "../hooks.js";
import { EmptyState, ErrorState, Skeleton, formatDate } from "../components/ui.jsx";

export default function Updates() {
  const { data, error, loading } = useApi("/api/notices");
  useDocumentTitle("Library updates");
  return (
    <div className="page">
      <h1 className="page-title">Library updates</h1>
      {error ? (
        <ErrorState error={error} />
      ) : loading ? (
        <Skeleton lines={4} />
      ) : data.length ? (
        <ul className="notices">
          {data.map((n) => (
            <li className="notice" key={n.id}>
              <p className="update-meta">
                <span className="pill">{n.kind || "UPDATE"}</span>
                <time dateTime={n.createdAt}>{formatDate(n.createdAt)}</time>
              </p>
              <h2>{n.title}</h2>
              {n.body && <p>{n.body}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No updates right now." />
      )}
    </div>
  );
}
