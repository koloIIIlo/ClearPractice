# ClearPractice desktop speaking coach blueprint

Product design and implementation plan

4 October 2026 (original blueprint: 29 September 2026)

Revision 3 includes optional API audio transcription, API coaching, and progressive practice

Build ClearPractice as an installed desktop app that guides short speaking sessions and keeps the entire practice history on the computer. The primary experience is a clear sequence: choose a prompt, record an answer, review one improvement, and try again. Exercises, recordings, transcripts, personal notes, useful expressions, and progress remain available after closing the app and without an internet connection.

The recommended foundation remains Tauri 2, React, TypeScript, Vite, Tailwind CSS, and the Radix variant of shadcn/ui. Rust owns recording, files, SQLite, and outbound API calls. The intended personal setup defaults to local whisper.cpp transcription, with optional API transcription of explicitly approved saved recordings, and a hosted language model API for wording and structure feedback. Offer a separate optional local LLM coaching mode through a tested loopback endpoint, but do not install or run an LLM on this laptop by default. The design should feel like a quiet practice notebook with a small recording studio.

The delivery target is a single-user Windows 11 x64 desktop application. The reference laptop's hardware and tools have been detected and recorded in `DEVELOPMENT_PLAN.md`; re-detect them when continuing on another machine. English practice is the initial curriculum, with a separate interface language setting and a future multilingual option. Other desktop platforms remain later extensions.

This plan specifies proposed behavior. Timing budgets, hardware profiles, and implementation estimates are engineering targets to validate, not measured results from an existing app. The screen concept uses illustrative content and does not record or analyze real audio.

The revised learning design adds an explicit progression in difficulty, practice in real conversations, and separate evidence for rehearsed and unfamiliar tasks. The technical design separates local storage, selectable speech recognition, local acoustic analysis, and selectable text coaching. Previously saved material remains available offline; fresh API transcription and feedback need a connection and may incur provider charges. API transcription sends audio, while text coaching sends selected text under separate approval. The earlier screen concept is illustrative; the screen specifications in this revision define the updated behavior.

## 1 Product outcomes and boundaries

The app should help the user express a point sooner, complete thoughts without unnecessary restarting, become comfortable with pauses, and retrieve useful English expressions more easily. A successful session ends with something concrete: an improved second attempt, one expression to practise again, or a clear observation supported by a recording.

Success is not defined by eliminating every filler, reaching a universal speaking speed, or sounding like a particular accent. Ordinary hesitation is compatible with effective communication. The product should avoid a single numerical fluency score because it would combine uncertain measurements and subjective judgments into an apparently authoritative result.

The app is a practice aid with no measured learning outcomes yet. It must not promise a final proficiency level or a deadline for reaching it. Advanced goals can include precision, coherent explanations, storytelling, persuasion, and effective interaction. CEFR descriptions may inform these goals, but the app does not award CEFR levels. Spoken proficiency includes range, accuracy, fluency, interaction, and coherence; solo fluency drills cover only part of it. [S21]

The first complete release must support these jobs:

- Open the app and immediately know what to practise today.
- Follow the record, review, repeat exercise with minimal setup.
- Practise pausing, imitation, and corrected expressions using saved material.
- Listen to an earlier attempt while reading its transcript.
- Compare two attempts at the same prompt.
- Find an old session or useful phrase without remembering its exact date.
- See personal trends while understanding which values are estimates.
- Practise unfamiliar tasks and record feedback from real conversations.
- Select Local / API / Off for transcription, independently of API coaching, an optional local LLM endpoint, or manual review.
- Export and restore the practice history without depending on an account or subscription.

The initial release does not need social feeds, rankings, in-app payments, a ClearPractice cloud account, unrestricted AI chat, automatic video downloading, or a mobile app. API transcription and coaching use the user's own provider account and credentials. Live audio streaming and turn-taking conversation with a voice model are later extensions. Pronunciation assessment at the phoneme level requires a separately evaluated system and should not be inferred from a transcript.

| Priority | Included capabilities | Completion condition |
| --- | --- | --- |
| Foundation | Local curriculum, native recording, playback, SQLite history, export and restore | A complete manual practice session survives restart and restore |
| Core coaching | Local transcription, editable transcript, approximate speech and pause measures, candidate filler review | Every displayed observation can be inspected or corrected |
| Optional API transcription | One native hosted ASR adapter, audio preview, transcript normalization, shared usage controls | Only approved saved audio is uploaded; missing timings and provider failures remain visible |
| Complete personal app | Four exercises, phrase review, comparisons, progress, local search, progressive tasks | Manual practice and saved material remain usable offline |
| Default text coaching | Hosted API feedback and usage controls | Selected text is sent only on an explicit request; results are saved locally |
| Optional local coaching | Tested loopback LLM adapter with the same feedback contract | No model download is required for API users; failures preserve manual practice |
| Later | Conversation turns, richer pronunciation tools, additional platforms | Separate performance and quality criteria have been met |

## 2 The daily practice flow

The default session lasts approximately 13 minutes, including preparation and playback. Recording time is shorter than session time. Offer a five-minute session for busy days and a custom session for individual exercises. Duration is a suggestion; there is no penalty for stopping early.

| Stage | Default allowance | What the user does | Saved result |
| --- | --- | --- | --- |
| Record and repeat | 6 minutes | Outline three keywords, record 60 seconds, review, record again; optional third take | Two or three linked attempts and one selected focus |
| Thought groups | 2 minutes | Read a short passage with pauses, then explain it freely | A recording and a brief reflection |
| Listen and imitate | 3 minutes | Listen to a short clip, repeat, compare one feature | Reference clip, attempt, selected focus |
| Expression practice | 2 minutes | Use one corrected expression in three different sentences | Phrase card, examples, next review date |

The Today screen offers one primary action, Start practice. Before recording, show the prompt and at most three outline fields: Point, Reason, Example. During speech, hide transcript corrections and coaching. After speech, save the audio first, then offer playback while analysis continues. Present one suggested improvement and an optional details view. The next action should usually be Try again, with the same prompt and the selected focus.

At the end, show the attempts, the chosen improvement, and one optional phrase to save. Ask, "How easy did speaking feel?" with a clearly labeled self-report scale. Save automatically. The completion view offers Finish or Practise another prompt; it does not encourage an endless session.

For the five-minute version, use one prompt, two short attempts, a playback comparison, and one reflection. If transcription is slow, the session remains usable through listening and manual notes. Never require waiting for optional coaching before recording the next attempt.

Once a week, add an unfamiliar prompt before rehearsal and a small real-world speaking task. These supplement the daily routine; the app should not imply that 13 minutes is a complete advanced-language curriculum. In API mode, Get feedback is an explicit action after the transcript is available. The button names the active provider; it never automatically sends a recording or the entire history.

## 3 Navigation and information architecture

Use five primary destinations: Today, Exercises, Sessions, Phrases, and Progress. Put Settings at the bottom of the sidebar. Learning guides belong within Exercises, and reference clips belong within the imitation exercise and its media collection. This avoids several overlapping destinations called Library, Resources, History, or Coach.

| Destination | Main content | Primary action | Supporting action |
| --- | --- | --- | --- |
| Today | Daily focus, session sequence, resume entry, recent session | Start or resume practice | Choose a shorter session |
| Exercises | Four core exercises, practice prompts, short learning guides | Start selected exercise | Save a prompt or import a clip |
| Practice studio | Prompt, outline, recorder, attempt sequence | Record or stop and save | Check microphone |
| Session review | Playback, transcript, evidence, notes, linked attempts | Try again | Compare or save a phrase |
| Sessions | Searchable chronological history and favorites | Open session | Export selected session |
| Phrases | Due expressions, saved phrases, examples | Practise due phrases | Add a phrase |
| Progress | Personal trends, comparable recordings, reflections | Compare recordings | Change date range |
| Settings | Audio, appearance, data, transcription, coaching providers, accessibility | Depends on section | Open data folder or create backup |

The practice studio and session review are contextual screens rather than permanent sidebar entries. Preserve sidebar selection when opening a session. A breadcrumb such as Sessions / Explaining a habit / Attempt 2 makes navigation reversible. The back button restores filters, scroll position, and the previously selected session.

Use a command palette for navigation and saved-content search, opened with Ctrl+K or Command+K. Search results group sessions, phrases, prompts, and guides. Search is local. A matching transcript excerpt opens near the relevant passage when timing information is available.

## 4 Visual direction and design tokens

Use warm neutral surfaces, dark readable text, and a restrained deep teal accent. The interface should have generous space around the current speaking task and denser rows for history. Avoid ornamental gradients, oversized metric cards, animated backgrounds, and a dashboard full of scores. A small waveform is functional; it should not become decorative scenery.

Use locally bundled Inter for the interface, with the system sans-serif stack as a fallback. Use tabular numerals for timers and aligned values. The principal action is filled teal; secondary actions use a quiet border; destructive actions appear only where needed. Keep ordinary content left aligned and reserve centered layouts for the recorder timer and simple empty states.

| Token | Light appearance | Dark appearance | Use |
| --- | --- | --- | --- |
| App background | #F6F7F4 | #111816 | Overall workspace |
| Main surface | #FFFFFF | #19221F | Recorder, panels, menus |
| Secondary surface | #EDF1ED | #222E28 | Selected rows and quiet grouping |
| Main text | #18251F | #EDF4EF | Titles and body |
| Secondary text | #526159 | #AFBEB5 | Descriptions and metadata |
| Primary accent | #176A50 | #8ED8B5 | Primary actions and selected states |
| Text on primary | #FFFFFF | #102219 | Filled action labels |
| Border | #D6DED7 | #3A4A40 | Dividers and controls |
| Review highlight | #FFF0C2 | #43391C | Candidate issue with text label |
| Error | #A32D35 | #FFB4B9 | Failure or destructive action |

These are proposed tokens. Check actual foreground and background combinations, focus indicators, chart marks, and disabled states during accessibility testing. Color must always be paired with a label, icon, or pattern when it conveys meaning.

Use an 8-pixel spacing scale with 4-pixel adjustments where necessary. Suggested radii are 8 pixels for controls and 12 pixels for panels. Body text is 15–16 pixels; metadata is 13–14; transcript text is 18 with approximately 1.6 line height; screen titles are 28–32. Buttons are at least 40 pixels high on desktop, with larger effective targets for touch. Content controls must remain usable at 200 percent zoom.

