// Environment configuration.
//
// Admin access (all three are required in production; see README):
//   ADMIN_USERNAME, ADMIN_PASSWORD_HASH (npm run admin:hash),
//   SESSION_SECRET (at least 32 bytes).
// The sign-in page is the public /login; the dashboard is /admin.
// ADMIN_DISABLED=true runs a public-only site with no admin at all.

import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHash } from "./utils/password.js";

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectDir = resolve(backendDir, "..");

export class ConfigError extends Error {}

function adminConfig(env, production, warnings) {
  if (env.ADMIN_DISABLED === "true") return { enabled: false };

  let username = env.ADMIN_USERNAME ?? "";
  let passwordHash = env.ADMIN_PASSWORD_HASH ?? "";
  let sessionSecret = env.SESSION_SECRET ?? "";
  let devPassword = "";

  // On Vercel with no admin settings at all, run public-only rather than take the
  // public site down: no admin routes exist. A partial or weak setup still fails.
  const anySet = [env.ADMIN_USERNAME, env.ADMIN_PASSWORD_HASH, env.SESSION_SECRET].some(Boolean);
  if (production && env.VERCEL && !anySet) {
    warnings.push(
      "No admin settings on Vercel: admin sign-in is off. Set ADMIN_USERNAME, ADMIN_PASSWORD_HASH and SESSION_SECRET to enable it."
    );
    return { enabled: false };
  }

  if (production) {
    const missing = [];
    if (!username) missing.push("ADMIN_USERNAME");
    if (!passwordHash) missing.push("ADMIN_PASSWORD_HASH");
    if (!sessionSecret) missing.push("SESSION_SECRET");
    if (missing.length) {
      throw new ConfigError(
        `Refusing to start in production without ${missing.join(", ")}. ` +
          "Run `npm run admin:hash -- --generate` to create them, or set ADMIN_DISABLED=true for a public-only site."
      );
    }
  } else {
    // Development: never a fixed default. Generate fresh values and print them once.
    if (!username) username = "admin";
    if (!sessionSecret) sessionSecret = randomBytes(48).toString("base64url");
    if (!passwordHash) {
      devPassword = randomBytes(12).toString("base64url");
      warnings.push(
        `Development admin: open /login and sign in as "${username}" with password ${devPassword} (generated for this run only).`
      );
    }
  }

  if (passwordHash && !parseHash(passwordHash)) {
    throw new ConfigError("ADMIN_PASSWORD_HASH is not a valid scrypt hash. Generate one with `npm run admin:hash`.");
  }
  if (Buffer.byteLength(sessionSecret) < 32) {
    throw new ConfigError("SESSION_SECRET must be at least 32 bytes. Generate one with `npm run admin:hash -- --generate`.");
  }
  return { enabled: true, username, passwordHash, devPassword, sessionSecret };
}

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  const warnings = [];
  const admin = adminConfig(env, production, warnings);

  // Vercel functions only have a temporary /tmp disk: data lasts as long as
  // one function instance, so load the sample there unless told otherwise.
  const vercel = Boolean(env.VERCEL);
  const ephemeral = vercel && !env.DB_PATH;
  if (ephemeral) {
    warnings.push("Running on Vercel without persistent storage: uploads and edits are temporary.");
  }
  const autoLoad =
    env.AUTO_LOAD_SAMPLE === undefined ? !production || ephemeral : env.AUTO_LOAD_SAMPLE === "true";
  // Vercel rejects function request bodies over 4.5 MB.
  const defaultUploadMb = vercel ? 4 : 10;

  // The built React app (npm run build -> web/dist).
  const publicDir = resolve(projectDir, env.PUBLIC_DIR || "web/dist");

  return {
    production,
    port: Number(env.PORT) || 5000,
    libraryName: env.LIBRARY_NAME || "Central Library",
    admin,
    secureCookies: production,
    dbPath: ephemeral ? "/tmp/library.db" : resolve(projectDir, env.DB_PATH || "data/library.db"),
    ephemeral,
    maxUploadBytes: (Number(env.MAX_UPLOAD_MB) || defaultUploadMb) * 1024 * 1024,
    corsOrigin: env.CORS_ORIGIN || "",
    autoLoadSample: autoLoad,
    sampleFile: resolve(backendDir, "sample-data/sample-books.csv"),
    trustProxy: env.TRUST_PROXY === "true",
    publicDir,
    warnings,
  };
}
