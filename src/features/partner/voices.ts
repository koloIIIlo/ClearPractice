import { useEffect, useState } from "react";
import { offlineEnglishVoices } from "@/lib/speech";

/**
 * The offline English voices installed on this computer (13.7). Windows
 * loads them after start-up, so the list follows `voiceschanged`. The app
 * never downloads voices.
 */
export function useOfflineVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => offlineEnglishVoices());
  useEffect(() => {
    const synth = globalThis.speechSynthesis;
    if (!synth) return;
    const update = () => setVoices(offlineEnglishVoices(synth));
    update();
    synth.addEventListener?.("voiceschanged", update);
    return () => synth.removeEventListener?.("voiceschanged", update);
  }, []);
  return voices;
}
