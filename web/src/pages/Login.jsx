import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useApi, useDocumentTitle } from "../hooks.js";
import { useAuth } from "../auth.jsx";
import { Icon } from "../components/Icon.jsx";

export default function Login() {
  useDocumentTitle("Login");
  const { me, signIn } = useAuth();
  const { data: config } = useApi("/api/config");
  const location = useLocation();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Fetch the admin screen while the password is typed, so it opens at once after Login.
  useEffect(() => {
    import("../admin/AdminApp.jsx").catch(() => {});
  }, []);

  // Logging in always opens the dashboard, unless it was an admin page that sent you here.
  const from = location.state?.from;
  const target = from?.pathname?.startsWith("/admin") ? `${from.pathname}${from.search ?? ""}` : "/admin";

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
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <span className="login-badge" aria-hidden="true">
          <Icon name="book-open" size={44} />
        </span>
        <h1>Admin Login</h1>
        <p className="login-sub">Library Management Portal</p>
        {config && !config.adminEnabled && (
          <p className="form-error" role="alert">
            Login is not set up on this server yet.
          </p>
        )}
        <label className="login-input">
          <Icon name="user" size={20} />
          <span className="visually-hidden">Username</span>
          <input
            id="username"
            placeholder="Username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck="false"
            required
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            autoFocus
          />
        </label>
        <label className="login-input">
          <Icon name="lock" size={20} />
          <span className="visually-hidden">Password</span>
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            placeholder="Password"
            autoComplete="current-password"
            required
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <button
            type="button"
            className="login-eye"
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((v) => !v)}
          >
            <Icon name={showPassword ? "eye-off" : "eye"} size={20} />
          </button>
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="login-submit" type="submit" disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
    </div>
  );
}