At a 1440 by 900 window, reserve about 216 pixels for the sidebar, 56 for the top bar, and 32 for main content padding. In review, use a flexible transcript column and a 300–340 pixel feedback column. Below about 1100 pixels, make feedback a stacked section. Below about 800 pixels, use compact navigation and a single content column. The desktop minimum supported window size should be tested at 800 by 600. A narrow concept preview may reflow further without promising a mobile release.

## 5 Components and interaction patterns

Use shadcn/ui with its Radix implementation consistently. Its components provide a useful starting point for the app's own design system; choose one implementation family and avoid mixing Radix and Base UI variants arbitrarily. Audit the final components and application composition for accessibility rather than treating a component library as an automatic guarantee. [S1, S2]

| Component | Library or approach | Product behavior |
| --- | --- | --- |
| Sidebar | shadcn Sidebar | Five destinations, current location, Settings at bottom |
| Buttons and fields | shadcn Button, Input, Textarea, Label | Clear verbs, visible labels, native disabled behavior |
| Microphone picker | shadcn Select | Device name, unavailable state, Test microphone action |
| Session preferences | RadioGroup, Switch | Explicit choices for duration, mode, and reminders |
| Exercise filters | Tabs and ToggleGroup where appropriate | Keyboard navigation and a persistent selected state |
| Dialogs | Dialog and AlertDialog | Import, restore, and destructive confirmations |
| Feedback details | Sheet or Collapsible | Optional evidence without hiding the main next step |
| Notifications | Sonner-style toast integration | Brief confirmations; failures remain visible in context |
| History rows | Semantic table, initially without a heavy grid | Sort, filter, select, and open with keyboard support |
| Waveform playback | WaveSurfer.js with Regions | Seek, loop a range, show approximate annotations |
| Trends | Recharts | Labeled axes, units, accessible equivalent data |
| Icons | Lucide React | One family, 18–20 pixel icons, labels on important actions |
| Transcript | Custom React component | Segment playback, editing, annotations, revision awareness |
| Recorder | Custom component backed by native audio | Start, stop, input level, elapsed time, save state |
| Phrase practice | Custom component using standard controls | Prompt, reveal, say it aloud, self-rate recall |

WaveSurfer is appropriate for waveform rendering and playback, including plugins for regions and timelines. It is not the source of truth for recording durability or speech analysis. Recharts is a presentation layer for saved measurements; the backend defines the measurements. [S3, S4]

Use brief transitions of roughly 120–180 milliseconds for opening panels and changing selection. Respect reduced-motion settings. Do not animate scores, make an idle microphone pulse, or flash when a filler is detected. Recording status must be explicit in text and remain visible throughout capture.

Custom components should include PracticeStepper, PromptOutline, RecorderTransport, InputLevelMeter, AttemptList, TranscriptSegment, EvidenceItem, ComparisonPlayer, PhraseReview, ModelStatus, CoachingProviderStatus, TransferReview, DifficultyChoice, UsageSummary, and BackupStatus. Each needs loading, empty, unavailable, and failure states where relevant.

## 6 Screen specifications

### First launch and baseline

Keep onboarding to four short steps. First, ask what the user wants to improve: clarity, hesitation, English phrasing, or confidence in a particular setting. Allow multiple choices and a free-text goal. Ask whether the difficulty appears mainly in English or also in the strongest language. This changes exercise emphasis, not a diagnosis or an inferred proficiency level.

Second, select a microphone, display a live level, and record a five-second test with explicit playback. Do not enable continuous microphone monitoring after leaving this step. Explain a silent input with a specific action such as selecting another device or opening microphone permissions.

Third, configure two independent services. Transcription offers Local / API / Off and defaults to Local Whisper; show installed packs, pack size, and Import pack. Select the local default from the verified M0 benchmark. API transcription setup explains that a chosen recording leaves the computer only after a separate audio preview is approved. Coaching defaults to API, with Local LLM and Off available as alternatives; its requests send selected text. Each API setup shows provider, model, masked key status, and a clearly labeled test that may be billable. Choosing API does not require local model downloads. Skipping setup keeps manual practice available; configuring a service does not submit a baseline recording.

Fourth, offer an optional 60-second baseline recording: "Describe something you would like to get better at and why." Save it with a baseline tag. Explain that later comparisons will include unfamiliar prompts so improvement is not judged only from rehearsed answers.

### Today

The header contains the date and an understated "Saved on this computer" indicator. Nearby service labels show the independent active choices, such as "Transcription: Local" or "Transcription: API · OpenAI" and "Coaching: API"; local storage is never presented as proof that all processing stays local. The central area shows today's focus in one sentence, such as "State your point before explaining it." Under it, show the selected duration and one Start practice button.

Below, present the four planned exercise rows with durations. The right side can show one recent reflection and one saved phrase due for review. Avoid filling unused space with unrelated statistics. If there is an incomplete session, replace the main action with Resume session and offer Start fresh as secondary.

The empty state says "Your first session starts here" and explains what will be saved. After a completed session, Today shows the last completion and allows another session without suggesting the user has failed if a day is skipped.

Show a weekly Try a new situation row with a familiar or unfamiliar label and a brief reason for the suggested difficulty. A Real conversation task row links to a simple reflection form. Neither row requires a microphone recording of another person. Upcoming challenges are goals, not levels awarded by the app.

### Exercises

Show four prominent exercise entries: Repeat an answer, Thought groups, Listen and imitate, and Use a better expression. Each entry states its purpose, typical duration, and one example. Opening an exercise shows exact instructions and what to pay attention to.

Include a searchable prompt collection with situation tags: daily life, explanations, opinions, work, storytelling, and unexpected questions. Store favorites and user-created prompts. Add a small Guides tab with offline articles about pauses, main-point structure, self-review, and the limits of automatic feedback.

Add filters for skill, preparation time, audience, and familiarity. Advanced tasks belong in the same collection: concise explanations, stories, reasoned persuasion, careful disagreement, and responding to a follow-up. A difficulty selector shows the actual demands, such as Two minutes, unfamiliar topic, one follow-up. Do not replace these useful descriptions with a claimed C1 or C2 badge.

### Practice studio

The top shows the exercise, prompt, and attempt number. The center contains a readable prompt, optional outline fields, elapsed time, a modest input meter, and one dominant Record action. While recording, the action changes to Stop and save. Keep Finish early available and make the elapsed time an informational value rather than a countdown that encourages rushing.

The initial version should not offer pause-and-resume within a take. A single continuous recording makes timing and comparisons easier to explain. Users can stop and begin another take. Microphone disconnection ends the take safely and preserves recoverable audio.

An attempt strip lists previous takes with duration and saved status. During recording, prevent accidental navigation from silently abandoning a take. Closing the app offers Stop and save or Continue recording. If a crash or forced shutdown occurs, recover the captured chunks on next launch.

Use a short optional preparation countdown before capture, visibly distinct from recording. Do not show live grammar feedback or a running filler tally. The user should be able to focus on speaking.

### Session review

Place the audio transport across the top of the content area: play, elapsed and total time, waveform, speed, and loop selection. Below it, place the transcript on the left and a small feedback panel on the right. A click on a segment seeks near the corresponding audio only when verified timing exists; enable word-level seeking only when tested alignment is sufficiently reliable. Untimed API text remains editable alongside whole-take playback, with a clear "Timing unavailable for this model" explanation.

The main feedback panel shows one useful observation, an example from the attempt, and one action for the next take. Additional suggestions are collapsed. Labels distinguish Measured, Estimated, Your note, and AI suggestion. These describe the evidence source, not an invented confidence percentage.

The transcript has separate views for As transcribed, My corrections, and Suggested wording. The raw transcript remains recoverable. Editing a word does not pretend that the original recording changed. An edited passage may lose precise alignment; label its timing as approximate and recalculate text-derived metrics against the selected revision.

Selecting text opens actions to play the passage, correct transcription, save a phrase, or add a note. Candidate fillers have a neutral underline. A small review panel offers Hear it, Confirm, and Dismiss. Dismissing a candidate records that decision so it does not reappear from the same analysis run.

If AI feedback is unavailable, show the transcript, playback, manual checklist, and metrics that can still be computed. If transcription fails, preserve the audio and offer Retry transcription, Change model, or Add notes. A failure must never replace the recording with an empty completed result.

When API transcription is selected, saving a take exposes Transcribe via API. Its preview identifies the whole selected recording, provides playback of the prepared audio, and shows recipient/model, duration, size, included language/context hints, estimated charge, price date, and remaining shared budget. Send is an explicit action bound to that exact preview. No upload happens on Stop, navigation, recovery, or reconnection. A completed API transcript is labeled with its provider/model and run date; Retranscribe creates a separate run. Local retry is offered as an explicit choice if the installed pack is available.

The coaching panel has Get feedback, View text to send, and a provider label. The preview includes the selected transcript revision, prompt, focus, and any chosen comparison excerpt; it allows temporary redaction without changing the saved original. After completion show the provider, model, generation date, and usage when available in Details. Offline, show Saved feedback if present and Manual review for new takes. An unavailable API must not silently switch provider, upload later, or download a local model.

### Attempt comparison

Use tabs or a two-column layout for Attempt 1 and Attempt 2, with a single active player. Preserve separate playback positions and clearly label the active take. Offer alternating playback of selected passages, not simultaneous playback.

Show the same prompt, outline, selected focus, and comparable values side by side. A difference in words per minute is descriptive rather than automatically good or bad. Highlight the user's selected improvement, such as a shorter opening, and allow "This attempt felt clearer" as a manual preference. The user can keep any take as their favorite.

### Sessions and notes

History is a compact list with title, date, exercise, duration, number of attempts, and optional favorite marker. Filters include exercise, date range, tag, and presence of a saved note. Search titles, transcripts, and notes locally. Opening a row shows the complete session.

Offer rename, tag, favorite, export, and move to Trash from a contextual menu. Deletion must state whether linked audio and derived analysis are included. Keep a visible Trash view with restoration for 30 days by default; emptying Trash requires a clear confirmation. A user can choose a shorter retention period.

