// Benchmark: search over N generated rows (spec: 50,000 rows in < 300 ms).
// Usage: npm run bench [-- 50000]

import { openDatabase } from "../src/db.js";
import { importCsv } from "../src/services/library.js";
import { search } from "../src/services/searchEngine.js";

const N = Number(process.argv[2]) || 50000;
const words = ["harry", "physics", "history", "algorithms", "garden", "ocean", "silent", "river", "quantum", "story", "ancient", "modern"];
const pick = (i, k) => words[(i * 7 + k * 13) % words.length];
const lines = ["id,title,author,category,isbn,floor,rack,shelf,available"];
for (let i = 1; i <= N; i++) {
  lines.push(
    `${i},${pick(i, 1)} ${pick(i, 2)} ${pick(i, 3)} ${i},Author ${pick(i, 4)} ${i % 997},${pick(i, 5)},978${String(i).padStart(10, "0")},${(i % 4) + 1},R-${String(i % 40).padStart(2, "0")},${"ABCDEF"[i % 6]},${i % 3 ? "yes" : "no"}`
  );
}

const db = openDatabase(":memory:");
let t = performance.now();
importCsv(db, { buffer: Buffer.from(lines.join("\n")), mode: "replace" });
console.log(`import ${N} rows: ${Math.round(performance.now() - t)} ms`);

for (const q of ["a", "e", "harry", "r07", "quantum river", "978000001234", "zzzz"]) {
  search(db, { q, page: 1, limit: 20 }); // warm
  const runs = 5;
  t = performance.now();
  let total = 0;
  for (let i = 0; i < runs; i++) total = search(db, { q, page: 1, limit: 20 }).total;
  console.log(`q=${JSON.stringify(q).padEnd(16)} ${String(total).padStart(6)} hits  ${((performance.now() - t) / runs).toFixed(1)} ms`);
}
