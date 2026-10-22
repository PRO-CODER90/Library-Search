import { Link } from "react-router-dom";
import { useDocumentTitle } from "../hooks.js";
import { EmptyState } from "../components/ui.jsx";

export default function NotFound() {
  useDocumentTitle("Not found");
  return (
    <div className="page">
      <EmptyState title="This page isn't on any shelf.">The link may be old or mistyped.</EmptyState>
      <p className="center">
        <Link className="button" to="/">
          Search the catalogue
        </Link>
      </p>
    </div>
  );
}
