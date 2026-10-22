import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDatabase } from "../src/db.js";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/server.js";
import { hashPassword } from "../src/utils/password.js";

const here = dirname(fileURLToPath(import.meta.url));
export const ADMIN = { username: "librarian", password: "correct-horse-battery-1", path: "test-desk-7f3k9q" };
export const ADMIN_ENV = {
  ADMIN_USERNAME: ADMIN.username,
  ADMIN_PASSWORD_HASH: await hashPassword(ADMIN.password),
  ADMIN_PATH: ADMIN.path,
  SESSION_SECRET: "s".repeat(48),
};
/** Pass `token: TOKEN` to a call to make it as the signed-in admin. */
export const TOKEN = Symbol("admin session");
export const CSRF = { "X-Requested-With": "library-admin" };
export const sample = (name) => readFileSync(join(here, "../sample-data", name));

/** Start an app on a random port with an in-memory database. */
export async function startApp(overrides = {}, env = {}) {
  const logs = [];
  const config = {
    ...loadConfig({ ...ADMIN_ENV, PUBLIC_DIR: "backend/tests/fixtures/site", ...env }),
    searchRateLimit: 100000,
    uploadRateLimit: 1000,
    loginFailureDelayMs: 0,
    ...overrides,
  };
  const db = openDatabase(":memory:");
  const server = createServer(createApp({ db, config, log: (line) => logs.push(JSON.parse(line)) }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let sessionCookie = null;

  async function raw(path, { method = "GET", body, headers = {} } = {}) {
    let payload = body;
    const h = { ...headers };
    if (body !== undefined && !(body instanceof FormData) && typeof body !== "string" && !Buffer.isBuffer(body)) {
      h["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + path, { method, headers: h, body: payload });
    const text = await res.text();
    let data = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    return { status: res.status, data, text, headers: res.headers };
  }

  async function login({ username = ADMIN.username, password = ADMIN.password, headers = CSRF } = {}) {
    const res = await raw(`/api/${ADMIN.path}/login`, { method: "POST", body: { username, password }, headers });
    const setCookie = res.headers.get("set-cookie");
    if (res.status === 200) sessionCookie = setCookie.split(";")[0];
    return { ...res, setCookie };
  }

  async function call(path, { token, headers = {}, ...opts } = {}) {
    const h = { ...headers };
    if (token === TOKEN) {
      if (!sessionCookie) await login();
      h.Cookie = sessionCookie;
      Object.assign(h, CSRF);
    } else if (typeof token === "string" && token) {
      h.Cookie = `lib_session=${token}`; // forged
      Object.assign(h, CSRF);
    }
    return raw(path, { ...opts, headers: h });
  }

  function upload(buffer, { filename = "books.csv", type = "text/csv", token = TOKEN, ...fields } = {}) {
    const form = new FormData();
    form.append("file", new Blob([buffer], { type }), filename);
    for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
    return call("/api/upload", { method: "POST", body: form, token });
  }

  return {
    db,
    base,
    logs,
    raw,
    call,
    login,
    upload,
    get cookie() {
      return sessionCookie;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
