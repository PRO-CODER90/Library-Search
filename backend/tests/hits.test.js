// Spec "Fix counter": the hit count lives in a persistent store and never resets.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db.js";
import { loadConfig } from "../src/config.js";
import { istDate } from "../src/services/hitStore.js";
import { startApp } from "./helpers.js";

const visit = (app) => app.call("/api/visit", { method: "POST" });

describe("hit counter (SQLite on a persistent disk)", () => {
  test("5 visits → +5; GET reads without counting", async () => {
    const app = await startApp();
    const start = (await app.call("/api/visits")).data.total;
    for (let i = 0; i < 5; i++) await visit(app);
    assert.equal((await app.call("/api/visits")).data.total, start + 5);
    assert.equal((await app.call("/api/visits")).data.total, start + 5);
    await app.close();
  });

  test("concurrent visits are not lost", async () => {
    const app = await startApp();
    const results = await Promise.all(Array.from({ length: 20 }, () => visit(app)));
    assert.ok(results.every((r) => r.status === 200));
    assert.equal((await app.call("/api/visits")).data.total, 20);
    assert.equal(new Set(results.map((r) => r.data.total)).size, 20, "every visit got its own number");
    await app.close();
  });

  test("a restart (new instance, same database file) keeps the total", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hits-"));
    const file = join(dir, "library.db");
    const first = await startApp({}, {}, { db: openDatabase(file) });
    for (let i = 0; i < 3; i++) await visit(first);
    await first.close();
    const second = await startApp({}, {}, { db: openDatabase(file) });
    assert.equal((await second.call("/api/visits")).data.total, 3);
    assert.equal((await visit(second)).data.total, 4);
    await second.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("hit counter (Upstash Redis)", () => {
  function fakeUpstash() {
    const kv = new Map();
    const calls = [];
    const run = ([cmd, key, field]) => {
      if (cmd === "INCR") kv.set(key, (kv.get(key) ?? 0) + 1);
      else if (cmd === "HINCRBY") kv.set(`${key}/${field}`, (kv.get(`${key}/${field}`) ?? 0) + 1);
      else if (cmd === "GET") return { result: kv.has(key) ? String(kv.get(key)) : null };
      return { result: kv.get(key) };
    };
    const fetchImpl = async (url, init) => {
      calls.push({ url, auth: init.headers.Authorization });
      const body = JSON.parse(init.body);
      const out = url.endsWith("/pipeline") ? body.map(run) : run(body);
      return { ok: true, json: async () => out };
    };
    return { kv, calls, fetchImpl };
  }

  test("INCR the total and HINCRBY today's count; the token stays server-side", async () => {
    const fake = fakeUpstash();
    const upstash = { url: "https://example.upstash.io", token: "secret-token" };
    const app = await startApp({ upstash, ephemeral: true }, {}, { fetchImpl: fake.fetchImpl });
    assert.equal((await app.call("/api/visits")).data.total, 0);
    for (let i = 0; i < 5; i++) await visit(app);
    const read = await app.call("/api/visits");
    assert.equal(read.data.total, 5);
    assert.equal(fake.kv.get("library:hits:total"), 5);
    assert.equal(fake.kv.get(`library:hits:daily/${istDate()}`), 5);
    assert.ok(fake.calls.every((c) => c.auth === "Bearer secret-token"));
    assert.doesNotMatch(read.text, /secret-token|upstash/i);
    await app.close();
  });

  test("Upstash failing → 503, never a fake 0", async () => {
    const upstash = { url: "https://example.upstash.io", token: "t" };
    const app = await startApp({ upstash, ephemeral: true }, {}, { fetchImpl: async () => ({ ok: false, status: 500 }) });
    assert.equal((await visit(app)).status, 503);
    assert.equal((await app.call("/api/visits")).status, 503);
    await app.close();
  });
});

describe("no persistent store", () => {
  test("temporary storage (Vercel /tmp) → 503 and a start-up error, not a counter that resets", async () => {
    const app = await startApp({ ephemeral: true, upstash: null });
    assert.equal((await visit(app)).status, 503);
    assert.equal((await app.call("/api/visits")).status, 503);
    await app.close();
    const config = loadConfig({ VERCEL: "1", NODE_ENV: "production", ADMIN_DISABLED: "true" });
    assert.ok(config.warnings.some((w) => /hit counter/i.test(w) && /UPSTASH_REDIS_REST_URL/.test(w)));
    const withRedis = loadConfig({ VERCEL: "1", NODE_ENV: "production", ADMIN_DISABLED: "true", UPSTASH_REDIS_REST_URL: "https://x", UPSTASH_REDIS_REST_TOKEN: "y" });
    assert.ok(withRedis.upstash && !withRedis.warnings.some((w) => /hit counter/i.test(w)));
  });

  test("istDate uses India time", () => {
    assert.equal(istDate(new Date("2026-01-01T19:00:00Z")), "2026-01-02");
    assert.equal(istDate(new Date("2026-01-01T18:00:00Z")), "2026-01-01");
  });
});
