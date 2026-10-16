import { describe, expect, it } from "vitest";
import { factsBuilder } from "@/test/fixtures/facts";
import { buildProfile, middleHalf } from "./profile";

const row = (facts: ReturnType<ReturnType<typeof factsBuilder>["build"]>, key: string) => buildProfile(facts).rows.find((r) => r.key === key)!;

describe("speech profile", () => {
  it("uses the middle half of the last 20 takes", () => {
    expect(middleHalf([1])).toBeNull();
    expect(middleHalf([10, 20, 30, 40, 50])).toEqual([20, 40]);
    let b = factsBuilder("2026-10-30");
    // 25 takes: the first five (pace 300) fall outside the last 20 (pace 100–119).
    for (let i = 0; i < 25; i += 1) b = b.onDay(25 - i).session().take({ transcribed: true, paceWpm: i < 5 ? 300 : 100 + (i - 5), meanRun: 7 });
    const facts = b.build();
    expect(row(facts, "pace").value).toBe("105–114 words a minute");
    expect(row(facts, "run").value).toBe("about 7 words between pauses");
    expect(buildProfile(facts).takes).toBe(20);
  });

  it("hides since-first-month until each side has five takes", () => {
    let b = factsBuilder("2026-10-30");
    for (let i = 0; i < 4; i += 1) b = b.onDay(80 - i).session().take({ meanRun: 5, paceWpm: 110 });
    for (let i = 0; i < 6; i += 1) b = b.onDay(10 - i).session().take({ meanRun: 8, paceWpm: 125 });
    expect(buildProfile(b.build()).since).toBeNull();
    b = b.onDay(76).session().take({ meanRun: 5, paceWpm: 110, differentPer50: 33 });
    const since = buildProfile(b.build()).since!;
    expect(since.map((r) => [r.label, r.value])).toEqual([["Mean run", "5.0 → 8.0 words"], ["Pace", "110 → 125 words a minute"]]);
  });

  it("explains missing pitch range when no take has an intonation track", () => {
    const facts = factsBuilder().session().take({ transcribed: true, paceWpm: 120 }).take({ transcribed: true, paceWpm: 130 }).build();
    const pitch = row(facts, "pitch");
    expect(pitch.value).toBeNull();
    expect(pitch.unavailableReason).toMatch(/No take has an intonation track yet/);
    expect(row(facts, "rate").unavailableReason).toMatch(/measure it from the audio/);
    const withPitch = factsBuilder().session().take({ pitchRangeSt: 5 }).take({ pitchRangeSt: 8 }).build();
    expect(row(withPitch, "pitch").value).toBe("usually 6–7 semitones");
  });
});
