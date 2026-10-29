import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { SchemaProvider } from "./schema.jsx";
import { AuthProvider, useAuth } from "./auth.jsx";
import Header from "./components/Header.jsx";
import Footer from "./components/Footer.jsx";
import Home from "./pages/Home.jsx";
import Book from "./pages/Book.jsx";
import Browse from "./pages/Browse.jsx";
import Login from "./pages/Login.jsx";
import NotFound from "./pages/NotFound.jsx";

// The admin UI is a separate chunk, loaded only for a signed-in admin.
const AdminApp = lazy(() => import("./admin/AdminApp.jsx"));

const Loading = () => <div className="page-loading" aria-busy="true" />;

/** A signed-in admin goes straight to the dashboard instead of the public home page. */
function HomeOrDashboard() {
  const { me } = useAuth();
  return me ? <Navigate to="/admin" replace /> : <Home />;
}

/** /admin: signed out → /login (and back here after signing in). */
function AdminRoute() {
  const { me } = useAuth();
  const location = useLocation();
  if (me === undefined) return <Loading />;
  if (!me) return <Navigate to="/login" replace state={{ from: location }} />;
  return (
    <Suspense fallback={<Loading />}>
      <AdminApp />
    </Suspense>
  );
}

export default function App() {
  // The bare home page fits one screen; search results and other pages scroll.
  const { pathname } = useLocation();
  return (
    <AuthProvider>
      <SchemaProvider>
        <div className={pathname === "/" ? "shell shell-fit" : "shell"}>
          <a className="skip-link" href="#main">
            Skip to content
          </a>
          <Header />
          <main id="main" tabIndex={-1}>
            <Routes>
              <Route path="/" element={<HomeOrDashboard />} />
              <Route path="/search" element={<Home />} />
              <Route path="/book/:id" element={<Book />} />
              {/* Browse is no longer linked from the header; kept for old links. */}
              <Route path="/browse" element={<Browse />} />
              <Route path="/browse/:field/:value" element={<Browse />} />
              <Route path="/login" element={<Login />} />
              <Route path="/admin/*" element={<AdminRoute />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </main>
          <Footer />
        </div>
      </SchemaProvider>
    </AuthProvider>
  );
}
