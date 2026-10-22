// Password hashing with scrypt (node:crypto). Stored format:
//   scrypt:<N>:<r>:<p>:<salt base64url>:<hash base64url>
// No plaintext password is ever stored in env or code.

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const DEFAULTS = { N: 2 ** 15, r: 8, p: 1 };
const KEY_LENGTH = 64;

function scryptAsync(password, salt, params) {
  const maxmem = 256 * params.N * params.r; // 2x the scrypt minimum (128 * N * r)
  return new Promise((resolve, reject) =>
    scrypt(String(password), salt, KEY_LENGTH, { ...params, maxmem }, (err, key) => (err ? reject(err) : resolve(key)))
  );
}

export async function hashPassword(password, params = DEFAULTS) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, params);
  return ["scrypt", params.N, params.r, params.p, salt.toString("base64url"), key.toString("base64url")].join(":");
}

export function parseHash(stored) {
  const parts = String(stored ?? "").split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [, N, r, p, salt, hash] = parts;
  const params = { N: Number(N), r: Number(r), p: Number(p) };
  if (!Number.isInteger(params.N) || params.N < 2 ** 14 || (params.N & (params.N - 1)) !== 0) return null;
  if (!Number.isInteger(params.r) || !Number.isInteger(params.p) || params.r < 1 || params.p < 1) return null;
  const saltBuf = Buffer.from(salt, "base64url");
  const hashBuf = Buffer.from(hash, "base64url");
  if (saltBuf.length < 16 || hashBuf.length !== KEY_LENGTH) return null;
  return { params, salt: saltBuf, hash: hashBuf };
}

/** Constant-time check. Always does the scrypt work, even for a bad hash. */
export async function verifyPassword(password, parsed) {
  const target = parsed ?? { params: DEFAULTS, salt: Buffer.alloc(16), hash: Buffer.alloc(KEY_LENGTH) };
  const key = await scryptAsync(password, target.salt, target.params);
  return Boolean(parsed) && timingSafeEqual(key, target.hash);
}
