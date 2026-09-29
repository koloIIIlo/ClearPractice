# ClearPractice — Development Plan & Tracker

Source of truth for *what* to build: [ClearPractice-App-Blueprint.md](ClearPractice-App-Blueprint.md) (rev. 2, 29 Sep 2026).
This file tracks *how far we are*. Section references like **§9** point into the blueprint.

## How to use this file

- `[ ]` not started · `[x]` done · `[~]` in progress · `[!]` blocked (reason inline)
- Tick a box only when the item is **verified** (test passes, or it was checked manually and the check is noted).
- Each milestone has an **Exit gate**. Don't start broad work in the next milestone until the gate passes.
  Exception: M1 (UI shell with sample data) can run alongside M0 because it doesn't depend on M0's results.
- New decisions go in the **Decision log**; new risks or surprises go in **Notes & findings**.
- Update **Current status** at the end of every working session.

---

## Current status

| | |
| --- | --- |
| Active milestone | M0 Feasibility (M1 shell is functionally done; remaining items are listed below) |
| Last updated | 2026-09-29 |
| Repository | Initial commit includes the M0 scaffold, M1 sample-data shell, lockfiles, and Git/editor configuration |
| Next action | M0 audio spike: 0.5–0.9 chunked capture, recovery, level meter, and kill test. Then benchmark the existing Whisper model alongside smaller candidates |
| Blockers | None for recording. Choose and validate the OpenAI model before the API spike; request a model download only if the existing packs cannot answer the benchmark question |

---

## Environment facts (detected 2026-09-29)

Resolves the hardware open questions in §10 and §18.

| Item | Value |
| --- | --- |
| OS | Windows 11 Pro 10.0.26200, x64 |
| CPU | AMD Ryzen 7 3750H (4 cores / 8 threads) |
| RAM | 13.9 GB usable (16 GB installed, some shared with iGPU) |
| dGPU | NVIDIA GeForce GTX 1650 laptop, **4096 MiB VRAM**, driver 592.82 |
| iGPU | AMD Radeon RX Vega 10 |
| Free disk | C: 33.8 GB · D: 323.3 GB (project lives on D:) |
| WebView2 | 154.0.4258.37 (installed) |
| Node / npm | 24.14.0 / 11.9.0 |
| Git | 2.49.0 |
| MSVC | VS Build Tools 2026 (18.10, installed at D:\Aps\Microsoft Visual Studio) + VS 2019 Build Tools |
| Windows SDK | 10.0.26100.0 |
| Rust | 1.98.1 stable, x86_64-pc-windows-msvc (rustup 1.29.1) |
| Tauri | tauri 2.12.0 / CLI 2.12.0 · `tauri info` all green |

---

## Decision log

| # | Decision | Status | Date |
| --- | --- | --- | --- |
| D-1 | Stack: Tauri 2 + React + TS + Vite + Tailwind 4 + shadcn/ui (Radix) (§8) | Confirmed by blueprint | 2026-09-29 |
| D-2 | Package manager: npm (already installed; lockfile committed) | Chosen | 2026-09-29 |
| D-3 | Target: Windows 11 x64 only, single user | Confirmed by blueprint | 2026-09-29 |
| D-4 | Transcription default: existing large-v3-turbo-q5_0 vs smaller packs → decided by M0 benchmark | **Open** | |
| D-5 | Whisper backend: CPU vs CUDA build → decided by M0 benchmark | **Open** | |
| D-6 | Initial hosted coaching provider: OpenAI API; choose a configurable model after feedback quality and cost checks | Provider chosen, model pending | 2026-09-29 |
| D-7 | Stop new app coaching requests at USD 5/month; warn at USD 4 by default (adjustable) (§16) | USD 5 limit confirmed; USD 4 warning assumed | 2026-09-29 |
| D-8 | English practice for the first release; German may follow later (§18) | Confirmed | 2026-09-29 |
| D-9 | English interface; dates formatted with `en-GB` regardless of Windows locale (`UI_LOCALE` in src/lib/format.ts) | Confirmed | 2026-09-29 |
| D-10 | Keep backups locally in a user-selected folder; retain original recordings until explicit deletion (§18) | Confirmed; exact backup folder selected in the app | 2026-09-29 |
| D-11 | Reuse existing local Whisper packs first; decide on any additional one-time download after benchmarking | Existing pack found; download decision deferred | 2026-09-29 |
| D-12 | Audio resampling crate (rubato vs alternative) → M0 spike | **Open** | |
| D-14 | shadcn preset `radix-nova`; primitives customised in place (buttons ≥ 40 px, sidebar 216 px, `nav` breakpoint 800 px, CommandDialog a11y fix) | Chosen | 2026-09-29 |
| D-15 | Until native commands exist, the UI runs on `createMockClient()`, which parses through the same Zod schemas as the future Tauri client | Chosen | 2026-09-29 |
| D-16 | Filler-aware transcription: plain Whisper vs. filler-prompt trick vs. CrisperWhisper → decided by 0.14a–c measurements | **Open** | |
| D-17 | Pitch tracker for prosody (YIN / pYIN / McLeod vs. CREPE-tiny) → decided by P.1 | **Open** | |
| D-18 | Mood/emotion detection from voice: **not built**. Acted-emotion training data makes it unreliable for second-language speech; self-reported ease + energy/pitch-range measures cover the need. Revisit only as a local experiment | Deferred | 2026-09-29 |
| D-13 | Whisper integration: sidecar `whisper-cli`/server exe vs `whisper-rs` bindings (§9: blueprint prefers a worker process) | **Open**, leaning toward a sidecar process | |
| D-19 | Content focus: explaining complex topics, debating, and teaching; subject pool includes sport, economics, religion, crypto, programming, anime, and books | Confirmed | 2026-09-29 |

