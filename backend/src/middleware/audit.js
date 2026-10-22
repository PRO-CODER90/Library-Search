// Audit log: one JSON line per security-relevant event (logins, logouts,
// destructive changes). Never includes passwords or tokens.

import { clientIp } from "../http.js";

export function createAudit({ trustProxy, log = (line) => console.info(line) }) {
  return function audit(event, req, details = {}) {
    log(JSON.stringify({ audit: event, at: new Date().toISOString(), ip: clientIp(req, trustProxy), ...details }));
  };
}
