# ClearPractice — Development Plan & Tracker

Source of truth for *what* to build: [ClearPractice-App-Blueprint.md](ClearPractice-App-Blueprint.md) (rev. 3, 4 Oct 2026).
This file tracks *how far we are*. Section references like **§9** point into the blueprint.

## How to use this file

- `[ ]` not started · `[x]` done · `[~]` in progress · `[!]` blocked (reason inline)
- Tick a box only when the item is **verified** (test passes, or it was checked manually and the check is noted).
- Each milestone has an **Exit gate**. Don't start broad work in the next milestone until the gate passes.
  Exception: M1 (UI shell with sample data) can run alongside M0 because it doesn't depend on M0's results.
  The separate optional API transcription gate blocks enabling uploads, not progress through the local-review/prosody/routine gates. Core M0 requirements still apply.
- New decisions go in the **Decision log**; new risks or surprises go in **Notes & findings**.
- Update **Current status** at the end of every working session.

---

## Current status

| | |
| --- | --- |
| Active milestone | M3 local transcription and review, started early because M2's build items are done. M2 still needs its manual desktop checks and exit gate |
| Last updated | 2026-10-08 |
| Repository | Everything is committed on `main`; the working tree is clean at the end of each session |
| Built, not yet checked in the desktop app | Studio timer / Ctrl+Enter / live waveform fixes, waveform player (2.14), Trash (2.17), backup folder / create / check / replace / weekly (2.18–2.21), session Export (2.22) |
| Blockers | None for coding. Desktop checks need the user at the laptop (or an agent driving the desktop app) |

**Next actions, in order**
1. One desktop pass after rebuilding (`npm run tauri dev`) over the "Built, not yet checked" list above, then the manual M2 exit gate.
2. M3 local transcription in the app: job queue, transcript storage, Transcribe on a saved take, transcript view (3.1–3.4, 3.8, 3.11).
3. Remaining M2: recovery presentation (2.5), recording failure and close-guard checks (2.8–2.10), microphone test (2.12), API usage ledger in backups.
4. M1 manual keyboard pass and compact-navigation check.

**Standing notes (not blockers)**
- Do not request another personal speech sample or repeat the completed paid coaching test; the public benchmark (D-24) stands in for personal audio.
- Optional API audio transcription stays disabled until its own enablement gate passes (see "Data that leaves this computer").
- Rebuild/reopen the desktop app after adding native commands; never interrupt an active recording or concurrent user input.

--- | --- |
| Active milestone | M2 Durable practice; core M0 exit gate passed. M1 manual keyboard/compact checks remain separate |
| Last updated | 2026-10-08 |
| Repository | M0 and M2 work committed on `main`: waveform player (44838b3), Trash (dcd058f), backup + restore check (93e2680), restore commit (2026-10-08) |
| Next action | One desktop pass after rebuilding: Studio timer/Ctrl+Enter/live waveform fixes, waveform player (2.14), Trash (2.17), backup folder / create / check / replace / weekly (2.18–2.21), Export… (2.22), then the manual M2 exit gate. Then include the API usage ledger in backups, M2 reconciliation/recovery presentation and recording failure/manual close checks. Native SQLite v1, legacy receipt import, staged reference commits and real session history are implemented; verify and record the latest checks below. Product transcription/job integration follows in M3 |
| Scope update | User-approved live text coaching succeeded and its saved receipt/shared ledger were verified: 291 input + 163 output tokens, USD 0.000227 estimated. Public benchmark replaces personal speech (D-24). CUDA turbo with filler prompt is selected. Optional audio API remains disabled behind its separate approval/enablement gate |
| Blockers | No core M0 blocker. Do not request the completed text test or a personal sample again. API audio still needs separate approved requests. Native tests require normal Windows filesystem access; no validation was weakened. Desktop executable must be rebuilt/reopened for newly added commands; avoid interrupting active recording or concurrent user input |

---

## Data that leaves this computer: shared rules

These rules apply to every API purpose: transcription (M0 0.20–0.23, M3 3.14–3.19), coaching (M0 0.16–0.19, M5) and any later provider. Tasks and acceptance checks refer to them instead of restating them.

