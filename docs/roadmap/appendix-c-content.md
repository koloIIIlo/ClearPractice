# Appendix C: Content to write

This appendix lists every new content file, how many items each needs, its rules, and examples that set the tone. Content is written during the milestone that uses it.

**Rules for every list**
- Content is reviewed by you before release.
- Each file has a content test (10.15).
- Content shown in a past session never changes meaning. To change it, add a new ID and bump `CURRICULUM_VERSION`.

**General rules**
- Plain, everyday English. No idioms in instructions.
- Topics suit adults and stay neutral. No prompts about health conditions, trauma or politics of specific parties.
- Lengths:
  - topics ≤ 80 characters;
  - prompts ≤ 160 characters;
  - instructions ≤ 200 characters.
- No score, grade or mood words (`offending()`).

---

## C.1 Drills (`src/content/drills.ts`)

| Exercise type | Title | Exercise ID | Minutes | Areas | Defaults | Needs transcript |
| --- | --- | --- | --- | --- | --- | --- |
| `jam` | Just a Minute | `ex-jam` | 2 | fluency, spontaneity | think 5, speak 60 | yes (full result) |
| `roulette` | Topic roulette | `ex-roulette` | 2 | spontaneity | think 10, speak 60 (30–120) | no |
| `word_bomb` | Word bomb | `ex-word-bomb` | 2 | vocabulary, spontaneity | speak 90, bombs 3 | yes |
| `three_ways` | Explain it three ways | `ex-three-ways` | 5 | structure, spontaneity | 3 rounds, open | no |
| `emphasis` | Emphasis game | `ex-emphasis` | 3 | voice | 7 rounds | no (audio only) |
| `pace_ladder` | Pace ladder | `ex-pace-ladder` | 3 | voice | 3 × 30 s | no (audio only) |
| `story_spine` | Story spine | `ex-story-spine` | 2 | storytelling | speak 90 | no |
| `story_cubes` | Story cubes | `ex-story-cubes` | 2 | storytelling, spontaneity | 4 icons, think 15, speak 90 | yes (icon matching) |
| `pitch` | Elevator pitch | `ex-pitch` | 3 | structure | 60/30/15 s | no |
| `steelman` | Steelman | `ex-steelman` | 3 | spontaneity, structure | 90 + 60 s | no |
| `daily` | Daily prompt | `ex-daily` | 2 | spontaneity | think 10, speak 60 | yes (full grid) |
| `gauntlet` | Gauntlet | `ex-gauntlet` | 5 | spontaneity, fluency | 5 rounds | no |
| `boss` | Boss levels | `ex-boss` | 5–8 | per boss | per boss | no |

---

## C.2 Topic and word lists

