import { expect, it, vi } from "vitest";
import { offlineEnglishVoices, speakGroups } from "./speech";

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