---

## Milestone E — Development environment

- [x] E-1 Detect hardware and existing tools (see Environment facts)
- [x] E-2 Install Rust (rustup, stable, `x86_64-pc-windows-msvc`)
- [x] E-3 Windows SDK: the user installed VS Build Tools 2026 with SDK 10.0.26100
- [x] E-4 Verify `cargo build` links a hello-world binary
- [x] E-5 Install the Tauri CLI (as an npm dev dependency) and check prerequisites with `tauri info`
- [x] E-6 Initialize Git on `main`, add `.gitignore`, `.gitattributes`, and `.editorconfig`, and make the initial commit
- [ ] E-7 Install CMake (needed only if we build whisper.cpp from source; skip if prebuilt binaries are used)

## Milestone 0 — Feasibility (§17, §18) · budget 3–5 days

Goal: prove recording durability, Whisper on this laptop, and one bounded API call before broad UI work.

**Scaffold**
- [x] 0.1 Scaffold the Tauri 2 + React + TS + Vite app in the repo root (`src/`, `src-tauri/`)
- [~] 0.2 Pin exact dependency versions, commit lockfiles (§8). npm deps pinned exactly; Cargo.lock exists; Cargo.toml still uses `"2"` ranges
- [x] 0.3 Resolve the app-local data root through the Tauri path API at startup; create `database/`, `recordings/`, `imports/`, `models/`, `cache/`, `recovery/` (§12). Rust test verifies creation and repeat startup

**Audio spike (§9)**
- [x] 0.4 `list_input_devices` command using CPAL: stable ID, name, default flag, supported configs. Live Windows smoke test found three inputs with six format ranges each; native UI wiring follows with the IPC client
- [ ] 0.5 Open the device at its native rate/format; real-time callback → bounded queue, no blocking I/O in the callback
- [ ] 0.6 Writer thread: downmix to mono, write 16-bit PCM chunk files, flush at least every 2 s
- [ ] 0.7 Recovery manifest written before the mic opens; on Stop, concatenate chunks → WAV, verify, atomic rename
- [ ] 0.8 Level meter event (`recording_level`, rate-limited)
- [ ] 0.9 **Kill test**: kill the process mid-recording; on relaunch, recover with ≤ 2 s lost
- [ ] 0.10 Derive 16 kHz mono inference WAV (pick the resampler → D-12)

**Whisper spike (§10)**
- [ ] 0.11 Obtain pinned whisper.cpp Windows binaries (CPU + CUDA) — record version, source, checksums
- [ ] 0.12 Inventory and verify existing `ggml-base` and `ggml-large-v3-turbo-q5_0` packs; obtain `ggml-base.en`/`ggml-small.en` only if a controlled comparison still needs them
- [ ] 0.13 Sidecar worker invocation with JSON output, progress, cancel (→ D-13)
- [ ] 0.14 Benchmark script: 60 s personal sample × {existing base, existing large-v3-turbo-q5_0, English baselines if obtained} × {CPU, CUDA}: 1 cold + 3 warm runs, median, range, peak RAM/VRAM

