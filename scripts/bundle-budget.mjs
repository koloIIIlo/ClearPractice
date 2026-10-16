// Bundle budget (roadmap 7.1). Reads dist/ after `npm run build` and checks:
//   - start-up JS: the entry script plus every chunk index.html preloads with it, ≤ 320 kB gzip;
//   - every other (lazy) chunk ≤ 250 kB gzip.
// Usage: node scripts/bundle-budget.mjs [--report]   (--report prints without failing)
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const DIST = "dist";
const INITIAL_BUDGET_KB = 320;
const LAZY_BUDGET_KB = 250;
const reportOnly = process.argv.includes("--report");

const html = readFileSync(join(DIST, "index.html"), "utf8");
const initialNames = new Set(
  [...html.matchAll(/<script[^>]+src="\/assets\/([^"]+\.js)"|<link[^>]+rel="modulepreload"[^>]+href="\/assets\/([^"]+\.js)"/g)].map((m) => m[1] ?? m[2]),
);
if (initialNames.size === 0) {
  console.error("No entry script found in dist/index.html. Run `npm run build` first.");
  process.exit(1);
}

const kb = (bytes) => bytes / 1024;
const chunks = readdirSync(join(DIST, "assets"))
  .filter((name) => name.endsWith(".js"))
  .map((name) => {
    const code = readFileSync(join(DIST, "assets", name));
    return { name, raw: code.length, gzip: gzipSync(code, { level: 9 }).length, initial: initialNames.has(name) };
  })
  .sort((a, b) => b.gzip - a.gzip);

const initialGzip = chunks.filter((c) => c.initial).reduce((sum, c) => sum + c.gzip, 0);
const initialRaw = chunks.filter((c) => c.initial).reduce((sum, c) => sum + c.raw, 0);
const tooBig = chunks.filter((c) => !c.initial && kb(c.gzip) > LAZY_BUDGET_KB);

console.log("Chunk".padEnd(52), "raw kB".padStart(9), "gzip kB".padStart(9), " loads");
for (const c of chunks.slice(0, 25)) {
  console.log(c.name.padEnd(52), kb(c.raw).toFixed(1).padStart(9), kb(c.gzip).toFixed(1).padStart(9), c.initial ? " at start-up" : " on demand");
}
if (chunks.length > 25) console.log(`… and ${chunks.length - 25} smaller chunks`);
console.log(`\nStart-up JS: ${kb(initialRaw).toFixed(1)} kB raw, ${kb(initialGzip).toFixed(1)} kB gzip in ${initialNames.size} files (budget ${INITIAL_BUDGET_KB} kB gzip).`);
console.log(`Largest on-demand chunk: ${kb(chunks.find((c) => !c.initial)?.gzip ?? 0).toFixed(1)} kB gzip (budget ${LAZY_BUDGET_KB} kB).`);

const failures = [];
if (kb(initialGzip) > INITIAL_BUDGET_KB) failures.push(`start-up JS is ${kb(initialGzip).toFixed(1)} kB gzip`);
for (const c of tooBig) failures.push(`${c.name} is ${kb(c.gzip).toFixed(1)} kB gzip`);
if (failures.length && !reportOnly) {
  console.error(`\nOver budget: ${failures.join("; ")}.`);
  process.exit(1);
}
console.log(failures.length ? `\n(report only) over budget: ${failures.join("; ")}` : "\nWithin budget.");
