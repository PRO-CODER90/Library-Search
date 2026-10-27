// Admin sign-in, session check and sign-out under /api/auth/. The Login
// button is public; every admin API still checks the session on the server.

import { HttpError, readJson } from "../http.js";
import { CSRF_HEADER, CSRF_VALUE } from "../middleware/adminAuth.js";

const GENERIC = "Sign-in failed. Check the username and password.";

export function registerAdminSessionRoutes(router, { config, auth }) {
  router.add("POST", "/api/auth/login", async ({ req, res }) => {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    if (!auth.enabled) throw new HttpError(503, "Admin sign-in is not set up on this server.");
    if (req.headers[CSRF_HEADER] !== CSRF_VALUE) throw new HttpError(403, "Forbidden.");
    const locked = auth.lockedOut(req);
    if (locked) {
      const error = new HttpError(429, `Too many attempts. Try again in ${Math.ceil(locked / 60)} min.`);
      error.retryAfter = locked;
      throw error;
    }
    let body;
    try {
      body = await readJson(req, 4096);
    } catch {
      throw new HttpError(401, GENERIC);
    }
    const result = await auth.checkCredentials(req, { username: body?.username, password: body?.password });
    if (!result.ok) {
      const error = new HttpError(result.status, result.status === 429 ? "Too many attempts. Try again later." : GENERIC);
      error.retryAfter = result.retryAfter;
      throw error;
    }
    res.setHeader("Set-Cookie", result.setCookie);
    return { username: result.claims.u, expiresAt: result.claims.exp };
  });

  // Public: tells the header whether to show "Login" or the signed-in menu.
  router.add("GET", "/api/auth/me", ({ req, res }) => {
    res.setHeader("Cache-Control", "no-store");
    const session = auth.session(req);
    if (!session) return { authenticated: false };
    return {
      authenticated: true,
      username: session.u,
      expiresAt: session.exp,
      temporaryStorage: Boolean(config.ephemeral),
      maxUploadMb: Math.round(config.maxUploadBytes / 1048576),
    };
  });

  router.add(
    "POST",
    "/api/auth/logout",
    ({ req, res }) => {
      res.setHeader("Set-Cookie", auth.logout(req));
      return { status: 204 };
    },
    { admin: true }
  );
}