*Filler-aware transcription (→ D-16). Whisper tends to drop "um"/"uh" and smooth over restarts (§11)*
- [ ] 0.14a Make a verbatim reference for the benchmark sample(s): hand-mark every filler, repetition, and restart with approximate times. Without this, filler recall can't be measured
- [ ] 0.14b **Filler prompt variant**: rerun base.en / small.en with a filler-bearing initial prompt (whisper.cpp `--prompt`, e.g. "Umm, so, uh, I think, like, you know…"). Measure filler recall, false insertions, change in ordinary word errors, and any repetition/hallucination loops the prompt causes
- [ ] 0.14c **CrisperWhisper** (verbatim fine-tune): check the licence (reportedly CC BY-NC 4.0, fine for personal use, blocks later distribution) and whether a whisper.cpp/ggml conversion exists or can be made. It's a large-v3 fine-tune, so only a quantized build has a chance on 4 GB VRAM. Benchmark it like 0.14 and reject it if it misses the §10 wait targets
- [ ] 0.15 Write the benchmark results into **Notes & findings**; decide D-4, D-5, and D-16

**API spike (§10)**
- [ ] 0.16 User picks the provider/model (D-6)
- [ ] 0.17 `credentials` module: store/read/delete a key in Windows Credential Manager (`keyring` crate or `windows` CredWriteW)
- [ ] 0.18 reqwest client: HTTPS only, timeouts 10 s/60 s, bounded body, no cross-origin redirects
- [ ] 0.19 One structured feedback request on a sample transcript → validate against a draft `FeedbackResult` schema

**Exit gate M0**
- [ ] Recording is recovered after a forced kill within the loss target
- [ ] Transcription backend and default model chosen with measured numbers
- [ ] Filler strategy (D-16) chosen from measured filler recall and false insertions, not from the model's reputation
- [ ] One validated API result obtained; the key is never in SQLite, logs, or the frontend

## Milestone 1 — Design system & shell (§3–§5) · budget 3–5 days

- [x] 1.1 Tailwind 4 + CSS custom-property tokens (light/dark) exactly per the §4 table
- [x] 1.2 Bundle Inter locally (no remote fonts, §13); tabular numerals utility
- [x] 1.3 shadcn/ui init (Radix variant); add Button, Input, Textarea, Label, Select, RadioGroup, Switch, Tabs, ToggleGroup, Dialog, AlertDialog, Sheet, Collapsible, Sidebar, Sonner
- [x] 1.4 App shell: Sidebar (Today, Exercises, Sessions, Phrases, Progress + Settings at the bottom), top bar, breadcrumb
- [x] 1.5 React Router with hash routing; routes for all 8 destinations including contextual Studio and Review
- [x] 1.6 TanStack Query provider; `src/lib/ipc` typed command wrappers with a mock implementation for browser-only dev
- [x] 1.7 Zod schemas for the core DTOs (Session, Attempt, TranscriptRevision, PhraseCard, …). FeedbackResult comes with 0.19 / 5.2
- [~] 1.8 Responsive rules: sidebar at ≥1100 px, stacked feedback below 1100 px, compact nav below 800 px; test at 800×600
- [~] 1.9 Real empty / loading / unavailable / error states for each screen (§5)
- [x] 1.10 Command palette (Ctrl+K), local search stub
- [x] 1.11 Reduced motion, 120–180 ms transitions, visible focus rings
- [x] 1.12 Vitest + React Testing Library set up; keyboard navigation smoke test

**Exit gate M1**
- [~] Every key screen is navigable with sample data using only the keyboard. Automated: Today → Sessions → Review, Ctrl+K search, and 404. Still needed: a manual keyboard pass over Studio, Phrases, Progress, and Settings, plus a check of compact nav below 800 px

**M1 notes**: all 8 screens exist with sample data (Today, Exercises + detail, Studio with a *simulated* recorder and navigation guard, Review with a simulated transport + candidate review + coaching preview, Compare, Sessions, Phrases with the recall schedule, Progress with 3 separate views, Settings with 7 sections). Controls that need the native core are disabled and say which milestone enables them.

