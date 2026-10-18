import { expect, it } from "vitest";
import { matchRoutes } from "react-router";
import { routes } from "@/app/routes";
import config from "../../src-tauri/tauri.conf.json";
import { APP_VERSION } from "@/lib/app-version";
import { WHATS_NEW } from "./whats-new";
it("keeps the release versions aligned and supplies linked highlights", () => {
  expect(config.version).toBe(APP_VERSION);
  expect(WHATS_NEW[APP_VERSION]).toBeDefined();
  for (const highlights of Object.values(WHATS_NEW)) {
    expect(highlights.length).toBeGreaterThanOrEqual(3);
    expect(highlights.length).toBeLessThanOrEqual(6);
    for (const highlight of highlights) {
      expect(highlight.text.length).toBeGreaterThan(0);
      expect(highlight.linkLabel.length).toBeGreaterThan(0);
      expect(matchRoutes(routes, highlight.href)).not.toBeNull();
    }
  }
});
