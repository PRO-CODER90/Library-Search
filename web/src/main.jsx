import { Component, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./styles/tokens.css";
import "./styles/app.css";

const RELOADED = "appReloadedOnce";

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
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    console.error("The page crashed:", error);
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
