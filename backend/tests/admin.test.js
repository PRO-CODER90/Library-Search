// Spec "React migration and admin lockdown" §2.6: hidden, server-enforced admin.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { ADMIN, ADMIN_ENV, CSRF, TOKEN, sample, startApp } from "./helpers.js";
import { ConfigError, loadConfig } from "../src/config.js";

const P = `/api/${ADMIN.path}`;

// Every admin-only endpoint (method, path, body).
const ADMIN_ENDPOINTS = [
  ["POST", "/api/upload", undefined],
  ["GET", "/api/upload", undefined], // wrong method on an admin-only path
  ["PATCH", "/api/fields/title", { label: "x" }],
  ["POST", "/api/books", { title: "x" }],
  ["PUT", "/api/books/1", { title: "x" }],
  ["DELETE", "/api/books/1", undefined],
  ["DELETE", "/api/books?confirm=yes", undefined],
  ["GET", "/api/export", undefined],
  ["POST", "/api/notices", { title: "x" }],
  ["DELETE", "/api/notices/1", undefined],
  ["GET", `${P}/me`, undefined],
  ["POST", `${P}/logout`, undefined],
];

function forgeCookie({ exp, username = ADMIN.username, secret = ADMIN_ENV.SESSION_SECRET }) {
  const key = createHash("sha256").update(`session:${secret}`).digest();
  const payload = Buffer.from(JSON.stringify({ u: username, sid: "forged", exp })).toString("base64url");
  return `lib_session=${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
}

describe("admin endpoints are invisible without a session", () => {
  let app;
  let unknown;
  before(async () => {
    app = await startApp();
    unknown = await app.raw("/api/definitely-not-a-route");
  });
  after(() => app.close());

  const variants = {
    "no cookie": {},
    "forged cookie": { Cookie: "lib_session=abc.def" },
    "expired cookie": () => ({ Cookie: forgeCookie({ exp: Date.now() - 1000 }) }),
    "cookie signed with another secret": () => ({ Cookie: forgeCookie({ exp: Date.now() + 60000, secret: "x".repeat(40) }) }),
    "old x-admin-token header": { "x-admin-token": "dev-admin-token" },
  };

  for (const [name, h] of Object.entries(variants)) {
    test(`every admin endpoint → 404 with ${name}`, async () => {
      const headers = { ...CSRF, ...(typeof h === "function" ? h() : h) };
      for (const [method, path, body] of ADMIN_ENDPOINTS) {
        const res = await app.raw(path, { method, body, headers });
        assert.equal(res.status, 404, `${method} ${path} → ${res.status}`);
        assert.equal(res.text, unknown.text, `${method} ${path} body differs from an unknown route`);
      }
    });
  }

  test("a validly signed, unexpired cookie does work (control)", async () => {
    const res = await app.raw(`${P}/me`, { headers: { Cookie: forgeCookie({ exp: Date.now() + 60000 }) } });
    assert.equal(res.status, 200);
  });

  test("public config exposes nothing about admin", async () => {
    const config = await app.raw("/api/config");
    assert.deepEqual(Object.keys(config.data), ["libraryName"]);
    for (const path of ["/api/config", "/api/health", "/api/stats", "/api/fields", "/api/notices", "/api/search?q=a"]) {
      const res = await app.raw(path);
      assert.doesNotMatch(res.text, /admin|staff|token/i, `${path} mentions admin`);
    }
  });

  test("the old /api/admin/* and /api/auth/login paths don't exist", async () => {
    for (const path of ["/api/admin/check", "/api/admin/me", "/api/admin/login", "/api/auth/login"]) {
      for (const method of ["GET", "POST"]) {
        assert.equal((await app.raw(path, { method, headers: CSRF, body: method === "POST" ? {} : undefined })).status, 404, path);
      }
    }
  });
});

describe("sign-in, session cookie, CSRF and sign-out", () => {
  test("correct credentials set an HttpOnly, SameSite=Strict, 8-hour cookie", async () => {
    const app = await startApp();
    const res = await app.login();
    assert.equal(res.status, 200);
    assert.equal(res.data.username, ADMIN.username);
    const c = res.setCookie;
    assert.match(c, /^lib_session=[\w-]+\.[\w-]+; /);
    assert.match(c, /; HttpOnly/);
    assert.match(c, /; SameSite=Strict/);
    assert.match(c, /; Path=\//);
    assert.match(c, /; Max-Age=28800/);
    assert.doesNotMatch(c, /Secure/, "not Secure over plain http in development");
    assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.doesNotMatch(res.text, /lib_session/, "the token is only in the HttpOnly cookie, not the body");
    await app.close();
  });

  test("in production the cookie is Secure and uses the __Host- prefix", async () => {
    const app = await startApp({ secureCookies: true });
    const res = await app.login();
    assert.match(res.setCookie, /^__Host-lib_session=/);
    assert.match(res.setCookie, /; Secure/);
    await app.close();
  });

  test("wrong username and wrong password give the same generic error", async () => {
    const app = await startApp();
    const a = await app.login({ password: "wrong-password-123" });
    const b = await app.login({ username: "someone", password: ADMIN.password });
    const c = await app.raw(`${P}/login`, { method: "POST", body: "not json", headers: { ...CSRF, "Content-Type": "application/json" } });
    assert.equal(a.status, 401);
    assert.deepEqual(a.data, b.data);
    assert.deepEqual(a.data, c.data);
    assert.equal(a.setCookie, null);
    assert.doesNotMatch(a.text, /user not found|no such user|wrong password/i, "doesn't say which part was wrong");
    await app.close();
  });

  test("the 11th failure within 15 minutes → 429, even with the right password", async () => {
    const app = await startApp();
    const statuses = [];
    for (let i = 0; i < 10; i++) statuses.push((await app.login({ password: `wrong-${i}` })).status);
    assert.deepEqual(statuses, Array(10).fill(401));
    const locked = await app.login();
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers.get("retry-after")) > 0);
    await app.close();
  });

  test("a failed login is slowed down", async () => {
    const app = await startApp({ loginFailureDelayMs: 300 });
    const t = Date.now();
    await app.login({ password: "nope-nope-nope" });
    assert.ok(Date.now() - t >= 300);
    await app.close();
  });

  test("login without the CSRF header → 403", async () => {
    const app = await startApp();
    const res = await app.login({ headers: {} });
    assert.equal(res.status, 403);
    await app.close();
  });

  test("state-changing admin calls without the CSRF header → 403 (reads are fine)", async () => {
    const app = await startApp();
    await app.login();
    const cookie = app.cookie;
    const post = await app.raw("/api/notices", { method: "POST", body: { title: "x" }, headers: { Cookie: cookie } });
    const del = await app.raw("/api/books?confirm=yes", { method: "DELETE", headers: { Cookie: cookie } });
    const wrong = await app.raw("/api/notices", { method: "POST", body: { title: "x" }, headers: { Cookie: cookie, "X-Requested-With": "XMLHttpRequest" } });
    const read = await app.raw(`${P}/me`, { headers: { Cookie: cookie } });
    assert.deepEqual([post.status, del.status, wrong.status, read.status], [403, 403, 403, 200]);
    assert.ok((await app.raw("/api/health")).data.books >= 0);
    await app.close();
  });

  test("each login issues a new session (rotation)", async () => {
    const app = await startApp();
    const a = (await app.login()).setCookie.split(";")[0];
    const b = (await app.login()).setCookie.split(";")[0];
    assert.notEqual(a, b);
    await app.close();
  });

  test("sign-out clears the cookie and the old session stops working", async () => {
    const app = await startApp();
    await app.login();
    const cookie = app.cookie;
    assert.equal((await app.raw(`${P}/me`, { headers: { Cookie: cookie } })).status, 200);
    const out = await app.raw(`${P}/logout`, { method: "POST", headers: { Cookie: cookie, ...CSRF } });
    assert.equal(out.status, 204);
    assert.match(out.headers.get("set-cookie"), /^lib_session=; .*Max-Age=0/);
    assert.equal((await app.raw(`${P}/me`, { headers: { Cookie: cookie } })).status, 404);
    assert.equal((await app.raw("/api/export", { headers: { Cookie: cookie } })).status, 404);
    await app.close();
  });

  test("signed-in admin can upload, edit fields and post an update", async () => {
    const app = await startApp();
    assert.equal((await app.upload(sample("sample-books.csv"))).status, 200);
    assert.equal((await app.call("/api/fields/year", { method: "PATCH", body: { label: "Y" }, token: TOKEN })).status, 404, "unknown field");
    assert.equal((await app.call("/api/fields/title", { method: "PATCH", body: { label: "Book" }, token: TOKEN })).status, 200);
    assert.equal((await app.call("/api/notices", { method: "POST", body: { title: "Hello" }, token: TOKEN })).status, 201);
    const me = await app.call(`${P}/me`, { token: TOKEN });
    assert.equal(me.data.authenticated, true);
    await app.close();
  });
});

describe("audit log", () => {
  test("logins, failures and destructive actions are logged without secrets", async () => {
    const app = await startApp();
    await app.login({ password: "wrong-password-123" });
    await app.upload(sample("sample-books.csv"), { mode: "replace" });
    await app.call("/api/books/1", { method: "DELETE", token: TOKEN });
    await app.call("/api/books?confirm=yes", { method: "DELETE", token: TOKEN });
    const events = app.logs.map((l) => l.audit);
    for (const e of ["login_failed", "login", "replace_catalogue", "delete_book", "delete_all_books"]) {
      assert.ok(events.includes(e), `missing ${e} in ${events}`);
    }
    const all = JSON.stringify(app.logs);
    assert.doesNotMatch(all, /wrong-password-123|correct-horse|lib_session/);
    assert.ok(app.logs.every((l) => l.at && l.ip));
    await app.close();
  });
});

describe("configuration safety", () => {
  const prod = { NODE_ENV: "production" };

  test("production refuses to start without the admin settings", () => {
    assert.throws(() => loadConfig(prod), ConfigError);
    for (const missing of Object.keys(ADMIN_ENV)) {
      const env = { ...prod, ...ADMIN_ENV };
      delete env[missing];
      assert.throws(() => loadConfig(env), (e) => e instanceof ConfigError && e.message.includes(missing), missing);
    }
    assert.doesNotThrow(() => loadConfig({ ...prod, ...ADMIN_ENV }));
  });

  test("weak or invalid settings are rejected", () => {
    const base = { ...prod, ...ADMIN_ENV };
    assert.throws(() => loadConfig({ ...base, SESSION_SECRET: "x".repeat(31) }), /32 bytes/);
    assert.throws(() => loadConfig({ ...base, ADMIN_PASSWORD_HASH: "plaintext-password" }), /scrypt/);
    assert.throws(() => loadConfig({ ...base, ADMIN_PATH: "admin" }), /ADMIN_PATH/);
    assert.throws(() => loadConfig({ ...base, ADMIN_PATH: "short" }), /ADMIN_PATH/);
    assert.throws(() => loadConfig({ ...base, ADMIN_PATH: "Has Spaces!!" }), /ADMIN_PATH/);
  });

  test("on Vercel with no admin settings at all: public-only, not a crash; partial settings still fail", () => {
    const vercel = { ...prod, VERCEL: "1" };
    const config = loadConfig(vercel);
    assert.equal(config.admin.enabled, false);
    assert.ok(config.warnings.some((w) => /public-only/.test(w)));
    assert.throws(() => loadConfig({ ...vercel, ADMIN_USERNAME: "x" }), ConfigError);
    assert.equal(loadConfig({ ...vercel, ...ADMIN_ENV }).admin.enabled, true);
  });

  test("ADMIN_DISABLED=true runs public-only: no admin routes at all", async () => {
    assert.doesNotThrow(() => loadConfig({ ...prod, ADMIN_DISABLED: "true" }));
    const app = await startApp({}, { ADMIN_DISABLED: "true" });
    assert.equal((await app.login()).status, 404);
    assert.equal((await app.raw("/api/search?q=a")).status, 200);
    await app.close();
  });

  test("development never uses a fixed default password", () => {
    const a = loadConfig({});
    const b = loadConfig({});
    assert.ok(a.admin.devPassword && a.admin.devPassword !== b.admin.devPassword);
    assert.notEqual(a.admin.path, b.admin.path);
    assert.ok(a.warnings.some((w) => w.includes(a.admin.devPassword)), "printed once at start-up");
    assert.ok(!JSON.stringify(a).includes("dev-admin-token"));
  });
});
