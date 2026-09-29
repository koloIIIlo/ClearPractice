# ClearPractice — Session Handout (2026-09-29)

A condensed summary of the first working session: what was decided, built, and verified, and what's still open. Paste this into a new chat together with the repo to continue.

---

## 1. What the project is

A **Windows 11 desktop speaking coach** for one user. It guides short sessions (pick a prompt → record → review one improvement → try again) and keeps **all** history on the computer: recordings, transcripts, notes, phrases, and progress.

- **Spec:** `ClearPractice-App-Blueprint.md` (rev. 2). References like §9 point into it.
- **Stack:** Tauri 2 (Rust core) + React 19 + TypeScript + Vite + Tailwind 4 + shadcn/ui (Radix). Rust owns recording, files, SQLite, and outbound API calls.
- **Services:** local **whisper.cpp** for transcription. Coaching defaults to a **hosted LLM API** with the user's own key, and only on explicit request. Optional local LLM through a loopback endpoint; nothing is installed by default. Audio never leaves the computer.
- **Principles:** no single fluency score, no CEFR levels, and every observation labelled **Measured / Estimated / Your note / AI suggestion**. Missing values are shown as *unavailable*, never 0.

## 2. Files in the repo

| File | Purpose |
| --- | --- |
| `ClearPractice-App-Blueprint.md` | Full product and technical spec |
| `DEVELOPMENT_PLAN.md` | **Checkbox tracker** with milestones, decision log, acceptance suite, and notes. Read "Current status" first |
| `CLAUDE.md` | Conventions and commands for AI assistants |
| `handout.md` | This file |
| `src/` | React UI (`app/` shell, `features/<area>/` screens, `components/`, `lib/ipc/` typed IPC + mock) |
| `src-tauri/` | Rust core (still the Tauri template; M0 starts here) |

## 3. Milestones (see the plan for all checkboxes)

E (environment) → **M0 Feasibility** (audio, Whisper, API spikes) → **M1 Design & shell** → M2 Durable practice (recording, SQLite, backup/restore) → M3 Review & transcription → **P Prosody** (new) → M4 Full routine → M5 Coaching modes → M6 Release hardening.

## 4. Status at the end of this session

**Done and verified**
- Environment on the original laptop: Rust 1.98.1 (MSVC), VS Build Tools 2026 + Windows SDK 10.0.26100, Node 24.14, and `npx tauri info` all green. The first `cargo build` of `src-tauri` succeeds.
- Project scaffolded; npm dependencies pinned to exact versions.
- **M1 UI shell** runs on sample data: Today, Exercises (+ detail, prompts, guides), Practice studio (**simulated** recorder with a navigation guard), Session review (simulated transport, transcript, filler candidates with Hear it / Confirm / Dismiss, coaching "View text to send"), Compare takes, Sessions, Phrases (recall practice on a 1/3/7/14/30-day schedule), Progress (Rehearsed / Unfamiliar / Real conversations kept separate), and Settings (7 sections).
- `npm test` 15/15 passing, `tsc` clean, `vite build` OK. Checked visually at 800×600 and 1440×900 in light and dark mode with no console errors.
- `git init` done (branch `main`), **no commit yet**.

**Not yet done**
- M1 leftovers: a manual keyboard pass over Studio, Phrases, Progress, and Settings; a check of compact nav below 800 px; `.editorconfig`.
- Everything native: real recording, playback, SQLite, Whisper, API. The UI talks to `createMockClient()` for now.

**Next action:** M0 audio spike. Set up the data dirs, add a CPAL device list, capture chunked audio with a recovery manifest, and run a **kill test** (lose ≤ 2 s of audio after a forced kill). Then the Whisper benchmark.

## 5. Answers and decisions so far

| Topic | Answer / decision |
| --- | --- |
| Windows SDK setup | User installed **VS Build Tools 2026** (with the Windows SDK) themselves |
| Package manager | npm |
| Interface locale | English; dates formatted as `en-GB` regardless of the Windows locale (`UI_LOCALE` in `src/lib/format.ts`) |
| Models beyond plain transcription | Discussed (see §7). The user asked to add the **first two** ideas to the plan; done |
| Mood/emotion detection | **Not built** (D-18): unreliable for second-language speech; self-rated ease + energy measures instead |

**Still open, needed from the user**
1. **D-6:** API provider + model for coaching (blocks M0 task 0.16–0.19)
2. **D-7:** monthly API spending warning/stop limit
3. **D-8:** practice language: English only, or also another?
4. **D-9:** confirm the English interface
5. **D-10:** backup destination; keep recordings indefinitely?
6. **D-11:** is a one-time download of ~600 MB of Whisper models OK?
7. Permission to make the **first git commit**

