import { lazy, Suspense, useEffect, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { SchemaProvider } from "./schema.jsx";
import Header from "./components/Header.jsx";
import Footer from "./components/Footer.jsx";
import Home from "./pages/Home.jsx";
import Book from "./pages/Book.jsx";
import Browse from "./pages/Browse.jsx";
import Updates from "./pages/Updates.jsx";
import NotFound from "./pages/NotFound.jsx";

// The admin UI is a separate chunk; public visitors never download it.
const AdminApp = lazy(() => import("./admin/AdminApp.jsx"));

/* global __ADMIN_PATH_HASH__ */
const ADMIN_HASH = typeof __ADMIN_PATH_HASH__ === "string" ? __ADMIN_PATH_HASH__ : "";

async function sha256Hex(text) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const PUBLIC_SEGMENTS = new Set(["", "search", "book", "browse", "updates"]);

/** Is the first path segment the hidden admin path? Only its hash is in the bundle. */
function useAdminSegment() {
  const { pathname } = useLocation();
  const segment = pathname.split("/")[1] ?? "";
  const skip = !ADMIN_HASH || PUBLIC_SEGMENTS.has(segment) || !globalThis.crypto?.subtle;
  const [result, setResult] = useState({ segment: null, ok: false });
  useEffect(() => {
    if (skip) return undefined;
    let alive = true;
    sha256Hex(segment).then((hash) => alive && setResult({ segment, ok: hash === ADMIN_HASH }));
    return () => {
      alive = false;
    };
  }, [segment, skip]);
  if (skip) return { segment, ok: false, checked: true };
  return { segment, ok: result.segment === segment && result.ok, checked: result.segment === segment };
}

export default function App() {
  const admin = useAdminSegment();

  if (admin.ok) {
    return (
      <Suspense fallback={<div className="page-loading" aria-busy="true" />}>
        <AdminApp base={`/${admin.segment}`} apiBase={`/api/${admin.segment}`} />
      </Suspense>
    );
  }

  return (
    <SchemaProvider>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header />
      <main id="main" tabIndex={-1}>
        {admin.checked ? (
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/search" element={<Home />} />
            <Route path="/book/:id" element={<Book />} />
            <Route path="/browse" element={<Browse />} />
            <Route path="/browse/:field/:value" element={<Browse />} />
            <Route path="/updates" element={<Updates />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        ) : (
          <div className="page-loading" aria-busy="true" />
        )}
      </main>
      <Footer />
    </SchemaProvider>
  );
}
