# ClearPractice — Project Handout (updated 2026-10-08)

A condensed summary of decisions, verified work, and remaining tasks. Read the current status in DEVELOPMENT_PLAN.md before starting; it is more current than older chat messages.

---

## 1. What the project is

A **Windows 11 desktop speaking coach** for one user. It guides short sessions (pick a prompt → record → review one improvement → try again) and keeps **all** history on the computer: recordings, transcripts, notes, phrases, and progress.

- **Spec:** `ClearPractice-App-Blueprint.md` (rev. 3, 4 October 2026). References like §9 point into it.
- **Stack:** Tauri 2 (Rust core) + React 19 + TypeScript + Vite + Tailwind 4 + shadcn/ui (Radix). Rust owns recording, files, SQLite, and outbound API calls.
- **Services:** transcription has **Local / API / Off**, defaulting to local **whisper.cpp**. The user requested an optional audio-transcription API; one approved saved take can be sent to its chosen provider. Coaching independently offers **API / Local LLM / Off**, defaulting to a hosted LLM with the user's own key and explicit requests for selected text. Optional local LLM uses a loopback endpoint. Settings alone never send audio; local processing and prosody stay on the computer.
- **Principles:** no single fluency score, no CEFR levels, and every observation labelled **Measured / Estimated / Your note / AI suggestion**. Missing values are shown as *unavailable*, never 0.

## 2. Files in the repo

| File | Purpose |
| --- | --- |
| `ClearPractice-App-Blueprint.md` | Full product and technical spec |
| `DEVELOPMENT_PLAN.md` | **Checkbox tracker** with milestones, decision log, acceptance suite, and notes. Read "Current status" first |
| `AGENTS.md` | Current workspace instructions for development agents |
| `CLAUDE.md` | Conventions and commands for AI assistants |
| `handout.md` | This file |
| `src/` | React UI (`app/` shell, `features/<area>/` screens, `components/`, `lib/ipc/` typed IPC + mock) |
| `src-tauri/` | Rust core: app folders, microphone enumeration, real capture, chunk journal, WAV verification/recovery, recording commands |

## 3. Milestones (see the plan for all checkboxes)

E (environment) → **M0 Feasibility** (audio, Whisper, text API spike; optional audio API spike) → **M1 Design & shell** → M2 Durable practice (recording, SQLite, backup/restore) → M3 Review & local/API transcription → **P Prosody** → M4 Full routine → M5 Coaching modes → M6 Release hardening. API transcription has its own enablement gate and must not stall local durable practice while credentials are pending.

## 4. Current status

**Done and verified**
- Environment on the original laptop: Rust 1.98.1 (MSVC), VS Build Tools 2026 + Windows SDK 10.0.26100, Node 24.14, and `npx tauri info` all green. The first `cargo build` of `src-tauri` succeeds.
- Scaffold and lockfiles exist; all direct npm and Rust dependencies are pinned exactly.
- **M1 UI shell:** all planned screens exist. Native recording/session history are real; routine, phrases and progress remain explicitly labelled sample data. Native saved-session review never shows mock feedback.
- **M0 recording slice (0.5–0.9):** desktop Studio now opens real microphones at native format, shows rate-limited levels, writes synced one-second mono PCM chunks, and commits a verified WAV plus metadata receipt on Stop. Duplicate Start/Stop requests are handled safely. Native recording is selected automatically in Tauri; the browser simulates it.
- Today and Studio have a persistent recording library, explicit recovery actions, and saved-audio controls. Playback uses trusted IDs and a scoped asset protocol. Navigation and desktop close guards are implemented; the complete manual playback/reopen/close pass remains pending.
- The latest frontend suite passes 28/28. Native M0/M2 storage checks pass; exact final counts/build status are in plan Notes. Earlier live microphone and three forced-kill runs recovered 3000 ms with 730–770 ms lost; these are harness checks, not packaged acceptance.
- Git branch `main` has baseline commits for the scaffold, data folders, and device list. Development changes are **uncommitted**. Do not discard existing work.

**Completed gate and remaining work**
- M1 leftovers: a manual keyboard pass over Studio, Phrases, Progress, and Settings and compact navigation below 800 px.
- Core M0 exit gate passed on 7 October: selected local model/backend/filler strategy and one approved live coaching result. Full packaging and optional audio API gates remain separate.
- Optional API transcription is **planned, not implemented**: D-20–23, M0 0.20–23, M3 3.14–19, and acceptance A-23–25. The 4 October session researched official documentation and updated the specification/tracker/handout; no recordings or paid requests were submitted.
- M2 is active: SQLite (schema v2), durable recording references and real session history/editing are implemented. Waveform player with native peaks cache and loop range, and Trash with restore/retention/safe permanent delete (schema v2), are implemented; desktop pass pending. Backup/export/restore, recording failure/manual acceptance, product transcription jobs, routine, coaching modes and prosody remain.