1. **Local by default.** Recording, local transcription, prosody, storage and backups never send anything. API modes are opt-in, separate per purpose (Transcription Local / API / Off; Coaching API / Local LLM / Off), with no silent fallback between providers and no automatic downloads.
2. **Preview, then one explicit send.** Every request shows exactly what will be sent (audio and hints, or text), the recipient, model, price basis and estimated cost. Approval is single-use and bound to a hash of the payload plus provider, configuration, model and price version; any change needs a fresh preview.
3. **Nothing sends by itself.** Choosing a mode, storing a key, finishing a recording, switching screens, restarting, recovering, restoring or reconnecting never dispatches a request. Paid jobs never resume or retry automatically.
4. **One shared budget.** All purposes reserve against one ledger: USD 5/month stop, USD 4 warning (D-7, D-22). Unknown price or usage stays Unknown, never 0; a cancelled or timed-out request keeps its possible charge. Free provider credits do not change the recorded price.
5. **Keys stay in Windows Credential Manager** (0.17), bound to one provider configuration. They never appear in SQLite, logs, exports, backups or frontend storage, and an endpoint change never forwards an old key.
6. **Failures never cost data.** Audio, notes and earlier results stay intact through auth errors, rate limits, malformed output, refusals, timeouts and cancellation.

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
| D-4 | Local default: existing large-v3-turbo-q5_0, based on six-profile public comparison; personal accuracy remains unknown | Chosen provisionally; app import/job integration is M3 | 2026-10-07 |
| D-5 | CUDA default on this laptop; CPU base offered as an explicit smaller alternative with no automatic fallback | Chosen; warm selected total median 14.022 s for 61.934 s audio | 2026-10-07 |
| D-6 | OpenAI GPT-6 Luna initial coaching model; keep configurable in M5 | One approved live sample passed access/schema/meaning/style checks; broader quality validation remains | 2026-10-07 |
| D-7 | Stop new app coaching requests at USD 5/month; warn at USD 4 by default (adjustable) (§16) | USD 5 limit confirmed; USD 4 warning assumed | 2026-09-29 |
| D-8 | English practice for the first release; German may follow later (§18) | Confirmed | 2026-09-29 |
| D-9 | English interface; dates formatted with `en-GB` regardless of Windows locale (`UI_LOCALE` in src/lib/format.ts) | Confirmed | 2026-09-29 |
| D-10 | Keep backups locally in a user-selected folder; retain original recordings until explicit deletion (§18) | Confirmed; exact backup folder selected in the app | 2026-09-29 |
| D-11 | Reuse existing local Whisper packs first; decide on any additional one-time download after benchmarking | Existing pack found; download decision deferred | 2026-09-29 |
| D-12 | Rubato 0.16.2 FFT resampling with delay trimming and tail flushing; preserve immutable original audio | Chosen; duration/impulse/alias/cache tests pass | 2026-10-04 |
| D-13 | Verified whisper.cpp 1.9.1 `whisper-cli.exe` sidecar, one worker owner, bounded JSON/progress, explicit cancellation and source preservation | Chosen and exercised by offline harness; packaged integration pending | 2026-10-04 |
| D-14 | shadcn preset `radix-nova`; primitives customised in place (buttons ≥ 40 px, sidebar 216 px, `nav` breakpoint 800 px, CommandDialog a11y fix) | Chosen | 2026-09-29 |
| D-15 | Until native commands exist, the UI runs on `createMockClient()`, which parses through the same Zod schemas as the future Tauri client | Chosen | 2026-09-29 |
| D-16 | Turbo CUDA with initial prompt `Umm, so, uh, I think, like, you know.`; all filler events remain review candidates | Chosen: 13/14 UH/UM retained, zero inserted in four public trials; no verified word alignment | 2026-10-07 |
| D-17 | Pitch tracker for prosody (YIN / pYIN / McLeod vs. CREPE-tiny) → decided by P.1 | **Open** | |
| D-18 | Mood/emotion detection from voice: **not built**. Acted-emotion training data makes it unreliable for second-language speech; self-reported ease + energy/pitch-range measures cover the need. Revisit only as a local experiment | Deferred | 2026-09-29 |
| D-19 | Content focus: explaining complex topics, debating, and teaching; subject pool includes sport, economics, religion, crypto, programming, anime, and books | Confirmed | 2026-09-29 |
| D-20 | Add optional API audio transcription. Transcription modes are Local / API / Off, independent of Coaching API / Local LLM / Off. Local remains the default; a saved take is uploaded only after its audio preview is approved | API option requested; default and interaction are working design choices | 2026-10-04 |
| D-21 | First transcription API adapters: **Deepgram Nova-3** (`filler_words=true`, English) and **AssemblyAI Universal-3.5 Pro** (`disfluencies=true`), because both keep um/uh and return word timings, which the filler review and pause measures need. OpenAI `gpt-transcribe` has no filler option and timings only on `whisper-1`, so it moves to a later comparison. Prices for pre-recorded audio, checked on the providers' own pages 2026-10-08: Deepgram USD 0.0043/min (USD 200 sign-up credit, pay-as-you-go "No expiration"); AssemblyAI USD 0.21/h ≈ USD 0.0035/min (USD 50 credit, which their support says does not expire). Recorded usage always uses the list price, even while credit covers it. Data-use/training terms and Deepgram word timings for pre-recorded audio still to verify at implementation | Revised after the 2026-10-08 plan review (was: OpenAI gpt-transcribe first) | 2026-10-08 |
| D-22 | Extend the existing USD 5/month app stop limit and USD 4 warning to **combined transcription + coaching** usage. Show subtotals by purpose; reserve costs atomically across both. Do not create a second USD 5 allowance or increase the limit | Working assumption extending D-7; shared limit not previously confirmed | 2026-10-04 |
| D-23 | First API transcription workflow submits one complete, verified saved take as derived 16 kHz mono WAV through Rust. No live microphone stream, automatic upload, batch dispatch, or automatic provider fallback. Intonation and pause analysis remain local | Working design choice | 2026-10-04 |
| D-24 | Use a downloaded public reference sample for the current benchmark instead of asking for personal speech again. Eight complete Nyra Disfluency Speech English test clips total 61.934 s, concatenated without trimming; independent dataset annotations identify fillers/restarts | User requested internet audio; provisional public-sample results do not measure personal accuracy | 2026-10-04 |
| D-25 | Backups are single ZIP files: `zip` 8.6.0 (Stored/Deflate only, `flate2` 1.1.10 pure-Rust backend) and `tauri-plugin-dialog` 2.8.1. Pickers open from Rust, so the UI never sends paths and needs no JS dialog permission | User chose ZIP + folder picker | 2026-10-08 |

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
- [x] 0.2 Pin exact dependency versions, commit lockfiles (§8). All direct npm and Rust dependencies are pinned exactly and both lockfiles are committed; new crates since (zip, flate2, tauri-plugin-dialog) are pinned too
- [x] 0.3 Resolve the app-local data root through the Tauri path API at startup; create `database/`, `recordings/`, `imports/`, `models/`, `cache/`, `recovery/` (§12). Rust test verifies creation and repeat startup