### Phrases

Each phrase stores the original wording, the improved expression, a short explanation, and the user's examples. Show its source session if present. Phrase practice asks the user to recall or use the expression before revealing the suggested version.

Start with a transparent review schedule: 1, 3, 7, 14, and 30 days after successful recall. Again returns the phrase to the next day, Hard keeps the current interval, and Good advances one step. Store the actual review history and calculate due dates using the user's local calendar. This is a simple product heuristic, not a claim of an optimized learning algorithm.

### Progress

Begin with evidence of communication: a recent unfamiliar explanation, the user's chosen improvement, and listener feedback when available. Then show practice minutes, completed sessions, and optional trends such as estimated pace, reviewed filler candidates, and self-reported ease. Use separate views for Rehearsed practice, Unfamiliar tasks, and Real conversations. First attempt and unfamiliar are separate labels: a first take can still use a familiar topic. Filter by language, task demands, preparation, and analysis version.

Prefer individual points plus a labeled rolling summary when enough comparable sessions exist. Display missing values as unavailable. Never fill a failed transcription with zero fillers or zero errors. Low sample counts show the recordings themselves and a message that more comparable sessions are needed.

Add a weekly listening comparison: one familiar prompt and one new prompt. A short reflection asks whether the point was easier to follow. If another person gives feedback, store it explicitly as listener feedback entered by the user.

Use comparable task demands when reviewing change over several weeks. Keep an unfamiliar first take before any retry. Every four to six weeks, invite a review using new prompts and human feedback; this is a proposed assessment interval, not a promised improvement timeline. Difficulty changes and missing listener feedback must remain visible. Do not average self-report, LLM judgment, and listener observations into one score.

### Settings

Group settings into Audio, Practice, Appearance, Transcription, Coaching, Data and backups, and About. Transcription has Local / API / Off: Local shows installed Whisper packs, CPU or NVIDIA acceleration, and Benchmark; API shows its provider/model, supported capabilities, masked key status, and billable-test explanation; Off keeps recordings, notes, and saved transcripts. Coaching has an independent API / Local LLM / Off control. API fields include supported protocol, endpoint when configurable, model ID, masked key status, Test connection, response budget where applicable, and usage limits. Local LLM shows its loopback endpoint and connection state. Detailed configuration stays here; the review screen retains a concise active-provider label. Permit moving local model files independently of recordings.

Data settings show the current folder, total audio size, last successful backup, restore options, and exports. The app should explain whether audio is included in a particular backup. Settings also control interface language, practice language, reminder behavior, text size, reduced motion, and recording sounds.

Usage displays this app's recorded calls, audio duration and tokens according to each model's billing units, estimated cost, and uncertain charges. Show transcription and coaching subtotals plus the combined monthly limit. A price editor records currency, rate source, and effective date; an unknown price is Unknown, never zero. Changing provider or endpoint invalidates the old credential association. Keys have Replace and Remove actions and are excluded from exports. A provider privacy link explains that its retention terms are separate from local storage.

## 7 Exercise content and adaptation

For Repeat an answer, begin with a familiar prompt and a 15-second outline. Record roughly 60 seconds, then listen and choose one improvement. Record the same answer again without requiring identical wording. The third take is optional. Store a repetition group so rehearsed improvement is not confused with improvement on new topics. Repeated speaking tasks have research support for second-language fluency, although the exact short routine here is a product adaptation. [S5]

For Thought groups, supply passages of 40–80 words with optional pause marks. Let the user listen, read aloud, hide the text, and explain the idea in their own words. The focus is finishing a thought and allowing space before the next one. Long pauses are not automatically mistakes.

For Listen and imitate, use short locally available clips, typically 10–20 seconds. The sequence is listen, choose one feature, repeat, compare. Features include emphasis, phrase rhythm, and clear endings. Offer 0.75, 1.0, and 1.25 playback speed only if pitch-preserving playback is verified. Do not compare waveforms visually as a pronunciation score. The initial release uses separately recorded imitation so speaker playback is not mixed into the microphone recording.

For Use a better expression, choose one phrase and ask for three original sentences. The user can type or record them. Feedback should preserve the intended meaning and distinguish a clear error from a stylistic alternative. For example, "stumble over words" is useful phrasing practice; "more clear" should not be falsely presented as universally ungrammatical.

Bundle at least 40 reviewed prompts, 12 short thought-group passages, 8 concise learning guides, and 10 licensed or original reference clips with transcripts. Keep attribution and redistribution permission alongside each clip. The app must work with user-imported material even if the bundled media pack is omitted. Version curriculum items, and preserve the version used in a historical session.

| Week | Suggested emphasis | Representative task | Review question |
| --- | --- | --- | --- |
| 1 | Awareness and a clear opening | Describe one habit using point, reason, example | Did I state the point early? |
| 2 | Complete thoughts and comfortable pauses | Explain a simple process | Did I finish each thought before starting another? |
| 3 | Natural expressions and rhythm | Reuse a saved expression; imitate a short clip | Can I use the expression in a new situation? |
| 4 | Transfer to spontaneous conversation | Answer an unfamiliar question | Could a listener summarize my point? |

The scheduler should be rules-based initially. Use the current user goal, due phrases, unfinished sessions, and recent exercise mix. After three sessions focused on the same issue, offer a new focus or ask whether the current one is still useful. Do not infer progress solely from a lower filler count. Every recommendation should expose a short reason and permit changing the focus.

### Progression beyond the first four weeks

Treat the four-week sequence as an introduction. Continue with a reusable progression based on demonstrated task performance and the user's goals. Repetition can improve some aspects of fluency while transfer to new tasks remains uneven; therefore both rehearsal and unfamiliar tasks belong in the design. [S22]

| Stage | Example task | Added demand |
| --- | --- | --- |
| Clear explanation | Explain a familiar habit in 60 seconds | Main point and one supporting example |
| Unfamiliar explanation | Explain a new question in 90 seconds | Less rehearsal and limited preparation |
| Audience adaptation | Explain the idea to a beginner, then a colleague | Different vocabulary and assumed knowledge |
| Extended expression | Tell a story or support a position for two minutes | Sequence, precision, and relevant detail |
| Interaction practice | Answer a follow-up or respond to disagreement | Listening, adjustment, and turn-taking |

Offer advancement after three completed unfamiliar tasks at the current demand over at least two days, when the user reports the task is manageable and the saved clarity checklist supports trying more difficulty. This is a configurable product heuristic. LLM ratings alone cannot unlock or block a stage. Missing feedback means insufficient evidence, not failure. The user can choose a challenge or easier practice at any time, and the app records that choice.

Change one demand at a time: topic novelty, preparation allowance, explanation length, audience, or follow-up complexity. Do not demand faster speech as a difficulty increase. Keep a practice focus stable long enough to review, but suggest a different task if the same easy prompt keeps recurring. Pause recommendations when the user reports strain or poor recording conditions; an unhelpful microphone is not a proficiency result.

Initial interaction practice can show a written follow-up after the first answer and record the response. Use reviewed bundled questions offline; API-generated follow-ups require a separate explicit request and usage entry. Label this as a simulation. Full low-latency spoken conversation and validated listening assessment remain later features.

### Transfer into real conversations

Offer one weekly assignment matched to the user's life, such as explaining a decision, asking a follow-up question, or telling a short story. Afterward, collect situation, preparation, what the listener understood, any request for clarification, one successful moment, and one next focus. No recording of the other person is required. A listener can answer, through the user, What was my main point, Where was I difficult to follow, and What helped. Store their actual response separately from the user's interpretation.

Suggest periodic feedback from a knowledgeable speaker or teacher for subtle wording and pronunciation, and listening or reading related to upcoming topics. Save a short input note and reuse one useful phrase in a fresh explanation. The app supports these activities without claiming to replace broad language exposure or human interaction. Success is clearer communication in new situations; fewer fillers is only an optional secondary observation.

### Advanced goals without a promised ceiling

Provide task collections for precision, storytelling, persuasive reasoning, nuance, and conversational repair. Each has observable criteria: a listener can identify the claim, the story has a clear sequence, the explanation fits the audience, or the speaker clarifies a misunderstanding. These are training criteria rather than validated proficiency scores. A plateau triggers a review of task variety, feedback, and real-world use; it does not produce a message that the user has reached their personal limit.

## 8 Recommended technical stack

Tauri provides a Rust application core and a web-based interface rendered in the operating system's WebView. Its sidecar mechanism can bundle an external native executable. This fits a small desktop UI with native file access and local inference workers. The tradeoff is Rust and native-build complexity, including separate platform packaging. [S6, S7]

| Layer | Recommendation | Reason and boundary |
| --- | --- | --- |
| Desktop shell | Tauri 2 | Native app lifecycle, IPC, files, and packaged workers |
| Interface | React and TypeScript | Reusable screens and explicit data contracts |
| Frontend build | Vite | Static production assets bundled into the app |
| Styling | Tailwind CSS 4 plus CSS custom properties | Consistent spacing and product tokens |
| UI primitives | shadcn/ui Radix variant | Customizable controls with established interaction primitives |
| Navigation | React Router with hash routing | Predictable local routes without a web server |
| Async reads | TanStack Query | Cache and invalidate data returned by native commands |
| Transient state | React state and typed reducers | Recorder UI and selections; SQLite remains authoritative |
| Validation | Zod in UI and Rust serde plus domain validation | Check command inputs, imports, and worker output |
| Local database | SQLite through rusqlite | One backend owns transactions and migrations |
| Search | SQLite FTS5 | Search saved text without a separate search service |
| Audio capture | Rust CPAL plus a writer thread | Native microphone access and controlled persistence |
| Audio processing | Rust resampling and WAV utilities selected in the spike | Convert device audio into explicit stored and inference formats |
| Playback | WaveSurfer.js and local asset URLs | Waveform, seek, loop, and playback controls |
| Speech recognition default | Pinned whisper.cpp worker | On-device transcript generation |
| Optional API transcription | Native TranscriptionProvider adapter using reqwest | Approved saved audio uploads; common results with model-specific capabilities |
| Text coaching by default | Rust provider adapter using reqwest | Hosted LLM requests with bounded structured output |
| Optional local LLM | Tested loopback adapter, initially llama.cpp server compatible | Same coaching contract; user-managed runtime, no required model pack |
| API credentials | Windows Credential Manager through a narrow Rust module | Personal keys stay out of SQLite, logs, exports, and frontend storage |
| Charts | Recharts | A few accessible trend views |
| Tests | Rust tests, Vitest, React Testing Library, Playwright | Domain tests, screen behavior, and integrated flows |