**Latest implementation checkpoint (4–7 October)**
- Rubato 0.16.2 converts immutable saved audio to verified 16 kHz mono PCM, trimming filter delay/flushing the final block. Tests cover timing at rates 8–192 kHz, alias rejection, cancellation and cache corruption.
- Official whisper.cpp 1.9.1 CPU/CUDA archives and existing base/turbo model SHA-256/sizes are pinned in `bench/whisper-assets.json`. `Prepare-Whisper.ps1` reuses existing weights read-only and verifies runtime DLLs. CUDA 11.8 also needs verified NVIDIA cuBLAS DLLs, downloaded locally with their licence; packaged redistribution review remains M6. No system driver/toolkit was installed.
- One native sidecar owner handles bounded progress/JSON, cancellation/kill/reap, checksum rejection, raw/normalized artifacts and peak RAM. Provider-neutral `TranscriptionResult` adds explicit unavailable reasons; word alignment and diarization are not claimed. It is not yet the product Review/job UI (M3).
- **User answer:** use downloaded internet audio instead of requesting a personal recording again. `Fetch-PublicSample.ps1`, pinned `public-fixture.json` and standard-library `public_sample.py` reproduce eight independent-reference, Apache-2.0 Nyra test clips totaling 61.934 s. This is an untrimmed multi-clip public fixture, not personal accuracy. Samples/references/runtime binaries remain ignored; copy or reproduce them on another machine.
- Six profiles each have an initial + three subsequent public runs. Selected CUDA turbo + `Umm, so, uh, I think, like, you know.` has warm worker median **11.532 s**, total **14.022 s**, peak working set **380.2 MiB**, **13/14 UH/UM retained**, **zero inserted**, and **3/194 verbatim edits** in all trials. CPU base alternative: 28.603 s worker / 29.040 s total, 0/14 fillers. Full matrix: `bench/results-2026-10.md` and `.json`; portable `selected-profile.json`. Initial caches uncontrolled; process VRAM N/A; no verified word alignment or personal accuracy. Old slow JFK GPU trial was not reproduced; cause unknown.
- Windows Credential Manager exposes presence only, with replace/remove. Fake-slot and no-secret-cache checks passed. User stored their key in the app and explicitly sent the live text test. Agent verified only saved receipt/usage metadata and never read the real key.
- Shared USD 5 stop / USD 4 warning foundation still uses its locked durable JSON ledger independently of session SQLite. It atomically reserves both purposes, binds hashes/month/request IDs and retains uncertain possible charges across restart. Settings shows separate subtotals under one limit. Later migrate through SQLite's single writer; do not create a second allowance.
- GPT-6 Luna is the initial coaching choice after one user-approved live sample: 291 input / 163 output tokens, **USD 0.000227 conservatively estimated**, saved/settled. It preserved meaning and labelled “more fast” → “searching faster” and “more clear” → “clearer” as optional style. Single-use exact-payload preview, no transport retries/redirects and strict quote/schema checks remain. This is one quality example, not broad validation or an invoice; model choice becomes configurable in M5.
- M0 native/contract/UI checks pass. M2 tests verify legacy import, edits/restart, missing audio, concurrent retakes, FK/idempotency, rollback and validated pre-upgrade snapshots. Latest exact counts/build status are in the plan Notes. Use approved unsandboxed native/test-worker checks when permissions stall; never weaken validation.

**Next action:** continue M2: complete reconciliation/recovery presentation, manual recording failure/close checks, manual desktop pass of the waveform player and Trash and full checksum-verified backup/export/restore. Rebuild/reopen desktop for new IPC commands when idle. M3 wires the selected local worker into product jobs/review. Optional API audio remains disabled until separately previewed/approved checks; do not repeat completed M0 or request personal audio.

## 5. Answers and decisions so far

