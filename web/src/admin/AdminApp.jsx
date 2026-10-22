// Library admin. Mounted only at the hidden ADMIN_PATH and loaded as its own
// chunk. Every API call goes to the server, which enforces the session.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiError, api } from "../api.js";
import { ToastProvider } from "./parts.jsx";
import Books from "./Books.jsx";
import Upload from "./Upload.jsx";
import Fields from "./Fields.jsx";
import Notices from "./Notices.jsx";
import "./admin.css";

const AdminContext = createContext(null);
export const useAdmin = () => useContext(AdminContext);

const TABS = [
  ["books", "Books"],
  ["upload", "Upload"],
  ["fields", "Fields"],
  ["notices", "Updates"],
];

function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex,nofollow";
    document.head.append(meta);
    document.title = "Library admin";
    return () => meta.remove();
  }, []);
}

function Login({ apiBase, onSignedIn }) {
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api(`${apiBase}/login`, { method: "POST", body: form, admin: true });
      setForm({ username: "", password: "" });
      onSignedIn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="admin-login">
      <form className="card form" onSubmit={submit}>
        <h1>Library admin</h1>
        <div className="field">
          <label htmlFor="username">Username</label>
          <input id="username" autoComplete="username" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button" type="submit" disabled={busy}>
          Sign in
        </button>
      </form>
    </div>
  );
}

export default function AdminApp({ base, apiBase }) {
  useNoIndex();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [me, setMe] = useState(undefined); // undefined = checking, null = signed out

  const check = useCallback(() => {
    api(`${apiBase}/me`)
      .then(setMe)
      .catch(() => setMe(null));
  }, [apiBase]);
  useEffect(check, [check]);

  /** Admin API call: on a lost session, drop back to the sign-in form. */
  const call = useCallback(
    async (path, options = {}) => {
      try {
        return await api(path, { ...options, admin: true });
      } catch (error) {
        if (error instanceof ApiError && error.status === 404 && path !== `${apiBase}/me`) {
          const still = await api(`${apiBase}/me`).catch(() => null);
          if (!still) setMe(null);
        }
        throw error;
      }
    },
    [apiBase]
  );

  async function signOut() {
    await api(`${apiBase}/logout`, { method: "POST", admin: true }).catch(() => {});
    setMe(null);
    navigate(base, { replace: true });
  }

  if (me === undefined) return <div className="page-loading" aria-busy="true" />;
  if (!me) return <Login apiBase={apiBase} onSignedIn={check} />;

  const tab = pathname.slice(base.length).split("/")[1] || "books";
  const Screen = { books: Books, upload: Upload, fields: Fields, notices: Notices }[tab] ?? Books;

  return (
    <AdminContext.Provider value={{ me, call, apiBase }}>
      <ToastProvider>
        <header className="admin-bar">
          <div className="admin-bar-inner">
            <span className="admin-brand">
              <img src="/logo-header.png" width="36" height="36" alt="" />
              Library admin
            </span>
            <nav aria-label="Admin sections">
              {TABS.map(([key, label]) => (
                <Link key={key} to={`${base}/${key}`} aria-current={tab === key ? "page" : undefined}>
                  {label}
                </Link>
              ))}
            </nav>
            <span className="admin-user">
              {me.username}
              <button type="button" className="button button-small button-ghost-light" onClick={signOut}>
                Sign out
              </button>
            </span>
          </div>
        </header>
        <main className="admin-main" id="main">
          {me.temporaryStorage && (
            <p className="storage-note">
              <strong>Temporary storage.</strong> This deployment has no permanent disk: uploads and edits last only until the server
              restarts. Host the app with a persistent disk for the real catalogue.
            </p>
          )}
          <Screen />
        </main>
      </ToastProvider>
    </AdminContext.Provider>
  );
}