**Audio spike (§9)**
- [x] 0.4 `list_input_devices` command using CPAL: stable ID, name, default flag, supported configs. Live Windows smoke test found three inputs with six format ranges each; native UI wiring follows with the IPC client
- [x] 0.5 Open the device at its native rate/format; fixed-size blocks → bounded queue, no blocking I/O in the callback. Live default microphone captured 48 kHz stereo F32; worker downmixes to mono
- [x] 0.6 Writer thread: downmix to mono, write 16-bit PCM chunk files, sync and close every 1 s. Sample-content and duration tests pass
- [x] 0.7 Recovery manifest synced before stream creation; on Stop, concatenate chunks → WAV, verify size and SHA-256, atomically rename, then commit a JSON receipt. Duplicate Stop returns the same asset; SQLite references follow in M2
- [x] 0.8 Level meter event (`recording_level`, rate-limited). Live test observed 28 valid events in ~3 s, monotonic timestamps ≥100 ms apart
- [x] 0.9 **Kill test**: actual child-process termination and fresh journal recovery pass. Three live microphone runs recovered 3000 ms from 3760/3730/3770 ms captured (760/730/770 ms lost). Synthetic kill and incomplete-tail tests also pass. Packaged-app acceptance A-2 remains pending
- [x] 0.10 Derive verified 16 kHz mono inference WAV with Rubato 0.16.2 (D-12). Tests cover rates 8–192 kHz, identity, duration, first/middle/final impulses, alias rejection, cancellation and corrupt-cache regeneration; original hash is preserved

**Whisper spike (§10)**
- [x] 0.11 Pinned official whisper.cpp 1.9.1 CPU + CUDA 11.8 archives. SHA-256/byte manifests and reproducible setup are in `bench/whisper-assets.json` / `Prepare-Whisper.ps1`. CUDA requires the separately verified NVIDIA cuBLAS redistributable; no system driver/toolkit changes
- [x] 0.12 Existing `ggml-base` and `ggml-large-v3-turbo-q5_0` packs verified against upstream Hugging Face LFS hashes/sizes, reused read-only. No model weights downloaded
- [x] 0.13 Sidecar worker: validated full JSON/raw retention, bounded progress, source/hash checks, peak RAM, below-normal hidden process, cancellation/kill/reap and single-owner behavior exercised by harness (D-13). Product Review/job integration follows in M3
- [x] 0.14 Six public-sample profiles, each initial + three subsequent process trials. Worker/total latency and peak RAM recorded in bench/results-2026-10.json and .md. Initial caches uncontrolled; per-process VRAM unavailable (Windows WDDM N/A), with reasons

*Filler-aware transcription (→ D-16). Whisper tends to drop "um"/"uh" and smooth over restarts (§11)*
- [x] 0.14a D-24 independent dataset verbatim reference with fillers, repetitions/restarts and clip boundaries (Estimated; not word alignment). Source audio hashes and untrimmed composition are verified. Portable word-edit scorer has tests; scope counts explicit UH/UM only, not ambiguous “like”
- [x] 0.14b Filler-prompt comparison completed for CPU base and CUDA turbo against plain profiles. Selected turbo retains 13/14 explicit UH/UM, zero insertions, 1.11% ordinary WER across all four trials; additional English-only weights not needed for the initial choice
- [x] 0.14c CrisperWhisper compatibility/licence decision completed: defer the additional adapter/weights experiment. V2 custom CTranslate2 published wheels are Linux; Windows uses Transformers. Model licence is Nyra NonCommercial Research License; code MIT; no official ggml route identified. It was not benchmarked and redistribution is not cleared
- [x] 0.15 Results and D-4/D-5/D-16 recorded; portable selected-profile.json and setup config added. Small public fixture does not establish personal accuracy or verified alignment; all fillers remain review candidates

**Text coaching API spike (§10)**
- [x] 0.16 Initial GPT-6 Luna choice verified with the user-approved live coaching sample on 7 October. Feedback preserves the trade-off, grounds style changes in exact text, and labels “more clear” optional. Broader quality checks/model configuration remain M5
- [x] 0.17 Native Windows Credential Manager store/read/replace/delete. Only provider/presence is returned to UI. Disposable fake-slot round-trip passed and was cleaned up; secret-redaction, browser-disabled controls and no key in query/mutation caches tested
- [x] 0.18 Pinned reqwest 0.13.5 native TLS client: HTTPS only, 10 s connect / 60 s total, bounded request/response, redirects disabled, automatic retries disabled, sensitive auth headers. Request/header and streamed-body boundary tests pass; real provider round-trip is still 0.19
- [x] 0.19 Single-use hashed sample-text preview, explicit Send, strict FeedbackResult and unique evidence validated by native/UI tests and one user-approved live result. Saved receipt verified; no additional paid request made by the agent

**Optional API transcription spike (§10, D-20–23)**
- [x] 0.20 Shared native USD 5 stop / USD 4 warning ledger passes concurrent-purpose, duplicate, corrupt-ledger and restart-uncertainty checks. Real approved request settled with 291/163 tokens and 227 micro-USD conservatively estimated. Locked JSON foundation remains until the later SQLite usage migration; preserve all existing charges
- [x] 0.21 Provider-neutral TranscriptionResult local adapter and real normalized artifacts verified; native + Zod tests cover identity, unknown reasons, capabilities and invalid timing. Word alignment/diarization remain unavailable
- [ ] 0.22 Verify candidate request/response formats, limits, current prices, data-use/training terms and retention for Deepgram and AssemblyAI, then build the native spike: prepare/hash a complete saved take, show recipient/model, duration/size, all language/context hints, and estimated charge; reserve budget and submit one approved multipart request to verify model access. Validate/save raw output and reject stale approval, invalid output, oversize audio, and duplicates. Requires 0.10, 0.17–18, and 0.20–21; credentials stay in the app
- [ ] 0.23 After 0.22, benchmark the D-21 candidates (Deepgram Nova-3, AssemblyAI Universal-3.5 Pro; free credits cover the test) against the same hand-checked audio as 0.14a **only after an in-app preview and explicit approval for each request**; measure upload + processing time, errors, filler omissions/insertions, alignment where available, and cost. Record the selected API model separately from D-4's local default

