import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useApi, useDocumentTitle } from "../hooks.js";
import { useAuth } from "../auth.jsx";

export default function Login() {
  useDocumentTitle("Login");
  const { me, signIn } = useAuth();
  const { data: config } = useApi("/api/config");
  const location = useLocation();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Back to the page the visitor came from, or the dashboard.
  const from = location.state?.from;
  const target = from ? `${from.pathname}${from.search ?? ""}` : "/admin";

  if (me) return <Navigate to={target} replace />;

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await signIn(form);
      navigate(target, { replace: true });
    } catch (err) {
      setError(err.message);
      setForm((f) => ({ ...f, password: "" }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page login-page">
      <form className="card form login-card" onSubmit={submit}>
        <h1>Library login</h1>
        <p className="muted">For library staff. Visitors can search without signing in.</p>
        {config && !config.adminEnabled && (
          <p className="form-error" role="alert">
            Sign-in is not set up on this server yet.
          </p>
        )}
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
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
