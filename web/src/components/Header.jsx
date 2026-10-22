import { Link, NavLink } from "react-router-dom";
import { useApi } from "../hooks.js";

// Public header: crest, lockup, Browse and Updates. Nothing here hints at an admin area.
export default function Header() {
  const { data } = useApi("/api/config");
  const name = data?.libraryName || "Central Library";
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link className="brand" to="/" aria-label={`Poornima University ${name}, book locator: home`}>
          <img className="brand-logo" src="/logo-header.png" width="56" height="56" alt="" />
          <span className="brand-text">
            <span className="brand-uni">Poornima University</span>
            <span className="brand-name">{name}</span>
            <span className="brand-sub">Book Locator</span>
          </span>
        </Link>
        <nav className="topnav" aria-label="Main">
          <NavLink to="/browse">Browse</NavLink>
          <NavLink to="/updates">Updates</NavLink>
        </nav>
      </div>
    </header>
  );
}
