/**
 * Offline read-aloud for thought-group passages (plan 4.7 "listen"). Only
 * voices installed on this computer are used (`localService`); online voices
 * would send the text to a speech service, so they are never chosen.
 */
export function offlineEnglishVoices(synth: SpeechSynthesis | undefined = globalThis.speechSynthesis): SpeechSynthesisVoice[] {
  if (!synth) return [];
  return synth.getVoices().filter((v) => v.localService && v.lang.toLowerCase().startsWith("en"));
}

/**
 * Speaks each group in turn with a short pause between them, reporting the
 * group being spoken. Returns a function that stops reading.
 */
export function speakGroups(
  groups: string[],
  { voice, rate = 0.9, pauseMs = 450, onGroup, onEnd, synth = globalThis.speechSynthesis }: {
    voice: SpeechSynthesisVoice; rate?: number; pauseMs?: number; onGroup: (index: number) => void; onEnd: () => void; synth?: SpeechSynthesis;
  },
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const say = (index: number) => {
    if (stopped) return;
    if (index >= groups.length) { onEnd(); return; }
    onGroup(index);
    const utterance = new SpeechSynthesisUtterance(groups[index]);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = rate;
    utterance.onend = () => { timer = setTimeout(() => say(index + 1), pauseMs); };
    utterance.onerror = () => { if (!stopped) onEnd(); };
    synth.speak(utterance);
  };
  synth.cancel();
  say(0);
  return () => {
    stopped = true;
    clearTimeout(timer);
    synth.cancel();
    onEnd();
  };
}

/** Windows' built-in voices by how they sound, for a persona's hint (13.7). */
const LOWER_VOICES = ["david", "mark", "george", "james", "richard", "ravi", "sean", "ryan", "guy", "william", "thomas"];
const HIGHER_VOICES = ["zira", "hazel", "susan", "catherine", "linda", "heera", "heather", "eva", "aria", "jenny", "libby", "sonia", "natasha", "clara", "emily"];

/**
 * The partner's voice (13.7): your chosen offline voice, else one that suits
 * the persona's hint, else any offline English voice; null when there is none
 * (the partner then speaks in captions only). The app never downloads voices.
 */
export function pickPartnerVoice(voices: SpeechSynthesisVoice[], preferredName: string | null, hint: "any" | "lower" | "higher"): SpeechSynthesisVoice | null {
  const offline = voices.filter((v) => v.localService && v.lang.toLowerCase().startsWith("en"));
  const preferred = preferredName ? offline.find((v) => v.name === preferredName) : undefined;
  if (preferred) return preferred;
  const names = hint === "lower" ? LOWER_VOICES : hint === "higher" ? HIGHER_VOICES : [];
  return offline.find((v) => names.some((n) => v.name.toLowerCase().includes(n))) ?? offline[0] ?? null;
}

/**
 * Speaks one line with an offline voice only (13.7); resolves when it ends,
 * fails or is stopped through `signal`, and never throws. Without an offline
 * voice nothing is spoken and it resolves at once.
 */
export function speakText(
  text: string,
  { voice, rate = 1, signal, synth = globalThis.speechSynthesis }: { voice?: SpeechSynthesisVoice | null; rate?: number; signal?: AbortSignal; synth?: SpeechSynthesis } = {},
): Promise<void> {
  return new Promise((resolve) => {
    const chosen = voice === undefined ? (offlineEnglishVoices(synth)[0] ?? null) : voice;
    if (!synth || !chosen || !chosen.localService || signal?.aborted || !text.trim()) {
      resolve();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      signal?.removeEventListener("abort", stop);
      resolve();
    };
    const stop = () => {
      synth.cancel();
      finish();
    };
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = chosen;
    utterance.lang = chosen.lang;
    utterance.rate = Math.min(1.2, Math.max(0.8, rate));
    utterance.onend = finish;
    utterance.onerror = finish;
    signal?.addEventListener("abort", stop, { once: true });
    synth.cancel();
    synth.speak(utterance);
  });
}
