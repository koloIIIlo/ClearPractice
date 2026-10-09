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
