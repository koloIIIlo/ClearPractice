# M16 — Platform and polish

> **Goal.** Widen where and how you practise, and keep the app healthy:
> - a mobile companion with private LAN sync, behind a feasibility gate;
> - opt-in surprise prompts;
> - content packs;
> - first-language tips;
> - local models for the small text tasks;
> - provider contract tests;
> - user docs and What's new;
> - updates and code signing;
> - a final performance pass.
>
> **What you'll see:** depending on the WPs you choose, a phone app, surprise prompts, a Content section in Settings, What's new, and Check for updates.
>
> **Schema.** v25 (sync), only if the mobile gate passes; `content_packs` lands in v25 or the next free version.
>
> **Effort.** 25–45 days (mobile dominates). The small items 16.5–16.8 can go any time after M7; 16.9 comes last.

| WP | Title | Effort |
| --- | --- | --- |
| 16.1 | Mobile companion and LAN sync (gated) | XL |
| 16.2 | Surprise prompts (opt-in) | S |
| 16.3 | Content packs and new content | M |
| 16.4 | First-language tips | M |
| 16.5 | Local models for phrase suggestions and clip naming | M |
| 16.6 | Provider contract tests | S |
| 16.7 | User docs, changelog and What's new | S |
| 16.8 | Updates and code signing | M |
| 16.9 | Performance and storage pass | M |

**As built so far (18 Oct): 16.2, 16.4, 16.5, 16.6, 16.7.** 16.1 waits for its feasibility gate (a phone), 16.3 and 16.9 are next, and 16.8 waits for a certificate and an updater key.
- **16.2 Surprise prompts.**
  - **Preferences:** `surpriseEnabled` (off), `surpriseStart` and `surpriseEnd` (09:00 to 18:00, 30-minute steps), `surpriseDays` (Monday to Friday) and `surpriseNotifications` (off). Missing fields in an older profile take these defaults.
  - **Scheduling:** `src/app/SurpriseScheduler.tsx` checks once a minute only while the prompt is switched on, and loads the prompt's screen only when one is due. The day's time comes from `surpriseMinute(date, …)`. "Already practised" means a practice event or a session with a take that day.
  - **Once a day:** the day a prompt was shown is kept in the WebView's local storage (`cp-surprise-on`), so it shows once even across restarts. Start opens the Studio with the prompt; Not now just closes it.
  - **Windows notification:** goes straight to `tauri-plugin-notification` 2.7.0 (Rust, pinned) through `invoke` in `src/lib/ipc/notifications.ts`, so no JS package was added. Permission is asked when you tick it; it needs `notification:default` in the main window's capability.
- **16.4 First-language tips.** `firstLanguage` (null is Prefer not to say) offers 12 languages: Arabic, French, German, Hindi, Japanese, Korean, Mandarin Chinese, Polish, Portuguese, Russian, Spanish and Ukrainian. `src/content/first-language-tips.ts` has six tips for each, each with an example and a practice link. They show in Exercises → Guides and, one line now and then, in the emphasis drill and the imitation exercise. Every language still needs a speaker's review before release (`docs/CONTENT_REVIEW.md`).
- **16.5 Local models for small text tasks.**
  - **Commands:** six in `commands/small_text.rs`: `preview_phrase_suggestions_local` and `send_phrase_suggestions_local`, and the same for clip names and clip picks.
  - **Rules:** they mirror the follow-up questions' local path: a preview that says the local model on this computer is free, a single-use send bound to the previewed payload, the endpoint checked by `local_llm::validate_endpoint` (loopback only), and the API path's validation.
  - **Front end:** the IPC loads lazily (`small-text-client.ts`, `schemas-small-text.ts`, `mock-small-text.ts`). PhraseSuggestions and ClipImport offer Send to the local model when Coaching is Local LLM.
