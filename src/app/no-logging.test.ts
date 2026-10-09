import { expect, it } from "vitest";

/**
 * Log redaction guard for the interface (plan 5.12): app code never writes to
 * the console, so transcripts, request text, provider answers and keys cannot
 * leak into WebView logs. Tests may print.
 */
const sources = import.meta.glob(["/src/**/*.{ts,tsx}", "!/src/**/*.test.{ts,tsx}", "!/src/**/*.d.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

it("interface code never logs to the console", () => {
  expect(Object.keys(sources).length).toBeGreaterThan(50);
  const offenders = Object.entries(sources).filter(([, text]) => /\bconsole\.(log|info|warn|error|debug|trace)\s*\(/.test(text)).map(([path]) => path);
  expect(offenders).toEqual([]);
});
