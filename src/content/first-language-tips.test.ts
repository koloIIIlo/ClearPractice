import { expect, it } from "vitest";
import { matchRoutes } from "react-router";
import { routes } from "@/app/routes";
import { EXERCISES } from "./exercises";
import { drillById } from "./drills";
import { FirstLanguage } from "@/lib/ipc/schemas";
import { offending } from "@/test/no-scores";
import { FIRST_LANGUAGE_TIPS, occasionalLanguageTip } from "./first-language-tips";
it("gives each language six to ten respectful tips with examples and known practice routes", () => {
  expect(Object.keys(FIRST_LANGUAGE_TIPS).sort()).toEqual([...FirstLanguage.options].sort());
  for (const tips of Object.values(FIRST_LANGUAGE_TIPS)) {
    expect(tips.length).toBeGreaterThanOrEqual(6);
    expect(tips.length).toBeLessThanOrEqual(10);
    for (const tip of tips) {
      expect(tip.example.trim().length).toBeGreaterThan(0);
      expect(matchRoutes(routes, tip.href)).not.toBeNull();
      const id = tip.href.split("/").at(-1)!;
      expect(tip.href.startsWith("/drill/") ? !!drillById(id) : EXERCISES.some((e) => e.id === id)).toBe(true);
      const text = `${tip.text} ${tip.example}`;
      expect(offending(text)).toEqual([]);
      expect(text).not.toMatch(/accent\s*(score|rating|grade)|native[- ]like|bad accent|correct accent|proficiency score/i);
    }
  }
});
it("offers tips on some days with a repeatable choice, and none without a language", () => {
  const picks = Array.from({ length: 30 }, (_, i) => {
    const date = `2026-10-${String(i + 1).padStart(2, "0")}`;
    const tip = occasionalLanguageTip("russian", date, "/drill/emphasis");
    expect(tip).toEqual(occasionalLanguageTip("russian", date, "/drill/emphasis"));
    return tip;
  });
  expect(picks.some(Boolean)).toBe(true);
  expect(picks.some((p) => !p)).toBe(true);
  expect(occasionalLanguageTip(null, "2026-10-19", "/drill/emphasis")).toBeNull();
});