These API transcription items add an estimated 1–2 days to feasibility if credentials are available. They have their own enablement gate in M3; unavailable credentials must not stall durable local practice. API transcription is not enabled by merely choosing API coaching.

**Exit gate M0**
- [x] Recording is recovered after a forced kill within the loss target (native M0 test harness; packaged acceptance remains separate)
- [x] Transcription backend and default model chosen with measured numbers
- [x] Filler strategy (D-16) chosen from measured filler recall and false insertions, not from the model's reputation
- [x] One validated text coaching API result obtained; the stored key is never returned to the frontend or written to SQLite/logs

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

**M1 notes**: all 8 screens exist. Studio, Sessions, session review playback, Trash and Settings → Data and backups use real native data in the desktop app. Curriculum, transcripts, observations, phrases and progress still use labelled sample data until M3–M4.

## Milestone 2 — Durable practice (§9, §12, §13) · budget 6–10 days

**Storage**
- [x] 2.1 Pinned rusqlite 0.40.2 with bundled SQLite, foreign keys, WAL, FULL sync, five-second busy timeout and one Mutex-owned connection; concurrent retake/FK tests pass
- [x] 2.2 Versioned transactional migration; existing older database receives an online, integrity-checked snapshot before upgrade. Failed upgrade rolls back and preserves the snapshot; newer schema fails closed. Tests pass
- [x] 2.3 SQLite v1 tables and indexes implemented for profiles, exercise_definitions, prompts, sessions, session_steps, attempts, audio_assets, task_conditions, jobs and backup_records. Curriculum seeding/full job behavior follow their milestones
- [~] 2.4 Native commands reserve attempt/asset identity before capture, finalize verified files then commit the reference, and announce Saved only after both succeed. Receipt-import/restart/idempotency tests pass; whole-app failure acceptance remains
- [~] 2.5 Startup imports healthy legacy receipts idempotently, marks reserved captures interrupted and flags missing/corrupt assets without deleting them. Existing recovery UI retained; comprehensive orphan/discard/reservation presentation remains
- [~] 2.6 Trusted native IDs and generated relative asset paths; recording, chunk, database and snapshot access checks links/junctions/containment. Traversal tests pass. Remaining adversarial link/archive and restore checks pending

**Recording in the app**
- [ ] 2.7 `start_recording` / `stop_recording` with idempotency keys; a second Stop creates no duplicate. The native behaviour is already proven by 0.7 and 2.4; what remains here is the whole-app check from the Studio (double-click Stop, Ctrl+Enter twice)
- [ ] 2.8 Capture state machine: Preparing → Recording → Finalizing → Saved / Interrupted
- [ ] 2.9 Device disconnect → safe stop and preserved audio; full-disk simulation → no false "Saved"
- [ ] 2.10 Close-app guard during recording (Stop and save / Continue recording)
- [ ] 2.11 Practice studio UI: PromptOutline, RecorderTransport, InputLevelMeter, AttemptList, optional prep countdown
- [ ] 2.12 Microphone picker + 5-second test with playback (onboarding step 2)

**Playback & history**
- [x] 2.13 Scoped asset protocol for playback by trusted ID. `get_recording_playback_path` resolves only committed, checksum-verified assets; asset scope is limited to `$APPLOCALDATA/recordings/*/audio.wav`
- [~] 2.14 WaveSurfer player: seek, speed, loop region, keyboard alternative (start/end fields, skip). `WaveformPlayer` replaces the plain `<audio>` for all native takes: drag or typed loop range, Start/End here, 0.75/1/1.25× pitch-preserving rate, position slider, ±5 s, one active player app-wide. Unit/component tests pass; manual desktop pass (audible loop, drag-select, theme switch) remains
- [x] 2.15 Waveform peaks cache. Native `get_recording_waveform` streams the verified WAV once into ≤20 000 bucket maxima (100/s) cached at `cache/peaks/<id>.json`, keyed by SHA-256; changed/corrupt caches regenerate, unwritable cache is non-fatal. WaveSurfer receives peaks + duration + media, so it never fetches/decodes the WAV and the CSP stays unchanged. Rust tests pass
- [~] 2.16 Real native session list, title/note/tag/favorite search and editor connected. Edits persist through restart and retain original audio identity; failed-save UI keeps edits and never claims success. Manual full-app pass remains
- [~] 2.17 Trash with 30-day retention and restore; delete dialog states which audio/analysis is included. Schema v2 (`purged_assets` tombstones, `app_settings`) with pre-upgrade snapshot. Move/restore set `deleted_at_ms`; trashing an actively capturing session and recording into a trashed session are refused. Permanent delete commits row removal + tombstones atomically, then removes audio, receipt, recovery chunks, inference and peaks caches (links refused); interrupted removal resumes at start and receipts are never re-imported. Retention 1/7/14/30 days (default 30), expired Trash purged at start. Library/recovery lists hide trashed and purged takes. UI: Move to Trash dialog naming recordings/duration/derived copies, 10 s Undo toast, Trash page with Restore / Delete / Empty Trash confirmations and retention select. Rust 8/8 storage tests, Vitest 2 Trash tests, browser (mock) pass. Desktop pass remains; M3 must add transcripts/analysis to the purge list

