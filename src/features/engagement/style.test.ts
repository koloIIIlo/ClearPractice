import { expect, it } from "vitest";
import { effectiveStyle } from "./style";
import { shouldOfferStyleChoice } from "./StyleChoiceCard";

const prefs = (p: Partial<Parameters<typeof effectiveStyle>[0]> = {}) => ({ practiceStyle: "playful" as const, celebrations: "full" as const, celebrationSounds: true, ...p });

it("calm turns everything off", () => {
  expect(effectiveStyle(prefs({ practiceStyle: "calm" }), false)).toEqual({ playful: false, celebrations: "off", sounds: false });
});

it("reduced motion turns full into subtle but keeps off as off", () => {
  expect(effectiveStyle(prefs(), true).celebrations).toBe("subtle");
  expect(effectiveStyle(prefs({ celebrations: "off" }), true).celebrations).toBe("off");
  expect(effectiveStyle(prefs({ celebrations: "subtle" }), false).celebrations).toBe("subtle");
  expect(effectiveStyle(prefs(), false)).toEqual({ playful: true, celebrations: "full", sounds: true });
});

it("plays a sound only with celebrations", () => {
  expect(effectiveStyle(prefs({ celebrations: "off" }), false).sounds).toBe(false);
  expect(effectiveStyle(prefs({ celebrationSounds: false }), false).sounds).toBe(false);
});

it("offers the style choice once, after setup, to people who have practised", () => {
  const open = { onboarded: true, styleChosen: false };
  expect(shouldOfferStyleChoice(open, true, true)).toBe(true);
  expect(shouldOfferStyleChoice(open, true, false)).toBe(false);
  expect(shouldOfferStyleChoice(open, false, true)).toBe(false);
  expect(shouldOfferStyleChoice({ ...open, styleChosen: true }, true, true)).toBe(false);
  expect(shouldOfferStyleChoice({ ...open, onboarded: false }, true, true)).toBe(false);
});
