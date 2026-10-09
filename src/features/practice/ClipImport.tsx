import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, FileAudio, History, Link2, Loader2, Play, Scissors, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AudioPlayer, type AudioPlayerHandle } from "@/components/audio-player";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatClock } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import type { ClipCandidate, ClipName, ClipSource, ClipStaged, CoachingModel, CoachingPreview, OpenedSource, PickedClip, PickRun, ReferenceClip, SavedRange } from "@/lib/ipc/schemas";
import { FEATURE_LABELS, type Feature } from "./ClipLibrary";
import { COACHING_MODELS } from "@/features/settings/CoachingSpike";
import { money } from "@/features/review/ApiTranscribe";
import { formatClockTenths, parseClock } from "@/features/review/waveform";
import { API_LABELS, ApiRequestFlow } from "@/features/review/ApiTranscribe";
import type { AudioProvider } from "@/lib/ipc/schemas";
import { NativeSelect } from "@/components/ui/native-select";

type Proposal = ClipCandidate & { keep: boolean; description: string; feature: Feature | null; suggested: boolean; reason?: string; savedAs?: string };

/**
 * Marks proposals that overlap a clip already cut from this recording (4.4i) by
 * at least a second; they start unticked, so only new parts are saved by default.
 */
export function markSaved(list: Proposal[], saved: SavedRange[]): Proposal[] {
  return list.map((p) => {
    const hit = saved.find((r) => Math.min(p.endMs, r.endMs) - Math.max(p.startMs, r.startMs) >= 1_000);
    return hit ? { ...p, savedAs: hit.title, keep: false } : { ...p, savedAs: undefined };
  });
}
const fromPicks = (picks: PickedClip[]): Proposal[] =>
  picks.map((p) => ({ startMs: p.startMs, endMs: p.endMs, text: p.text, title: p.title, keep: true, description: p.description, feature: p.feature, suggested: true, reason: p.reason }));
const TRANSCRIBED_WITH: Record<ClipSource["transcribedWith"], string> = { local: "this computer", deepgram: "Deepgram", assemblyai: "AssemblyAI" };

/** Earlier imports (4.4i): reopen one to cut more clips without transcribing again. */
function ImportHistory({ disabled, onOpen }: { disabled: boolean; onOpen: (opened: OpenedSource) => void }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const sources = useQuery({ queryKey: ["clip-sources"], queryFn: () => ipc.listClipSources(), retry: false });
  const [confirm, setConfirm] = useState<string | null>(null);
  const open = useMutation({ mutationFn: (id: string) => ipc.openClipSource(id), onSuccess: onOpen });
  const remove = useMutation({
    mutationFn: (id: string) => ipc.deleteClipSource(id),
    onSuccess: async () => { setConfirm(null); await qc.invalidateQueries({ queryKey: ["clip-sources"] }); },
  });
  const list = sources.data ?? [];
  if (list.length === 0) return null;
  return (
    <details className="rounded-lg border p-2" open>
      <summary className="cursor-pointer font-medium"><History aria-hidden className="mr-1 inline size-4" /> Import history ({list.length})</summary>
      <p className="mt-1 text-meta text-muted-foreground">Recordings you transcribed before. Open one to cut more clips; its transcript and measures are reused, so nothing is transcribed or sent again.</p>
      <ul className="mt-2 space-y-2" aria-label="Import history">
        {list.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
            <div className="min-w-48 flex-1">
              <p className="font-medium">{s.title}</p>
              <p className="text-meta text-muted-foreground">
                {formatClock(s.durationMs)} · transcribed on {TRANSCRIBED_WITH[s.transcribedWith]} · {s.clipCount} {s.clipCount === 1 ? "clip" : "clips"} saved
                {s.pickCount > 0 && ` · ${s.pickCount} AI ${s.pickCount === 1 ? "choice" : "choices"}`}
                {" · "}{new Date(s.updatedAtMs).toLocaleDateString("en-GB")}
              </p>
              {s.link && <a className="text-meta underline" href={s.link} target="_blank" rel="noreferrer">{s.link}</a>}
              {!s.audioAvailable && <p className="text-meta text-destructive">The audio is not on this computer (backups leave it out). Import the file or link again.</p>}
            </div>
            <Button size="sm" variant="outline" disabled={disabled || open.isPending || !s.audioAvailable} onClick={() => open.mutate(s.id)} aria-label={`Open ${s.title}`}>
              {open.isPending && open.variables === s.id ? "Opening…" : "Open"}
            </Button>
            {confirm === s.id ? (
              <span className="flex items-center gap-2 text-meta">
                Remove from the history? Its clips stay.
                <Button size="sm" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(s.id)}>Remove</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Keep</Button>
              </span>
            ) : (
              <Button size="sm" variant="ghost" aria-label={`Remove ${s.title} from the history`} onClick={() => setConfirm(s.id)}><Trash2 aria-hidden /></Button>
            )}
          </li>
        ))}
      </ul>
      {(open.error ?? remove.error ?? sources.error) && <p role="alert" className="text-meta text-destructive">{(open.error ?? remove.error ?? sources.error)!.message}</p>}
    </details>
  );
}

