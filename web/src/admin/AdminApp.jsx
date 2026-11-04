// Library admin at /admin, loaded as its own chunk for a signed-in admin.
// Every API call goes to the server, which enforces the session.

import { createContext, useCallback, useContext, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiError, api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { ToastProvider } from "./parts.jsx";
import Books from "./Books.jsx";
import Upload from "./Upload.jsx";
import Fields from "./Fields.jsx";
import Support from "./Support.jsx";
import "./admin.css";

const AdminContext = createContext(null);
export const useAdmin = () => useContext(AdminContext);

const TABS = [
  ["books", "Books"],
  ["upload", "Upload"],
  ["fields", "Fields"],
  ["support", "Support"],
];

function useNoIndex() {
  useEffect(() => {
    try {
      sessionStorage.removeItem("adminChunkReload");
    } catch {
      /* ignore */
    }
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex,nofollow";
    document.head.append(meta);
    document.title = "Library admin";
    return () => meta.remove();
  }, []);
}

export default function AdminApp() {
  useNoIndex();
  const { pathname } = useLocation();
  const { me, signedOut, signOut } = useAuth();
  const navigate = useNavigate();
  const logout = async () => {
    await signOut();
    navigate("/", { replace: true });
  };

  /** Admin API call: on a lost session (401), drop back to the sign-in page. */
  const call = useCallback(
    async (path, options = {}) => {
      try {
        return await api(path, { ...options, admin: true });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) signedOut();
        throw error;
      }
    },
    [signedOut]
  );

  const tab = pathname.split("/")[2] || "books";
  const Screen = { books: Books, upload: Upload, fields: Fields, support: Support }[tab] ?? Books;

  return (
    <AdminContext.Provider value={{ me, call }}>
      <ToastProvider>
        <nav className="admin-bar" aria-label="Admin sections">
          <div className="admin-bar-inner">
            <span className="admin-brand">Admin dashboard</span>
            <div className="admin-tabs">
              {TABS.map(([key, label]) => (
                <Link key={key} to={key === "support" && tab !== "support" ? `/admin/support?from=${tab}` : `/admin/${key}`} aria-current={tab === key ? "page" : undefined}>
                  {label}
                </Link>
              ))}
            </div>
            <button type="button" className="button button-small button-ghost admin-logout" onClick={logout}>
              Logout
            </button>
          </div>
        </nav>
        <div className="admin-main">
          {me.temporaryStorage && (
            <p className="storage-note">
              <strong>Temporary storage.</strong> This deployment has no permanent disk: uploads and edits last only until the server
              restarts. Host the app with a persistent disk for the real catalogue.
            </p>
          )}
          <Screen />
        </div>
      </ToastProvider>
    </AdminContext.Provider>
  );
}