Vite and Tailwind support the intended frontend build arrangement. TanStack Query can manage asynchronous data access; it does not require turning the app into a cloud service. Pin compatible exact package versions and lockfiles at implementation time rather than treating an unversioned latest dependency as a production policy. [S8, S9, S10]

Do not add a web backend, PostgreSQL, Redis, a vector database, Docker, or a Python installation requirement for the user. Those would add operational work without solving a first-release need. Keep React Query's cache disposable. Do not use localStorage or IndexedDB as the sole repository of recordings or practice history.

| Alternative | When it is a better choice | Why it is not the default here |
| --- | --- | --- |
| Electron with the same React UI | A JavaScript-only team needs a consistent bundled browser runtime | A larger runtime; native audio and inference still need integration |
| Browser app or PWA | Fast distribution matters more than native storage control | Browser persistence, permissions, and eviction complicate this storage requirement |
| PySide6 desktop app | The implementation team is primarily Python-focused | Achieving this interface and packaging native ML dependencies takes a different workflow |
| Flutter desktop | A shared desktop and mobile UI is an immediate requirement | Adds Dart and a separate UI ecosystem for a desktop-first scope |

Use the Tauri plan unless the developer's experience or an audio prototype demonstrates a material reason to change. Architecture selection should follow a short recording and packaging experiment before broad feature work.

## 9 Architecture and audio lifecycle

Keep the UI, trusted application core, and inference workers separate. The UI issues typed commands and renders results. Rust owns identifiers, paths, file permissions, the database, capture state, job scheduling, worker lifecycle, and outbound provider requests. Local inference workers and provider adapters receive only the current job's approved inputs and return structured output. They do not receive general filesystem or shell access through the product interface.

CPAL is a low-level cross-platform audio library; its device and stream APIs are suitable for native capture. The application still has to handle device formats, buffering, thread scheduling, disconnection, and persistence. [S11]

The recording pipeline should follow this order:

1. Create an attempt record and capture manifest before enabling the microphone.
2. Open the chosen device at a supported rate and sample format. Do not assume every device is natively 16 kHz mono.
3. Copy audio frames from the real-time callback into a bounded queue. Perform no database work or blocking filesystem writes in that callback.
4. A worker downmixes as needed and writes recoverable chunks. Preserve the actual sample rate and channel conversion details. Prefer lossless mono PCM for saved speech; 48 kHz and 16-bit is the nominal storage profile when supported.
5. Flush completed chunks periodically, targeting a maximum of two seconds of lost audio under ordinary forced-process termination. Record this as a tested recovery target, not an absolute guarantee under hardware failure.
6. On Stop, close capture, finalize and verify the file, then commit its durable metadata. Mark the attempt saved only after the required write succeeds.
7. Derive 16 kHz mono inference audio without deleting the saved recording. Compute levels and voice activity from the relevant audio stream, preserving the original time coordinates.
8. Run local transcription, or await an explicit preview approval for API transcription of the verified derived WAV. Off skips this job. Store raw output as a versioned analysis artifact with source audio hash, provider/model, settings, and timing capabilities.
9. Compute text-derived metrics locally. Generate coaching only when requested through the selected API or local adapter. Save the validated response locally and make each result available independently.
10. Create compact waveform peaks and discard regenerable temporary files according to cache policy.

If voice activity detection trims silence for transcription, maintain an explicit mapping to the original recording timeline. Use the untrimmed timeline for pause measurements. Never measure natural pausing from already silence-stripped audio.

Use the lifecycle states Preparing, Recording, Finalizing, Saved, and Interrupted for capture. Analysis has its own Queued, Running, Completed, Failed, and Canceled states. Separating these states prevents a failed AI job from making a valid recording appear unsaved.

Allow one transcription job across Local/API and one coaching request at a time by default. API processing avoids loading the corresponding local inference model but adds upload time and a network dependency. When optional local LLM mode is selected, schedule it around transcription according to available memory. A new recording takes priority over background analysis; pause or postpone local inference and audio preparation if they cause dropouts. Canceling a job preserves the take; for an already submitted API request it stops local waiting without promising that provider processing or billing stopped. Pending paid jobs never automatically dispatch after restart or reconnection.

The bundled Whisper worker uses a narrow process protocol with JSON requests and structured progress/results. Separate transcription and coaching API adapters use outbound HTTPS from Rust, sharing credential, transport, and budget infrastructure while keeping payload approval separate. Optional local LLM coaching uses an explicitly configured loopback endpoint, with endpoint authentication where supported; the user manages that runtime. A remote or LAN endpoint belongs to API mode and must not carry an On this computer label. Keep all inference services inaccessible to frontend-supplied arbitrary URLs.

## 10 Transcription, coaching modes, and hardware

### Recommended setup for this laptop

Default to local whisper.cpp for speech recognition and a hosted API for normal LLM coaching. Offer API transcription separately for approved saved takes when the user prefers it; benchmark its accuracy, latency, and cost against local results. Keep the optional local LLM coaching adapter available, switched off. No LLM weights or local LLM runtime should be installed as a dependency of the intended setup.

The reference laptop was detected on 29 September 2026 as Windows 11 x64, Ryzen 7 3750H, 13.9 GB usable RAM, and GTX 1650 with 4096 MiB dedicated memory. Full environment facts are in `DEVELOPMENT_PLAN.md`; re-detect on another machine. Local transcription performance remains unmeasured. API transcription is an alternative to evaluate, not evidence that local processing is inadequate.

| Item | Status or initial choice | Decision |
| --- | --- | --- |
| Operating system | Windows 11 Pro x64 detected | Validate packaged build on the actual laptop |
| Processor | Ryzen 7 3750H, 4 cores / 8 threads | Use measured timings |
| Graphics | GTX 1650 laptop, 4096 MiB VRAM detected | Test NVIDIA acceleration; retain CPU fallback |
| System RAM | 13.9 GB usable, 16 GB installed | Benchmark under ordinary multitasking load |
| Transcription | Local Whisper by default; optional API | Verify existing base and large-v3-turbo-q5_0 packs before any further download; choose local and API models separately |
| Language coaching | Hosted API | No local LLM memory or GPU budget required |

Start with 30–120 second takes, transcription after stopping, and one active transcription job. Benchmark existing packs first; obtain base.en/small.en only if comparison needs them. Use a multilingual pack when another practice language is selected. A larger installed pack becomes a default only after its quality and resource use are measured. Do not promise live transcription or a particular seconds-per-minute speed before testing.

whisper.cpp supports Windows, CPU execution, and NVIDIA acceleration. Its documentation lists base at 142 MiB on disk and about 388 MB memory, and small at 466 MiB and about 852 MB. These are upstream model figures, not a complete Windows RAM budget or a guarantee about peak GPU allocations. [S12]

Package a tested CPU build and a compatible optional NVIDIA build. Validate the actual driver, runtime dependencies, and target GPU in the feasibility milestone. Use the backend that is stable and fast on this machine rather than assuming the GPU must win. End users should receive tested binaries and documented prerequisites, not be required to compile Whisper or install Python.

### Hardware benchmark and acceptance

Record the detected CPU name, RAM, GPU, available dedicated memory, driver, app build, power mode, model checksum, and inference settings. On a plugged-in laptop, benchmark the same hand-checked 60-second personal sample with the verified existing packs on CPU and GPU where available, adding English baselines only if needed. Run a cold trial and three warm trials for each local candidate; report median warm time and range, memory peak, transcript corrections, filler omissions/false insertions, and capture responsiveness. Repeat the chosen local configuration under the user's usual multitasking load. API comparison requires a separate approved request for each sample/model and records upload plus processing time, returned capabilities, and usage; local cold/warm timings are not API latency measurements.

Treat a median processing time of at most 30 seconds for a 60-second take as a preferred product target, 30–60 seconds as usable with background review, and over 60 seconds as a reason to offer a smaller pack or CPU/GPU change. These are proposed waiting-time preferences, not performance predictions. The user can accept a longer wait for a better transcript. If neither pack is satisfactory, manual review remains usable while the implementation is tuned. Recommend hardware purchases only after a measured bottleneck is established.

### Transcription modes and initial API candidates

| Mode | Processing and setup | Audio boundary and availability |
| --- | --- | --- |
| Local default | Verified Whisper pack, CPU or tested NVIDIA backend | No upload; works offline with an installed pack |
| API optional | Supported provider/model, personal key, evaluated price | One approved saved take is sent; needs connection; saved results remain local and available offline |
| Off | No speech recognition | Recording, playback, manual notes, local acoustic analysis, and existing transcripts remain available |

Revised 8 October 2026 (D-21): evaluate filler-aware providers first, because filler review and pause measures need um/uh kept and word timings returned. Deepgram Nova-3 (`filler_words=true`, English) lists USD 0.0043/min for pre-recorded audio and AssemblyAI Universal-3.5 Pro (`disfluencies=true`) USD 0.21/hour, both checked on the providers' pages that day; their sign-up credits would cover the benchmark. Implement one adapter for the winner, keeping the trait extensible. The OpenAI options below remain later comparison candidates. As checked on 4 October 2026, the file-transcription guide recommends `gpt-transcribe`; `gpt-4o-mini-transcribe` is a lower-cost candidate. Evaluate `whisper-1` when word/segment timestamps are required; the documented timestamp-granularity parameter is specific to that model. General transcription quality, filler preservation, and timing quality must be measured independently. API transcription does not supply a validated mood, pronunciation, or intonation assessment. [S24]

The first implementation submits a complete saved take as verified, untrimmed 16 kHz mono PCM WAV. This avoids automatic live streaming and preserves original time coordinates. The documented file limit is 25 MB; enforce the current limit before submission and explain oversize files. Automatic chunking, multi-speaker diarization, other providers, and live transcription are later work. Selecting API does not force a local pack download or trigger an upload. [S24]