**Backup, restore, export (§13)**
- [x] 2.18 SQLite online backup API snapshot + asset manifest + checksums → temp archive → rename. `src-tauri/src/backup`: snapshot staged under `cache/backup`, assets listed from the snapshot, WAVs Stored and verified against the DB hash while streaming, receipts + manifest Deflated, `.zip.partial` synced, re-read and re-hashed, then renamed; `backup_records` logs verified/failed. Changed audio or a missing folder fails without touching earlier backups (tests). Already-unavailable recordings are listed in the manifest, not silently dropped. Folder picker + Settings UI built; desktop pass pending
- [x] 2.19 Restore preview into a staging dir: reject traversal, zip bombs, newer schema, checksum mismatch. Allow-listed paths only, no dirs/links, Stored/Deflate only, declared size = manifest, ratio limit, bounded reads, per-entry SHA-256, no extra/missing entries, DB integrity + version, every available asset present. Tests cover traversal, newer schema, checksum, missing audio, decompression bomb, non-ZIP; staging removed on failure and cleared at start. UI "Check a backup…" states nothing changed
- [x] 2.20 Restore commit (separate command): pre-restore backup, swap, rollback material kept. `restore_backup` refuses during capture, takes the storage write lock (all commands now hold a read lock for their storage/file work), closes the DB, writes a synced journal, renames `database/`, `recordings/`, `recovery/` into `restore-rollback/before-restore-*` (the pre-restore copy), moves staging in and reopens (older schemas migrate). Failed swap or reopen rolls back; an interrupted restore is rolled back at start before the DB opens. Tests: restore into an empty profile matches sessions, Trash and every asset SHA-256; crash-after-swap rollback restores newer live edits. Only Replace is offered; Restore as a separate profile is not built. Desktop pass pending
- [x] 2.21 Weekly auto-backup when open + catch-up on launch; keep 4; never delete the last valid one. Background thread checks 90 s after launch (catch-up) and every 30 min; skips during capture and when the folder is unavailable (retried later). Due = last verified + 7 days. Keep 2/4/8/12 (default 4); pruning runs only after a new backup verifies, removes only this app's verified, correctly named backups, always keeps the newest, never touches other files. Settings toggle, keep selector and next-due date. Rust test covers catch-up, not-due, pruning to 2, off, unplugged drive
- [x] 2.22 Session export ZIP: Markdown transcript/notes, CSV measures, original WAV, JSON manifest. `backup/export.rs`: session.md (prompt, outline, conditions or their unavailability, takes table, note; transcript explicitly "not available yet"), measures.csv (Measured durations, audio availability, escaped), take-N.wav verified against the committed hash, manifest.json with SHA-256; written as `.partial` then renamed. Native Save dialog with a sanitised suggested name; Export… on the session page. Rust test + UI test pass; desktop pass pending

**Exit gate M2**
- [ ] A full manual offline session survives restart **and** backup → restore into an empty profile (records + asset checksums match). Automated equivalent passes (`backup::tests::restore_into_an_empty_profile_matches_records_and_asset_checksums`); the manual desktop run remains

## Milestone 3 — Review & transcription (§6 Session review, §11) · budget 5–8 days

The API tasks below add an estimated 3–5 days. Implement the shared budget foundation here, before exposing audio uploads; M5 extends it for full coaching. Complete local review independently if the API gate is waiting for credentials.

- [ ] 3.1 Job queue (jobs table): one transcription job across Local/API at a time; recording has priority; cancel. Paid jobs never resume or dispatch automatically after restart/reconnection
- [ ] 3.2 Whisper worker protocol: JSON request, structured progress, result, schema version
- [ ] 3.3 Model pack registry: ID, checksum, size, license, language; verified import; atomic install
- [ ] 3.4 Schema: transcript_revisions, transcript_segments, analysis_runs, metric_values, annotations
- [ ] 3.5 VAD + timeline mapping (never measure pauses from trimmed audio)
- [ ] 3.6 Metrics with definition versions: duration, analysis interval, estimated pace (≥15 s speech, ≥20 words), pauses (≥700 ms threshold, stored), repeated wording
- [ ] 3.7 Candidate filler lexicon (contextual) → annotations; Hear it / Confirm / Dismiss; manual insertion. Use the D-16 transcription strategy; anything it inserts is still only a candidate until reviewed
- [ ] 3.8 Transcript component: segment seek only with verified timings, views As transcribed / My corrections / Suggested wording. Untimed API text remains editable alongside whole-take playback; no invented alignment
- [ ] 3.9 Transcript revisions: edits create a child revision; dependent metrics are invalidated; Reanalyze
- [ ] 3.10 Evidence labels: Measured / Estimated / Your note / AI suggestion
- [ ] 3.11 Failure paths: Retry transcription, Change model, Add notes; audio is never lost
- [ ] 3.12 Settings → Transcription: independent Local / API / Off selector; local packs/backend/Benchmark; API provider/model/key status and clearly billable test. Local is default; Off preserves playback, notes, and existing transcripts
- [ ] 3.13 FTS5 index for transcripts, notes, prompts, phrases; wire it to the command palette

