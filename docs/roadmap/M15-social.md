# M15: Social features (optional, private by default)

> **Goal:** practise with other people without a social network. Four features:
> - a buddy exchange with structured feedback;
> - a club mode for in-person or video-call speaking clubs;
> - challenge codes so friends can play the same drill;
> - a weekly accountability note.
>
> **What stays out:** feeds, public profiles, rankings and servers. Everything is a file, a code or clipboard text that you choose to share.
>
> **Why private by default:** announcing identity goals publicly can reduce follow-through (Gollwitzer et al. 2009). The app helps you share *what you did* with one person, not announce intentions.
>
> **What you'll see:**
> - buddy feedback presets in **Ask a listener**;
> - a **Club** screen;
> - **Share challenge** and **Enter a code**;
> - **Copy my week**.
>
> **Schema:** v24 (club meetings only). **Effort:** 6–9 days. **Needs:** M10 and M14.4.
>
> **Exit gate:**
> - every WP is done;
> - club mode works offline on a second screen (window or projector);
> - the challenge-code round trip is tested.

| WP | Title | Effort |
| --- | --- | --- |
| 15.1 | Buddy feedback presets | S |
| 15.2 | Club mode | L |
| 15.3 | Challenge codes | S |
| 15.4 | Copy my week | S |

**As built (18 Oct)**
- **Schema.** As below, plus `club_speeches.word_used` (null, 0 or 1: whether the speaker used the word of the day, your note). `counts` holds only the six counters (um, uh, so, like, you know, other), each 0 to 999, and zero counts are dropped. A speech is at most six hours. Saving an agenda keeps each speaker's result by id, and speakers you removed are deleted for good. A meeting is deleted softly.
- **15.1 Buddy feedback presets.** Ask a listener… gains a Questions select: Listener (the three default questions), Buddy feedback (two stars and a wish, with an optional fourth), Teacher check and Custom. Editing any question switches it to Custom. Nothing extra is stored: the preset is recognised from the pack's questions, and the answers are headed "Buddy feedback: Sam" or "Teacher check: Ms Lee". **Buddies** on Progress → Real conversations is derived only from imported answer files: one row per name (case and spaces ignored, unnamed files together as "Unnamed listener") with the number of answer files and the last import.
- **15.2 Club mode.** `/club` (lazy, not in the sidebar) from Exercises → Drills → **Club mode** and Ctrl+K → Run a club meeting.
  - **Setup:** title, word of the day, agenda rows (speaker, kind, window in seconds: prepared 5–7 min, table topic 1–2, evaluation 2–3, other none) and the consent note.
  - **Run view:** the light as a large block with the word, the time (Measured), Start, Stop and Next speaker. Then the Ah-counter (Your note; 1–6, Undo last), Word of the day used and Notes. For table topics, New topic from the roulette topics. Space, N and 1–6 work except while typing in a field. Each speaker is saved on Next speaker.
  - **Lights:** green at the minimum, amber at the window's midpoint and red at the maximum, in TypeScript (`src/lib/social/club.ts`) and Rust (`light_reached`) alike.
  - **Second window:** **Open timing light in a new window** opens a Tauri window labelled `club-light` at `#/club/light`, outside the app shell (`capabilities/club-light.json` grants it `core:default` only). The light's state goes to it with a Tauri event every 500 ms and on every change; the browser preview uses a BroadcastChannel and a pop-up.
  - **Summary:** a table (speaker, time, light reached, counts, word used). Copy as text copies the Markdown from `club_summary`, and Save as file… writes it as `<title> <date>.md` through the save dialog. The Markdown ends "Timed with ClearPractice. Nobody was recorded."
  - The browser preview has two sample meetings, one under way and one finished.