Use a `TranscriptionProvider` interface with validate_configuration, capabilities, test_connection, transcribe, and cancel. Local Whisper and the initial API adapter normalize into a versioned `TranscriptionResult`: source asset/hash, prepared audio hash, provider/model/engine, language, settings, raw text, optional segments/word timings, timing source and validity, request/run IDs, finish state, and available usage. Parameters follow each model's capability table; language hints and prompts are not assumed interchangeable. Store absent timings/confidence as `null` with a reason. Validate bounds, monotonicity, schema, and completeness before presenting results; silence or unusable output is explained rather than interpreted as flawless speech.

Audio preview approval is single-use and binds the prepared audio hash, included hints, exact provider configuration/model, and price version. Rust rechecks source identity and approval before sending; changes require a new preview. Cache by exact uploaded audio, hints, provider/model/settings, and adapter version. Reopening a screen uses saved results; explicit Retranscribe creates a new run and may cost money. Provider retirement prompts a new configuration and approval; it never silently swaps models.

### Coaching modes

| Mode | Where computation runs | Setup | Availability |
| --- | --- | --- | --- |
| API default | Selected provider or explicitly remote server | Personal key, supported adapter, model | New feedback requires its connection; saved results remain offline |
| Local LLM optional | User-managed endpoint on this computer | Tested local server and suitable model | Offline while runtime is available; no silent cloud fallback |
| Off | No LLM call | None | Playback, existing transcripts, selected transcription mode, rules, and manual feedback remain available |

Keep transcription and coaching settings independent. Switching LLM provider must not change the transcription mode/model or approve an audio upload. Start with one tested hosted coaching adapter and one tested local endpoint adapter. A configurable OpenAI-compatible protocol is useful, but providers differ in schemas, token limits, usage reporting, and supported parameters. Compatibility must be tested per provider and service purpose; do not advertise every API as interchangeable. Native provider adapters can be added without changing saved sessions. llama.cpp server is a candidate for the optional local coaching protocol. [S20]

OpenAI is the initial hosted coaching provider; the coaching model remains to be evaluated on correction tasks for meaning preservation, evidence grounding, latency, structured output, and cost. Keep provider/model IDs configurable so the app can survive model retirement. Do not hard-code a current best model or claim that a larger model provides accurate pronunciation assessment from a transcript.

### Coaching provider request and response contract

Use a CoachingProvider interface with validate_configuration, test_connection, generate_feedback, and cancel. Normalize provider responses into a versioned FeedbackResult. Required request fields are a request ID, transcript revision ID, selected text, prompt, focus, response budget, schema version, and explicitly selected comparison context. Required result fields include provider/model IDs, request ID where supplied, evidence spans, optional suggestions, finish state, and usage when available. Cache results by the exact redacted input, prompt/schema versions, provider, model, and generation settings.

Start with a context budget around 4,000 tokens and an output cap around 600 tokens, adjusted to the chosen model and provider. Do not send unlimited session history. Offer a visible excerpt choice when a task exceeds the budget. Prefer structured output where supported, then validate locally. Invalid JSON, a refusal, a truncated result, or nonexistent evidence spans must produce a clear incomplete or failed state, never a fabricated successful assessment. Automatic repair calls are off by default because they add cost.

Use a reused asynchronous reqwest client in Rust with TLS verification, bounded response size, timeouts, and cancellation. [S19] Require HTTPS for remote endpoints. Permit plain HTTP only for explicit loopback local mode. Bind a stored credential to its exact provider configuration and prevent cross-origin redirect forwarding. Endpoint changes require revalidation before the credential is used. No arbitrary browser-side fetch endpoint or transcript-specified URL is allowed.

Use proposed defaults of a 10-second connect timeout and 60-second request timeout, configurable in advanced settings. On 401/403, ask for configuration repair; on quota exhaustion, preserve manual mode; on rate limits, display the provider's retry guidance. A timeout after submission can have an uncertain billing outcome. Do not blindly repeat it. A local request ID prevents duplicate app jobs but does not guarantee provider-side idempotency; use an advertised idempotency feature only where supported. Retry is visible and may incur another charge. Cancellation stops local waiting but does not promise the provider stopped processing or billing.

### Data sent and credentials

The text coaching API payload contains only the selected transcript or redacted excerpt, task prompt, focus, and explicitly chosen context. It contains no audio. Unrelated notes, the phrase collection, and the full practice history stay local. Exact audio metrics need not leave the computer; if the user includes them, label their source and limitations. No web search, provider tools, remote file upload, or persistent provider conversation is needed for this text feedback workflow.

The separate API transcription request contains only the approved prepared audio and its previewed model/language/context options. Send the file directly to the transcription endpoint using native multipart transport, not a persistent Files API object or provider conversation. Local transcription and acoustic analysis send nothing. Audio submission does not authorize text coaching, additional audio analysis, or later retranscription. Uploaded speech itself may contain personal information; the preview must not describe the audio as anonymized merely because notes are excluded.

Store the personal API key in Windows Credential Manager through a narrow Rust interface; SQLite stores only the credential reference. CredWrite is the Windows facility for creating or updating a credential. [S18] Receive a new key once through the settings form, store it in native code, clear the field, and subsequently return only key-present status. Exclude keys from logs, crash reports, command lines, source code, frontend persistence, and backups. Removing a key removes the local credential but does not revoke it at the provider. Operating-system credential storage does not protect against all code running as the same user.

Bind credentials to a validated recipient and service purpose. The same OpenAI credential may be selected for both services only through explicit configuration; choosing coaching does not enable transcription. Endpoint or provider changes require revalidation and fresh credential association. The frontend sends trusted asset IDs and configuration references, never filesystem paths, upload bytes, or stored secrets.

Each service's review button and setup explanation disclose the recipient, payload type, and possible API billing. Provider processing and retention terms apply to transmitted audio or text; saving a result locally or deleting a local take does not establish provider deletion. OpenAI currently documents no training by default and no abuse-monitoring/application-state retention for `/v1/audio/transcriptions`; this is an endpoint-specific policy, not a blanket claim for all OpenAI services. Link current terms and recheck before enabling an adapter. An offline or failed request is never silently queued for dispatch on reconnection; the user explicitly requests it again. [S26]

### Local assets

Each installed Whisper pack needs an immutable ID, engine compatibility, language scope, exact byte size, checksum, source, license, and installation date. Download to a temporary file, verify it, then rename atomically; support trusted offline import. The optional external LLM runtime manages its own weights in version one. App backups preserve its nonsecret configuration, not a claim that its external runtime or weights are installed on a restored computer.

## 11 Measurement and feedback rules

The app must distinguish audio measurements, transcription estimates, model suggestions, and user judgments. It should be possible to inspect how a displayed value was produced. Store the model, configuration, transcript revision, and metric-definition version with each result.

| Observation | Definition or method | Display rule |
| --- | --- | --- |
| Recording duration | Saved sample count divided by actual sample rate | Measured value; exclude preparation time |
| Analysis interval | First to last detected speech, retaining interior gaps | Estimated boundaries; allow user adjustment |
| Estimated pace | Transcript word count / analysis-interval minutes | Show only with usable transcript and enough speech |
| Speaking-time pace | Transcript word count / VAD speech minutes | Advanced view only; distinct from overall pace |
| Pauses | VAD gaps inside analysis interval | Show duration and position; no automatic bad label |
| Candidate fillers | Reviewable transcript matches or separately validated audio detections | Never label as exhaustive or exact |
| Reviewed fillers per 100 words | Confirmed events / reviewed transcript words × 100 | Available only with adequate review coverage |
| Repeated wording | Repeated token sequences in the transcript | Candidate annotation; context may justify repetition |
| Sentence restarts | User-confirmed spans or qualified model suggestions | Do not claim robust acoustic detection in version one |
| Main point clarity | User/listener rating or text-based suggestion with evidence | Qualitative, tied to a quoted passage |
| Ease of speaking | User rating on a labeled 1–5 scale | Clearly marked self-report |
| Pronunciation | Playback and imitation comparison | No numeric pronunciation grade in this release |

For pause review, use a configurable initial threshold such as 700 milliseconds and store it with the analysis. This is a display threshold to evaluate, not a universal definition of problematic hesitation. Exclude leading and trailing silence, playback segments, and interrupted-device gaps from the relevant measures. Keep the raw recording duration available.

For short or poor recordings, return unavailable values with reasons. Suggested starting rules are at least 15 seconds of detected speech and at least 20 recognized words before displaying pace; these need usability testing. Speech recognition confidence scores are not calibrated human confidence percentages and should not be converted into misleading percentages.

Speech recognition may normalize repetitions or omit filled pauses. Therefore, counting "um" in the transcript cannot establish the actual filler count. The safe first-release experience is candidate review with replay and manual insertion of missed events. If the user reviews only candidates but not the entire take, label the result "confirmed candidates" rather than a complete rate. A dedicated disfluency model is a separate future project with its own annotation and evaluation dataset.

These rules apply to local and API transcripts. Capability support and better general text accuracy do not demonstrate filler recall or reliable word alignment. Keep each run's raw text and edits separate. Pauses, pitch, and energy are computed locally from the original audio regardless of ASR mode. Prosody milestone P adds an estimated pitch/energy contour and imitation comparison without scores or mood labels. Untimed API text allows audio contours and whole-take listening; per-word stress or timed filler playback requires separately verified alignment. Do not manufacture timestamps from word positions or confidence percentages from model log probabilities.

Use a maintained contextual lexicon for possible fillers, but do not flag every "like," "so," "well," or "you know" automatically. Quoted examples, discourse markers, and ordinary words require context. A candidate that came from a model is still a candidate until reviewed.

Text coaching receives the selected transcript or redacted excerpt, prompt, chosen focus, and only explicitly included precomputed metrics. It should return an optional main observation, quoted evidence spans, a small set of suggested rewrites, and one next exercise. It must not infer actual pace, pronunciation, accent quality, emotions, or a speech disorder from text.

Validate that evidence spans exist in the selected transcript. Preserve meaning in rewrites. Allow no suggestion when the evidence is weak. Feedback should say "Try opening with your main point" and show the relevant wording, rather than assign a personality judgment or announce that the user is a poor communicator.

