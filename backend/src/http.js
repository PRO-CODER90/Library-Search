// Small HTTP toolkit on node:http: router, JSON/body helpers, CORS, static files.

import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize as normalizePath, sep } from "node:path";

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; " +
    "connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
};

export function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(data));
}

export async function readBody(req, maxBytes) {
  const declared = Number(req.headers["content-length"]);
  if (declared > maxBytes) throw new HttpError(413, `Request is too large (limit ${Math.round(maxBytes / 1048576)} MB).`);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, `Request is too large (limit ${Math.round(maxBytes / 1048576)} MB).`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req, maxBytes = 1048576) {
  if (!(req.headers["content-type"] ?? "").includes("application/json")) {
    throw new HttpError(415, "Send JSON (Content-Type: application/json).");
  }
  const body = await readBody(req, maxBytes);
  try {
    return JSON.parse(body.toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "Body is not valid JSON.");
  }
}

export function intParam(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  }
  // On Vercel the socket can be gone by the time the body has been read.
  return req.socket?.remoteAddress ?? "unknown";
}

/** "/api/books/:id" style routing with per-route options. */
export function createRouter() {
  const routes = [];
  return {
    add(method, pattern, handler, options = {}) {
      const keys = [];
      const regex = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)"))}/?$`);
      routes.push({ method, regex, keys, handler, ...options });
    },
    match(method, path) {
      let pathMatched = false;
      for (const route of routes) {
        const m = route.regex.exec(path);
        if (!m) continue;
        pathMatched = true;
        if (route.method !== method && !(method === "HEAD" && route.method === "GET")) continue;
        try {
          const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
          return { route, params };
        } catch {
          throw new HttpError(400, "Bad URL encoding.");
        }
      }
      return pathMatched ? { methodNotAllowed: true } : null;
    },
  };
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

/** Serve the frontend: real files from publicDir, else the SPA shell. */
export function createStaticHandler({ publicDir }) {
  async function serveFile(res, filePath, cacheControl) {
    const body = await readFile(filePath);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream",
      "Cache-Control": cacheControl,
    });
    res.end(body);
  }

  return async function serveStatic(req, res, url) {
    if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Method not allowed.");
    const root = publicDir;
    const rel = url.pathname.slice(1);
    let decoded;
    try {
      decoded = decodeURIComponent(rel);
    } catch {
      throw new HttpError(400, "Bad path.");
    }
    const filePath = normalizePath(join(root, decoded));
    if (filePath !== root && !filePath.startsWith(root + sep)) throw new HttpError(403, "Forbidden.");

    if (extname(filePath)) {
      try {
        if ((await stat(filePath)).isFile()) return await serveFile(res, filePath, "public, max-age=300");
      } catch (error) {
        if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      }
      throw new HttpError(404, "File not found.");
    }
    return serveFile(res, join(publicDir, "index.html"), "no-cache");
  };
}

/** Restrictive CORS: only the configured origin, only for /api. Returns true if handled. */
export function applyCors(req, res, allowedOrigin) {
  const origin = req.headers.origin;
  if (!allowedOrigin || !origin || origin !== allowedOrigin) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
    });
    res.end();
    return true;
  }
  return false;
}
