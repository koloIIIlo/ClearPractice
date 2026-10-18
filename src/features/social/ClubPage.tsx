import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorState, LoadingBlock, Page, PageHeader, Panel, QueryView, SectionTitle } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useIpc } from "@/lib/ipc";
import { keys, useClubMeeting, useClubMeetings } from "@/lib/ipc/queries";
import type { ClubCounter, ClubKind, ClubLightState, ClubMeetingView, ClubSpeech } from "@/lib/ipc/schemas";
import { ClubMeetingInput } from "@/lib/ipc/schemas-social";
import { clubClock, COUNTERS, DEFAULT_WINDOWS, KIND_LABELS, lightAt } from "@/lib/social/club";
import { toLocalDate } from "@/lib/phrase-schedule";
import { ROULETTE_TOPICS } from "@/content/roulette-topics";
import { TimingLight } from "./ClubLight";

type AgendaRow = { key: number; speaker: string; kind: ClubKind; min: string; max: string };
const TOPICS = Object.values(ROULETTE_TOPICS).flat();
const MAX_MS = 21600000;
const windowText = (s: ClubSpeech) => s.targetMinSeconds === null || s.targetMaxSeconds === null ? "no time window" : `${clubClock(s.targetMinSeconds * 1000)}–${clubClock(s.targetMaxSeconds * 1000)}`;