Imported text and transcripts are untrusted model input. Delimit them as data, prohibit tool calls, and validate the output schema and referenced spans. The model never writes to the database or deletes recordings directly. Accepting a phrase or suggestion is an ordinary app action controlled by the user.

Record task familiarity, preparation allowance, audience, duration target, and follow-up conditions beside every learning observation. Use independent fields for user ease, listener comprehension, clarity checklist, and LLM suggestions. The rules-based scheduler can use user-confirmed task evidence; the API cannot decide a proficiency level or silently advance the curriculum.

## 12 Data model and local file organization

Use one SQLite database owned by the Rust layer. Enable foreign keys and versioned migrations. Use stable UUID identifiers. Store times in UTC with the relevant local timezone or offset for session dates and review scheduling. Treat audio files as immutable assets referenced by the database rather than large database blobs.

| Entity | Important fields | Relationship |
| --- | --- | --- |
| profiles | id, goal, interface_language, practice_language, timezone | One local profile initially |
| exercise_definitions | id, version, type, instructions, content_id | Historical sessions retain the used version |
| prompts | id, text, language, tags, source, favorite | Sessions reference or snapshot prompts |
| sessions | id, title, local_date, started_at, status, focus, notes | Contains steps and attempts |
| session_steps | id, session_id, exercise_version, order, status | Links the daily routine to exercises |
| attempts | id, step_id, repetition_group_id, ordinal, capture_state | Links a take to its recording |
| audio_assets | id, relative_path, sha256, bytes, sample_rate, channels, duration | Can be owned recording or imported reference |
| transcript_revisions | id, attempt_id, kind, text, parent_id, created_at | Raw, user-corrected, and suggested versions stay separate |
| transcript_segments | id, revision_id, nullable start_ms/end_ms, text, alignment_kind, unavailable_reason | Verified timing refers to original audio; untimed text is explicitly unaligned |
| analysis_runs | id, attempt_id, engine_version, provider_id, model_id, settings, state | Captures local or hosted provenance and failure information |
| task_conditions | attempt_id, familiarity, preparation, audience, challenge, follow_up | Separates difficulty from improvement |
| transfer_reviews | id, situation, date, listener_text, self_report, next_focus | Real conversation reflection; audio optional |
| progression_events | id, goal, previous_stage, next_stage, reason, user_choice | Records transparent recommendations and overrides |
| provider_configs | id, service_purpose, mode, protocol, endpoint, model, credential_ref, capabilities, version | Independent transcription/coaching configuration; nonsecret only |
| transcription_requests | id, attempt_id, source_asset_id, prepared_hash, hints_hash, provider_id, config_version, approved_preview_hash, state | Audio requests have their own approval and immutable input identity |
| coaching_requests | id, revision_id, redacted_input_hash, provider_id, state, schema | Tracks requests without duplicating full sensitive payloads in logs |
| usage_records | request_id, purpose, audio_duration, billing_units, tokens, price_version, reserved_cost, estimated_cost, charge_state | Shared ledger; reported, estimated, or unknown usage stays distinct |
| metric_values | run_id, definition_version, revision_id, key, value, unit, validity_reason | Values can be unavailable without becoming zero |
| annotations | id, attempt_id, span, source, category, review_state | Candidate, confirmed, dismissed, or manually added |
| feedback_items | id, run_id, evidence_span, suggestion, acceptance_state | Suggestions remain traceable |
| phrase_cards | id, source_revision_id, original, expression, examples, due_date | Optional link to a session |
| phrase_reviews | id, phrase_id, reviewed_at, rating, interval | Append-only learning history |
| model_packs | id, path, checksum, engine_compatibility, language, status | Installed and benchmarked local resources |
| jobs | id, kind, input_revision, state, attempts, error_code | Resumable work queue |
| backup_records | id, created_at, destination, manifest_hash, validation_status | Successful and failed backup attempts |

Add indexes on session date, attempt session links, phrase due date, annotation state, and job state. Use FTS5 for searchable transcript text, notes, prompts, and phrase content, with explicit index maintenance on edits and deletions. Search indexing is disposable and can be rebuilt from primary data. [S13]

Use the operating system's application-local data directory through the framework path API. Do not hard-code a username or assume the application installation folder is writable. Store database/app.sqlite, recordings grouped by stable asset ID, imported reference assets, model packs, cache, and recovery manifests in separate subdirectories.

Keep relative paths for assets within the app's data root. The app resolves paths from trusted IDs and validates traversal and symlink behavior. A user-supplied filename never becomes a shell command or an unrestricted filesystem path. Renaming a session changes its title, not its asset identifier.

File creation and database writes cannot be one filesystem transaction. Use an explicit staged protocol: reserve the asset ID, write and verify the temporary asset, atomically finalize the file on the same filesystem, and commit the reference. On startup, reconcile interrupted manifests, missing references, and orphaned finalized files. Keep recoverable files until the user has a chance to restore or discard them.

A changed transcript invalidates dependent text analyses. Keep old results attached to their original revision and offer Reanalyze. Do not silently overwrite historical results with a new model or algorithm. Progress views either filter to comparable versions or clearly identify a change.

A changed transcription provider/model, audio preparation, or context creates a new analysis run and raw transcript revision. Link metrics and corrections to their original run/revision. Preserve timing capabilities and prepared-to-original timeline mappings. Request and usage records share an operation identity across services so retries and cost reservations cannot be double-counted or collide.

A changed API provider, redaction, or prompt template similarly creates a new coaching run. Store the exact text used as a versioned local analysis artifact when needed for evidence alignment, with the same deletion and backup policy as transcripts; logs retain only hashes and IDs. Preserve redaction-to-source span mappings so evidence can be inspected without attaching a suggestion to the wrong words.

## 13 Backups portability and offline operation

Local storage makes information available without a service account, but it does not protect against drive failure. Build backup and restore into the first usable version. A backup includes a consistent database snapshot, referenced recordings, imported clips, curriculum overrides, and a manifest with schema version and checksums. Model weights and regenerable caches are excluded by default, with an optional self-contained export that includes installed packs when redistribution permits.

Include saved local/API transcripts, analysis provenance, API feedback, task conditions, transfer reviews, progression history, and usage records. Exclude API keys and authentication headers. Restored provider configurations show Credentials needed until a key is re-entered; never reuse an accidental credential reference belonging to a different configuration. Invalidate audio/text preview approvals and disable all pending API dispatch on restore. Deleting local material does not request deletion at a provider or remove older backups.

Use SQLite's online backup mechanism or another documented consistent snapshot operation. Do not copy only an active database file while ignoring its journal state. SQLite documents the backup API specifically for creating consistent backups of live databases. [S14]

During backup, establish a manifest of immutable referenced assets from the database snapshot, defer destructive asset cleanup, and copy those files. Mark success only after the snapshot and all required assets have passed validation. Save to a temporary archive and rename it when complete. If the target disappears or disk space is insufficient, retain the previous successful backup and report the failed attempt.

Offer weekly automatic backup when the app is open and a destination has been configured. If the date was missed while the app was closed, run it on the next launch. A closed-app scheduled service is outside the first-release scope. Keep a configurable number of backups, initially four weekly copies, and never delete the last valid backup before another is verified. Explain that a backup on a second device protects against a different set of failures than a copy on the same drive.

Restore first into a staging directory. Reject path traversal entries, unreasonable archive expansion, unsupported schema versions, and checksum mismatches. Verify database integrity and asset presence. Offer Restore as a separate profile or Replace current profile. Before replacement, create a backup of the current state and stop active recordings and analysis. Swap only after verification; retain rollback material until the restored app opens successfully.

Provide readable exports in addition to full backup: transcript and notes as Markdown or text, measurements as CSV, and original WAV audio. A complete session export can be a ZIP with these items and a JSON manifest. The app should not be the only software capable of reading a person's own practice information.

All normal app screens, curriculum, fonts, icons, recordings, saved local/API transcripts, and previously saved feedback must work without network access. Local transcription works with an installed pack. Fresh API transcription, API coaching, connection tests, and explicitly requested API follow-ups need a connection. Offer local transcription as an explicit offline choice when its pack is installed; never change modes automatically or dispatch uploads upon reconnection. Other permitted network use is model installation, optional update checks, and opening a chosen external link. No remote fonts, CDN assets, analytics, hidden inference, or automatic audio upload belong in the default workflow. The offline acceptance test covers local practice and saved material; it must not claim fresh API responses work offline.

Provide an installer path that works offline. On Windows, account for the WebView2 dependency; Tauri documents an offline installer option. Package size must distinguish the app, the WebView runtime when needed, and selected model packs. A small desktop shell does not imply a small full AI installation. [S15]

Keep user data across normal upgrades and uninstall by default, with an explicit separate removal option. Run migrations against a backed-up database and stop safely on migration failure. Pin the tested build and keep model compatibility separate from app version. Before distributing beyond personal use, decide how signed installers and updates will be produced and funded.

## 14 Privacy accessibility and error handling

Microphone access is active only during an explicit test or recording. Show its state in the studio and release the device on stop. Recording the user's practice is the default; capturing system audio or other participants requires a separate explicitly chosen feature.

Tauri capabilities help constrain frontend access to the application core. Scope file, dialog, shell, and opener permissions narrowly, and validate every custom command independently. Do not assume the capabilities system automatically validates application-specific inputs. Load packaged interface assets with a restrictive content security policy; open external links in the system browser. [S16]

Local does not mean encrypted. The base design uses operating-system account permissions and can benefit from the user's full-disk encryption. Do not promise protection from another process running as the same user. If application-level encryption is added later, it must cover audio and exports as well as the database, with a documented recovery and key-management design.

Keep logs free of transcript and audio content by default. Include job IDs, error categories, engine versions, and timing information. A diagnostic export should be reviewable before sharing and should clearly list any personal content included.

Redact authorization headers, provider error bodies that echo input, and URL secrets as well. Use request IDs and sanitized status codes for API diagnostics. Network inspection should verify that only the configured recipient receives the previewed payload and that model output cannot cause additional network requests.