- **16.6 Provider contract tests.** `src-tauri/tests/fixtures/providers/` holds scrubbed responses: OpenAI take feedback, follow-up questions, phrases and a partner turn; Deepgram; AssemblyAI; 401, 429 and a malformed body. `src-tauri/tests/providers/mod.rs` is compiled into the library from `api/coaching.rs`, so `cargo test --lib providers::fixtures_parse` runs them. `live_contract` is ignored and runs only with your OK: about USD 0.008 in total, keys from Credential Manager, synthetic silence only, and the desktop app closed first.
- **16.7 User docs, changelog and What's new.**
  - **Docs:** `README.md` is now for users (what the app is, install, privacy, features, keyboard shortcuts, where data lives, backups). The developer notes are in `docs/DEVELOPING.md`, and `CHANGELOG.md` uses Keep a Changelog.
  - **What's new:** `src/content/whats-new.ts` has six highlights for 0.1.0. The dialog opens after an update and from Help → What's new. A new profile's `lastSeenVersion` is the current version, so a fresh install doesn't show it. An older profile has none, so it shows once after the update.
- **Start-up:** the waveform player now loads when a saved recording is opened rather than with Today, so start-up JS fell from 318.8 to about 289 kB gzip.

---

## 16.1 Mobile companion and LAN sync (gated)

**Goal.** Practise two minutes anywhere. The phone is the biggest lever for habits.
- **On the phone:** record takes, review phrases and play the daily prompt.
- **On the desktop:** transcription and analysis, as now.
- **Sync** stays on your own network (LAN), with no cloud service (D-36).

**Feasibility gate.** Do this first, in about 4–6 days, and decide with you before building more.
1. **Build.** A Tauri 2 Android build of a minimal shell (Today read-only, a recorder) installs and runs on your phone.
2. **Record.** Recording works on Android, through either cpal with its Android (AAudio) backend or a Tauri mobile plugin.
   - The output is a verified 16-bit mono WAV that survives app backgrounding mid-take.
3. **Pair.** The desktop shows a QR code only while **Pair a phone** is open. The code holds:
   - its LAN address and port;
   - a one-time 128-bit pairing secret;
   - its certificate fingerprint.

   The phone scans it. Both sides then store each other's public key. The desktop listens only while the dialog is open.
4. **Sync one take.** The phone sends one take (WAV + metadata). The desktop verifies the SHA-256 and imports it as a take in a new session.
   - Transcription follows automatically when it is enabled.
5. **Decide.** Pass if steps 1–4 work on your phone and Wi-Fi, and battery use during a 10-minute session is reasonable. The decision is recorded as D-36 confirmed or deferred.

**If the gate passes: scope v1**
- **Phone** (`src-mobile/` or a mobile target of the same Tauri app, decided by the gate):
  - Today (the plan from the last sync);
  - **Quick practice** (one prompt, up to 3 takes);
  - phrase review with **Say it** (records, but transcription happens later on the desktop);
  - the daily prompt;
  - Sync now.
  - No coaching and no cloud requests on the phone in v1.
- **Desktop:** Settings → **Devices** to pair, rename or revoke devices, plus **Sync now** (the desktop listens only during sync).
- **Sync protocol** (`src-tauri/src/sync/`):
  - HTTPS on the LAN with a self-signed certificate pinned by fingerprint, and mutual key authentication.
  - **Append-only items never conflict:** takes, reviews, reflections, events.
  - **Small metadata uses last-writer-wins by `updated_at_ms`:** titles, notes, favourites, preferences that sync (goal, weekly goal).
  - **Deletes travel as tombstones.**
  - **Audio goes one way,** phone → desktop. The desktop sends the phone only text and plan data.
- **Data (v25):**
  - `sync_devices(id, name, public_key, fingerprint, paired_at_ms, revoked_at_ms)`
  - `sync_log(id, device_id, direction, item_kind, item_id, sha256, at_ms)`
  - `updated_at_ms` columns where last-writer-wins needs them.
- **Privacy:** **A-39**. No relay, no internet: the sync code refuses non-private addresses (RFC 1918, link-local, loopback for tests). Pairing needs confirmation on both devices.

**Tests (if built)**
- Rust:
  - `pairing_secret_is_single_use_and_expires`
  - `sync_refuses_public_addresses`
  - `append_only_items_merge_and_metadata_uses_last_writer_wins`
  - `tombstones_delete_on_the_other_side`
  - `imported_take_is_verified_by_hash`
