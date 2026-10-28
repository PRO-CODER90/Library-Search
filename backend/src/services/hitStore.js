// Visit counter storage. Two functions, incrementHits() and getHits(), hide
// where the number lives so the store can change without touching the routes.
//
// - Upstash Redis (UPSTASH_REDIS_REST_URL / _TOKEN): the default on Vercel,
//   where the SQLite file in /tmp is temporary. INCR is atomic.
// - SQLite: only when the database is on a persistent disk.
// - Otherwise the counter is unavailable (503), never counted in temporary
//   storage that would later reset to 0.

const TOTAL_KEY = "library:hits:total";
const DAILY_KEY = "library:hits:daily";

/** YYYY-MM-DD in India time. */
export const istDate = (now = new Date()) => new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

export class HitStoreUnavailable extends Error {}

function upstashStore({ url, token }, fetchImpl = fetch) {
  async function command(body, path = "") {
    const res = await fetchImpl(`${url.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new HitStoreUnavailable(`Upstash answered ${res.status}.`);
    return res.json();
  }
  return {
    kind: "upstash",
    async incrementHits() {
      const [total] = await command([["INCR", TOTAL_KEY], ["HINCRBY", DAILY_KEY, istDate(), "1"]], "/pipeline");
      if (total?.error) throw new HitStoreUnavailable(total.error);
      return Number(total.result);
    },
    async getHits() {
      const { result, error } = await command(["GET", TOTAL_KEY]);
      if (error) throw new HitStoreUnavailable(error);
      return Number(result ?? 0);
    },
  };
}

function sqliteStore(db) {
  const read = (name) => db.prepare("SELECT value FROM counters WHERE name = ?").get(name)?.value ?? 0;
  const bump = db.prepare("INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1");
  return {
    kind: "sqlite",
    async incrementHits() {
      bump.run(TOTAL_KEY);
      bump.run(`${DAILY_KEY}:${istDate()}`);
      return read(TOTAL_KEY);
    },
    async getHits() {
      return read(TOTAL_KEY);
    },
  };
}

function unavailableStore(reason) {
  const fail = async () => {
    throw new HitStoreUnavailable(reason);
  };
  return { kind: "none", reason, incrementHits: fail, getHits: fail };
}

/** Pick the store for this deployment. */
export function createHitStore({ db, config, fetchImpl }) {
  if (config.upstash) return upstashStore(config.upstash, fetchImpl);
  if (!config.ephemeral) return sqliteStore(db);
  return unavailableStore(
    "Hit counter has no persistent store: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or DB_PATH on a persistent disk)."
  );
}
