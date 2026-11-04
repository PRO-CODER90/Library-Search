import { Component, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./styles/tokens.css";
import "./styles/app.css";

const RELOADED = "appReloadedOnce";

// Browser translation (Chrome/Edge "Translate this page") and some extensions
// move text React owns into their own <font> wrappers; React then fails with
// "Failed to execute 'removeChild'/'insertBefore' on 'Node'" when the screen
// changes. Tolerate that instead of crashing (well-known React workaround).
if (typeof Node === "function" && Node.prototype) {
  const removeChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function (child) {
    if (child.parentNode !== this) return child;
    return removeChild.call(this, child);
  };
  const insertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function (node, ref) {
    if (ref && ref.parentNode !== this) return insertBefore.call(this, node, null);
    return insertBefore.call(this, node, ref);
  };
}

/** Reload once (per tab session) to pick up a newer deploy; false if already tried. */
function reloadOnce() {
  try {
    if (sessionStorage.getItem(RELOADED) === "1") return false;
    sessionStorage.setItem(RELOADED, "1");
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

// After a new deploy, a page that was already open may ask for script files
// that no longer exist. Vite reports that here: reload to get the new version.
window.addEventListener("vite:preloadError", (event) => {
  if (reloadOnce()) event.preventDefault();
});

/**
 * Last line of defence: never leave a blank page. A crash shows a short
 * message with a Reload button; a missing-file crash reloads by itself once.
 */
class AppErrorBoundary extends Component {
  state = { failed: false, detail: "" };
  static getDerivedStateFromError(error) {
    return { failed: true, detail: `${error?.name ?? "Error"}: ${String(error?.message ?? error).slice(0, 300)}` };
  }
  componentDidCatch(error, info) {
    console.error("The page crashed:", error);
    // Where it happened (first component in the stack), shown on screen to help fix it.
    const where = info?.componentStack?.trim().split("\n")[0]?.trim() ?? "";
    if (where) this.setState((s) => ({ detail: `${s.detail}\n${where}` }));
    if (/dynamically imported module|Importing a module script failed|Failed to fetch/i.test(String(error?.message))) reloadOnce();
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page center crash">
        <p className="empty-title">Something went wrong while opening this page.</p>
        <button type="button" className="button" onClick={() => window.location.reload()}>
          Reload
        </button>
        <pre className="crash-detail">
          {this.state.detail}
          {"\n"}
          {window.location.pathname} · {navigator.userAgent.slice(0, 120)}
        </pre>
      </div>
    );
  }
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>
);

// A page that loaded fine clears the one-time reload flag for next time.
window.addEventListener("load", () => {
  setTimeout(() => {
    try {
      sessionStorage.removeItem(RELOADED);
    } catch {
      /* ignore */
    }
  }, 10000);
});