- **15.3 Challenge codes.**
  - **Format:** `CP1-<drill>-<seed>[-<options>]-<check>`. The drill is three letters (JAM, ROU, WBM, EMP, STC, PIT, GAU). The seed is eight Crockford base-32 characters: new plays now get such seeds. Options are a letter and an index into the bundled content, such as the topic, the speaking time or a re-spin. The check is two characters of CRC-10 over the rest.
  - **Reading a code:** O reads as 0, and I and L read as 1. A wrong check says "That code doesn't look right. Check the last two characters." An unknown version, drill or option says "This challenge needs a newer ClearPractice."
  - **Share challenge** at the end of a drill appears only when replaying the code gives the same plan, with your prompts and with the bundled ones. So a typed pitch idea or your own prompt hides it.
  - **Enter a code:** on the Drills tab and in Ctrl+K (`/exercises?tab=drills&code=1`), checked as you type. Play opens the drill with that seed and its options.
- **15.4 Copy my week.** A button in Progress's and Journey's headers opens a dialog with the exact note before anything is copied. The note gives practice days, minutes and takes (Measured), drills played with Just a Minute's best clean seconds (Estimated), and real conversations. A highlight is added only if you choose one: a reflection of the week, your own words, or none.
- **Not done here:** no new XP or achievements for M15. Club meetings are not practice sessions and don't count toward levels.

**Schema v24**
```sql
-- Club mode (15.2). Counts and times only; no recording of anyone. Names are what
-- you typed. User content, soft-deleted, in backups, not in session exports.
CREATE TABLE club_meetings (
 id TEXT PRIMARY KEY,
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 2 AND 120),
 local_date TEXT NOT NULL,
 word_of_the_day TEXT NOT NULL DEFAULT '',
 created_at_ms INTEGER NOT NULL,
 deleted_at_ms INTEGER
) STRICT;
CREATE TABLE club_speeches (
 id TEXT PRIMARY KEY,
 meeting_id TEXT NOT NULL REFERENCES club_meetings(id),
 position INTEGER NOT NULL CHECK(position > 0),
 speaker TEXT NOT NULL CHECK(length(trim(speaker)) BETWEEN 1 AND 60),
 kind TEXT NOT NULL CHECK(kind IN ('prepared','table_topic','evaluation','other')),
 target_min_seconds INTEGER, target_max_seconds INTEGER,
 seconds INTEGER CHECK(seconds >= 0),
 counts TEXT NOT NULL DEFAULT '{}',
 notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 2000),
 UNIQUE(meeting_id, position)
) STRICT;
PRAGMA user_version=24;
```

---

## 15.1 Buddy feedback presets

**Goal:** a practice buddy gives structured, kind feedback on your take. The format is the Toastmasters sandwich: commend, recommend, commend.

**Front end**
- `ListenerPackDialog` (14.4) gets a **Questions** preset `Select`:
  - **Listener (3 questions):** the default.
  - **Buddy feedback:**
    - "What did I do well?"
    - "One thing I could do better?"
    - "Another thing that worked?"
    - "Anything else?" (optional)
  - **Teacher check:**
    - "Any wording that sounded unnatural?"
    - "Any sounds that were hard to understand?"
    - "One thing to practise next?"
  - **Custom.**
- Imported answers show under the take with the preset's headings.
- A **Buddies** list (Progress → Real conversations → Buddies) shows the names from imported answers, with counts and the last date. It is derived, so there is no table.

**Tests:** `ListenerPackDialog.test.tsx`
- `it("fills the buddy preset and still allows edits")`
- `it("lists buddies from imported answers")`

---

## 15.2 Club mode

**Goal:** run a speaking-club meeting with the app as the Timer, Ah-counter and Table Topics master. It records **nobody**: only times, counts and your notes.

**Screens:** `/club` (lazy). Reach it from Exercises → Drills → **Club mode** and from Ctrl+K. It is not in the sidebar.

**Setup:**
- meeting title;
- word of the day;
- an agenda of speakers, each with a name, kind and time window (prepared speech 5–7 min, table topic 1–2 min, evaluation 2–3 min).

