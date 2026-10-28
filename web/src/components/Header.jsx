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
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="user-menu" ref={box}>
      <button type="button" className="login-pill login-icon" title={me.username} aria-label={`Signed in as ${me.username}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="avatar" aria-hidden="true">
          {me.username.slice(0, 1).toUpperCase()}
        </span>
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
              <Icon name="log-out" size={18} /> Sign out
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

export default function Header() {
  const { data } = useApi("/api/config");
  const { me, signOut } = useAuth();
  const location = useLocation();
  const name = data?.libraryName || "Central Library";
  return (
    <header className="topbar">
      <div className="topbar-band">
        <div className="topbar-inner">
          <Link className="brand" to="/" aria-label={`Poornima University ${name}, book locator: home`}>
            <img className="brand-logo" src="/logo-header.png" width="72" height="72" alt="" />
            <span className="brand-text">
              <span className="brand-uni">Poornima University</span>
              <span className="brand-name">{name}</span>
              <span className="brand-sub">Book Locator</span>
            </span>
          </Link>
          <nav className="topnav" aria-label="Main">
            {me ? (
              <UserMenu me={me} signOut={signOut} />
            ) : (
              <Link
                className="login-pill login-icon"
                to="/login"
                aria-label="Login"
                title="Login"
                state={{ from: location.pathname === "/login" ? undefined : location }}
              >
                <Icon name="user" size={22} />
              </Link>
            )}
            <span className="partner">
              <span className="partner-text">
                <small>PROUD PARTNER OF</small>
                <span>RAJASTHAN ROYALS</span>
              </span>
              <img src="/art/partner-logo.png" width="86" height="108" alt="Rajasthan Royals" />
            </span>
          </nav>
        </div>
      </div>
      <svg className="topbar-wave" viewBox="0 0 1440 34" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 0H1440V6C1180 40 980 4 720 18 470 32 260 30 0 10Z" fill="currentColor" />
      </svg>
    </header>
  );
}