**Optional API transcription**
- [ ] 3.14 Integrate the D-21 adapter (Deepgram or AssemblyAI, whichever wins 0.23) behind `TranscriptionProvider` and the typed IPC client; capability-check model parameters, enforce the verified upload limit, and stream the prepared file from Rust. No frontend paths, audio byte arrays, or browser-side API requests
- [ ] 3.15 Preview → Transcribe via API: whole selected take, playable prepared audio, recipient/model, duration/size, all included hints, price/date, estimated cost, and remaining shared budget. Approval is single-use and bound to audio hash + hints + provider/config/model + price version; any change requires a fresh preview. Settings alone never uploads audio
- [ ] 3.16 Save API runs, raw results, transcript revisions, request IDs, capability/timing provenance, and usage. Retranscription creates a separate run; never overwrites local or corrected text. Cache by exact uploaded audio + hints + provider/model/settings/adapter version; Retranscribe is an explicit paid action
- [ ] 3.17 Shared usage ledger and atomic reservations (0.20): transcription audio-duration/token categories and coaching token categories, separate subtotals, combined warning/stop limits. Missing price/usage remains unknown; cancellation/timeout after submission retains possible charge. Display billed/estimated/uncertain separately
- [ ] 3.18 Exercise offline, missing/rejected credentials, rate limits/quota, timeout, cancellation, malformed/truncated/empty output, duplicate requests, provider/model changes, and restored pending jobs. Audio remains saved; show explicit local retry or manual review; no automatic paid retry, model switch, or upload on reconnection
- [ ] 3.19 Verify filler review and available metrics against API transcripts with and without timing. Compute pauses/pitch/energy from local audio; disable per-word stress labels and timed candidate replay when alignment is absent. An optional local alignment job must be explicit and verified

**Exit gate M3 — local review**
- [ ] Worker crash leaves the audio saved and the next recording works
- [ ] Editing a transcript keeps raw text and old metrics tied to their original revision
- [ ] Timing is verified after resampling / VAD, including gaps and the final segment

**API transcription enablement gate (separate from the local milestone)**
- [ ] API transcription enablement gate: consented live request and provider contract tests pass; audio preview, credential binding, shared budget, cache, failures, untimed results, and restore behavior are verified. Keep API mode unavailable until this gate passes

## Milestone P — Prosody: intonation & stress display · budget 4–6 days

Goal: show *how* the voice moved (pitch rising or falling, which words carried stress) as a measured visual aid, mainly for Listen and imitate. Runs after M3 because it reuses analysis runs and the original timeline, and before M4 so 4.8 can use it.
Boundaries: no score, no "correct/incorrect" colouring, no mood or emotion labels (D-18), and no pronunciation grade (§11). Everything runs locally.

