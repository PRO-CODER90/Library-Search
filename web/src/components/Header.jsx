import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useApi } from "../hooks.js";
import { useAuth } from "../auth.jsx";
import { Icon } from "./Icon.jsx";

function UserMenu({ me, signOut }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.type === "keydown" ? event.key === "Escape" : !box.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="user-menu" ref={box}>
      <button type="button" className="signin-pill" aria-label={`Logged in as ${me.username}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="avatar" aria-hidden="true">
          {me.username.slice(0, 1).toUpperCase()}
        </span>
        <span>{me.username}</span>
      </button>
      {open && (
        <ul className="menu" role="menu">
          <li role="none">
            <Link role="menuitem" to="/admin">
              <Icon name="dashboard" size={18} /> Admin dashboard
            </Link>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                await signOut();
                if (pathname.startsWith("/admin")) navigate("/", { replace: true });
              }}
            >
              <Icon name="log-out" size={18} /> Logout
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

/** PU shield mark (inline, so it stays crisp at any size). */
function Shield() {
  return (
    <svg className="brand-shield" viewBox="0 0 40 46" width="40" height="46" aria-hidden="true">
      <path d="M20 2 36 7v15c0 11-7.5 17.5-16 21C11.5 39.5 4 33 4 22V7Z" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" />
      <text x="20" y="27.5" textAnchor="middle" fontSize="13" fontWeight="700" fontFamily="system-ui, sans-serif" fill="currentColor">
        PU
      </text>
    </svg>
  );
}

/** The Login screen's own header: PU | LIBRARY, with Library Admin and Home screen links. */
function LoginHeader() {
  return (
    <header className="topbar topbar-login">
      <div className="topbar-inner">
        <Link className="brand" to="/" aria-label="Poornima University Library: home">
          <Shield />
          <span className="brand-uni brand-uni-sans">
            <strong>Poornima</strong>
            <span>University</span>
          </span>
          <span className="brand-divider" aria-hidden="true" />
          <span className="brand-library">
            <Icon name="book-open" size={36} />
            Library
          </span>
        </Link>
        <nav className="login-links" aria-label="Login page">
          <Link to="/login" aria-current="page">
            Library Admin
          </Link>
          <span className="login-links-divider" aria-hidden="true" />
          <Link to="/">
            <Icon name="home" size={28} />
            <span>Home screen</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}

export default function Header() {
  const { data } = useApi("/api/config");
  const { me, signOut } = useAuth();
  const location = useLocation();
  // The Login button lives on the Home screen only; admin pages have their own Logout.
  const isHome = location.pathname === "/";
  const name = data?.libraryName || "Central Library";
  if (location.pathname === "/login") return <LoginHeader />;
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link className="brand" to="/" aria-label={`Poornima University ${name}, book locator: home`}>
          <Shield />
          <span className="brand-uni">
            Poornima
            <br />
            University
          </span>
          <span className="brand-divider" aria-hidden="true" />
          <span className="brand-lib">
            <strong>{name}</strong>
            <span>Book Locator</span>
          </span>
        </Link>
        <nav className="topnav" aria-label="Main">
          {isHome &&
            (me ? (
              <UserMenu me={me} signOut={signOut} />
            ) : (
              <Link className="signin-pill" to="/login">
                <Icon name="user" size={22} />
                <span>Login</span>
              </Link>
            ))}
        </nav>
      </div>
    </header>
  );
}
