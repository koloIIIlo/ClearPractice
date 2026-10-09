import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

/**
 * Log redaction guard for the interface (plan 5.12): app code never writes to
 * the console, so transcripts, request text, provider answers and keys cannot
 * leak into WebView logs. Tests may print.
 */
it("interface code never logs to the console", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) files.push(path);
    }
  };
  walk(join(process.cwd(), "src"));
  expect(files.length).toBeGreaterThan(50);
  const offenders = files.filter((f) => /\bconsole\.(log|info|warn|error|debug|trace)\s*\(/.test(readFileSync(f, "utf8")));
  expect(offenders).toEqual([]);
});