function MeetingSetup({ onSaved, onCancel }: { onSaved: (view: ClubMeetingView) => void; onCancel: () => void }) {
  const ipc = useIpc();
  const [title, setTitle] = useState("");
  const [word, setWord] = useState("");
  const nextKey = useRef(1);
  const [rows, setRows] = useState<AgendaRow[]>([{ key: 0, speaker: "", kind: "prepared", min: "300", max: "420" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const change = (key: number, patch: Partial<AgendaRow>) => setRows((old) => old.map((r) => r.key === key ? { ...r, ...patch } : r));
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const parsed = ClubMeetingInput.safeParse({ title, wordOfTheDay: word, localDate: toLocalDate(new Date()), speeches: rows.map((r) => ({
      speaker: r.speaker, kind: r.kind, targetMinSeconds: r.min.trim() ? Number(r.min) : null, targetMaxSeconds: r.max.trim() ? Number(r.max) : null,
    })) });
    if (!parsed.success) { setError(new Error(parsed.error.issues[0]?.message ?? "Check the meeting details.")); return; }
    if (!rows.length) { setError(new Error("Add at least one speaker to run a meeting.")); return; }
    setBusy(true); setError(null);
    try { onSaved(await ipc.saveClubMeeting(parsed.data)); }
    catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  return <Panel>
    <SectionTitle>New meeting</SectionTitle>
    <p className="mb-5 text-muted-foreground">Ask speakers before counting their filler words. Nothing is recorded.</p>
    <form noValidate onSubmit={(event) => { void save(event); }} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="club-title">Meeting title</Label><Input id="club-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="club-word">Word of the day</Label><Input id="club-word" value={word} maxLength={60} onChange={(e) => setWord(e.target.value)} /></div>
      </div>
      <fieldset className="space-y-4" disabled={busy}>
        <legend className="mb-3 font-semibold">Agenda</legend>
        <p className="text-meta text-muted-foreground">Time windows are in seconds. Leave both ends empty for no timing lights.</p>
        {rows.map((row, i) => <div key={row.key} className="grid items-end gap-3 rounded-panel border p-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-2"><Label htmlFor={`speaker-${row.key}`}>Speaker {i + 1}</Label><Input id={`speaker-${row.key}`} value={row.speaker} maxLength={60} onChange={(e) => change(row.key, { speaker: e.target.value })} /></div>
          <div className="space-y-2"><Label htmlFor={`kind-${row.key}`}>Kind</Label><Select value={row.kind} onValueChange={(kind: ClubKind) => {
            const window = DEFAULT_WINDOWS[kind];
            change(row.key, { kind, min: window ? String(window[0]) : "", max: window ? String(window[1]) : "" });
          }}><SelectTrigger id={`kind-${row.key}`} className="w-full"><SelectValue /></SelectTrigger><SelectContent>
            {(Object.keys(KIND_LABELS) as ClubKind[]).map((kind) => <SelectItem key={kind} value={kind}>{KIND_LABELS[kind]}</SelectItem>)}
          </SelectContent></Select></div>
          <div className="space-y-2"><Label htmlFor={`min-${row.key}`}>Minimum (seconds)</Label><Input id={`min-${row.key}`} inputMode="numeric" value={row.min} onChange={(e) => change(row.key, { min: e.target.value })} /></div>
          <div className="space-y-2"><Label htmlFor={`max-${row.key}`}>Maximum (seconds)</Label><Input id={`max-${row.key}`} inputMode="numeric" value={row.max} onChange={(e) => change(row.key, { max: e.target.value })} /></div>
          <Button type="button" variant="outline" aria-label={`Remove speaker ${i + 1}`} onClick={() => setRows((old) => old.filter((r) => r.key !== row.key))}>Remove</Button>
        </div>)}
        <Button type="button" variant="outline" disabled={rows.length >= 30} onClick={() => setRows((old) => [...old, { key: nextKey.current++, speaker: "", kind: "prepared", min: "300", max: "420" }])}>Add speaker</Button>
      </fieldset>
      {error != null && <ErrorState error={error} title="The meeting could not be saved" />}
      <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Run meeting"}</Button><Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button></div>
    </form>
  </Panel>;
}

function SpeakerRun({ view, index, onSaved }: { view: ClubMeetingView; index: number; onSaved: (view: ClubMeetingView) => void }) {
  const ipc = useIpc();
  const speech = view.speeches[index]!;
  // Monotonic time, rather than counting interval ticks, also survives a throttled projector window.
  const clock = useRef({ elapsed: 0, started: null as number | null });
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [timed, setTimed] = useState(false);
  const [taps, setTaps] = useState<ClubCounter[]>([]);
  const [wordUsed, setWordUsed] = useState<boolean | null>(null);
  const [notes, setNotes] = useState("");
  const [topic, setTopic] = useState<string | null>(null);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const currentMs = () => Math.min(MAX_MS, clock.current.elapsed + (clock.current.started === null ? 0 : performance.now() - clock.current.started));
  const stateAt = (ms: number): ClubLightState => ({ elapsedMs: ms, running: clock.current.started !== null, light: lightAt(ms, speech.targetMinSeconds, speech.targetMaxSeconds) });
  const stop = () => {
    const ms = currentMs(); clock.current = { elapsed: ms, started: null };
    setElapsed(ms); setRunning(false);
    return ms;
  };
  const toggle = () => {
    if (saving.current) return;
    if (clock.current.started !== null) { stop(); return; }
    if (clock.current.elapsed >= MAX_MS) return;
    clock.current.started = performance.now(); setTimed(true); setRunning(true);
  };
  const tap = (id: ClubCounter) => {
    if (!saving.current) setTaps((old) => old.filter((key) => key === id).length < 999 ? [...old, id] : old);
  };
  async function next() {
    if (saving.current || !timed) return;
    saving.current = true; setBusy(true); setError(null);
    const ms = stop();
    try {
      const counts = Object.fromEntries(COUNTERS.map((c) => [c.id, taps.filter((t) => t === c.id).length]));
      onSaved(await ipc.saveClubSpeech(view.meeting.id, speech.id, { seconds: Math.floor(ms / 1000), counts, wordUsed, notes }));
    } catch (e) { setError(e); }
    finally { saving.current = false; setBusy(false); }
  }
  useEffect(() => {
    const publish = () => {
      const ms = currentMs();
      if (ms >= MAX_MS && clock.current.started !== null) stop();
      setElapsed(ms);
      void ipc.publishClubLight(stateAt(ms)).catch(() => { /* The second window may be closed. */ });
    };
    publish();
    const timer = setInterval(publish, 500);
    return () => clearInterval(timer);
    // Republish on timer controls and on every change in the run view, including while paused.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ipc, running, taps, wordUsed, notes, topic]);
  useEffect(() => () => {
    void ipc.publishClubLight({ ...stateAt(currentMs()), running: false }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ipc]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="checkbox"], [role="dialog"]')) return;
      if (event.code === "Space" || event.key === " ") { event.preventDefault(); toggle(); }
      else if (event.key.toLowerCase() === "n") { event.preventDefault(); void next(); }
      else {
        const counter = COUNTERS.find((c) => c.key === event.key);
        if (counter) { event.preventDefault(); tap(counter.id); }
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });
  const state = { elapsedMs: elapsed, light: lightAt(elapsed, speech.targetMinSeconds, speech.targetMaxSeconds), running };
  return <div className="space-y-5">
    <Panel className="space-y-5">
      <h2 className="text-xl font-semibold">Speaker {index + 1} of {view.speeches.length} · {speech.speaker} · {KIND_LABELS[speech.kind]} ({windowText(speech)})</h2>
      <TimingLight state={state} />
      <p className="text-meta text-muted-foreground">Measured time · {running ? "Timer running" : "Timer stopped"}</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={running || busy || elapsed >= MAX_MS} onClick={toggle}>Start</Button>
        <Button variant="outline" disabled={!running || busy} onClick={stop}>Stop</Button>
        <Button variant="outline" disabled={!timed || busy} onClick={() => { void next(); }}>{busy ? "Saving…" : "Next speaker"}</Button>
        <Button variant="outline" onClick={() => { void ipc.openClubLight().then(() => ipc.publishClubLight(stateAt(currentMs()))).catch(setError); }}>Open timing light in a new window</Button>
      </div>
      <p className="text-meta text-muted-foreground">Space: start or stop · N: save and move on · 1–6: count a filler. Start the timer before moving on.</p>
    </Panel>
    {speech.kind === "table_topic" && <Panel className="space-y-4">
      <SectionTitle>Table topic</SectionTitle>
      {topic && <p aria-live="polite" className="text-3xl font-semibold">{topic}</p>}
      <Button variant="outline" disabled={busy} onClick={() => {
        const choices = TOPICS.filter((t) => t.text !== topic);
        setTopic(choices[Math.floor(Math.random() * choices.length)]!.text);
      }}>New topic</Button>
    </Panel>}
    <Panel>
      <SectionTitle>Ah-counter</SectionTitle>
      <p className="mb-4 text-meta text-muted-foreground">Your note · Tap when you hear a filler word.</p>
      <div className="flex flex-wrap gap-2">{COUNTERS.map((c) => {
        const count = taps.filter((id) => id === c.id).length;
        return <Button key={c.id} variant="outline" disabled={busy || count >= 999} aria-label={`${c.label} ${count}`} onClick={() => tap(c.id)}><kbd className="text-muted-foreground">{c.key}</kbd> {c.label} {count}</Button>;
      })}<Button variant="outline" disabled={busy || !taps.length} onClick={() => setTaps((old) => old.slice(0, -1))}>Undo last</Button></div>
    </Panel>
    <Panel className="space-y-4">
      <SectionTitle>Notes / Grammarian</SectionTitle>
      <p className="text-meta text-muted-foreground">Your note{view.meeting.wordOfTheDay ? ` · Word of the day: ${view.meeting.wordOfTheDay}` : " · No word of the day set"}</p>
      <Label className="flex min-h-10 items-center gap-3"><Checkbox checked={wordUsed ?? false} disabled={busy || !view.meeting.wordOfTheDay} onCheckedChange={(checked) => setWordUsed(checked === true)} />Word of the day used</Label>
      <div className="space-y-2"><Label htmlFor="club-notes">Notes</Label><Textarea id="club-notes" value={notes} disabled={busy} maxLength={2000} onChange={(e) => setNotes(e.target.value)} /></div>
    </Panel>
    {error != null && <ErrorState error={error} title="The action could not be completed" />}
  </div>;
}

function MeetingSummary({ view }: { view: ClubMeetingView }) {
  const ipc = useIpc();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function share(save: boolean) {
    setBusy(true); setError(null);
    try {
      if (save) { const name = await ipc.exportClubSummary(view.meeting.id); if (name) toast.success(`Saved ${name}`); }
      else { await navigator.clipboard.writeText(await ipc.clubSummary(view.meeting.id)); toast.success("Meeting summary copied"); }
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  return <Panel className="space-y-4">
    <SectionTitle>Meeting summary</SectionTitle>
    <p className="text-meta text-muted-foreground">Time and light reached: Measured · Counts, word use and notes: Your note</p>
    <div className="overflow-x-auto"><table className="w-full text-left">
      <caption className="sr-only">Speakers, time, light reached and filler counts</caption>
      <thead><tr className="border-b"><th className="p-3">Speaker</th><th className="p-3">Time</th><th className="p-3">Light reached</th>{COUNTERS.map((c) => <th key={c.id} className="p-3">{c.label}</th>)}<th className="p-3">Word used</th></tr></thead>
      <tbody>{view.speeches.map((s) => <tr key={s.id} className="border-b">
        <th scope="row" className="p-3 font-medium">{s.speaker}</th>
        <td className="p-3 tabular-nums">{s.seconds === null ? "Not timed" : clubClock(s.seconds * 1000)}</td>
        <td className="p-3">{s.seconds === null ? "Not timed" : lightAt(s.seconds * 1000, s.targetMinSeconds, s.targetMaxSeconds)?.toUpperCase() ?? (s.targetMinSeconds === null ? "No time window" : "Before green")}</td>
        {COUNTERS.map((c) => <td key={c.id} className="p-3 tabular-nums">{s.seconds === null ? "Not counted" : s.counts[c.id] ?? 0}</td>)}
        <td className="p-3">{s.wordUsed === null ? "Not noted" : s.wordUsed ? "Yes" : "No"}</td>
      </tr>)}</tbody>
    </table></div>
    {view.speeches.filter((s) => s.notes).map((s) => <p key={s.id} className="whitespace-pre-wrap break-words"><strong>{s.speaker} · Your note:</strong> {s.notes}</p>)}
    <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => { void share(false); }}>Copy as text</Button><Button variant="outline" disabled={busy} onClick={() => { void share(true); }}>Save as file…</Button></div>
    {error != null && <ErrorState error={error} title="The summary could not be shared" />}
  </Panel>;
}

function Meeting({ initial }: { initial: ClubMeetingView }) {
  const qc = useQueryClient();
  const [view, setView] = useState(initial);
  const [index, setIndex] = useState(() => initial.speeches.findIndex((s) => s.seconds === null));
  if (index < 0) return <MeetingSummary view={view} />;
  return <SpeakerRun key={view.speeches[index]!.id} view={view} index={index} onSaved={(next) => {
    setView(next);
    setIndex(next.speeches.findIndex((s, i) => i > index && s.seconds === null));
    qc.setQueryData(keys.clubMeeting(next.meeting.id), next);
    void qc.invalidateQueries({ queryKey: keys.clubMeetings, exact: true });
  }} />;
}

export function ClubPage() {
  const ipc = useIpc();
  const qc = useQueryClient();
  const meetings = useClubMeetings();
  const [params, setParams] = useSearchParams();
  const selected = params.get("meeting") ?? undefined;
  const meeting = useClubMeeting(selected);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  return <Page>
    <PageHeader title={selected ? meeting.data?.meeting.title ?? "Club mode" : "Club mode"} description="Run a speaking-club meeting with a timer, Ah-counter and table topics."
      actions={selected || creating ? <Button variant="outline" onClick={() => { setCreating(false); setParams({}); }}>Your meetings</Button> : <Button onClick={() => setCreating(true)}>New meeting</Button>} />
    {creating ? <MeetingSetup onCancel={() => setCreating(false)} onSaved={(view) => {
      qc.setQueryData(keys.clubMeeting(view.meeting.id), view);
      void qc.invalidateQueries({ queryKey: keys.clubMeetings, exact: true });
      setCreating(false); setParams({ meeting: view.meeting.id });
    }} /> : selected ? <QueryView query={meeting} loading={<LoadingBlock label="Loading meeting" />}>{(view) => <Meeting key={view.meeting.id} initial={view} />}</QueryView> : <Panel>
      <SectionTitle>Your meetings</SectionTitle>
      <QueryView query={meetings} loading={<LoadingBlock label="Loading meetings" />}>
        {(list) => list.length ? <ul className="divide-y">{list.map((m) => <li key={m.id} className="flex flex-wrap items-center gap-3 py-4">
          <div className="min-w-0 flex-1"><p className="break-words font-medium">{m.title}</p><p className="text-meta text-muted-foreground">{m.localDate} · {m.timed} of {m.speeches} speakers timed</p></div>
          <Button variant="outline" aria-label={`Open ${m.title}`} onClick={() => setParams({ meeting: m.id })}>Open</Button>
          <Button variant="outline" disabled={deleting !== null} aria-label={`Delete ${m.title}`} onClick={() => {
            setDeleting(m.id); setError(null);
            void ipc.deleteClubMeeting(m.id).then(() => {
              qc.removeQueries({ queryKey: keys.clubMeeting(m.id) });
              return qc.invalidateQueries({ queryKey: keys.clubMeetings, exact: true });
            }).catch(setError).finally(() => setDeleting(null));
          }}>{deleting === m.id ? "Deleting…" : "Delete"}</Button>
        </li>)}</ul> : <p className="text-muted-foreground">No meetings yet. Create a meeting and add your speakers.</p>}
      </QueryView>
      {error != null && <ErrorState error={error} title="The meeting could not be deleted" />}
    </Panel>}
  </Page>;
}