## Milestone 2 — Durable practice (§9, §12, §13) · budget 6–10 days

**Storage**
- [ ] 2.1 rusqlite with foreign keys, WAL, busy timeout, a single writer owner
- [ ] 2.2 Versioned migration runner (+ pre-migration backup, stop safely on failure)
- [ ] 2.3 Schema v1: profiles, exercise_definitions, prompts, sessions, session_steps, attempts, audio_assets, task_conditions, jobs, backup_records
- [ ] 2.4 Staged asset protocol: reserve ID → temp write → verify sha256 → atomic finalize → commit reference
- [ ] 2.5 Startup reconciliation: interrupted manifests, missing references, orphaned files → Recovery entry in the UI
- [ ] 2.6 Path safety: relative paths only, traversal and symlink checks, IDs → paths resolved in Rust only

**Recording in the app**
- [ ] 2.7 `start_recording` / `stop_recording` with idempotency keys; a second Stop creates no duplicate
- [ ] 2.8 Capture state machine: Preparing → Recording → Finalizing → Saved / Interrupted
- [ ] 2.9 Device disconnect → safe stop and preserved audio; full-disk simulation → no false "Saved"
- [ ] 2.10 Close-app guard during recording (Stop and save / Continue recording)
- [ ] 2.11 Practice studio UI: PromptOutline, RecorderTransport, InputLevelMeter, AttemptList, optional prep countdown
- [ ] 2.12 Microphone picker + 5-second test with playback (onboarding step 2)

**Playback & history**
- [ ] 2.13 Scoped asset protocol for playback by trusted ID
- [ ] 2.14 WaveSurfer player: seek, speed, loop region, keyboard alternative (start/end fields, skip)
- [ ] 2.15 Waveform peaks cache
- [ ] 2.16 Sessions list: compact table, filters, rename, tag, favorite
- [ ] 2.17 Trash with 30-day retention and restore; delete dialog states which audio/analysis is included

**Backup, restore, export (§13)**
- [ ] 2.18 SQLite online backup API snapshot + asset manifest + checksums → temp archive → rename
- [ ] 2.19 Restore preview into a staging dir: reject traversal, zip bombs, newer schema, checksum mismatch
- [ ] 2.20 Restore commit (separate command): pre-restore backup, swap, rollback material kept
- [ ] 2.21 Weekly auto-backup when open + catch-up on launch; keep 4; never delete the last valid one
- [ ] 2.22 Session export ZIP: Markdown transcript/notes, CSV measures, original WAV, JSON manifest

**Exit gate M2**
- [ ] A full manual offline session survives restart **and** backup → restore into an empty profile (records + asset checksums match)

## Milestone 3 — Review & transcription (§6 Session review, §11) · budget 5–8 days

- [ ] 3.1 Job queue (jobs table): one transcription job at a time; recording has priority; cancel
- [ ] 3.2 Whisper worker protocol: JSON request, structured progress, result, schema version
- [ ] 3.3 Model pack registry: ID, checksum, size, license, language; verified import; atomic install
- [ ] 3.4 Schema: transcript_revisions, transcript_segments, analysis_runs, metric_values, annotations
- [ ] 3.5 VAD + timeline mapping (never measure pauses from trimmed audio)
- [ ] 3.6 Metrics with definition versions: duration, analysis interval, estimated pace (≥15 s speech, ≥20 words), pauses (≥700 ms threshold, stored), repeated wording
- [ ] 3.7 Candidate filler lexicon (contextual) → annotations; Hear it / Confirm / Dismiss; manual insertion. Use the D-16 transcription strategy; anything it inserts is still only a candidate until reviewed
- [ ] 3.8 Transcript component: segment seek, views As transcribed / My corrections / Suggested wording
- [ ] 3.9 Transcript revisions: edits create a child revision; dependent metrics are invalidated; Reanalyze
- [ ] 3.10 Evidence labels: Measured / Estimated / Your note / AI suggestion
- [ ] 3.11 Failure paths: Retry transcription, Change model, Add notes; audio is never lost
- [ ] 3.12 Settings → Transcription: installed packs, CPU/NVIDIA toggle, Benchmark button
- [ ] 3.13 FTS5 index for transcripts, notes, prompts, phrases; wire it to the command palette

