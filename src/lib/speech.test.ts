import { describe, expect, it, vi } from "vitest";
import { offlineEnglishVoices, pickPartnerVoice, speakGroups, speakText } from "./speech";

class FakeUtterance { text: string; voice: unknown; lang = ""; rate = 1; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(t: string) { this.text = t; } }

it("reads thought groups one by one with offline English voices only (4.7)", () => {
  vi.useFakeTimers();
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  const spoken: FakeUtterance[] = [];
  const voices = [
    { name: "Microsoft Hazel", lang: "en-GB", localService: true },
    { name: "Online Natural", lang: "en-US", localService: false },
    { name: "Microsoft Irina", lang: "ru-RU", localService: true },
  ] as SpeechSynthesisVoice[];
  const synth = { getVoices: () => voices, speak: (u: FakeUtterance) => spoken.push(u), cancel: vi.fn() } as unknown as SpeechSynthesis;
  expect(offlineEnglishVoices(synth).map((v) => v.name)).toEqual(["Microsoft Hazel"]);

  const heard: number[] = [];
  const onEnd = vi.fn();
  const stop = speakGroups(["One idea", "then another", "and the end"], { voice: voices[0], synth, onGroup: (i) => heard.push(i), onEnd });
  expect(spoken.map((u) => u.text)).toEqual(["One idea"]);
  spoken[0].onend!();
  vi.advanceTimersByTime(450);
  expect(heard).toEqual([0, 1]);
  stop();
  expect(onEnd).toHaveBeenCalledOnce();
  spoken[1].onend!();
  vi.advanceTimersByTime(1000);
  expect(spoken).toHaveLength(2);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the partner's voice (13.7)", () => {
  const voices = [
    { name: "Microsoft Zira", lang: "en-US", localService: true },
    { name: "Microsoft David", lang: "en-US", localService: true },
    { name: "Online Natural Guy", lang: "en-US", localService: false },
    { name: "Microsoft Irina", lang: "ru-RU", localService: true },
  ] as SpeechSynthesisVoice[];
  const fakeSynth = () => {
    const spoken: FakeUtterance[] = [];
    const synth = { getVoices: () => voices, speak: (u: FakeUtterance) => spoken.push(u), cancel: vi.fn() } as unknown as SpeechSynthesis & { cancel: ReturnType<typeof vi.fn> };
    return { synth, spoken };
  };

  it("uses only local voices", async () => {
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    const { synth, spoken } = fakeSynth();
    await speakText("Hello there.", { voice: voices[2], synth });
    expect(spoken).toHaveLength(0);
    const done = speakText("Hello there.", { synth, rate: 2 });
    expect(spoken.map((u) => [u.text, (u.voice as SpeechSynthesisVoice).name, u.rate])).toEqual([["Hello there.", "Microsoft Zira", 1.2]]);
    spoken[0].onend!();
    await done;
    vi.unstubAllGlobals();
  });

  it("resolves when stopped", async () => {
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    const { synth, spoken } = fakeSynth();
    const stop = new AbortController();
    const done = speakText("A long question.", { voice: voices[1], synth, signal: stop.signal });
    expect(spoken).toHaveLength(1);
    stop.abort();
    await expect(done).resolves.toBeUndefined();
    expect(synth.cancel).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("picks the preferred voice, then the persona hint, then any English voice", () => {
    expect(pickPartnerVoice(voices, "Microsoft David", "higher")?.name).toBe("Microsoft David");
    expect(pickPartnerVoice(voices, "Online Natural Guy", "any")?.name, "an online voice is never used").toBe("Microsoft Zira");
    expect(pickPartnerVoice(voices, null, "lower")?.name).toBe("Microsoft David");
    expect(pickPartnerVoice(voices, null, "higher")?.name).toBe("Microsoft Zira");
    expect(pickPartnerVoice(voices, "Missing", "any")?.name).toBe("Microsoft Zira");
    expect(pickPartnerVoice([voices[2], voices[3]], null, "any")).toBeNull();
  });
});
