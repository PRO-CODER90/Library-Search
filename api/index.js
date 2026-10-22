// Vercel serverless entry point. vercel.json rewrites every /api/* request
// here; the same app that `npm start` runs handles it.
//
// Storage note: on Vercel the database lives in /tmp, which belongs to one
// function instance and disappears when that instance is recycled. The
// sample catalogue is loaded on each cold start. For a real catalogue that
// the admin edits, host the Node server with a persistent disk (see README).
//
// Admin settings: if they are missing, partial or invalid, the public site
// keeps running and the admin area is switched off entirely (fail closed).
// The reason is written to the function log, never to the response.

import { ConfigError, loadConfig } from "../backend/src/config.js";
import { openDatabase } from "../backend/src/db.js";
import { createApp, loadSampleIfEmpty } from "../backend/src/server.js";

let handler = null;

function buildHandler() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(`Admin configuration rejected, admin area disabled: ${error.message}`);
    config = loadConfig({ ...process.env, ADMIN_DISABLED: "true" });
  }
  for (const warning of config.warnings) console.warn(warning);
  const db = openDatabase(config.dbPath);
  loadSampleIfEmpty(db, config);
  return createApp({ db, config });
}

export default function vercelHandler(req, res) {
  // Rewrites may present the path as /api/index?path=<rest>; restore the
  // original /api/<rest> URL the router expects.
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/index" || url.pathname === "/api/index/") {
    const rest = url.searchParams.get("path") ?? "";
    url.searchParams.delete("path");
    const query = url.searchParams.toString();
    req.url = `/api/${rest}${query ? `?${query}` : ""}`;
  }
  try {
    handler ??= buildHandler();
  } catch (error) {
    console.error("Start-up failed:", error);
    res.writeHead(503, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    return res.end(JSON.stringify({ error: "The service is temporarily unavailable." }));
  }
  return handler(req, res);
}