- [ ] P.1 Choose the pitch tracker (→ D-17). Compare classic trackers in Rust (YIN / pYIN / McLeod; check available crates and licences) on the M3 evaluation set. Consider CREPE-tiny through ONNX Runtime only if classic trackers fail on noisy or weak-mic recordings, since it adds a runtime dependency. Criteria: octave errors, voiced/unvoiced accuracy, CPU time per minute. Praat is only a dev-time reference (GPL, not bundled)
- [ ] P.2 Compute an F0 contour (Hz, plus semitones relative to the speaker's median), voicing flags, and RMS energy (dB) at a 10 ms hop on the **original recording timeline** (never VAD-trimmed audio, §9)
- [ ] P.3 Storage: a versioned, regenerable analysis artifact (compact binary) plus a `prosody_tracks` record (run_id, attempt_id, algorithm, settings, hop_ms, definition_version, checksum). Metrics: pitch range (5th–95th percentile, semitones) and loudness variation, labelled **Estimated**; unavailable with a reason when there is too little voiced speech, clipping, or heavy noise
- [ ] P.4 Contour view in Session review: pitch line + energy band under the transport, synced playhead, click to seek, gaps where the voice is unvoiced or silent (never drawn as zero), neutral colours only
- [ ] P.5 Imitation overlay (feeds 4.8): reference clip vs. attempt, aligned at speech onset with optional time-normalisation. The user picks one feature (sentence-final fall/rise, stressed word, phrase rhythm) and compares by listening and looking. **No similarity score**. Untimed API text permits audio contours and audio-only comparison; word-linked stress requires separately verified alignment
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
- [ ] 4.19 Onboarding: 4 steps incl. optional baseline recording; independent transcription/coaching choices, local default, explicit explanation of API audio vs. text submission, and manual practice when setup is skipped

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
- [ ] 5.9 Extend M3's shared usage ledger and price editor for full coaching (Unknown ≠ 0); atomic reservations and combined monthly warn/stop limits across transcription + coaching, including tests/retries/follow-ups
- [ ] 5.10 Settings → Coaching: API / Local LLM / Off; Test connection; masked key status; Replace/Remove
- [ ] 5.11 API follow-up question generation (separate explicit request, labeled simulation)
- [ ] 5.12 Log redaction for both API purposes: no audio, transcript text, echoed payloads, authorization headers, or keys in logs

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

- [ ] A-1 Network off: complete manual practice + local transcription; reopen every take, saved API transcript, and saved feedback; fresh API transcription/coaching show unavailable without blocking practice
- [ ] A-2 Kill during recording → recovery within the loss target
- [ ] A-3 Worker crash → audio, notes, and the next recording still work
- [ ] A-4 Mic disconnect + full disk → no false Saved message
- [ ] A-5 Transcript edit keeps raw text and old metrics on the original revision
- [ ] A-6 Timing after resampling / VAD, incl. gaps and the final segment
- [ ] A-7 Backup → restore into an empty profile; records and asset checksums match
- [ ] A-8 Reject corrupted archive, missing audio, path traversal, newer schema
- [ ] A-9 Upgrade a populated older schema; failed migration recovers safely
- [ ] A-10 Packaged install without dev runtime or internet
- [ ] A-11 Network inspection: recording/local transcription/prosody send nothing; API transcription sends only approved prepared audio and previewed hints; coaching sends only previewed text to its configured recipient. No cross-purpose payloads
- [ ] A-12 Keys absent from SQLite, logs, exports, frontend persistence, backups
- [ ] A-13 Auth failure, rate limit, quota, malformed JSON, refusal, timeout, cancel → audio safe, uncertain billing shown
- [ ] A-14 Independent Transcription Local / API / Off and Coaching API / Local LLM / Off switching: no silent fallback, no auto-download, no restored pending upload
- [ ] A-15 Provider/endpoint change doesn't forward the old key
- [ ] A-16 Both API purposes: cache reuse, explicit retranscribe/regenerate, usage accounting, unknown price; simultaneous requests cannot exceed combined reservations; timed-out charges never reset to zero
- [ ] A-17 Transcript or redaction change invalidates the coaching preview; old evidence preserved
- [ ] A-18 Unfamiliar first attempts, rehearsal, and real-conversation feedback stay separate
- [ ] A-19 Difficulty recommendations show a reason, tolerate missing evidence, accept override
- [ ] A-20 Major flows keyboard-only + screen reader
- [ ] A-21 Prosody contours stay aligned with the original timeline after resampling; unvoiced stretches are gaps, not zeros
- [ ] A-22 No filler, prosody, or imitation value is shown as a score, grade, or mood label
- [ ] A-23 API audio preview: setting a key, selecting API, stopping capture, switching screens, restart, recovery, restore, and reconnection never dispatch an upload; changed audio/hints/recipient/model/price reject prior approval
- [ ] A-24 API transcripts with no timing allow text correction and whole-take playback; unavailable alignment is explained. Returned timings are range/monotonicity checked and tested against the original timeline
- [ ] A-25 API failure/cancel/oversize/malformed output leaves recordings and old revisions intact; explicit retries disclose possible duplicate charges; changing ASR provider/model does not overwrite history or forward credentials

---

## Notes & findings

- 2026-10-08: Session export (2.22); Rust backup 7/7, crate builds without warnings, sessions/settings/ipc Vitest 18/18. All M2 build items except 2.5–2.12 recording/recovery polish are now implemented.
- 2026-10-08: Weekly automatic backup (2.21); Rust backup 6/6, crate builds without warnings, settings + ipc Vitest 14/14.
- 2026-10-08: User's desktop pass: recording works; reported a frozen 0:00 timer, Ctrl+Enter not starting, and a static level meter. Cause of the timer/meter: under React StrictMode both effect mounts registered the same `apply` function; a client keyed by function identity (the mock's Set, reproduced in the browser) lost the live registration on the first mount's cleanup. Each mount now registers its own wrapper and the mock wraps per registration; the timer also can no longer rewind when the start reply arrives after level events. Ctrl+Enter is now a window listener (skipped while a dialog is open), not a handler that needed focus inside the studio. The static bar meter became a scrolling, mirrored live waveform (last ~8 s at 10 events/s, −50…0 dB scale). Verified in the browser preview (Ctrl+Enter from BODY, timer 0:24, waveform scrolling, stop saves) and a new StrictMode regression test; full Vitest 37/37 before the last one-line change, practice tests 5/5 after. Not re-checked in the desktop app; if the native timer still freezes, inspect Tauri event delivery next.
- 2026-10-08: Restore commit (2.20). `SessionStorage` is now `RwLock<Result<DatabaseOwner>>`; `list_recordings`, `list_recoverable_recordings` and `recover_recording` now hold the read lock for their file work too, so no command can observe a half-swapped profile. No nested read locks (checked), so the write lock cannot deadlock. Rust backup 5/5; crate builds without warnings; full Vitest suite 36/36 (fixed a latent `--isolate=false` mock-ordering failure in waveform.test.tsx from 44838b3). Known gaps against §13: the API usage ledger (JSON) is not yet in backups; the pre-restore copy is a rollback folder, not a ZIP in the backup folder; rollback folders are kept indefinitely and are not yet shown in the storage view (6.6).
- 2026-10-08: Backup (2.18) and restore check (2.19), D-25. Downloaded only `zip` 8.6.0, `tauri-plugin-dialog` 2.8.1 and their transitive crates (rfd, tauri-plugin-fs, …) with user approval; `flate2` had to be added directly because zip disables its default backend. Rust: backup 3/3 (round trip incl. Trash, changed-audio failure keeps earlier backup, six restore rejections), storage 9/9; desktop crate builds without warnings. Vitest: BackupSettings test + settings/ipc files 14/14. Browser preview shows the section disabled with an explanation. Restore commit (2.20) needs `SessionStorage` to become swappable (close connection, swap folders, reopen) and is next.
- 2026-10-08: Trash (2.17). Schema bumped to v2; an existing v1 database is snapshotted (`before-v2-*`) and upgraded in place (tested). Purge safety: rows and tombstones commit together before any file is removed; a Windows exclusive-handle test proves a blocked removal is finished on the next start without re-importing the receipt. Startup Trash expiry is non-fatal so it can never hide history. Browser preview check (mock client): dialog text, Trash list, permanent-deletion date, Undo restore, no console errors; fixed a flash of "session unavailable" by navigating before invalidating. Not yet run in the desktop app. Whisper run folders (`cache/whisper/<run>`) are not linked to attempts yet; M3 must include them in `remove_take_files`.
- 2026-10-08: Resumed from the Codex thread of 4–7 Oct (Claude Code session). Per the user's request there, testing is now targeted: run only the touched Rust module / Vitest files while iterating, full suites at milestone boundaries. Added 2.14/2.15: `src-tauri/src/audio/peaks.rs` (+2 tests), `get_recording_waveform` command, `WaveformPeaks` Zod schema/IPC method, `src/features/review/WaveformPlayer.tsx` + `waveform.ts` helpers (+5 tests). Checks run: `cargo test --lib audio::peaks` 2/2, `tsc --noEmit` clean, Vitest waveform + ipc + sessions + practice files 18/18. Desktop app not relaunched; browser preview can't show this (mock client has no saved audio).
- 2026-10-07: Core M0 closed. Six profiles × four public trials are published in bench/results-2026-10.json/.md; selected CUDA turbo + exact filler prompt has warm worker median 11.532 s, total median 14.022 s, peak working set 380.2 MiB, 3/194 verbatim edits, 13/14 UH/UM retained and zero insertions in all trials. Initial cache state and per-process VRAM are unknown; older JFK GPU slowness was not reproduced and has no proven cause. CrisperWhisper adapter/weights experiment deferred, not benchmarked. Portable setup selects CUDA or explicit CPU base without automatic fallback.
- 2026-10-07: User supplied one successful, explicitly approved in-app GPT-6 Luna feedback result. Agent verified saved feedback metadata and the shared ledger without reading credentials: 291 input / 163 output tokens, estimated USD 0.000227, settled. Suggestions preserve meaning and label natural comparative phrasing as optional style. No audio upload or extra paid request. Broader coaching quality and optional audio API gates remain separate.
- 2026-10-07: Started M2 with rusqlite 0.40.2 bundled SQLite, single connection owner, WAL/FK/FULL sync, transactional v1 schema, online pre-migration snapshots, native history/edit commands and staged capture references. Legacy receipts import idempotently; missing audio stays flagged, task details unknown, and user edits survive restart. Native Review/Compare play real recordings and bypass simulated observations. Recorder events announce Saved only after SQLite commit; failed references leave files/receipts recoverable. Full ZIP backup/restore, Trash, waveform controls and comprehensive recovery/manual acceptance remain unfinished. API usage remains in its locked JSON owner; migrate later without dropping the live charge.
- 2026-10-04: At the user's request, updated blueprint rev. 3 and this tracker for optional API audio transcription (D-20–23, 0.20–23, 3.14–19, A-23–25). Updated `handout.md` for another chat/machine. This is documentation and planned scope, not an implemented API feature; no audio was submitted or paid request made. Existing recording progress and remaining local feasibility tasks are preserved. Added API allowances total approximately 4–7 working days, beyond the previous filler/prosody extension; estimates need validation.
- 2026-10-04: Verified official OpenAI [file transcription guide](https://developers.openai.com/api/docs/guides/speech-to-text), [pricing](https://developers.openai.com/api/docs/pricing), [Whisper model](https://developers.openai.com/api/docs/models/whisper-1), and [data controls](https://developers.openai.com/api/docs/guides/your-data). The guide recommends `gpt-transcribe`; word/segment timestamp parameters are specific to `whisper-1`. Current rates: `gpt-transcribe` USD 0.0045/min, `gpt-4o-mini-transcribe` about USD 0.003/min, `whisper-1` USD 0.006/min. Store dated prices/capabilities and recheck at implementation; these facts do not demonstrate filler fidelity or performance on this user's audio. Provider retention is endpoint-specific; do not apply a generic 30-day assumption or promise deletion from local deletion.
- 2026-10-04: Documentation verification passed: all 13 new API task/acceptance IDs occur once and remain unchecked, blueprint source IDs are unique, and every source reference resolves. Reviewed privacy/offline/dependency wording across the three documents; `git diff --check` passes. No application code changed in this planning session.
- 2026-10-04: Implemented M0 recording in `src-tauri/src/audio/capture.rs` and `src-tauri/src/storage/recording.rs`, with native IPC commands and Zod-validated responses/events. Startup journals and receipts preserve native format, source channels, title, duration, and checksums. Identifier validation prevents frontend paths; playback resolves only trusted asset IDs and is scoped to app-owned WAV files. Recovery is explicit and never restarts a microphone or uploads audio. Completed chunks remain alongside final WAVs until M2 implements cleanup after database commit.
- 2026-10-04: Verified seven regular Rust tests, a live microphone save/idempotency/level-event test, and three live forced-kill runs (loss 760/730/770 ms). Full frontend suite passed 19/19; after the final event-filter/mock-error fixes, the two affected files passed 9/9 again. Typecheck, frontend production build, and native desktop build passed; format and diff checks are clean. Test recordings were created in isolated temporary directories and deleted. Hardware tests are ignored by default and require explicit execution.
- 2026-10-04: CPAL's `RealtimeDenied` and `DeviceChanged` notifications describe an active stream, so they do not terminate a take. Actual stream failures, queue overruns, and driver xruns stop capture and retain recovery chunks without a false Saved state. One concurrent-build run produced a driver xrun; all three crash tests passed after compilation finished. Keep recording ahead of background work, as required by §9.
- 2026-10-04: Opened the native desktop app and verified Today/Studio render, native mode is selected, real microphone enumeration appears, and the saved-recording library is reachable. Further UI input was declined because user input was detected, so in-window recording, audible playback, reopen, and close-dialog checks remain manual tasks. Native capture and recovery were verified through the hardware harness. The development preview remains open.
- 2026-10-04: Pinned direct Rust versions to the existing lockfile and added SHA-256 hashing plus Tauri's scoped asset protocol. Only `http-range` 0.1.5 needed downloading. No model weights or coaching requests were downloaded/submitted.
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
