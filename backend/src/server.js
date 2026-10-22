// App bootstrap: wires the database, routes, auth, rate limits and static
// frontend into one node:http handler. Run directly to start the server.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ConfigError, loadConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { HttpError, applyCors, clientIp, createRouter, createStaticHandler, sendJson, SECURITY_HEADERS } from "./http.js";
import { createAdminAuth } from "./middleware/adminAuth.js";
import { createAudit } from "./middleware/audit.js";
import { handleError } from "./middleware/errorHandler.js";
import { createRateLimiter } from "./utils/rateLimit.js";
import { importCsv } from "./services/library.js";
import { registerSearchRoutes } from "./routes/search.js";
import { registerBookRoutes } from "./routes/books.js";
import { registerFieldRoutes } from "./routes/fields.js";
import { registerUploadRoutes } from "./routes/upload.js";
import { registerNoticeRoutes } from "./routes/notices.js";
import { registerAdminSessionRoutes } from "./routes/adminSession.js";

// Admin-only endpoints answer exactly like a path that doesn't exist.
const notFound = () => new HttpError(404, "Unknown API endpoint.");

export function createApp({ db, config, log }) {
  const audit = createAudit({ trustProxy: config.trustProxy, log });
  const auth = createAdminAuth({
    admin: config.admin,
    secureCookies: config.secureCookies,
    trustProxy: config.trustProxy,
    audit,
    failureDelayMs: config.loginFailureDelayMs,
  });
  const limiters = {
    search: createRateLimiter({ max: config.searchRateLimit ?? 120, windowMs: 60 * 1000 }),
    upload: createRateLimiter({ max: config.uploadRateLimit ?? 10, windowMs: 60 * 60 * 1000 }),
  };
  const router = createRouter();
  const ctx = { db, config, auth, audit };
  registerSearchRoutes(router, ctx);
  registerBookRoutes(router, ctx);
  registerFieldRoutes(router, ctx);
  registerUploadRoutes(router, ctx);
  registerNoticeRoutes(router, ctx);
  if (auth.enabled) registerAdminSessionRoutes(router, ctx);
  const serveStatic = createStaticHandler(config);

  async function handleApi(req, res, url) {
    const found = router.match(req.method, url.pathname);
    if (!found) throw notFound();
    if (found.methodNotAllowed) {
      // Don't reveal that an admin-only path exists.
      if (!found.publicPath && !auth.session(req)) throw notFound();
      throw new HttpError(405, "Method not allowed.");
    }
    const { route, params } = found;

    let session = null;
    if (route.admin) {
      session = auth.session(req);
      if (!session) throw notFound();
      if (!auth.csrfOk(req)) throw new HttpError(403, "Forbidden.");
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
    }
    if (route.rateLimit) {
      const wait = limiters[route.rateLimit].hit(clientIp(req, config.trustProxy));
      if (wait) {
        const error = new HttpError(429, `Too many requests. Try again in ${wait} s.`);
        error.retryAfter = wait;
        throw error;
      }
    }

    const result = await route.handler({ req, res, url, params, session });
    if (result?.handled) return;
    if (result && typeof result === "object" && typeof result.status === "number" && !Array.isArray(result)) {
      if (result.status === 204) {
        res.writeHead(204, SECURITY_HEADERS);
        return res.end();
      }
      return sendJson(res, result.status, result.body);
    }
    return sendJson(res, 200, result);
  }

  return async function handler(req, res) {
    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch {
      return sendJson(res, 400, { error: "Bad request." });
    }
    try {
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        if (applyCors(req, res, config.corsOrigin)) return;
        await handleApi(req, res, url);
      } else {
        await serveStatic(req, res, url);
      }
    } catch (error) {
      handleError(error, req, res, url);
    }
  };
}

/** Load the sample CSV into an empty database (testing/demo only). */
export function loadSampleIfEmpty(db, config) {
  if (!config.autoLoadSample) return null;
  const empty = db.prepare("SELECT (SELECT count(*) FROM books) + (SELECT count(*) FROM fields) AS n").get().n === 0;
  if (!empty) return null;
  const report = importCsv(db, { buffer: readFileSync(config.sampleFile), filename: "sample-books.csv", mode: "replace" });
  db.prepare("INSERT INTO notices (title, body, kind) VALUES (?, ?, ?)").run(
    "Welcome to the library search",
    "Type any part of a title, author, subject or shelf code to see exactly where a book is kept.",
    "NEW"
  );
  return report;
}

function main() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(`Configuration error: ${error.message}`);
    process.exit(1);
  }
  for (const warning of config.warnings) console.warn(warning);
  const db = openDatabase(config.dbPath);
  const sample = loadSampleIfEmpty(db, config);
  if (sample) console.log(`Loaded ${sample.rowsImported} sample books (AUTO_LOAD_SAMPLE).`);

  const server = createServer(createApp({ db, config }));
  server.listen(config.port, () => {
    console.log(`${config.libraryName} search running at http://localhost:${config.port}`);
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      server.close();
      db.close();
      process.exit(0);
    });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