| Condition | Required visible behavior | Recovery |
| --- | --- | --- |
| Microphone permission denied | Explain that capture is unavailable | Device or permission guidance; existing sessions remain accessible |
| Input device disappears | Stop capture and indicate interruption | Preserve chunks; choose another device for a new take |
| Silence or clipping | Offer a brief audio-quality notice | Replay, adjust input, or keep recording anyway |
| Disk becomes full | Report the failed save without claiming success | Preserve recoverable data; choose space to export or clear |
| Model missing or corrupt | Keep manual practice available | Import or reinstall a verified pack |
| Local inference process crashes | Mark analysis failed, keep audio saved | Retry once if appropriate, then offer manual action |
| API offline or quota exhausted | Fresh API transcription/feedback unavailable; saved material usable | Manual review or explicitly selected local transcription; no automatic upload later |
| API key rejected | Configuration needs attention | Replace key or select another configured provider |
| API timeout after submission | Result and possible charge are uncertain | Explicit retry with possible extra charge disclosed |
| API output invalid or refused | No fabricated transcript or successful coaching assessment shown | Inspect safe error, retry explicitly, or use manual review |
| API audio exceeds limit | Explain size limit before submission; no charge initiated | Keep audio; choose local transcription or a shorter take |
| API model lacks timing | Text and whole-take playback remain usable | Explain unavailable alignment; optionally request a verified local alignment job |
| App closes unexpectedly | Recovery entry appears on next launch | Recover valid chunks and interrupted jobs |
| Backup destination missing | Last valid backup remains listed | Choose a destination or retry later |
| Imported file unsupported | Explain supported formats before changing data | Convert externally or use a supported file |

Version one should guarantee PCM WAV import, with MP3 and other formats added only after the native decoding path is chosen and tested. Display format limits accurately. Avoid shipping an unexamined FFmpeg build; licensing and distribution obligations depend on how it is built.

Make all actions available by keyboard. Use visible focus, meaningful labels, proper dialog focus management, and screen-reader announcements for saved, failed, and recording states. Do not announce the timer every second. Provide an accessible alternative to waveform dragging, such as start and end time fields and skip controls.

Suggested shortcuts are Ctrl+K for search, Ctrl+Enter for the currently available record or stop action when the studio is focused, and Space for playback when focus is not in a text field or another control. Escape closes a panel but never silently discards a recording. Display shortcuts in menus and let users disable recording shortcuts.

Use WCAG 2.2 AA as a design target for the web-rendered interface. Validate the actual desktop app with a screen reader on the target operating system, including the native microphone and file dialogs. Preserve usability with enlarged text, reduced motion, and high-contrast settings.

## 15 Implementation modules and contracts

Organize the code around product features. Shared controls belong in a small design-system directory; exercise-specific behavior stays with its feature. Database, audio, and inference code should not be imported into React components.

| Module location | Responsibility |
| --- | --- |
| src/app | Routes, providers, shell, theme, global error boundary |
| src/components/ui | Chosen and customized shadcn controls |
| src/features/today | Daily plan and resume behavior |
| src/features/practice | Exercise flow, outline, recorder presentation |
| src/features/review | Transcript, evidence, playback, comparisons |
| src/features/sessions | Search, history, notes, exports |
| src/features/phrases | Phrase collection and recall practice |
| src/features/progress | Comparable metrics and listening reviews |
| src/features/settings | Audio, transcription, coaching, usage, data, appearance |
| src/lib/ipc | Typed native commands and event adapters |
| src-tauri/src/audio | Device access, buffers, capture, resampling |
| src-tauri/src/storage | Database, migrations, assets, recovery |
| src-tauri/src/inference | Shared transcription queue, local Whisper protocol, common result validation |
| src-tauri/src/transcription | TranscriptionProvider adapters, prepared audio preview, approved upload lifecycle |
| src-tauri/src/coaching | Text provider adapters, feedback contract, request lifecycle |
| src-tauri/src/providers | Shared validated HTTP transport, capability/configuration records, usage ledger and budget reservations |
| src-tauri/src/credentials | Native secret storage and provider binding |
| src-tauri/src/learning | Progression rules, task conditions, transfer evidence |
| src-tauri/src/backup | Snapshot, archive, restore, manifests |
| src-tauri/src/commands | Narrow application commands and validation |
| resources/content | Versioned prompts, guides, licensed clips |

The core commands should include list_input_devices, start_recording, stop_recording, list_sessions, get_session, create_transcript_revision, enqueue_analysis, cancel_analysis, preview_transcription_request, request_transcription, preview_coaching_request, request_coaching, test_provider, store_provider_key, remove_provider_key, save_transfer_review, choose_challenge, search_content, save_phrase, export_session, create_backup, and restore_backup_preview. The destructive restore commit is a separate command from preview. A generic analysis enqueue cannot bypass API preview approval.

The frontend sends identifiers and small validated values. The backend resolves paths and checks state. Every mutation that can be retried needs an idempotency key or an equivalent operation identity. A second Stop request must not create a duplicate asset or session.

| Command or event | Important contract |
| --- | --- |
| start_recording | attempt_id, device_id, idempotency_key; reject if another capture is active |
| stop_recording | attempt_id; resolves only after durable finalization or explicit failure |
| recording_level | attempt_id, monotonic timestamp, level, clipping flag; rate-limited |
| recording_saved | attempt_id, asset_id, duration_ms; emitted after commit |
| analysis_progress | job_id, stage, optional progress; never invent percent completion |
| analysis_completed | job_id, run_id, transcript_revision_id, available result kinds |
| create_transcript_revision | parent_revision_id and expected version; preserves source revision |
| preview_transcription_request | trusted saved asset ID and configuration; returns prepared-audio identity/playback ID, duration/size, hints, recipient/model, capabilities, price version, estimated cost, and preview hash; no stored key/path/audio array |
| request_transcription | approved preview hash, source/prepared hashes, provider config version, request ID; validate single-use approval, state, size, and shared budget before native upload |
| preview_coaching_request | selected revision and provider; returns exact text and estimated size, never a stored key |
| request_coaching | approved payload hash, provider config version, request ID; reject stale preview or changed endpoint |
| choose_challenge | task conditions and reason; preserve user override and prior evidence |
| create_backup | destination selected through native picker; returns verified manifest identity |

A feedback item should carry category, evidence segment IDs or offsets, suggested wording, explanation, and source type. A missing evidence span is a validation error for a claim about the user's wording. Keep schema versions in both saved artifacts and worker messages.

Use one SQLite writer owner or a clearly managed connection strategy with bounded transactions and a busy timeout. Offload audio, inference, and backup work from the UI thread. Avoid storing large binary payloads in UI state or sending complete audio arrays repeatedly through IPC. Serve playback assets through a scoped local asset mechanism based on trusted IDs.

## 16 Performance storage and operating cost

Use targets to guide implementation, then measure on the chosen reference computer. Suggested targets are an interactive home screen within two seconds of a warm launch, visible recording response within 200 milliseconds after a ready device is selected, and a search response within 250 milliseconds for a typical personal history. Report actual cold-start, device-open, and inference times separately.

Audio is likely to dominate personal-data storage. At 48,000 samples per second, 16 bits, and one channel, uncompressed PCM uses about 5.76 MB per minute in decimal units, excluding the small WAV header. Six recorded minutes per day use approximately 34.6 MB per day or 1.04 GB over 30 days. Thirteen fully recorded minutes per day would use about 2.25 GB per 30 days. Actual device rates and formats can change these values.

Show storage by category: recordings, reference clips, model packs, backups, and regenerable cache. Clearing cache is distinct from deleting recordings. Offer retention choices, but keep audio indefinitely by default until the user explicitly chooses a policy. If audio is deleted while notes remain, the history view must state that playback and reanalysis are unavailable.

Local Whisper has no per-minute hosted transcription charge. Optional API transcription and hosted LLM feedback are billed under the chosen provider's terms; a consumer chat subscription must not be assumed to include API usage. Exact costs depend on the model's billing units, audio duration, tokens, caching rules, and additional charges. Store dated prices rather than treating this document as a permanent quote.

For planning, current documented rates checked on 4 October 2026 are `gpt-transcribe` USD 0.0045/min, `gpt-4o-mini-transcribe` approximately USD 0.003/min, and `whisper-1` USD 0.006/min. One hour would therefore be approximately USD 0.27, 0.18, or 0.36 respectively, before text coaching, taxes, retries, or other charges. Mini's per-minute figure is an estimate for token-based billing; preserve actual billing categories. Use submitted audio duration, not the full practice-session timer, and recheck before implementation. [S25, S27] Deepgram and AssemblyAI rates (8 October 2026, see D-21) are about USD 0.26 and 0.21 per hour.

For token-priced models, estimate cost as input tokens times the input rate per million divided by one million, plus output tokens times the output rate per million divided by one million. Use the provider's actual billing categories when they differ. As a purely hypothetical example, 60 calls in a month at 2,000 input and 500 output tokens each would use 120,000 input and 30,000 output tokens. At invented example rates of USD 5 and USD 15 per million respectively, that is USD 1.05 before other charges. This illustrates arithmetic, not a quote or expected bill.

Allow monthly app-level warning and stop limits. The working extension of the confirmed coaching budget is one combined USD 5/month stop limit with a USD 4 warning for transcription plus coaching; it does not add a second allowance. This shared allocation is an engineering assumption recorded as D-22. Show subtotals by purpose. Atomically reserve a conservative amount for each in-flight call across both services, count explicit retries and tests, and reconcile reported usage afterward. Unknown usage after a timeout remains uncertain rather than zero. Stop new paid calls if the local budget cannot be evaluated reliably; permit a clear user override. Provider billing is authoritative: app limits cannot control other clients, retroactive price changes, or provider-side work after cancellation. Recommend provider-side spending controls where available.

Keep feedback to one request per reviewed attempt by default. Reuse saved transcription/feedback results when changing views or reopening a session; Retranscribe and Regenerate are deliberate new requests. A transcription model change does not automatically regenerate coaching. Show local storage separately from API use. Other costs remain the computer, storage, electricity, backup media, and maintenance. Benchmark the existing laptop before considering a hardware purchase.

## 17 Build sequence and release criteria

Build a vertical slice first: install, record, save, close, reopen, play, export, restore. This proves the central requirement before investing in coaching polish. Add AI only after the app can reliably preserve and recover recordings.