| Topic | Answer / decision |
| --- | --- |
| Windows SDK setup | User installed **VS Build Tools 2026** (with the Windows SDK) themselves |
| Package manager | npm |
| Interface locale | English; dates formatted as `en-GB` regardless of the Windows locale (`UI_LOCALE` in `src/lib/format.ts`) |
| Models beyond plain transcription | Discussed (see §7). The user asked to add the **first two** ideas to the plan; done |
| Mood/emotion detection | **Not built** (D-18): unreliable for second-language speech; self-rated ease + energy measures instead |
| Hosted coaching | OpenAI GPT-6 Luna initially (one approved sample); configurable in M5; USD 5/month app stop limit, USD 4 warning default |
| API transcription | User requested the option. OpenAI proposed as the first adapter; local remains default; separate audio preview and approval per saved take |
| Shared API budget | Working assumption D-22: extend the existing USD 5 stop / USD 4 warning to **combined transcription + coaching**, with separate subtotals. No extra allowance; combined allocation was not previously confirmed |
| Practice and interface | English initially; German may follow; English interface confirmed |
| Backups and retention | Local folder chosen in-app; recordings kept until explicit deletion |
| Model downloads | Reuse existing packs first. Additional downloads depend on benchmarks |
| Topics and goals | Explaining, debating, teaching; sport, economics, religion, crypto, programming, anime, books |

**Still open**
1. Broader coaching quality checks and configurable model controls in M5; the initial GPT-6 Luna live check is complete. Credentials belong in the app, never chat/source/backups.
2. Select the exact local backup folder in the app when that feature exists.
3. **D-11:** approve additional model downloads only if benchmarking needs them.
4. **D-21:** select the API transcription model separately from the coaching and local Whisper models after evaluating filler fidelity, timings, text accuracy, latency, and cost. Documentation support is verified; app/model access and real-audio performance are not.

Settled defaults: D-4 turbo q5_0, D-5 CUDA on the original laptop, D-12 Rubato, D-13 whisper.cpp sidecar, D-16 filler-bearing prompt. D-17 pitch tracker still needs measurement. Existing weights are outside the repository. Reproduce setup/fixtures with bench scripts and re-benchmark different hardware.

## 6. Hardware (original laptop, re-detect on a new machine)

AMD Ryzen 7 3750H (4C/8T) · 13.9 GB RAM · NVIDIA GTX 1650 **4 GB VRAM**, driver 592.82 · Windows 11 Pro 26200 · WebView2 154. The Whisper defaults (§10) were planned around this machine.

## 7. The model discussion, in short

Plain speech recognition produces text and, depending on the model, timings. It does not provide a validated intonation or mood assessment and may drop "um".

1. **Intonation / stress / rhythm (prosody):** local signal processing (pitch trackers such as YIN/pYIN/McLeod, optionally CREPE; loudness), with accuracy to verify. **Added as Milestone P:** a pitch and loudness display in Review and a reference-vs-attempt overlay for Listen & imitate. No scores. Word-linked stress requires verified alignment; untimed API text still permits audio contours.
2. **Mood/emotion:** models exist (SenseVoice-Small, emotion2vec, wav2vec2-based) but are trained mostly on acted native speech and misread L2 hesitation as emotion. **Skipped** (D-18).
3. **Filler-aware transcription:** selected the measured turbo/CUDA filler prompt. CrisperWhisper V2 requires a separate custom adapter (published CTranslate2 wheels Linux; Windows Transformers); model licence is Nyra NonCommercial Research License, code MIT. No official ggml route identified. Experiment deferred and no weights downloaded.
4. **General models that interpret audio directly** (GPT-4o audio, Gemini, Voxtral, Qwen-Omni): separate from speech-to-text APIs. Their usefulness for delivery assessment is unverified; later, opt-in only. Adding API transcription does not authorize extra audio coaching or mood analysis.

*The original prosody/disfluency/experimental model names and licences need verification before adoption. API candidates below were checked against official documentation.*

### Optional API transcription (added 4 October 2026)