| File | Count | Notes | Examples |
| --- | --- | --- | --- |
| `jam-topics.ts` | 120 | concrete, familiar, broad enough for a minute | The best meal you've ever had · Why people keep houseplants · Your morning routine · A tool you couldn't live without · How to make a good cup of tea · The weather where you grew up · A skill everyone should learn · Your favourite way to travel · Why some people love running · What makes a good neighbour |
| `roulette-topics.ts` | 8 categories × 20 | categories: Daily life · Work · Opinions · Storytelling · Unexpected · Explanations · Hypotheticals · Memories | Hypotheticals: "If you could live in any decade, which would you choose?" · Unexpected: "Convince me that Monday is the best day of the week" · Memories: "A teacher you still remember" |
| `word-bomb-words.ts` | 200 | concrete nouns, singular plus plural, A2–B2 frequency | umbrella/umbrellas · bicycle · lighthouse · sandwich · ladder · passport · volcano · keyboard · candle · suitcase |
| `emphasis-sentences.ts` | 20 | 6–9 words; each target gives a clear meaning change, with a one-line meaning per target | "I didn't say she stole my money": I (someone else said it) · say (I implied it) · she (someone else stole it) · stole (she borrowed it) · my (someone else's money) · money (she stole something else) |
| `story.ts` seeds | 60 | situations that start stories | A lost key · The first day at a new job · A train that never came · A wrong turn on holiday · A surprising message · Cooking for guests for the first time |
| `story.ts` icons | 60 | lucide icon name plus 2–6 synonyms | `Key`: key, keys, lock, unlock · `Umbrella`: umbrella, rain · `Train`: train, station, platform · `Moon`: moon, night · `Dog`: dog, puppy · `Map`: map, directions |
| `daily-prompts.ts` | 365 | no repeats; balanced tags (no tag over 30%) | "Describe a smell that takes you back" · "Explain a rule of a game you know" · "What would you change about your street?" |
| `star-questions.ts` | 30 | behavioural interview questions | "Tell me about a time you disagreed with a colleague." · "Describe a project that didn't go to plan." · "Tell me about a time you had to learn something fast." |

---

## C.3 Bosses (`src/content/bosses.ts`)

| ID | Title | Rounds | Final self-check (Your note) | Recommended after | Partner mapping (13.6) |
| --- | --- | --- | --- | --- | --- |
| `job-interview` | Job interview | "Tell me about yourself" 90 s → 3 STAR questions × 120 s (STAR card) | "Would you hire yourself on these answers?" | Structure 3 | `job-interview` · interviewer · pressure 2 |
| `skeptical-qa` | Sceptical Q&A | Your claim 60 s → 3 sceptical questions × 60 s | "Did you answer the question that was asked?" | Spontaneity 3 | `qa-panel` style · skeptic · pressure 2 |
| `toast` | Wedding toast | 90 s with cards: who you are · a story · a wish · raise a glass | "Would the couple smile at your story?" | Storytelling 3 | `toast` (a friendly guest asks one question afterwards) · friendly · pressure 1 |
| `meeting` | Meeting update, interrupted | 60 s update; interruption card at 40 s; answer 30 s | "Did you get back to your point after the interruption?" | Courage 3 | `meeting-update` · neutral · pressure 3 |

---

## C.4 Scenarios and personas (`src/content/scenarios.ts`)

| ID | Title | Partner role | Your goal | Opening line | Turns | Area |
| --- | --- | --- | --- | --- | --- | --- |
| `job-interview` | Job interview | A hiring manager at a software company | Show your experience with clear examples | "Thanks for coming in. To start, could you walk me through your background?" | 8 | structure |
| `small-talk` | Small talk at a meetup | Someone you just met at a tech meetup | Keep a friendly conversation going and ask questions back | "Hi! First time at one of these? What brings you here?" | 6 | courage |
| `meeting-update` | Meeting status update | Your team lead | Give a clear update and handle questions | "Okay, can you give us a quick update on your part?" | 5 | structure |
| `negotiate-deadline` | Negotiating a deadline | Your manager | Ask for more time with good reasons | "I hear you wanted to talk about the release date?" | 6 | spontaneity |
| `complaint-call` | Customer complaint call | A frustrated customer | Calm things down and agree on next steps | "Hello, I've been waiting two weeks for my order and nobody's answering my emails." | 6 | courage |
| `explain-mistake` | Explaining a mistake | Your manager | Explain what went wrong, own it and propose a fix | "So, what happened with the report yesterday?" | 6 | structure |
| `doctor` | Doctor's appointment | A GP | Describe a minor problem clearly and ask questions | "Good morning, what brings you in today?" | 6 | vocabulary |
| `pitch-friend` | Pitching an idea to a friend | A curious but sceptical friend | Explain an idea simply and answer doubts | "So what's this idea you keep talking about?" | 6 | spontaneity |

**Scripted lines.** Each scenario needs at least 6 scripted lines for the offline partner, written as natural follow-ups. For example, for `small-talk`:
- "Oh nice, how long have you been doing that?"
- "What do you like most about it?"
- "Have you been to the cafe on the corner? I hear it's good."
- …

**Personas**

| ID | Title | Style (sent to the model) | Voice hint |
| --- | --- | --- | --- |
| `friendly` | Friendly | warm, encouraging, patient; asks open questions | any |
| `neutral` | Neutral | polite and professional; asks direct questions | any |
| `skeptic` | Sceptical | polite but doubtful; asks for evidence and examples | lower |
| `newcomer` | Newcomer | curious, knows little about the topic; asks basic questions | higher |
| `expert` | Expert | knowledgeable; asks precise, technical questions | lower |
| `interviewer` | Interviewer | formal and structured; follows up on vague answers | any |

---

## C.5 Missions (`src/content/missions.ts`): 40

Difficulty runs from 1 (easy) to 3 (hard).

| # | Mission | Area | Difficulty |
| --- | --- | --- | --- |
| 1 | Ask one question in a meeting | courage | 1 |
| 2 | Say good morning to someone new and ask how their week is going | courage | 1 |
| 3 | Order at a cafe and ask one question about the menu | vocabulary | 1 |
| 4 | Leave a 30-second voice message for a friend | courage | 1 |
| 5 | Use one saved phrase in a real conversation | vocabulary | 1 |
| 6 | Explain how to get to your home to someone | structure | 1 |
| 7 | Tell someone about a film or book you liked, in one minute | storytelling | 1 |
| 8 | Ask a colleague what they're working on, and one follow-up question | spontaneity | 1 |
| 9 | Give a compliment with a reason ("I liked … because …") | structure | 1 |
| 10 | Call a shop or office instead of emailing | courage | 2 |
| 11 | Tell a one-minute story at dinner | storytelling | 2 |
| 12 | Explain your job to someone outside your field | structure | 2 |
| 13 | Summarise a meeting's decision in two sentences for someone who missed it | structure | 2 |
| 14 | Ask for help with something, and explain what you've tried | spontaneity | 2 |
| 15 | Give a one-minute update without notes | fluency | 2 |
| 16 | Answer a question you didn't expect without saying "um" at the start | fluency | 2 |
| 17 | Disagree politely with one point | spontaneity | 2 |
| 18 | Teach someone a small skill in three steps | structure | 2 |
| 19 | Tell a story with one concrete detail (a name, a place, a sound) | storytelling | 2 |
| 20 | Ask a stranger for a recommendation | courage | 2 |
| 21 | Join a conversation that has already started | courage | 3 |
| 22 | Present something for five minutes | courage | 3 |
| 23 | Speak first in a meeting | courage | 3 |
| 24 | Give feedback to someone: one thing that worked, one to change | structure | 3 |
| 25 | Handle a phone call in English from start to finish | spontaneity | 3 |
| 26 | Negotiate something small (a price, a date, a task) | spontaneity | 3 |
| 27 | Tell a story that makes someone laugh | storytelling | 3 |
| 28 | Answer three follow-up questions about your work | spontaneity | 3 |
| 29 | Explain a mistake you made, and what you'll do differently | structure | 3 |
| 30 | Run a short meeting or call | courage | 3 |
| 31 | Ask "What was my main point?" after you explain something | structure | 2 |
| 32 | Pause for two seconds before answering a hard question | fluency | 1 |
| 33 | Use "in other words" to rephrase when someone looks confused | vocabulary | 2 |
| 34 | Describe your weekend in four sentences: what, where, who, best moment | storytelling | 1 |
| 35 | Ask someone to repeat or explain a word you didn't know | courage | 1 |
| 36 | Make small talk while waiting in a queue | courage | 2 |
| 37 | Explain a news story you read, in one minute | structure | 2 |
| 38 | Recommend a place with three reasons | structure | 1 |
| 39 | Tell a colleague about a problem and suggest two options | spontaneity | 2 |
| 40 | Thank someone and say specifically what helped | vocabulary | 1 |

---

## C.6 Exposure ladder templates (`src/content/exposure-templates.ts`)

**Meetings**
1. Record yourself alone and listen back.
2. Send a voice message to a colleague.
3. Say good morning and ask about someone's weekend.
4. Ask one question in a team meeting.
5. Give a one-minute update.
6. Disagree politely with one point.
7. Present for five minutes.
8. Run a meeting.

**Social situations**
1. Order at a cafe.
2. Ask a shop assistant a question.
3. Make small talk in a queue.
4. Introduce yourself to someone at an event.
5. Join a group conversation.
6. Tell a story at dinner.
7. Suggest a plan to a group.
8. Give a short toast.

**Presentations**
1. Present to your phone camera.
2. Present to one friend.
3. Present to two or three people.
4. Answer questions after a short talk.
5. Present at a team meeting.
6. Present to people you don't know.
7. Present with a time limit.
8. Give a talk at an event.

**Phone calls**
1. Listen to a voicemail greeting and repeat it.
2. Call a recorded information line.
3. Call a shop with a simple question.
4. Book an appointment by phone.
5. Call a friend in English.
6. Handle a call about a problem.
7. Make a call with a stranger on speaker in a room.
8. Lead a call with several people.

---

## C.7 Routine steps (`src/content/routine.ts`)

The step texts are given in 12.3. The breathing cue timings are inhale 2 s, second inhale 1 s, exhale 6 s, five rounds. Tongue twisters (10, one per run):
- "Red lorry, yellow lorry."
- "She sells seashells by the seashore."
- "Unique New York."
- "A proper copper coffee pot."
- …

---

## C.8 Programmes (`src/content/programmes.ts`): filler programme `fillers-4w`

The weeks are given in 11.6.

**Step IDs**

| Week | Step IDs |
| --- | --- |
| 1 | `w1-catch-3`, `w1-review-3`, `w1-note` |
| 2 | `w2-pause-3`, `w2-jam-2`, `w2-catch-1` |
| 3 | `w3-unfamiliar-3`, `w3-roulette-1`, `w3-compare` |
| 4 | `w4-real-2`, `w4-aar`, `w4-reanswer` |

**Detectors.** Each step has a detector, or `null` when you tick it yourself:
- `w1-note` and `w3-compare` are ticked by you.
- `w3-compare` is also detected when a comparison is saved.

---

## C.9 Monthly themes (`src/content/monthly-themes.ts`)

| Month | Theme | Area |
| --- | --- | --- |
| January | Clear openings | structure |
| February | Stories | storytelling |
| March | Thinking on your feet | spontaneity |
| April | Your voice | voice |
| May | Real conversations | courage |
| June | Better phrases | vocabulary |
| July | Listening and copying | listening |
| August | Steady flow | fluency |
| September | Back to structure | structure |
| October | Storytelling month | storytelling |
| November | Under pressure | spontaneity |
| December | Looking back (capsules, best moments) | courage |

---

## C.10 Talk templates (`src/content/talk-templates.ts`)

The section lists are given in 14.3. Default targets for a 5-minute talk:

| Template | Section targets |
| --- | --- |
| Classic | 0:30 · 1:20 · 1:20 · 1:20 · 0:30 |
| Story | 0:45 · 1:30 · 1:45 · 1:00 |
| STAR answer (2 min) | 0:20 · 0:15 · 1:05 · 0:20 |
| Pitch (2 min) | 0:30 · 0:45 · 0:20 · 0:25 |
| Toast (90 s) | 0:15 · 0:45 · 0:20 · 0:10 |
| Update (2 min) | 0:50 · 0:40 · 0:30 |

---

## C.11 First-language tips (`src/content/first-language-tips.ts`, 16.4)

**Structure:** `{ language: string; tips: { id, title, explanation, example, practise: PractiseLink }[] }`, with 6–10 tips per language.

**Languages for the first pass:** Russian, Ukrainian, German, Spanish, Portuguese, French, Italian, Polish, Turkish, Arabic, Hindi, Mandarin.

**Each language is reviewed by a knowledgeable speaker before shipping.**

Example, Russian, written to show the shape only and still to be reviewed:
- "Articles: English uses *a* and *the* where Russian uses none. Try: *I bought **a** book. **The** book is about…*"
- "Yes/no questions often rise at the end in English: *Are you coming?* ↗"

---

## C.12 What's new (`src/content/whats-new.ts`, 16.7)

```ts
export const WHATS_NEW: { version: string; date: string; items: { title: string; detail: string; link?: string }[] }[]
```

Each version has 3–6 items, written in the user-facing voice of appendix D.