- Manual: two-device recipe in `DEVELOPMENT_PLAN.md` (pair, record on the phone, sync, transcribe on the desktop, revoke).
- iOS is out of scope until a Mac build machine exists.

---

## 16.2 Surprise prompts (opt-in)

**Goal.** An occasional 2-minute challenge at a random time inside a window you choose. Off by default.

**Settings → Practice → Surprise prompts**
- A switch.
- **Between** times (two `Select`s in 30-minute steps).
- **Days** (toggle chips).
- **At most once a day.**

**Delivery**
- While the app is open (even minimised), an in-app toast like the daily reminder, at a random time in the window: "Surprise prompt: describe your morning in one minute. [Start] [Not now]".
- Optional: **Show as a Windows notification**. This uses `tauri-plugin-notification` (pin the exact version), asks Windows permission when you turn it on, and works only while the app is running.
- No background service and no start-up entry. Those would be a separate decision.

**Rules**
- The random time is drawn once a day with `seededRandom(date)`.
- It is skipped if you have already practised that day.
- **Not now** dismisses it for the day. There is no penalty.

**Tests**
- `surprise.test.ts`:
  - `it("draws one time inside the window per day")`
  - `it("skips days with practice")`
- `SurprisePrompt.test.tsx`:
  - `it("starts the Studio with the surprise prompt")`

---

## 16.3 Content packs and new content

**Goal.** More to practise, versioned and checked.