- **First adapter:** OpenAI file transcription. Evaluate `gpt-transcribe` for general use, `gpt-4o-mini-transcribe` for cost, and `whisper-1` when word/segment timestamps are needed. Timestamp capability differs by model; never invent alignment. [Official guide](https://developers.openai.com/api/docs/guides/speech-to-text).
- **Price snapshot:** respectively USD 0.0045/min, approximately USD 0.003/min, and USD 0.006/min. Recheck prices and store actual billing units; see blueprint §16 and the plan's dated sources.
- **Workflow:** save and verify original audio → prepare untrimmed 16 kHz mono WAV in Rust → preview playable audio, recipient/model, duration/size, hints, estimated cost, and shared budget → explicit Send → normalize and save the result locally. Enforce the provider file limit before sending. Credentials are stored in Windows Credential Manager; browser components never upload audio directly.
- **Privacy and reliability:** transcription sends only approved audio/hints; coaching sends only separately previewed text. Provider-specific terms apply. No automatic paid retry, fallback, upload on Stop, reconnection, restore, or model change. Saved API transcripts work offline. Unsupported metrics/timing are unavailable with a reason; local pitch/pause analysis is independent.
- **History and costs:** preserve separate runs/revisions per model; cache exact inputs; Retranscribe is deliberate and may cost money. Reserve against one combined budget, include tests/retries, and retain uncertain charges after timeout/cancel. API scope adds an estimated 4–7 working days; its gate must pass before exposing uploads.

## 8. Implementation notes and gotchas

- **IPC boundary:** components use `useIpc()` / hooks in `src/lib/ipc/queries.ts`. Method names mirror the blueprint's Rust commands (§15). All data is parsed with Zod (`src/lib/ipc/schemas.ts`), so the mock can't drift from the contract.
- **Design tokens:** `--cp-*` in `src/index.css` (§4 colours), mapped onto shadcn variables. No hard-coded colours.
- **Customised shadcn primitives:** buttons ≥ 40 px, sidebar 216 px, custom `nav:` breakpoint at 800 px (`use-mobile.ts` in sync), and `CommandDialog` fixed so its title sits inside the dialog and children are wrapped in `<Command>`.
- shadcn imports `cn` from the `cn` npm package (shadcn's own; verified legitimate).
- **Git Bash:** `link` resolves to GNU coreutils and breaks Rust linking. Run cargo from **PowerShell**; add `$env:USERPROFILE\.cargo\bin` to PATH if needed.
- Vitest workers time out if started during a cargo build (CPU saturated). Rerun afterwards.
- `useBlocker` guards navigation; Rust intercepts native close while capture is active and asks the Studio to show Stop and save / Continue recording. Manual close checks remain pending.
- Live audio tests require execution outside the restricted sandbox. CPAL scheduling/route notifications keep the stream active; true errors and overruns interrupt safely. A heavy concurrent build caused an xrun; idle microphone and crash tests passed. Keep inference/background work below recording priority.
- Tauri config: product name ClearPractice, min window 800×600, restrictive CSP, NSIS/MSI targets.
- The main JS chunk is 1.1 MB. Acceptable for a local app; lazy-load if cold start misses 2 s.

## 9. Setting up on another machine

Copy the source folder **without** `node_modules/`, `src-tauri/target/`, and `dist/`, including any uncommitted work. Existing model packs and app-local recordings live elsewhere; they are not included in a source-folder copy. Use the app's backup/export feature once implemented to transfer practice data.

1. Install **Node 24+**, **Rust stable** (`winget install Rustlang.Rustup`), and **Visual Studio Build Tools** with the *Desktop development with C++* workload + a Windows 10/11 SDK. WebView2 is preinstalled on Windows 11.
2. In the repo: `npm ci`
3. Check: `npx tauri info` (everything should be ✔)
4. Run:
   - `npm run dev`: UI in a browser at http://localhost:1420 (mock data)
   - `npm run tauri dev`: desktop window
   - `npm test` · `npm run typecheck` · `npm run build`
5. Re-detect the hardware (CPU, RAM, GPU/VRAM, driver) and update "Environment facts" in `DEVELOPMENT_PLAN.md` if the machine differs.

## 10. Prompt to start the next chat

> Continue developing ClearPractice in M2. Read AGENTS.md, handout.md and DEVELOPMENT_PLAN.md Current status; specification is ClearPractice-App-Blueprint.md rev. 3. Core M0 is verified: real capture/forced-kill recovery, Rubato conversion, pinned whisper.cpp 1.9.1 and six public benchmark profiles, selected turbo-q5_0/CUDA/filler prompt, provider-neutral contract and one user-approved live GPT-6 Luna text result. Do not request another personal sample or repeat the paid test. SQLite v1, legacy receipt import, staged recording references and real history/editor are implemented and tested; preserve all uncommitted work and app-local data. Continue remaining M2 recovery/recording/waveform/Trash/backup/restore gates before broad M3 jobs/review. Optional audio API is off and requires separate preview/approval. Preserve the existing shared USD 5 stop/USD 4 warning ledger and its 227 micro-USD estimated live charge during later migration. Keys stay in Credential Manager and never travel with source or backups. Rebuild/reopen the desktop when idle for new commands. Tick only verified gates and update status/notes/handout.
