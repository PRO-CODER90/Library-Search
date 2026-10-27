// Admin authentication: username + scrypt-hashed password, then a signed
// session in an HttpOnly; SameSite=Strict cookie (Secure in production).
//
// - Anything admin-only answers 401 to a request without a valid session
//   (enforced in server.js for every admin route).
// - State-changing admin requests also need the X-Requested-With header (CSRF).
// - Failed logins are rate limited per IP and slowed down; every error is generic.
// - Sessions are stateless (HMAC-signed, 8 h) so they work across serverless
//   instances; logout revokes the session id on this instance and clears the cookie.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { clientIp } from "../http.js";
import { createRateLimiter } from "../utils/rateLimit.js";
import { hashPassword, parseHash, verifyPassword } from "../utils/password.js";

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const CSRF_HEADER = "x-requested-with";
export const CSRF_VALUE = "library-admin";
const SAFE_METHODS = new Set(["GET", "HEAD"]);

const digest = (value) => createHash("sha256").update(String(value)).digest();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function createAdminAuth({ admin, secureCookies, trustProxy, audit = () => {}, failureDelayMs = 400 }) {
  if (!admin?.enabled) {
    return { enabled: false, session: () => null, csrfOk: () => true };
  }

  const cookieName = secureCookies ? "__Host-lib_session" : "lib_session";
  const hmacKey = digest(`session:${admin.sessionSecret}`);
  const failures = createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });
  const revoked = new Map(); // session id -> expiry (best effort, this instance)
  let passwordHash = admin.passwordHash ? parseHash(admin.passwordHash) : null;
  const ready = admin.devPassword
    ? hashPassword(admin.devPassword).then((h) => (passwordHash = parseHash(h)))
    : Promise.resolve();

  const sign = (payload) => createHmac("sha256", hmacKey).update(payload).digest("base64url");

  function cookie(value, maxAgeSeconds) {
    return [
      `${cookieName}=${value}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      `Max-Age=${maxAgeSeconds}`,
      ...(secureCookies ? ["Secure"] : []),
    ].join("; ");
  }

  function issue(now = Date.now()) {
    const claims = { u: admin.username, sid: randomBytes(16).toString("base64url"), exp: now + SESSION_TTL_MS };
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return { token: `${payload}.${sign(payload)}`, claims };
  }

  /** The verified session for this request, or null. */
  function session(req, now = Date.now()) {
    const token = parseCookies(req.headers.cookie)[cookieName];
    if (!token) return null;
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;
    const expected = sign(payload);
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    let claims;
    try {
      claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      return null;
    }
    if (!claims || claims.u !== admin.username || !(claims.exp > now) || revoked.has(claims.sid)) return null;
    return claims;
  }

  return {
    enabled: true,
    cookieName,
    session,

    csrfOk(req) {
      return SAFE_METHODS.has(req.method) || req.headers[CSRF_HEADER] === CSRF_VALUE;
    },

    /** Verify a login. Success: { ok, setCookie }. Failure: { ok: false, status, retryAfter }, always generic. */
    async checkCredentials(req, { username, password }) {
      await ready;
      const ip = clientIp(req, trustProxy);
      const userOk = timingSafeEqual(digest(username ?? ""), digest(admin.username));
      const passOk = await verifyPassword(typeof password === "string" ? password : "", passwordHash);
      if (userOk && passOk) {
        failures.reset(ip);
        const { token, claims } = issue();
        audit("login", req, { username: admin.username });
        return { ok: true, setCookie: cookie(token, SESSION_TTL_MS / 1000), claims };
      }
      const retryAfter = failures.hit(ip);
      audit("login_failed", req, { username: String(username ?? "").slice(0, 64) });
      await sleep(failureDelayMs + Math.floor(Math.random() * 200));
      return { ok: false, status: retryAfter ? 429 : 401, retryAfter };
    },

    /** True if this IP is already locked out (checked before doing any work). */
    lockedOut(req) {
      return failures.peek(clientIp(req, trustProxy));
    },

    logout(req) {
      const claims = session(req);
      if (claims) {
        revoked.set(claims.sid, claims.exp);
        for (const [sid, exp] of revoked) if (exp < Date.now()) revoked.delete(sid);
        audit("logout", req, { username: claims.u });
      }
      return cookie("", 0);
    },
  };
}