Open technical decisions settled by measurement: D-4 (base.en vs small.en), D-5 (CPU vs CUDA), D-12 (resampler), D-13 (Whisper as sidecar process vs bindings, leaning sidecar), D-16 (filler strategy), D-17 (pitch tracker).

## 6. Hardware (original laptop, re-detect on a new machine)

AMD Ryzen 7 3750H (4C/8T) · 13.9 GB RAM · NVIDIA GTX 1650 **4 GB VRAM**, driver 592.82 · Windows 11 Pro 26200 · WebView2 154. The Whisper defaults (§10) were planned around this machine.

## 7. The model discussion, in short

Whisper outputs only text + timestamps. It doesn't capture intonation or mood and often drops "um".

1. **Intonation / stress / rhythm (prosody):** plain signal processing (pitch trackers such as YIN/pYIN/McLeod, optionally CREPE; loudness). Accurate, local, cheap. **Added as Milestone P:** a pitch and loudness display in Review and a reference-vs-attempt overlay for Listen & imitate. No scores.
2. **Mood/emotion:** models exist (SenseVoice-Small, emotion2vec, wav2vec2-based) but are trained mostly on acted native speech and misread L2 hesitation as emotion. **Skipped** (D-18).
3. **Filler-aware transcription:** a Whisper initial-prompt trick with fillers, or CrisperWhisper (a verbatim fine-tune of large-v3; licence reportedly non-commercial; needs quantization for 4 GB). **Added to the M0 benchmark** as tasks 0.14a–c.
4. **Models that listen to audio directly** (GPT-4o audio, Gemini, Voxtral, Qwen-Omni): would need uploads or too much VRAM, and their accuracy is unproven. Later, opt-in only.

*Names and licences come from memory; verify before adopting.*

## 8. Implementation notes and gotchas

- **IPC boundary:** components use `useIpc()` / hooks in `src/lib/ipc/queries.ts`. Method names mirror the blueprint's Rust commands (§15). All data is parsed with Zod (`src/lib/ipc/schemas.ts`), so the mock can't drift from the contract.
- **Design tokens:** `--cp-*` in `src/index.css` (§4 colours), mapped onto shadcn variables. No hard-coded colours.
- **Customised shadcn primitives:** buttons ≥ 40 px, sidebar 216 px, custom `nav:` breakpoint at 800 px (`use-mobile.ts` in sync), and `CommandDialog` fixed so its title sits inside the dialog and children are wrapped in `<Command>`.
- shadcn imports `cn` from the `cn` npm package (shadcn's own; verified legitimate).
- **Git Bash:** `link` resolves to GNU coreutils and breaks Rust linking. Run cargo from **PowerShell**; add `$env:USERPROFILE\.cargo\bin` to PATH if needed.
- Vitest workers time out if started during a cargo build (CPU saturated). Rerun afterwards.
- `useBlocker` guards in-app navigation while recording. The window-close guard comes in M2 (task 2.10).
- Tauri config: product name ClearPractice, min window 800×600, restrictive CSP, NSIS/MSI targets.
- The main JS chunk is 1.1 MB. Acceptable for a local app; lazy-load if cold start misses 2 s.

## 9. Setting up on another machine

The repo isn't pushed anywhere yet. Copy the folder **without** `node_modules/`, `src-tauri/target/`, and `dist/` (or commit and push first).

1. Install **Node 24+**, **Rust stable** (`winget install Rustlang.Rustup`), and **Visual Studio Build Tools** with the *Desktop development with C++* workload + a Windows 10/11 SDK. WebView2 is preinstalled on Windows 11.
2. In the repo: `npm install`
3. Check: `npx tauri info` (everything should be ✔)
4. Run:
   - `npm run dev`: UI in a browser at http://localhost:1420 (mock data)
   - `npm run tauri dev`: desktop window
   - `npm test` · `npm run typecheck` · `npm run build`
5. Re-detect the hardware (CPU, RAM, GPU/VRAM, driver) and update "Environment facts" in `DEVELOPMENT_PLAN.md` if the machine differs.

## 10. Prompt to start the next chat

> I'm building ClearPractice, a Tauri 2 + React desktop speaking coach. Read `handout.md`, then `DEVELOPMENT_PLAN.md` ("Current status") and `CLAUDE.md`; the spec is `ClearPractice-App-Blueprint.md`. Continue from the next unchecked task, tick boxes only when verified, and update the plan's status and notes at the end. Ask me about any open decision (D-6, D-7, D-8, D-10, D-11) when it blocks you.