**Run:**
```
┌ Speaker 3 of 8 · Maria · Table topic (1:00–2:00) ─────────────────────────┐
│                         ┌──────────────────────────┐                       │
│                         │         GREEN            │  1:12                 │
│                         └──────────────────────────┘                       │
│ [Start] [Stop] [Next speaker]      [Open timing light in a new window]      │
├ Ah-counter (tap when you hear one) ────────────────────────────────────────┤
│ (um 2) (uh 1) (so 0) (like 3) (you know 0) (other 1)        [Undo last]    │
├ Notes / Grammarian ────────────────────────────────────────────────────────┤
│ Word of the day used: [✓]   Notes: …                                         │
└────────────────────────────────────────────────────────────────────────────┘
```

**Timing light:**
- The lights follow Toastmasters rules: green at the minimum, amber at the midpoint of the window, red at the maximum.
- The light is a large block with the colour **and** a word (GREEN, AMBER, RED), using the light tokens.
- **Open timing light in a new window** opens a Tauri window (`WebviewWindow`, label `club-light`) showing only the light and the time, for a projector or second screen. It needs a capability entry for the new window label.
- Keyboard:
  - **Space** starts and stops;
  - **N** moves to the next speaker;
  - number keys **1–6** tap the counters.

**Table topics:** **New topic** draws from `ROULETTE_TOPICS` (10.3) and shows it big.

**End:** a summary table (speaker, time, light reached, counts) with:
- **Copy as text**, using the clipboard;
- **Save as file…**, using the Rust save dialog to write `.md`.

**Consent:** a note on the setup page: "Ask speakers before counting their filler words. Nothing is recorded."

**Native:** `storage/social.rs` provides:
- `save_club_meeting`, `list_club_meetings`, `get_club_meeting`, `delete_club_meeting`;
- `save_club_speech`, called after each speaker;
- `export_club_summary(meeting_id) -> Option<String>`, which uses the save dialog.

**Tests**
- `club.test.ts`: `it("computes light thresholds from the time window")`
- `ClubPage.test.tsx`:
  - `it("runs speakers with keyboard shortcuts")`
  - `it("counts and undoes taps")`
  - `it("the light window shows colour and word")`
- Rust: `club_meetings_store_counts_only_and_soft_delete`
- net_guard: `club_mode_builds_no_http_client` (A-32)
- Manual: open the light window on a second monitor. **Observe:** it stays in sync while timing.

---

## 15.3 Challenge codes

**Goal:** a friend plays exactly the same drill, with the same topic, words or icons, by typing a short code. There is no server: the code carries the seed.

**Rules** (`src/lib/social/codes.ts`):
```ts
/** CP1-<drill>-<seed base32, 8 chars>-<check 2 chars>, e.g. CP1-JAM-7KX2M9QA-4F */
export function encodeChallenge(drillId: string, seed: string, params?: Record<string, string | number>): string
export function decodeChallenge(code: string): { drillId: string; seed: string; params: Record<string, string | number> } | null
```
- The check characters catch typos. Drill IDs use short aliases (JAM, ROU, WBM, EMP, STC, PIT, GAU).
- Params are limited to the drill's options (time, number of bombs), encoded compactly.
- A code from a newer content version that this app can't resolve says: "This challenge needs a newer ClearPractice."

**Front end:**
- Each drill result gets **Share challenge**, which copies "Try my Just a Minute challenge in ClearPractice: CP1-JAM-7KX2M9QA-4F".
- Drills tab → **Enter a code**: a dialog with an input that validates as you type. **Play** opens the drill with that seed.

**Tests:** `codes.test.ts`
- `it("round-trips every drill with params")`
- `it("rejects typos via the check characters")`
- `it("explains codes from a newer version")`

---

## 15.4 Copy my week

**Goal:** a short, private progress note for one accountability partner. It reports what you did, not what you intend.

**Front end:** Journey (Playful) and Progress (both styles) → **Copy my week**. It copies text like:
```
My speaking practice this week: 4 days, 38 minutes, 11 takes.
Played Just a Minute twice (best 52 clean seconds) and had 1 real conversation.
Highlight: "Explained my job to my neighbour without notes."
```
- **The highlight** is optional: you pick it in a small dialog from your reflections, or type one.
- **Never included:** audio, transcript text, or anything you didn't choose.

**Tests:** `week-note.test.ts`
- `it("summarises the week from events and facts")`
- `it("includes only the chosen highlight")`