| Milestone | Deliverable | Exit criterion | Planning allowance |
| --- | --- | --- | --- |
| 0 Feasibility | Audio, Whisper, and selected API on target PC | Recover audio, compare transcription backends, verify one bounded API result and credentials | 3–5 working days |
| 0A Optional API transcription spike | Provider contract, model comparison, shared cost foundation | Approved saved-audio request; capabilities, cost, and failures checked | Additional 1–2 days |
| 1 Design and shell | Tokens, navigation, real empty states, typed contracts | All key screens navigable with sample data and keyboard | 3–5 days |
| 2 Durable practice | Recording, playback, sessions, migrations, backup and restore | Full offline manual session survives restart and restore | 6–10 days |
| 3 Review and local transcription | Worker, transcript revisions, evidence, measures | Failures preserve audio; timing and corrections remain traceable | 5–8 days |
| 3A Optional API transcription | Native adapter, audio approval, cache, shared budget, untimed review | Separate API enablement gate passes before any user-facing upload option | Additional 3–5 days |
| P Prosody | Local pitch/energy display and imitation overlay | Original timeline preserved; gaps shown; no grades/mood labels | Additional 4–6 days |
| 4 Full routine | Exercises, phrases, comparisons, progressive tasks, transfer reviews | Offline routine works and unfamiliar evidence stays separate | 7–10 days |
| 5 Coaching modes | One hosted adapter, one local endpoint adapter, shared usage and privacy UI | API is default; both modes pass the same feedback contract and fail safely | 6–10 days |
| 6 Release hardening | Installer, crash recovery, accessibility, performance | Release checklist passes on the supported system | 5–8 days |

The original milestones total roughly 35–56 working days for one experienced developer. The existing filler/prosody extension adds about 5–7 days, and optional API transcription adds a further 4–7 days, giving a revised allowance of about 44–70 working days. These are planning estimates, not a delivery promise; native audio, evaluation, and user testing can extend them. Once the core M0 gate passes, optional API transcription checks must not stall local durable practice. The checkbox tracker is authoritative for actual progress. Multi-platform release should be estimated separately.

The acceptance suite must cover real risks rather than only rendering components:

- Complete manual practice and local transcription with the network disabled, then reopen every take, saved API transcript, and saved feedback. Fresh API transcription/coaching must show unavailable without blocking practice.
- Kill the process during recording and verify recovery against the declared loss target.
- Force a worker crash and confirm the saved audio, notes, and next recording still work.
- Disconnect the microphone and simulate a full disk; confirm no false Saved message appears.
- Edit a transcript and verify that raw text and previous metrics remain tied to their original revisions.
- Verify timing after resampling and any VAD trimming, including gaps and the final segment.
- Export a backup, restore into an empty profile, and compare database records and asset checksums.
- Reject a corrupted archive, missing audio file, path traversal entry, and unsupported newer schema.
- Upgrade a populated earlier schema and recover safely from a failed migration.
- Check a packaged Windows installation without a developer runtime or internet connection.
- Inspect network activity: local recording, transcription, and prosody send nothing; API transcription sends only approved prepared audio and hints; API coaching sends only its previewed text to its configured recipient.
- Verify keys never appear in SQLite, logs, exports, frontend persistence, or backup archives.
- Exercise authentication failure, rate limits, quota exhaustion, malformed JSON, refusal, timeout, and cancellation; check saved audio and uncertain billing states.
- Switch transcription Local / API / Off independently of coaching API / Local LLM / Off; verify no silent fallback, automatic model download, or restored pending upload.
- Change provider or endpoint and verify the previous key is not forwarded.
- Verify cache reuse, explicit retranscription/regeneration, usage accounting, concurrent reservations against the combined budget, and unknown-price behavior.
- Verify a changed transcript or redaction invalidates the coaching preview and preserves old evidence.
- Verify selecting API, setting credentials, Stop, navigation, recovery, restore, and reconnection never upload audio; changed audio/hints/recipient/model/price invalidates an approved audio preview.
- Verify untimed API results support editing and whole-take playback without fabricated alignment; validate supported timings against the original timeline.
- Verify API audio limits, malformed/truncated results, cancellation, and retries preserve recordings and old revisions, disclose uncertain charges, and never silently forward credentials or switch models.
- Verify local prosody remains aligned with the original audio and absent voiced data appears as gaps; word-linked labels require tested alignment and never imply a mood or score.
- Verify unfamiliar first attempts, rehearsal, and real conversation feedback remain separate.
- Verify difficulty recommendations expose a reason, tolerate missing evidence, and accept user override.
- Complete the major flows using only the keyboard and a target-platform screen reader.

Evaluate transcription and feedback with a consented or properly licensed set of recordings that resembles actual use: spontaneous English, an appropriate range of accents, ordinary hesitations, quoted filler words, quiet and noisy rooms, and both good and weak microphones. A practical initial set is 30–50 short recordings, with manually checked text and selected audio boundaries. This supports a development decision, not a broad scientific claim.

Measure transcript errors, alignment error, candidate precision and missed events, invalid feedback outputs, unsupported suggestions, processing time, and peak memory. Review meaning preservation in rewrites. Do not set a universal word-error threshold before understanding its effect on the actual coaching tasks. Release individual features only when their limitations can be explained accurately.

## 18 Confirmed choices and remaining checks

The product direction is Windows 11, local Whisper by default, optional API audio transcription, hosted API text coaching, and optional local LLM coaching compatibility. Transcription and coaching are independently configurable. The laptop's CPU, RAM, GPU memory, driver, and free disk space have been recorded in `DEVELOPMENT_PLAN.md`. An existing local `ggml-large-v3-turbo-q5_0` pack is available for evaluation. Verify its provenance and benchmark it before selecting a default or deciding whether any additional one-time model download is useful.

Practice is English only for the first release, with German a possible later extension. The interface is English and uses `en-GB` dates. Prioritize explaining complex topics, debating, and teaching someone, with subject matter drawn from sport, economics, religion, crypto, programming, anime, and books. Backups stay local in a folder selected by the user; retain original recordings until the user deletes them.

OpenAI is the initial hosted coaching provider and proposed first transcription API adapter. Coaching and ASR models are chosen separately after quality/cost checks; §10 lists current ASR candidates. The confirmed coaching cap is USD 5/month; D-22 provisionally applies it to combined API usage with a USD 4 warning, keeping total allowance unchanged. These are app-level controls, not a guarantee about the provider account's total bill. Review current formats, prices, retention, and capability support at implementation. API credentials are entered only in the built app, never chat/source. Optional local LLM coaching requires no hardware commitment or installation for this user.

The immediate development task remains M0 0.10: derive verified inference audio, verify existing Whisper assets, and benchmark them, including filler retention. Real capture/recovery is implemented; see the tracker for verification and pending manual checks. The optional API spike adds a separately approved saved-audio comparison after credential/budget foundations. The durable-practice milestone must prove backup and restore. Before enabling API transcription, its M3 approval, budget, failure, and capability gate must pass. This specification describes required behavior; it does not claim that transcription, coaching, or prosody are already implemented.

## 19 Primary sources

Original technical documentation and model information were checked on 28 September 2026; API transcription sources S24–S27 were checked on 4 October 2026. Product behavior, visual tokens, schedules, and engineering targets in this plan are proposed design decisions. Pin exact tested releases and keep these source links in the project's decision record.

- S1 shadcn/ui documentation and components: https://ui.shadcn.com/docs and https://ui.shadcn.com/docs/components/radix/sidebar
- S2 Radix accessibility overview: https://www.radix-ui.com/primitives/docs/overview/accessibility
- S3 WaveSurfer documentation: https://wavesurfer.xyz/docs/
- S4 Recharts: https://recharts.github.io/en-US/
- S5 de Jong and Perfetti, Fluency Training in the ESL Classroom, 2011: https://doi.org/10.1111/j.1467-9922.2010.00620.x
- S6 Tauri architecture: https://v2.tauri.app/concept/architecture/
- S7 Tauri external binaries: https://v2.tauri.app/develop/sidecar/
- S8 Vite guide: https://vite.dev/guide/
- S9 Tailwind with Vite: https://tailwindcss.com/docs/installation/using-vite
- S10 TanStack Query overview: https://tanstack.com/query/latest/docs/framework/react/overview
- S11 CPAL repository and platform support: https://github.com/RustAudio/cpal
- S12 whisper.cpp documentation: https://github.com/ggml-org/whisper.cpp
- S13 SQLite FTS5: https://sqlite.org/fts5.html
- S14 SQLite backup API: https://sqlite.org/backup.html
- S15 Tauri Windows installer: https://v2.tauri.app/distribute/windows-installer/
- S16 Tauri capabilities: https://v2.tauri.app/security/capabilities/
- S17 rusqlite: https://github.com/rusqlite/rusqlite

- S18 Microsoft CredWriteW: https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credwritew
- S19 reqwest HTTP client: https://docs.rs/reqwest/latest/reqwest/
- S20 llama.cpp server and endpoint documentation: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- S21 Council of Europe qualitative aspects of spoken language: https://www.coe.int/en/web/common-european-framework-reference-languages/table-3-cefr-3.3-common-reference-levels-qualitative-aspects-of-spoken-language-use
- S22 Suzuki and Hanzawa, Massed task repetition is a double-edged sword for fluency development: https://doi.org/10.1017/S0272263121000358
- S23 ASUS product guide documenting Ryzen 7 3750H and GTX 1650 laptop configurations: https://www.asus.com/event/2019/productguide/in/ROG_Buyers_Guide_Q3_2019.pdf
- S24 OpenAI file transcription guide (models, upload limit, timestamps): https://developers.openai.com/api/docs/guides/speech-to-text
- S25 OpenAI API pricing: https://developers.openai.com/api/docs/pricing
- S26 OpenAI API data controls and endpoint retention: https://developers.openai.com/api/docs/guides/your-data
- S27 OpenAI Whisper API model and per-minute price: https://developers.openai.com/api/docs/models/whisper-1

The speaking exercises also draw on the practical recording and imitation guidance discussed in the preceding conversation: https://learnenglish.britishcouncil.org/level/improve-your-english-level/how-improve-your-english-speaking and https://www.britishcouncil.org/voices-magazine/ten-dos-ielts-speaking-test
