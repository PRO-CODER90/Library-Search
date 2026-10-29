// Environment configuration.
//
// Admin access (all three are required in production; see README):
//   ADMIN_USERNAME, ADMIN_PASSWORD_HASH (npm run admin:hash),
//   SESSION_SECRET (at least 32 bytes).
// The sign-in page is the public /login; the dashboard is /admin.
// ADMIN_DISABLED=true runs a public-only site with no admin at all.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHash } from "./utils/password.js";

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectDir = resolve(backendDir, "..");

export class ConfigError extends Error {}

/** Forgive common paste mistakes: spaces, quotes, or "NAME=" pasted into the value. */
export function cleanSetting(value, name) {
  let v = String(value ?? "").trim();
  if (v.startsWith(`${name}=`)) v = v.slice(name.length + 1).trim();
  if (v.length > 1 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) v = v.slice(1, -1).trim();
  // Hashes and keys never contain spaces: drop anything pasted after the first line or space.
  if (name !== "ADMIN_USERNAME") v = v.split(/\s/)[0];
  return v;
}

function persistentSecret(file) {
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  mkdirSync(dirname(file), { recursive: true });
  const secret = randomBytes(48).toString("base64url");
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

function adminConfig(env, production, warnings) {
  if (env.ADMIN_DISABLED === "true") return { enabled: false };

  let username = cleanSetting(env.ADMIN_USERNAME, "ADMIN_USERNAME");
  let passwordHash = cleanSetting(env.ADMIN_PASSWORD_HASH, "ADMIN_PASSWORD_HASH");
  let sessionSecret = cleanSetting(env.SESSION_SECRET, "SESSION_SECRET");
  let devPassword = "";
  // SESSION_SECRET=auto (library PC): a random secret made on first start and
  // kept in data/session-secret, so the .env file holds no signing key.
  if (sessionSecret === "auto") {
    if (env.VERCEL) throw new ConfigError("SESSION_SECRET=auto is for a library PC; on Vercel set a real random value.");
    sessionSecret = persistentSecret(resolve(projectDir, "data/session-secret"));
  }

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
    // Describe the shape (never the value) so a bad paste is easy to spot.
    const shape = `starts with "scrypt:": ${passwordHash.startsWith("scrypt:") ? "yes" : "no"}, ${passwordHash.split(":").length} of 6 parts, ${passwordHash.length} of 126 characters, cost "${passwordHash.split(":").slice(1, 4).join(":")}" (expected 32768:8:1)`;
    throw new ConfigError(`ADMIN_PASSWORD_HASH is not a valid scrypt hash (${shape}). Generate one with \`npm run admin:hash\`.`);
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
  // Persistent visit counter (Upstash Redis REST). Server-side only.
  const upstash =
    env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
      ? { url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }
      : null;
  if (ephemeral && !upstash) {
    warnings.push(
      "ERROR: hit counter has no persistent store, so /api/visit answers 503. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (Vercel → Storage → Upstash Redis)."
    );
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
    // Secure cookies need HTTPS; a library PC served over plain http sets SECURE_COOKIES=false.
    secureCookies: env.SECURE_COOKIES === undefined ? production : env.SECURE_COOKIES === "true",
    dbPath: ephemeral ? "/tmp/library.db" : resolve(projectDir, env.DB_PATH || "data/library.db"),
    ephemeral,
    upstash,
    maxUploadBytes: (Number(env.MAX_UPLOAD_MB) || defaultUploadMb) * 1024 * 1024,
    corsOrigin: env.CORS_ORIGIN || "",
    autoLoadSample: autoLoad,
    // The library's catalogue in the Holding_Creation template (same format as future uploads).
    sampleFile: resolve(backendDir, env.SAMPLE_FILE || "sample-data/catalogue.xlsx"),
    trustProxy: env.TRUST_PROXY === "true",
    publicDir,
    warnings,
  };
}
