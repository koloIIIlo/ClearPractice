import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Square, Volume2 } from "lucide-react";
import { NativeSelect } from "@/components/ui/native-select";
import { offlineEnglishVoices, speakGroups } from "@/lib/speech";
import { Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PASSAGES, thoughtGroups, wordCount, type Passage } from "@/content/passages";
import type { PracticePrompt } from "@/lib/ipc/schemas";

/** The task a thought-group take records, so history shows which passage was practised. */
export function passagePrompt(passage: Passage): PracticePrompt {
  return {
    id: passage.id,
    text: `Read "${passage.title}" in thought groups, then explain it in your own words.`,
    tags: ["explanations"],
    conditions: { familiarity: "familiar", preparationSeconds: 30, targetSeconds: 60, audience: null, followUp: false },
    favorite: false,
    source: "bundled",
  };
}

/**
 * Thought groups (plan 4.7): read the passage aloud group by group, then hide
 * it and explain the idea freely. The text is a support, not something to
 * recite: hiding it is the main step.
 */
export function ThoughtGroupPassage({ passage, locked, onChoose }: { passage: Passage; locked: boolean; onChoose: (id: string) => void }) {
  const [hidden, setHidden] = useState(false);
  const groups = thoughtGroups(passage.text);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => offlineEnglishVoices());
  const [voiceName, setVoiceName] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const stop = useRef<(() => void) | null>(null);
  // Windows loads its voices asynchronously.
  useEffect(() => {
    const synth = globalThis.speechSynthesis;
    if (!synth) return;
    const load = () => setVoices(offlineEnglishVoices(synth));
    load();
    synth.addEventListener?.("voiceschanged", load);
    return () => { synth.removeEventListener?.("voiceschanged", load); stop.current?.(); };
  }, []);
  useEffect(() => () => stop.current?.(), [passage.id]);
  const voice = voices.find((v) => v.name === voiceName) ?? voices[0];
  const listen = () => {
    if (!voice) return;
    stop.current = speakGroups(groups, { voice, onGroup: setSpeaking, onEnd: () => { setSpeaking(null); stop.current = null; } });
  };
  return (
    <Panel className="space-y-4" aria-labelledby="passage-heading">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="passage-choice">Passage</Label>
          <Select value={passage.id} onValueChange={onChoose} disabled={locked}>
            <SelectTrigger id="passage-choice" className="h-10 w-72"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PASSAGES.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.title} · {p.subject}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!hidden && (speaking === null ? (
          <Button variant="outline" disabled={!voice || locked} onClick={listen}><Volume2 aria-hidden /> Listen</Button>
        ) : (
          <Button variant="outline" onClick={() => stop.current?.()}><Square aria-hidden /> Stop</Button>
        ))}
        {!hidden && voices.length > 1 && (
          <div className="space-y-1">
            <Label htmlFor="passage-voice">Voice</Label>
            <NativeSelect id="passage-voice" value={voice?.name} onChange={(e) => setVoiceName(e.target.value)}>
              {voices.map((v) => <option key={v.name} value={v.name}>{v.name.replace(/^Microsoft /, "").replace(/ - .*$/, "")}</option>)}
            </NativeSelect>
          </div>
        )}
        <Button variant="outline" onClick={() => { stop.current?.(); setHidden((h) => !h); }}>
          {hidden ? <><Eye aria-hidden /> Show the text again</> : <><EyeOff aria-hidden /> Hide the text and explain</>}
        </Button>
      </div>
      <h2 id="passage-heading" className="font-semibold">{passage.title}</h2>
      {hidden ? (
        <div className="space-y-2 rounded-lg border border-dashed p-4">
          <p className="font-medium">Explain the idea in your own words.</p>
          <p className="text-meta text-muted-foreground">
            Aim for about a minute. You don't need the original phrases; speak in short groups, one idea at a time, and pause between them.
          </p>
        </div>
      ) : (
        <>
          <p className="text-meta text-muted-foreground">
            1. Listen, or read it aloud yourself, pausing briefly at each mark. 2. Hide the text. 3. Record yourself explaining it. ({wordCount(passage.text)} words, {groups.length} groups)
          </p>
          {!voice && <p className="text-meta text-muted-foreground">Listen needs an English voice installed on this computer (Windows Settings → Time &amp; language → Speech). Online voices are never used.</p>}
          <p className="text-lg leading-relaxed" aria-label={`Passage in ${groups.length} thought groups`}>
            {groups.map((g, i) => (
              <span key={i}>
                <span className={speaking === i ? "rounded bg-primary px-1 text-primary-foreground" : "rounded bg-secondary/60 px-1"}>{g}</span>
                {i < groups.length - 1 && <span aria-hidden className="mx-1.5 text-muted-foreground">/</span>}{" "}
              </span>
            ))}
          </p>
        </>
      )}
    </Panel>
  );
}
