// Central error handling: known errors become clean JSON; anything else is
// logged and reported without a stack trace.

import { HttpError, SECURITY_HEADERS, sendJson } from "../http.js";
import { CsvError } from "../services/csvImport.js";
import { RecordError } from "../services/library.js";

export function handleError(error, req, res, url) {
  let status = 500;
  let message = "Something went wrong on the server.";
  let details;
  const headers = {};

  if (error instanceof HttpError) {
    ({ status, message, details } = error);
    if (status === 429 && error.retryAfter) headers["Retry-After"] = String(error.retryAfter);
  } else if (error instanceof CsvError || error instanceof RecordError) {
    status = 422;
    message = error.message;
  } else {
    console.error(`[${new Date().toISOString()}] ${req.method} ${url?.pathname ?? req.url}`, error);
  }

  if (res.headersSent) return res.end();
  if (status === 404 && url && !url.pathname.startsWith("/api/")) {
    res.writeHead(404, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }
  sendJson(res, status, { error: message, ...(details ? { fields: details } : {}) }, headers);
}
