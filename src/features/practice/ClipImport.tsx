import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileAudio, Link2, Loader2, Play, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatClock } from "@/lib/format";
import { useIpc } from "@/lib/ipc";
import type { ClipCandidate, ClipName, ClipStaged, CoachingModel, CoachingPreview, PickedClip, ReferenceClip } from "@/lib/ipc/schemas";
import { COACHING_MODELS } from "@/features/settings/CoachingSpike";
import { money } from "@/features/review/ApiTranscribe";
import { formatClockTenths, parseClock } from "@/features/review/waveform";
import { API_LABELS, ApiRequestFlow } from "@/features/review/ApiTranscribe";
import type { AudioProvider } from "@/lib/ipc/schemas";

type Feature = "emphasis" | "rhythm" | "endings";
type Proposal = ClipCandidate & { keep: boolean; description: string; feature: Feature | null; suggested: boolean; reason?: string };
const FEATURE_LABELS: Record<Feature, string> = { emphasis: "Emphasis", rhythm: "Phrase rhythm", endings: "Clear endings" };

/**
 * AI chooses the best parts (4.4e): the transcript is annotated on this computer
 * with measured delivery per sentence and only that text is sent, after the usual
 * preview and an explicit Send. Picks replace the automatic proposals.
 */
function AiPick({ stagingId, onPicked }: { stagingId: string; onPicked: (picks: PickedClip[]) => void }) {
  const ipc = useIpc();
  const key = useQuery({ queryKey: ["api-key-status"], queryFn: () => ipc.getApiKeyStatus(), retry: false });
  const [model, setModel] = useState<CoachingModel>("gpt-6-luna");
  const [toneHint, setToneHint] = useState(false);
  const [wanted, setWanted] = useState(8);
  const [preview, setPreview] = useState<CoachingPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!key.data?.present) {
    return <p className="text-meta text-muted-foreground">Letting AI choose needs an OpenAI key (Settings → Coaching). The automatic proposals below still work.</p>;
  }
  const prepare = async () => {
    setBusy(true); setError(null);
    try { setPreview(await ipc.previewClipPicks(stagingId, { model, toneHint, wanted })); } catch (e) { setError(e instanceof Error ? e.message : "Could not prepare the request."); } finally { setBusy(false); }
  };
  const send = async () => {
    if (!preview) return;
    const approved = preview;
    setPreview(null); setBusy(true); setError(null);
    try { onPicked(await ipc.requestClipPicks(stagingId, approved.requestId, approved.payloadSha256)); } catch (e) { setError(e instanceof Error ? e.message : "The request did not finish; the charge may be uncertain."); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2 rounded-md border p-2">
      <div className="flex flex-wrap items-center gap-2 text-meta">
        <Label htmlFor="pick-model" className="text-meta">AI model</Label>
        <select id="pick-model" className="h-9 rounded-md border bg-background px-2 text-meta" value={model} disabled={busy} onChange={(e) => { setModel(e.target.value as CoachingModel); setPreview(null); }}>
          {COACHING_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.note}</option>)}
        </select>
        <Label htmlFor="pick-wanted" className="text-meta">Up to</Label>
        <Input id="pick-wanted" type="number" min={1} max={20} className="h-9 w-16" value={wanted} onChange={(e) => { setWanted(Math.max(1, Math.min(20, Number(e.target.value) || 1))); setPreview(null); }} />
        <span>clips</span>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={toneHint} onChange={(e) => { setToneHint(e.target.checked); setPreview(null); }} /> Experimental: let AI guess the speaker's tone as a hint
        </label>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void prepare()}>Ask AI to choose…</Button>
      </div>
      {preview && (
        <div className="space-y-2 text-meta" role="group" aria-label="AI clip choice request preview">
          <p className="font-medium">Recipient: OpenAI · {preview.model}</p>
          <p>Estimated upper reservation: {money(preview.estimatedMaximumCostMicroUsd)} within the shared monthly limit. Only the transcript and its measured numbers are sent, never audio.</p>
          <details><summary className="cursor-pointer">Text that will be sent</summary><pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap">{preview.selectedText}</pre></details>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => void send()}>Send transcript · may be billed</Button>
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
        <select id="naming-model" className="h-9 rounded-md border bg-background px-2 text-meta" value={model} disabled={busy} onChange={(e) => { setModel(e.target.value as CoachingModel); setPreview(null); }}>
          {COACHING_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.note}</option>)}
        </select>
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
  const preview = useRef<HTMLAudioElement>(null);
  const stopAt = useRef<number | null>(null);
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
  const fetchLink = () => run("link", async () => { const got = await ipc.fetchLinkAudio(link); await adopt(got.staged, got.source, got.title); });
  const chooseTool = async () => { try { await ipc.chooseLinkTool(); await qc.invalidateQueries({ queryKey: ["link-tool"] }); } catch (e) { setError(e instanceof Error ? e.message : "yt-dlp could not be set."); } };

  const split = async () => {
    if (!staged) return;
    setBusy("split"); setError(null); setProgress(0);
    try {
      const found = await ipc.splitClipSource(staged.stagingId);
      setProposals(found.map(toProposal));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The recording could not be split.");
    } finally {
      setBusy(null); setProgress(null);
    }
  };
  const playSection = (from: number, to: number) => {
    const audio = preview.current;
    if (!audio) return;
    audio.currentTime = from / 1000;
    stopAt.current = to / 1000;
    void audio.play().catch(() => {});
  };
  const here = (set: (v: string) => void) => preview.current && set(formatClockTenths(preview.current.currentTime * 1000));

  const saveOne = async () => {
    if (!staged) return;
    const startMs = parseClock(start);
    const endMs = parseClock(end);
    if (startMs === null || endMs === null) return setError("Enter times as m:ss, for example 0:12.5.");
    if (endMs - startMs < 3_000 || endMs - startMs > 30_000) return setError("Keep a section between 3 and 30 seconds long.");
    if (!title.trim()) return setError("Give the clip a title.");
    setBusy("save"); setError(null);
    try {
      const clip = await ipc.saveClip({ stagingId: staged.stagingId, startMs, endMs, title: title.trim(), source: source.trim(), transcript: transcript.trim() || null });
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
      const saved = await ipc.saveClipSections(staged.stagingId, kept.map((p) => ({ startMs: p.startMs, endMs: p.endMs, title: p.title.trim(), source: source.trim(), transcript: p.text, description: p.description.trim() || null, feature: p.feature })));
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

      {/* 1. Where the audio comes from */}
      <div className="flex flex-wrap items-end gap-3">
        <Button variant="outline" disabled={!!busy} onClick={() => void chooseFile()}>
          <FileAudio aria-hidden /> {staged ? "Choose another file…" : "Choose an audio file…"}
        </Button>
        <span className="pb-2 text-meta text-muted-foreground">or</span>
        <div className="min-w-64 flex-1 space-y-1">
          <Label htmlFor="clip-link">YouTube link</Label>
          <div className="flex gap-2">
            <Input id="clip-link" placeholder="https://www.youtube.com/watch?v=…" value={link} onChange={(e) => setLink(e.target.value)} disabled={!!busy || !tool.data?.available} />
            <Button variant="outline" disabled={!!busy || !tool.data?.available || !link.trim()} onClick={() => void fetchLink()}>
              <Link2 aria-hidden /> Get audio
            </Button>
          </div>
        </div>
      </div>
      {tool.data && !tool.data.available && (
        <p className="text-meta text-muted-foreground">
          Links need yt-dlp, which ClearPractice does not include. Install it with <code>winget install yt-dlp.yt-dlp</code>, then reopen this dialog, or{" "}
          <button type="button" className="underline" onClick={() => void chooseTool()}>choose yt-dlp.exe</button>.
        </p>
      )}
      {tool.data?.available && (
        <p className="text-meta text-muted-foreground">
          Audio only, videos up to 15 minutes. Downloading may not be allowed for every video; only use videos you have the right to keep, and follow YouTube's terms.
        </p>
      )}
      {(busy === "link" || busy === "file") && (
        <p role="status" className="flex items-center gap-2 text-meta">
          <Loader2 aria-hidden className="size-4 animate-spin" /> {busy === "link" ? "Getting the audio…" : "Opening the file…"}
          {busy === "link" && <Button variant="ghost" size="sm" onClick={() => void ipc.cancelClipWork()}>Stop</Button>}
        </p>
      )}

      {staged && (
        <>
          <p className="text-meta">{staged.fileName} · {formatClock(staged.durationMs)}</p>
          {url && (
            <audio
              ref={preview}
              controls
              src={url}
              className="h-10 w-full"
              aria-label="Preview the whole file"
              onTimeUpdate={(e) => { if (stopAt.current !== null && e.currentTarget.currentTime >= stopAt.current) { e.currentTarget.pause(); stopAt.current = null; } }}
            />
          )}
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
                  setProposals(found.map(toProposal));
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
                {aiChoose && (
                  <AiPick
                    stagingId={staged.stagingId}
                    onPicked={(picks) => setProposals(picks.map((p) => ({ startMs: p.startMs, endMs: p.endMs, text: p.text, title: p.title, keep: true, description: p.description, feature: p.feature, suggested: true, reason: p.reason })))}
                  />
                )}
                {!aiChoose && <AiNaming
                  proposals={proposals}
                  onNames={(names) => setProposals((all) => all!.map((p, i) => {
                    const n = names.find((x) => x.index === i + 1);
                    return n ? { ...p, title: n.title, description: n.description, feature: n.feature, suggested: true } : p;
                  }))}
                />}
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
                        <select
                          aria-label={`Feature of clip ${i + 1}`}
                          className="h-9 rounded-md border bg-background px-2 text-meta"
                          value={p.feature ?? ""}
                          onChange={(e) => setProposals((all) => all!.map((q, j) => (j === i ? { ...q, feature: (e.target.value || null) as Feature | null } : q)))}
                        >
                          <option value="">Feature…</option>
                          {(Object.keys(FEATURE_LABELS) as Feature[]).map((f) => <option key={f} value={f}>{FEATURE_LABELS[f]}</option>)}
                        </select>
                        {p.suggested && <span className="text-meta text-muted-foreground">AI suggestion · edit freely</span>}
                      </div>
                      {p.reason && <p className="text-meta text-muted-foreground">Why: {p.reason}</p>}
                    </li>
                  ))}
                </ol>
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
            <Button className="mt-2" disabled={!!busy} onClick={() => void saveOne()}>Save clip</Button>
          </details>
        </>
      )}
      {error && <p role="alert" className="text-meta text-destructive">{error}</p>}
      <Button variant="ghost" disabled={busy === "save"} onClick={() => { if (busy) void ipc.cancelClipWork(); onCancel(); }}>Cancel</Button>
    </div>
  );
}