**New bundled content** (appendix C lists the counts)
- STAR interview questions: 30, shared with 10.13.
- Storytelling prompts: 30.
- Everyday situations: 40 (ordering, returning an item, small talk, phone calls, a doctor's visit).
- Debate prompts with follow-ups: 20.
- All of these bump `CURRICULUM_VERSION`.

**Imitation speech pack (optional download)**
- About 10 public-domain speech clips with transcripts.
- Sources must be public domain, recorded with their source and licence like the existing clip credits. Examples: LibriVox recordings, which are public domain in the USA, and US government recordings. **Verify each licence before shipping.**
- The download follows the Whisper download pattern (`whisper_setup.rs`):
  - an explicit **Download (≈ 25 MB)** button;
  - pinned URLs, sizes and SHA-256;
  - progress and Stop;
  - nothing automatic (rule 1).

**Pack import** (Settings → Content)
- **Import a content pack…** reads `*.cppack.json`:

  ```json
  { "format": "clearpractice-content-pack", "version": 1, "id", "title", "prompts": [], "drillTopics": {}, "scenarios": [], "missions": [] }
  ```
- It is validated with zod (in TypeScript) and size-limited (1 MB).
- It is stored in `content_packs(id, title, version, json, imported_at_ms, removed_at_ms)`.
- It is merged into the lists at runtime (`listPrompts` and so on), with IDs prefixed by the pack ID.
- Packs can be removed. Sessions keep their snapshots.

**Tests**
- `content-pack.test.ts`:
  - `it("validates and prefixes pack items")`
  - `it("refuses unknown fields and oversize packs")`
- Rust:
  - `content_packs_are_stored_and_removable`
  - `speech_pack_download_verifies_hash` (as for Whisper)

---

## 16.4 First-language tips

**Goal.** Optional, respectful tips that point out patterns common to speakers of your first language. **Tips only; never an accent score.**

**Settings → Practice → "Your first language (optional)"**
- A `Select` of about 12 languages, or "Prefer not to say".
- Stored in `firstLanguage`.

**Content** (`src/content/first-language-tips.ts`)
- Per language, 6–10 tips, each with an example and a practice link (emphasis game, thought groups, imitation). For example, for Russian:
  - articles;
  - word stress in long words;
  - the rising intonation of yes/no questions.
- **Each language's tips must be reviewed by a knowledgeable speaker before shipping** (your call; record who reviewed in Notes).
- Tips appear in Exercises → Guides, and now and then as one line in the emphasis and imitation drills.

**Tests**
- Content test: every tip has an example and a link.
- `offending()` finds nothing.
- No tip mentions "accent score" or similar.

---

## 16.5 Local models for small text tasks

**Goal.** Phrase suggestions (and clip names and picks) work with your local model as well, not only OpenAI. Today they are blocked when Coaching is set to Local LLM, to avoid a silent switch of provider.

**Native**
- `api/coaching.rs`:
  - `preview_phrase_suggestions(…, local: Option<LocalTarget>)`
  - `send_phrase_suggestions_local`
  - the same for clip names and picks, mirroring the follow-up local path (`send_follow_up_local`)
- `local_llm::chat_body` with the same JSON schemas.
- **Validation is identical:** quotes must exist, and lengths are checked.
- The preview says "Recipient: local model on this computer · free".

**Front end**
- `PhraseSuggestions.tsx` enables the local mode with **Send to the local model**, following `FollowUpPanel`'s pattern.
- The "Choose in Settings → Coaching" note shows only when coaching is Off.

**Tests**
- Rust, with a stand-in loopback server: `phrase_suggestions_local_validate_like_api`.
- Vitest: `it("offers local suggestions without cost when coaching is local")`.

---

## 16.6 Provider contract tests

**Goal.** Catch provider response changes early, without network in normal test runs.

**Fixtures:** `src-tauri/tests/fixtures/providers/` holds recorded, scrubbed responses:
- OpenAI Responses (feedback, follow-up, phrases, partner turn);
- Deepgram;
- AssemblyAI;
- one error example each (401, 429, malformed).

**Tests**
- `cargo test --lib providers::fixtures_parse` runs every adapter over every fixture.
- **Live check (manual, opt-in):** `cargo test --lib -- --ignored live_contract` reads keys from Credential Manager and makes the smallest request per provider.
  - It runs only with your OK and costs under USD 0.01 in total.
  - Its result is recorded in Notes.

---

## 16.7 User docs, changelog and What's new

- **`README.md`** (user-facing): what the app is, install, privacy rules in plain words, features, keyboard shortcuts, where data lives, backups.
- **`CHANGELOG.md`** ("Keep a Changelog" format): one entry per release.
- **In-app What's new**
  - `src/content/whats-new.ts` lists, for each version, 3–6 highlights, each with a link.
  - On the first start after an update, a dialog shows them. The `lastSeenVersion` preference stops it from showing again.
  - Help → **What's new** reopens it.
- **Tests:** `WhatsNew.test.tsx` — `it("shows once per version and from Help")`.

---

## 16.8 Updates and code signing (D-38)

**Code signing**
- Sign the NSIS and MSI installers with your certificate. Either:
  - an OV or EV certificate;
  - or Azure Trusted Signing.
- Configure it in `tauri.conf.json` > `bundle.windows` and the build script.
- Keep the private keys out of the repo.
- Document the steps in `DEVELOPMENT_PLAN.md` → Environment.

**Updates**
- Use `tauri-plugin-updater`, pinned, with update manifests signed by your updater key and hosted on GitHub Releases.
- Settings → About:
  - **Check for updates** (manual);
  - an optional **Check once a week** toggle, off by default. It contacts GitHub, so it is opt-in under rule 1.
- **The download starts only after Install.** The dialog shows the version, size and release notes.
- **No update while recording;** the install waits for a safe moment.

**Tests**
- Rust: `update_check_is_not_run_unless_enabled_or_requested`, using net_guard style with a stand-in server.
- Manual: publish a test release to a private repo and update from it.

---

## 16.9 Performance and storage pass

**Once the features are in**
1. **Re-measure the README §8.8 budgets** on the release build with two years of seeded history, and fix any regressions.
2. **Database health:**
   - `PRAGMA optimize` on close;
   - a monthly `VACUUM` offered in Settings → Data when free pages exceed 20%;
   - index review using `EXPLAIN QUERY PLAN` for `practice_facts` and the Journey queries.
3. **Memory:** leave the app open on Journey and the Studio for 30 minutes. The WebView2 memory must stay flat (Task Manager).
4. **Storage usage:** the new tables appear in Settings → Data → Space used (6.6).
5. **Startup:** check again that lazy routes and prefetch still meet 7.1's budget.

**Tests:** the benchmarks from 7.6 and 8.8 run with `--ignored` and are recorded in Notes; `npm run check:bundle` passes.