/** Folder for the clips being saved (4.4h): an existing one, none, or a new one. */
function FolderChoice({ value, onChange, suggested }: { value: string; onChange: (v: string) => void; suggested: string }) {
  const ipc = useIpc();
  const folders = useQuery({ queryKey: ["clip-folders"], queryFn: () => ipc.listClipFolders(), retry: false });
  return (
    <div className="flex flex-wrap items-center gap-2 text-meta">
      <Label htmlFor="save-folder" className="text-meta">Save to folder</Label>
      <NativeSelect id="save-folder" compact value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">No folder</option>
        {suggested.trim() && !folders.data?.some((f) => f.name.toLowerCase() === suggested.trim().toLowerCase()) && <option value={`new:${suggested.trim()}`}>New folder: {suggested.trim()}</option>}
        {folders.data?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </NativeSelect>
    </div>
  );
}

/** Settings for the AI choice, kept by the dialog so toggling the option never loses them. */
export type AiPickSettings = { model: CoachingModel; toneHint: boolean; wanted: number };
export const DEFAULT_AI_PICK: AiPickSettings = { model: "gpt-6-luna", toneHint: false, wanted: 8 };

type PickStage =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "measuring"; percent: number }
  | { kind: "measured"; sentences: number }
  | { kind: "previewing"; sentences: number }
  | { kind: "approval"; sentences: number; preview: CoachingPreview }
  | { kind: "waiting"; sentences: number; since: number }
  | { kind: "done"; sentences: number; clips: number };

const STEP_ORDER = ["measure", "preview", "approve", "send", "place"] as const;
type Step = (typeof STEP_ORDER)[number];
const STEP_LABELS: Record<Step, string> = {
  measure: "Measure each sentence's delivery on this computer",
  preview: "Prepare the request (text only)",
  approve: "Your approval",
  send: "Send to OpenAI and wait for the answer",
  place: "Check the answer and place the clips",
};
function currentStep(stage: PickStage): Step {
  switch (stage.kind) {
    case "idle": case "preparing": case "measuring": return "measure";
    case "measured": case "previewing": return "preview";
    case "approval": return "approve";
    case "waiting": return "send";
    case "done": return "place";
  }
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return <>{Math.max(0, Math.round((now - since) / 1000))} s</>;
}

/**
 * AI chooses the best parts (4.4e, 4.4g): each sentence is measured on this
 * computer first (free, with progress and Stop; kept with the transcript), then
 * only the annotated text is previewed and sent after an explicit Send. Each
 * stage is shown with what is happening now. Picks replace the automatic list.
 */