**Exit gate M3**
- [ ] Worker crash leaves the audio saved and the next recording works
- [ ] Editing a transcript keeps raw text and old metrics tied to their original revision
- [ ] Timing is verified after resampling / VAD, including gaps and the final segment

## Milestone P — Prosody: intonation & stress display · budget 4–6 days

Goal: show *how* the voice moved (pitch rising or falling, which words carried stress) as a measured visual aid, mainly for Listen and imitate. Runs after M3 because it reuses analysis runs and the original timeline, and before M4 so 4.8 can use it.
Boundaries: no score, no "correct/incorrect" colouring, no mood or emotion labels (D-18), and no pronunciation grade (§11). Everything runs locally.

- [ ] P.1 Choose the pitch tracker (→ D-17). Compare classic trackers in Rust (YIN / pYIN / McLeod; check available crates and licences) on the M3 evaluation set. Consider CREPE-tiny through ONNX Runtime only if classic trackers fail on noisy or weak-mic recordings, since it adds a runtime dependency. Criteria: octave errors, voiced/unvoiced accuracy, CPU time per minute. Praat is only a dev-time reference (GPL, not bundled)
- [ ] P.2 Compute an F0 contour (Hz, plus semitones relative to the speaker's median), voicing flags, and RMS energy (dB) at a 10 ms hop on the **original recording timeline** (never VAD-trimmed audio, §9)
- [ ] P.3 Storage: a versioned, regenerable analysis artifact (compact binary) plus a `prosody_tracks` record (run_id, attempt_id, algorithm, settings, hop_ms, definition_version, checksum). Metrics: pitch range (5th–95th percentile, semitones) and loudness variation, labelled **Estimated**; unavailable with a reason when there is too little voiced speech, clipping, or heavy noise
- [ ] P.4 Contour view in Session review: pitch line + energy band under the transport, synced playhead, click to seek, gaps where the voice is unvoiced or silent (never drawn as zero), neutral colours only
- [ ] P.5 Imitation overlay (feeds 4.8): reference clip vs. attempt, aligned at speech onset with optional time-normalisation. The user picks one feature (sentence-final fall/rise, stressed word, phrase rhythm) and compares by listening and looking. **No similarity score**
- [ ] P.6 Contours for bundled and imported reference clips are computed at import and versioned with the clip (links to 4.4)
- [ ] P.7 Accessible equivalent: keyboard navigation between phrase endings, with a text readout per phrase ending (rising / falling / level, Estimated). Treat it as data, not advice
- [ ] P.8 Tests: synthetic tones and sweeps with known F0 (unit), octave-error checks on low and high voices, alignment after resampling (with A-6), CPU time per 60 s take (target ≤ 5 s, to validate)

**Exit gate P**
- [ ] Contours for ~10 recordings of the evaluation set spot-checked against Praat without systematic octave errors
- [ ] Unvoiced/missing stretches render as gaps; no prosody value appears as a score or grade anywhere

## Milestone 4 — Full routine (§2, §6, §7) · budget 7–10 days

**Content pack (resources/content, versioned)**
- [ ] 4.1 40 reviewed prompts with situation tags and task demands
- [ ] 4.2 12 thought-group passages (40–80 words, pause marks)
- [ ] 4.3 8 offline guides (pauses, main-point structure, self-review, limits of automatic feedback, …)
- [ ] 4.4 10 licensed or original reference clips with transcripts + attribution file
- [ ] 4.5 Curriculum versioning; sessions snapshot the version they used

**Exercises**
- [ ] 4.6 Repeat an answer (repetition groups, 2–3 takes, selected focus)
- [ ] 4.7 Thought groups (listen, read, hide, explain)
- [ ] 4.8 Listen and imitate (verify pitch-preserving speed before enabling 0.75/1.25×; uses the P.5 contour overlay)
- [ ] 4.9 Use a better expression (typed or recorded sentences)
- [ ] 4.10 Daily 13-minute and 5-minute sequences; custom session; resume / start fresh
- [ ] 4.11 Completion view: attempts, chosen improvement, save a phrase, ease self-report 1–5

**Screens**
- [ ] 4.12 Today: focus sentence, Start/Resume, exercise rows, due phrase, weekly rows
- [ ] 4.13 Exercises: prompt collection, filters (skill, prep, audience, familiarity), difficulty descriptors, favorites, user prompts
- [ ] 4.14 Attempt comparison: tabs, one active player, separate positions, alternating playback, manual preference
- [ ] 4.15 Phrases: cards, recall-before-reveal practice, schedule 1/3/7/14/30 days, Again/Hard/Good, append-only history
- [ ] 4.16 Progress: Rehearsed / Unfamiliar / Real conversations views; Recharts with labeled axes; unavailable ≠ 0
- [ ] 4.17 Transfer reviews (real conversation form; listener text stored separately)
- [ ] 4.18 Rules-based scheduler with visible reasons; progression events; user override (§7)
- [ ] 4.19 Onboarding: 4 steps incl. optional baseline recording

**Exit gate M4**
- [ ] The offline routine works end to end; unfamiliar-task evidence stays separate from rehearsal

## Milestone 5 — Coaching modes (§10) · budget 6–10 days

- [ ] 5.1 `CoachingProvider` trait: validate_configuration, test_connection, generate_feedback, cancel
- [ ] 5.2 Versioned `FeedbackResult`; evidence-span validation against the selected revision
- [ ] 5.3 Hosted adapter for D-6 (structured output, usage parsing)
- [ ] 5.4 Local loopback adapter (llama.cpp-server compatible; HTTP allowed only on loopback)
- [ ] 5.5 Provider config + credential binding; endpoint change invalidates the key association
- [ ] 5.6 Preview → request flow: "View text to send", temporary redaction, payload hash, stale-preview rejection
- [ ] 5.7 Result cache keyed by redacted input + versions + provider + model + settings; explicit Regenerate
- [ ] 5.8 Error states: 401/403, rate limit, quota, timeout (uncertain billing), invalid JSON, refusal, cancel
- [ ] 5.9 Usage records, price editor (Unknown ≠ 0), monthly warn/stop limits with reservation
- [ ] 5.10 Settings → Coaching: API / Local LLM / Off; Test connection; masked key status; Replace/Remove
- [ ] 5.11 API follow-up question generation (separate explicit request, labeled simulation)
- [ ] 5.12 Log redaction: no transcript text, headers, or keys in logs

**Exit gate M5**
- [ ] Both adapters pass the same contract tests and fail safely; no silent fallback or auto-download

## Milestone 6 — Release hardening (§13, §14, §16, §17) · budget 5–8 days

- [ ] 6.1 Tauri capabilities scoped narrowly; restrictive CSP; external links open in the system browser
- [ ] 6.2 NSIS/MSI installer with the offline WebView2 option; data kept on uninstall by default
- [ ] 6.3 Crash recovery UX pass
- [ ] 6.4 Accessibility: keyboard-only pass, NVDA/Narrator pass, 200 % zoom, high contrast, reduced motion
- [ ] 6.5 Performance: warm launch < 2 s, record response < 200 ms, search < 250 ms (measure and record)
- [ ] 6.6 Storage view by category; clear cache ≠ delete recordings
- [ ] 6.7 Diagnostic export (reviewable, no personal content by default)
- [ ] 6.8 Run the full acceptance suite below on a packaged build

---

## Acceptance suite (§17) — run on a packaged build before release

- [ ] A-1 Network off: complete manual practice + local transcription; reopen every take and saved API result; new API coaching shows unavailable
- [ ] A-2 Kill during recording → recovery within the loss target
- [ ] A-3 Worker crash → audio, notes, and the next recording still work
- [ ] A-4 Mic disconnect + full disk → no false Saved message
- [ ] A-5 Transcript edit keeps raw text and old metrics on the original revision
- [ ] A-6 Timing after resampling / VAD, incl. gaps and the final segment
- [ ] A-7 Backup → restore into an empty profile; records and asset checksums match
- [ ] A-8 Reject corrupted archive, missing audio, path traversal, newer schema
- [ ] A-9 Upgrade a populated older schema; failed migration recovers safely
- [ ] A-10 Packaged install without dev runtime or internet
- [ ] A-11 Network inspection: recording/transcription send nothing; coaching sends only previewed text to the configured recipient
- [ ] A-12 Keys absent from SQLite, logs, exports, frontend persistence, backups
- [ ] A-13 Auth failure, rate limit, quota, malformed JSON, refusal, timeout, cancel → audio safe, uncertain billing shown
- [ ] A-14 API / Local LLM / Off switching: no silent fallback, no auto-download, no restored pending upload
- [ ] A-15 Provider/endpoint change doesn't forward the old key
- [ ] A-16 Cache reuse, explicit regenerate, usage accounting, budget limits, unknown price
- [ ] A-17 Transcript or redaction change invalidates the coaching preview; old evidence preserved
- [ ] A-18 Unfamiliar first attempts, rehearsal, and real-conversation feedback stay separate
- [ ] A-19 Difficulty recommendations show a reason, tolerate missing evidence, accept override
- [ ] A-20 Major flows keyboard-only + screen reader
- [ ] A-21 Prosody contours stay aligned with the original timeline after resampling; unvoiced stretches are gaps, not zeros
- [ ] A-22 No filler, prosody, or imitation value is shown as a score, grade, or mood label

---

## Notes & findings

- 2026-09-29: M0 0.4 pins CPAL 0.18.2 and adds a native `list_input_devices` command with stable device IDs and supported input format ranges. A live WASAPI smoke test returned three devices and six ranges per device without opening a stream. `cargo test --locked --offline` passed (one regular test; the hardware smoke test is ignored by default and passed when run explicitly). Frontend typecheck and 15/15 Vitest tests passed with a single reused worker. The desktop UI still shows mock devices until the native IPC client is connected.

- 2026-09-29: M0 0.3 now resolves Tauri's `app_local_data_dir()` on startup and creates the six planned subdirectories. `cargo fmt --check` and `cargo test --locked --offline` passed (one new Rust test checks directory creation and repeat startup). The desktop startup itself has not been manually launched in this session.

- 2026-09-29: Found an existing `ggml-large-v3-turbo-q5_0.bin` (574,041,195 bytes; SHA-256 `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2`) in `../Jellzfin Server/data/WhisperSubs/whisper/models/`. That folder also has `ggml-base.bin`; `../whispercpp/` has a `whisper-cli.exe`. These are outside this repository. Check model/binary provenance and benchmark them before choosing the default; do not copy model weights into Git.

- 2026-09-29: Initial commit verification: `npm.cmd run typecheck` and `npm.cmd run build` passed; `npm.cmd test -- --pool=threads --maxWorkers=1` passed 15/15 tests. Default Vitest worker startup timed out in this environment, so use one worker for repeatable checks here. `cargo fmt --check` and `cargo test --locked --offline` passed; the Rust scaffold currently defines no tests.

- 2026-09-29: Plan extended at the user's request. Filler-aware transcription added to the M0 benchmark (0.14a–c, D-16), and a new prosody milestone P (intonation and stress display, D-17) placed between M3 and M4; it adds about 1 day to M0 and 4–6 days overall. Mood detection deliberately left out (D-18). Model names and licences in these tasks come from memory and must be verified before adoption.

- 2026-09-29: `npm test` passes 15/15 (phrase schedule, mock↔schema contract, keyboard shell navigation). `vite build` and `tsc` are clean. First `cargo build` of src-tauri succeeds.
- 2026-09-29: Vitest workers time out when started during a cargo build (all 8 threads busy). Rerun after cargo finishes.
- 2026-09-29: In Git Bash, `link` resolves to GNU coreutils and breaks Rust linking. Run cargo from PowerShell.
- 2026-09-29: shadcn now imports `cn` from the `cn` npm package (github.com/shadcn-ui/cn, maintained by shadcn). Verified legitimate.
- 2026-09-29: `useBlocker` guards in-app navigation during recording (verified). The window-close guard is part of M2 (2.10).
- 2026-09-29: The main JS chunk is 1.1 MB (Recharts, Radix). Acceptable for an app loaded from disk; lazy-load Progress if cold start misses the 2 s target (6.5).

- 2026-09-29: Hardware confirmed as Ryzen 7 3750H + GTX 1650 4 GB. 4 GB VRAM is enough for base.en/small.en on CUDA per upstream figures (§10); this still needs measuring in 0.14.
- 2026-09-29: (Resolved) VS 2019 Build Tools had no Windows SDK; fixed by installing Build Tools 2026 (E-3).