function AiPick({ stagingId, active, settings, onSettings, onPicked }: {
  stagingId: string;
  active: boolean;
  settings: AiPickSettings;
  onSettings: (next: AiPickSettings) => void;
  onPicked: (picks: PickedClip[]) => void;
}) {
  const ipc = useIpc();
  const key = useQuery({ queryKey: ["api-key-status"], queryFn: () => ipc.getApiKeyStatus(), retry: false });
  const [stage, setStage] = useState<PickStage>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const measuredFor = useRef<string | null>(null);
  const { model, toneHint, wanted } = settings;
  const change = (next: Partial<AiPickSettings>) => {
    onSettings({ ...settings, ...next });
    // A changed setting needs a new preview; the measures stay.
    setStage((s) => (s.kind === "approval" ? { kind: "measured", sentences: s.sentences } : s));
  };

  useEffect(() => {
    let remove: (() => void) | undefined;
    let disposed = false;
    void ipc
      .onClipMeasureProgress((p) => setStage((s) => (s.kind === "preparing" || s.kind === "measuring" ? (p.stage === "preparing" ? { kind: "preparing" } : { kind: "measuring", percent: p.percent ?? 0 }) : s)))
      .then((u) => (disposed ? u() : (remove = u)))
      .catch(() => {});
    return () => { disposed = true; remove?.(); };
  }, [ipc]);

  const measure = async () => {
    measuredFor.current = stagingId;
    setError(null);
    setStage({ kind: "preparing" });
    try {
      const sentences = await ipc.measureClipSource(stagingId);
      setStage({ kind: "measured", sentences });
    } catch (e) {
      measuredFor.current = null;
      setStage({ kind: "idle" });
      setError(e instanceof Error ? e.message : "The recording could not be measured.");
    }
  };
  // Measuring is local and free, so it starts as soon as the option is on.
  useEffect(() => {
    if (active && key.data?.present && measuredFor.current !== stagingId) void measure();
  }, [active, stagingId, key.data?.present]);

  if (!key.data?.present) {
    return <p className="text-meta text-muted-foreground">Letting AI choose needs an OpenAI key (Settings → Coaching). The automatic proposals below still work.</p>;
  }
  const sentences = "sentences" in stage ? stage.sentences : 0;
  const prepare = async () => {
    setError(null);
    setStage({ kind: "previewing", sentences });
    try {
      setStage({ kind: "approval", sentences, preview: await ipc.previewClipPicks(stagingId, { model, toneHint, wanted }) });
    } catch (e) {
      setStage({ kind: "measured", sentences });
      setError(e instanceof Error ? e.message : "Could not prepare the request.");
    }
  };
  const send = async () => {
    if (stage.kind !== "approval") return;
    const approved = stage.preview;
    setError(null);
    setStage({ kind: "waiting", sentences, since: Date.now() });
    try {
      const picks = await ipc.requestClipPicks(stagingId, approved.requestId, approved.payloadSha256);
      onPicked(picks);
      setStage({ kind: "done", sentences, clips: picks.length });
    } catch (e) {
      setStage({ kind: "measured", sentences });
      setError(e instanceof Error ? e.message : "The request did not finish; the charge may be uncertain.");
    }
  };
  const working = stage.kind === "preparing" || stage.kind === "measuring" || stage.kind === "previewing" || stage.kind === "waiting";
  const now = currentStep(stage);
  const nowIndex = STEP_ORDER.indexOf(now);
  const status = (() => {
    switch (stage.kind) {
      case "idle": return "Not started.";
      case "preparing": return "Preparing the audio for measuring…";
      case "measuring": return `Measuring pitch, loudness and pace of every sentence… ${stage.percent}%`;
      case "measured": return `Measured ${stage.sentences} sentences. Ready to prepare the request.`;
      case "previewing": return "Preparing the request text…";
      case "approval": return "Waiting for your approval. Nothing has been sent.";
      case "waiting": return "Sent to OpenAI. Waiting for the answer";
      case "done": return `Done: the AI chose ${stage.clips} ${stage.clips === 1 ? "part" : "parts"}. They replace the automatic list below.`;
    }
  })();

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2 text-meta">
        <Label htmlFor="pick-model" className="text-meta">AI model</Label>
        <NativeSelect id="pick-model" compact value={model} disabled={working} onChange={(e) => change({ model: e.target.value as CoachingModel })}>
          {COACHING_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.note}</option>)}
        </NativeSelect>
        <Label htmlFor="pick-wanted" className="text-meta">Up to</Label>
        <Input id="pick-wanted" type="number" min={1} max={20} className="h-9 w-16" value={wanted} disabled={working} onChange={(e) => change({ wanted: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} />
        <span>clips</span>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={toneHint} disabled={working} onChange={(e) => change({ toneHint: e.target.checked })} /> Experimental: let AI guess the speaker's tone as a hint
        </label>
      </div>

      <ol className="space-y-1 text-meta" aria-label="Steps">
        {STEP_ORDER.map((step, i) => {
          const done = i < nowIndex || stage.kind === "done";
          const current = i === nowIndex && stage.kind !== "done";
          return (
            <li key={step} className={cn("flex items-center gap-2", !done && !current && "text-muted-foreground")} aria-current={current ? "step" : undefined}>
              {done ? <CheckCircle2 aria-hidden className="size-4 text-primary" /> : current && working ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Circle aria-hidden className="size-4" />}
              {STEP_LABELS[step]}
            </li>
          );
        })}
      </ol>

      <div role="status" aria-label="AI choice progress" className="space-y-1 text-meta">
        <p>
          {status}
          {stage.kind === "waiting" && <> · <Elapsed since={stage.since} /> (usually under a minute)</>}
        </p>
        {(stage.kind === "preparing" || stage.kind === "measuring" || stage.kind === "previewing" || stage.kind === "waiting") && (
          <progress className="h-2 w-full" max={100} value={stage.kind === "measuring" ? stage.percent : undefined} aria-label="Progress" />
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {(stage.kind === "preparing" || stage.kind === "measuring") && (
          <Button variant="ghost" size="sm" onClick={() => void ipc.cancelClipWork()}>Stop measuring</Button>
        )}
        {stage.kind === "idle" && <Button variant="outline" size="sm" onClick={() => void measure()}>Measure the sentences</Button>}
        {(stage.kind === "measured" || stage.kind === "done") && (
          <Button variant="outline" size="sm" onClick={() => void prepare()}>{stage.kind === "done" ? "Ask AI again…" : "Ask AI to choose…"}</Button>
        )}
      </div>

      {stage.kind === "approval" && (
        <div className="space-y-2 text-meta" role="group" aria-label="AI clip choice request preview">
          <p className="font-medium">Recipient: OpenAI · {stage.preview.model}</p>
          <p>Estimated upper reservation: {money(stage.preview.estimatedMaximumCostMicroUsd)} within the shared monthly limit. Only the transcript and its measured numbers are sent, never audio. This approval expires in 5 minutes.</p>
          <details><summary className="cursor-pointer">Text that will be sent ({sentences} sentences)</summary><pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap">{stage.preview.selectedText}</pre></details>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void send()}>Send transcript · may be billed</Button>
            <Button size="sm" variant="ghost" onClick={() => setStage({ kind: "measured", sentences })}>Cancel</Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-meta text-destructive">{error}</p>}
    </div>
  );
}

/**
 * Optional AI titles, descriptions and features for proposed clips (4.4c). Only
 * the numbered transcripts are sent, after the usual preview and an explicit Send.
 */
function AiNaming({ proposals, onNames }: { proposals: Proposal[]; onNames: (names: ClipName[]) => void }) {
  const ipc = useIpc();
  const key = useQuery({ queryKey: ["api-key-status"], queryFn: () => ipc.getApiKeyStatus(), retry: false });
  const [model, setModel] = useState<CoachingModel>("gpt-6-luna");
  const [preview, setPreview] = useState<CoachingPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!key.data?.present) {
    return <p className="text-meta text-muted-foreground">AI titles and descriptions need an OpenAI key (Settings → Coaching). You can name the clips yourself.</p>;
  }
  const prepare = async () => {
    setBusy(true); setError(null);
    try { setPreview(await ipc.previewClipNames(proposals.map((p) => p.text), model)); } catch (e) { setError(e instanceof Error ? e.message : "Could not prepare the request."); } finally { setBusy(false); }
  };
  const send = async () => {
    if (!preview) return;
    const approved = preview;
    setPreview(null); setBusy(true); setError(null);
    try { onNames(await ipc.requestClipNames(approved.requestId, approved.payloadSha256)); } catch (e) { setError(e instanceof Error ? e.message : "The request did not finish; the charge may be uncertain."); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2 rounded-md border p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="naming-model" className="text-meta">AI model</Label>
        <NativeSelect id="naming-model" compact value={model} disabled={busy} onChange={(e) => { setModel(e.target.value as CoachingModel); setPreview(null); }}>
          {COACHING_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.note}</option>)}
        </NativeSelect>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void prepare()}>Suggest titles with AI…</Button>
      </div>
      {preview && (
        <div className="space-y-2 text-meta" role="group" aria-label="AI naming request preview">
          <p className="font-medium">Recipient: OpenAI · {preview.model}</p>
          <p>Estimated upper reservation: {money(preview.estimatedMaximumCostMicroUsd)} within the shared monthly limit. Only the transcripts below are sent, never audio.</p>
          <details><summary className="cursor-pointer">Text that will be sent</summary><pre className="mt-1 whitespace-pre-wrap">{preview.selectedText}</pre></details>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => void send()}>Send transcripts · may be billed</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPreview(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {busy && <p role="status" className="text-meta">Working…</p>}
      {error && <p role="alert" className="text-meta text-destructive">{error}</p>}
    </div>
  );
}

/**
 * Import clips (4.4a, 4.4c, 4.4d): from a local file or a YouTube link (with the
 * user's own yt-dlp), then either split automatically into whole-sentence clips
 * with local Whisper, or keep one section by hand. Everything stays on this
 * computer; the user is responsible for having the right to keep the audio.
 */
const toProposal = (c: ClipCandidate): Proposal => ({ ...c, keep: true, description: "", feature: null, suggested: false });

export function ClipImport({ onSaved, onCancel }: { onSaved: (clips: ReferenceClip[]) => void; onCancel: () => void }) {
  const ipc = useIpc();
  const qc = useQueryClient();
  const preview = useRef<AudioPlayerHandle>(null);
  const [staged, setStaged] = useState<ClipStaged | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [start, setStart] = useState("0:00.0");
  const [end, setEnd] = useState("0:15.0");
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [transcript, setTranscript] = useState("");
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "file" | "link" | "split" | "save">(null);
  const stagedRef = useRef<ClipStaged | null>(null);
  const tool = useQuery({ queryKey: ["link-tool"], queryFn: () => ipc.getLinkToolStatus(), retry: false });
  const preference = useQuery({ queryKey: ["transcription-preference"], queryFn: () => ipc.getTranscriptionPreference(), retry: false });
  const keys = useQuery({ queryKey: ["transcription-api-keys"], queryFn: () => ipc.getTranscriptionApiKeys(), retry: false });
  const [engine, setEngine] = useState<"local" | "api" | null>(null);
  const [aiChoose, setAiChoose] = useState(false);
  const [aiSettings, setAiSettings] = useState<AiPickSettings>(DEFAULT_AI_PICK);
  // The automatic proposals, kept so the AI's choice can be compared or undone.
  const [automatic, setAutomatic] = useState<Proposal[] | null>(null);
  // From the import history (4.4i): clips already cut from this recording and earlier AI choices.
  const [savedRanges, setSavedRanges] = useState<SavedRange[]>([]);
  const [pickRuns, setPickRuns] = useState<PickRun[]>([]);
  const [fromHistory, setFromHistory] = useState<ClipSource | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const splitEngine = engine ?? preference.data?.mode ?? "local";
  const stored = keys.data?.filter((k) => k.present).map((k) => k.provider) ?? [];
  const cloudProvider: AudioProvider | undefined = stored.includes(preference.data?.provider ?? "deepgram") ? (preference.data?.provider ?? "deepgram") : stored[0];
  useEffect(() => () => { if (stagedRef.current) void ipc.discardClipStaging(stagedRef.current.stagingId); }, [ipc]);
  useEffect(() => {
    let remove: (() => void) | undefined;
    let disposed = false;
    void ipc.onClipSplitProgress((p) => setProgress(p)).then((u) => (disposed ? u() : (remove = u))).catch(() => {});
    return () => { disposed = true; remove?.(); };
  }, [ipc]);

  const adopt = async (next: ClipStaged, credit?: string, name?: string) => {
    if (stagedRef.current) void ipc.discardClipStaging(stagedRef.current.stagingId);
    stagedRef.current = next;
    setStaged(next);
    setProposals(null);
    setAutomatic(null);
    setSavedRanges([]);
    setPickRuns([]);
    setFromHistory(null);
    setFolder(null);
    setTitle(name ?? next.fileName.replace(/\.[^.]+$/, ""));
    if (credit) setSource(credit);
    setEnd(formatClockTenths(Math.min(next.durationMs, 15_000)));
    setUrl(await ipc.getClipStagingUrl(next.stagingId));
  };
  const run = async (kind: "file" | "link", work: () => Promise<void>) => {
    setBusy(kind); setError(null);
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "That did not work."); } finally { setBusy(null); }
  };
  const chooseFile = () => run("file", async () => { const next = await ipc.chooseClipFile(); if (next) await adopt(next); });
  const openFromHistory = async (opened: OpenedSource) => {
    await adopt(opened.staged, opened.source.credit, opened.source.title);
    const found = markSaved(opened.candidates.map(toProposal), opened.saved);
    setFromHistory(opened.source);
    setSavedRanges(opened.saved);
    setPickRuns(opened.picks);
    setProposals(found);
    setAutomatic(found);
  };
  // The default for its clips is the folder named after the recording (made if needed).
  const folders = useQuery({ queryKey: ["clip-folders"], queryFn: () => ipc.listClipFolders(), retry: false });
  const folderValue = folder ?? (() => {
    const name = title.trim();
    if (!name) return "";
    return folders.data?.find((f) => f.name.toLowerCase() === name.toLowerCase())?.id ?? `new:${name}`;
  })();
  const resolveFolder = async (): Promise<string | null> => {
    if (!folderValue) return null;
    if (!folderValue.startsWith("new:")) return folderValue;
    const name = folderValue.slice(4);
    const existing = (await ipc.listClipFolders()).find((f) => f.name.toLowerCase() === name.toLowerCase());
    return existing ? existing.id : (await ipc.createClipFolder(name)).id;
  };
  const fetchLink = () => run("link", async () => { const got = await ipc.fetchLinkAudio(link); await adopt(got.staged, got.source, got.title); });
  const [toolProgress, setToolProgress] = useState<{ received: number; total: number | null } | null>(null);
  useEffect(() => {
    let remove: (() => void) | undefined;
    let disposed = false;
    void ipc.onLinkToolDownload((p) => setToolProgress(p)).then((u) => (disposed ? u() : (remove = u))).catch(() => {});
    return () => { disposed = true; remove?.(); };
  }, [ipc]);
  const downloadTool = async () => {
    setBusy("link"); setError(null); setToolProgress({ received: 0, total: null });
    try { await ipc.downloadLinkTool(); await qc.invalidateQueries({ queryKey: ["link-tool"] }); } catch (e) { setError(e instanceof Error ? e.message : "yt-dlp could not be downloaded."); } finally { setBusy(null); setToolProgress(null); }
  };
  const chooseTool = async () => { try { await ipc.chooseLinkTool(); await qc.invalidateQueries({ queryKey: ["link-tool"] }); } catch (e) { setError(e instanceof Error ? e.message : "yt-dlp could not be set."); } };

  const split = async () => {
    if (!staged) return;
    setBusy("split"); setError(null); setProgress(0);
    try {
      const found = await ipc.splitClipSource(staged.stagingId);
      setProposals(markSaved(found.map(toProposal), savedRanges));
      setAutomatic(markSaved(found.map(toProposal), savedRanges));
      void qc.invalidateQueries({ queryKey: ["clip-sources"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The recording could not be split.");
    } finally {
      setBusy(null); setProgress(null);
    }
  };
  const playSection = (from: number, to: number) => preview.current?.playRange(from, to);
  const here = (set: (v: string) => void) => preview.current && set(formatClockTenths(preview.current.positionMs()));

  const saveOne = async () => {
    if (!staged) return;
    const startMs = parseClock(start);
    const endMs = parseClock(end);
    if (startMs === null || endMs === null) return setError("Enter times as m:ss, for example 0:12.5.");
    if (endMs - startMs < 3_000 || endMs - startMs > 30_000) return setError("Keep a section between 3 and 30 seconds long.");
    if (!title.trim()) return setError("Give the clip a title.");
    setBusy("save"); setError(null);
    try {
      const folderId = await resolveFolder();
      const clip = await ipc.saveClip({ stagingId: staged.stagingId, startMs, endMs, title: title.trim(), source: source.trim(), transcript: transcript.trim() || null, folderId });
      stagedRef.current = null;
      onSaved([clip]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The clip could not be saved.");
    } finally {
      setBusy(null);
    }
  };
  const saveProposals = async () => {
    if (!staged || !proposals) return;
    const kept = proposals.filter((p) => p.keep);
    if (kept.some((p) => !p.title.trim())) return setError("Give every kept clip a title.");
    setBusy("save"); setError(null);
    try {
      const folderId = await resolveFolder();
      const saved = await ipc.saveClipSections(staged.stagingId, kept.map((p) => ({ startMs: p.startMs, endMs: p.endMs, title: p.title.trim(), source: source.trim(), transcript: p.text, description: p.description.trim() || null, feature: p.feature })), folderId);
      stagedRef.current = null;
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The clips could not be saved.");
    } finally {
      setBusy(null);
    }
  };
  const kept = proposals?.filter((p) => p.keep).length ?? 0;

  return (
    <div className="space-y-4 rounded-lg border p-3" role="group" aria-label="Import a clip">
      <p className="text-meta text-muted-foreground">
        Use a recording you have the right to keep for your own practice. It stays on this computer, is never uploaded and is not shared with anyone.
      </p>

      {!staged && <ImportHistory disabled={!!busy} onOpen={(opened) => void openFromHistory(opened)} />}

      {/* 1. Where the audio comes from */}
      {/* One line, one height: file button, "or", link field and its button. */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" className="shrink-0" disabled={!!busy} onClick={() => void chooseFile()}>
          <FileAudio aria-hidden /> {staged ? "Choose another file…" : "Choose an audio file…"}
        </Button>
        <span className="text-meta text-muted-foreground">or</span>
        <div className="flex min-w-64 flex-1 items-center gap-2">
          <Label htmlFor="clip-link" className="sr-only">YouTube link</Label>
          <Input id="clip-link" placeholder="Paste a YouTube link" value={link} onChange={(e) => setLink(e.target.value)} disabled={!!busy || !tool.data?.available} />
          <Button variant="outline" className="shrink-0" disabled={!!busy || !tool.data?.available || !link.trim()} onClick={() => void fetchLink()}>
            <Link2 aria-hidden /> Get audio
          </Button>
        </div>
      </div>
      {tool.data && !tool.data.available && (
        <div className="space-y-2 rounded-md border border-dashed p-2 text-meta">
          <p className="text-muted-foreground">
            Links need yt-dlp, a free open-source tool (<a className="underline" href="https://github.com/yt-dlp/yt-dlp" target="_blank" rel="noreferrer">project page</a>).
            ClearPractice can download the official release from GitHub and check it against its published checksum before using it.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void downloadTool()}>Download yt-dlp</Button>
            <span className="text-muted-foreground">or install it yourself (<code>winget install yt-dlp.yt-dlp</code>) or</span>
            <button type="button" className="underline" onClick={() => void chooseTool()}>choose yt-dlp.exe</button>
          </div>
          {toolProgress && (
            <div className="space-y-1" role="status" aria-label="yt-dlp download progress">
              <progress className="h-2 w-full max-w-md" max={toolProgress.total ?? undefined} value={toolProgress.total ? toolProgress.received : undefined} />
              <p>
                Downloading yt-dlp… {(toolProgress.received / 1_048_576).toFixed(1)} MB{toolProgress.total ? ` of ${(toolProgress.total / 1_048_576).toFixed(1)} MB` : ""}
                <Button variant="ghost" size="sm" onClick={() => void ipc.cancelClipWork()}>Stop</Button>
              </p>
            </div>
          )}
        </div>
      )}
      {tool.data?.available && (
        <p className="text-meta text-muted-foreground">
          Audio only, videos up to 15 minutes. Downloading may not be allowed for every video; only use videos you have the right to keep, and follow YouTube's terms.
        </p>
      )}
      {((busy === "link" && !toolProgress) || busy === "file") && (
        <p role="status" className="flex items-center gap-2 text-meta">
          <Loader2 aria-hidden className="size-4 animate-spin" /> {busy === "link" ? "Getting the audio…" : "Opening the file…"}
          {busy === "link" && <Button variant="ghost" size="sm" onClick={() => void ipc.cancelClipWork()}>Stop</Button>}
        </p>
      )}

      {staged && (
        <>
          <p className="text-meta">{staged.fileName} · {formatClock(staged.durationMs)}</p>
          {fromHistory && (
            <p className="text-meta text-muted-foreground" role="status">
              From your import history: transcribed on {TRANSCRIBED_WITH[fromHistory.transcribedWith]}, so nothing needs transcribing again.
              {savedRanges.length > 0 && ` ${savedRanges.length} ${savedRanges.length === 1 ? "part is" : "parts are"} already saved and marked below.`}
            </p>
          )}
          {url && <AudioPlayer ref={preview} src={url} label="the whole file" />}
          <div className="space-y-1">
            <Label htmlFor="clip-source">Source and credit</Label>
            <Input id="clip-source" maxLength={500} placeholder="Speaker, talk, year, where you got it" value={source} onChange={(e) => setSource(e.target.value)} />
          </div>

          {/* 2a. Automatic: transcribe and propose whole-sentence clips */}
          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <p className="flex items-center gap-2 font-medium"><Scissors aria-hidden className="size-4" /> Split into clips automatically</p>
            <p className="text-meta text-muted-foreground">Transcribes the recording, then proposes 8–20 s clips that start and end on whole sentences.</p>
            <label className="flex items-center gap-2 text-meta">
              <input type="checkbox" checked={aiChoose} onChange={(e) => setAiChoose(e.target.checked)} /> Let AI choose the best parts (after transcription; sends only text)
            </label>
            <fieldset className="flex flex-wrap gap-4 text-meta" disabled={!!busy}>
              <legend className="sr-only">Transcribe with</legend>
              {([["local", "This computer"], ["api", "Cloud API"]] as const).map(([value, label]) => (
                <label key={value} className="flex min-h-8 items-center gap-2">
                  <input type="radio" name="split-engine" checked={splitEngine === value} onChange={() => setEngine(value)} /> {label}
                </label>
              ))}
            </fieldset>
            {splitEngine === "local" ? (
              <Button disabled={!!busy} onClick={() => void split()}>Transcribe and split</Button>
            ) : cloudProvider ? (
              <ApiRequestFlow
                attemptId={staged.stagingId}
                provider={cloudProvider}
                hasKey
                keyHint=""
                sendLabel={`Send to ${API_LABELS[cloudProvider]} · may be billed`}
                previewFn={(provider) => ipc.previewSplitTranscription(staged.stagingId, provider)}
                sendFn={async (requestId, sha) => {
                  const found = await ipc.requestSplitTranscription(requestId, sha);
                  setProposals(markSaved(found.map(toProposal), savedRanges));
                  setAutomatic(markSaved(found.map(toProposal), savedRanges));
                  void qc.invalidateQueries({ queryKey: ["clip-sources"] });
                }}
              />
            ) : (
              <p className="text-meta text-muted-foreground">Cloud transcription needs a Deepgram or AssemblyAI key in Settings → Transcription.</p>
            )}
            {busy === "split" && (
              <p role="status" className="flex items-center gap-2 text-meta">
                <Loader2 aria-hidden className="size-4 animate-spin" /> Transcribing… {progress ?? 0}%
                <Button variant="ghost" size="sm" onClick={() => void ipc.cancelClipWork()}>Stop</Button>
              </p>
            )}
            {proposals && (
              <div className="space-y-2">
                <p className="text-meta">{proposals.length} {proposals.length === 1 ? "clip" : "clips"} found. Untick any you don't want, and rename them if you like.</p>
                {/* Both stay mounted, so switching the option keeps each panel's state. */}
                <div hidden={!aiChoose}>
                  <AiPick
                    stagingId={staged.stagingId}
                    active={aiChoose}
                    settings={aiSettings}
                    onSettings={setAiSettings}
                    onPicked={(picks) => {
                      setProposals(markSaved(fromPicks(picks), savedRanges));
                      void qc.invalidateQueries({ queryKey: ["clip-sources"] });
                    }}
                  />
                </div>
                {automatic && proposals.some((p) => p.reason) && (
                  <Button variant="ghost" size="sm" onClick={() => setProposals(automatic)}>Show the automatic proposals again</Button>
                )}
                {pickRuns.length > 0 && (
                  <details className="text-meta">
                    <summary className="cursor-pointer">Earlier AI choices for this recording ({pickRuns.length})</summary>
                    <ul className="mt-1 space-y-1">
                      {pickRuns.map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center gap-2">
                          {new Date(r.createdAtMs).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · {r.model}{r.toneHint ? " · tone hint" : ""} · {r.picks.length} {r.picks.length === 1 ? "part" : "parts"}
                          <Button variant="ghost" size="sm" onClick={() => setProposals(markSaved(fromPicks(r.picks), savedRanges))}>Show</Button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <div hidden={aiChoose}><AiNaming
                  proposals={proposals}
                  onNames={(names) => setProposals((all) => all!.map((p, i) => {
                    const n = names.find((x) => x.index === i + 1);
                    return n ? { ...p, title: n.title, description: n.description, feature: n.feature, suggested: true } : p;
                  }))}
                /></div>
                <ol className="space-y-2">
                  {proposals.map((p, i) => (
                    <li key={`${p.startMs}`} className="space-y-1 rounded-md border p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="checkbox"
                          aria-label={`Keep clip ${i + 1}`}
                          checked={p.keep}
                          onChange={(e) => setProposals((all) => all!.map((q, j) => (j === i ? { ...q, keep: e.target.checked } : q)))}
                        />
                        <Input
                          aria-label={`Title of clip ${i + 1}`}
                          className="h-9 min-w-56 flex-1"
                          maxLength={200}
                          value={p.title}
                          onChange={(e) => setProposals((all) => all!.map((q, j) => (j === i ? { ...q, title: e.target.value } : q)))}
                        />
                        <span className="text-meta tabular-nums text-muted-foreground">{formatClockTenths(p.startMs)}–{formatClockTenths(p.endMs)}</span>
                        <Button variant="ghost" size="sm" aria-label={`Play clip ${i + 1}`} onClick={() => playSection(p.startMs, p.endMs)}>
                          <Play aria-hidden /> Play
                        </Button>
                      </div>
                      <p className="text-meta text-muted-foreground">{p.text}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          aria-label={`Description of clip ${i + 1}`}
                          className="h-9 min-w-56 flex-1"
                          maxLength={300}
                          placeholder="What is worth imitating (optional)"
                          value={p.description}
                          onChange={(e) => setProposals((all) => all!.map((q, j) => (j === i ? { ...q, description: e.target.value } : q)))}
                        />
                        <NativeSelect
                          aria-label={`Feature of clip ${i + 1}`}
                          compact
                          value={p.feature ?? ""}
                          onChange={(e) => setProposals((all) => all!.map((q, j) => (j === i ? { ...q, feature: (e.target.value || null) as Feature | null } : q)))}
                        >
                          <option value="">Feature…</option>
                          {(Object.keys(FEATURE_LABELS) as Feature[]).map((f) => <option key={f} value={f}>{FEATURE_LABELS[f]}</option>)}
                        </NativeSelect>
                        {p.suggested && <span className="text-meta text-muted-foreground">AI suggestion · edit freely</span>}
                      </div>
                      {p.reason && <p className="text-meta text-muted-foreground">Why: {p.reason}</p>}
                      {p.savedAs && <p className="text-meta font-medium">Already saved as “{p.savedAs}”. Tick it to save another copy.</p>}
                    </li>
                  ))}
                </ol>
                <FolderChoice value={folderValue} onChange={setFolder} suggested={title} />
                <Button disabled={!!busy || kept === 0} onClick={() => void saveProposals()}>
                  Save {kept} {kept === 1 ? "clip" : "clips"}
                </Button>
              </div>
            )}
          </div>

          {/* 2b. By hand: one section */}
          <details className="space-y-2" open={!proposals}>
            <summary className="cursor-pointer font-medium">Or keep one section by hand</summary>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="clip-start">Keep from</Label>
                <Input id="clip-start" className="w-24 tabular-nums" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => here(setStart)}>Start here</Button>
              <div className="space-y-1">
                <Label htmlFor="clip-end">to</Label>
                <Input id="clip-end" className="w-24 tabular-nums" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => here(setEnd)}>End here</Button>
              <span className="text-meta text-muted-foreground">3–30 seconds</span>
            </div>
            <div className="mt-2 space-y-1">
              <Label htmlFor="clip-title">Title</Label>
              <Input id="clip-title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="mt-2 space-y-1">
              <Label htmlFor="clip-transcript">Transcript (optional)</Label>
              <Textarea id="clip-transcript" rows={2} maxLength={4000} value={transcript} onChange={(e) => setTranscript(e.target.value)} />
            </div>
            {!proposals && <div className="mt-2"><FolderChoice value={folderValue} onChange={setFolder} suggested={title} /></div>}
            <Button className="mt-2" disabled={!!busy} onClick={() => void saveOne()}>Save clip</Button>
          </details>
        </>
      )}
      {error && <p role="alert" className="text-meta text-destructive">{error}</p>}
      <Button variant="ghost" disabled={busy === "save"} onClick={() => { if (busy) void ipc.cancelClipWork(); onCancel(); }}>Cancel</Button>
    </div>
  );
}
