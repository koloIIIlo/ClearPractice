/**
 * Guided programmes (roadmap 11.6, appendix C.8). Version 1 has the filler
 * programme: four weeks of habit reversal for filled pauses (awareness, a
 * competing response, generalising, the real world; Azrin & Nunn 1973,
 * Mancuso & Miltenberger 2016). Steps complete by themselves when their
 * detector sees matching practice since the week started; any step can be
 * marked done by hand. Nothing is ever failed.
 */
export type StepDetector =
  | { kind: "catch"; atLeast: number; newTakes?: boolean }
  | { kind: "reviewed"; atLeast: number }
  | { kind: "focus"; focus: string; familiarity: "familiar" | "unfamiliar"; minSpeechMs?: number; atLeast: number }
  | { kind: "drill"; type: "jam" | "roulette"; atLeast: number }
  | { kind: "reflections"; atLeast: number; nextFocus?: boolean };

export type ProgrammeStep = { id: string; week: number; title: string; how: string; detect: StepDetector | null; link?: { to: string; label: string } };
export type ProgrammeDef = { id: "fillers-4w"; title: string; summary: string; weeks: { week: number; theme: string; focus: string | null; steps: ProgrammeStep[] }[] };

/** The focus the programme sets from week 2 (one of the Studio's focuses). */
export const PAUSE_FOCUS = "Pause between ideas instead of filling the gap";

export const PROGRAMMES: readonly ProgrammeDef[] = [
  {
    id: "fillers-4w",
    title: "Fewer fillers, in four weeks",
    summary: "Notice your fillers, then pause instead, then take the pause into unfamiliar topics and real conversations. Take your time; the programme waits for you.",
    weeks: [
      {
        week: 1, theme: "Notice", focus: null,
        steps: [
          { id: "w1-catch-3", week: 1, title: "Catch it on 3 of your takes", how: "Play a reviewed take with the transcript hidden and press when you hear a filler.", detect: { kind: "catch", atLeast: 3 }, link: { to: "/catch-it", label: "Start" } },
          { id: "w1-review-3", week: 1, title: "Review the candidates in 3 takes", how: "Open a transcribed take and decide on each hesitation candidate.", detect: { kind: "reviewed", atLeast: 3 }, link: { to: "/sessions", label: "Open sessions" } },
          { id: "w1-note", week: 1, title: "Note when fillers come most", how: "For example: at the start of an answer, or when you search for a word. Mark it done when you have written it down.", detect: null },
        ],
      },
      {
        week: 2, theme: "Pause instead", focus: PAUSE_FOCUS,
        steps: [
          { id: "w2-pause-3", week: 2, title: "Three 60-second familiar answers, pausing instead of filling", how: "Record and repeat with the focus set to pausing between ideas.", detect: { kind: "focus", focus: PAUSE_FOCUS, familiarity: "familiar", minSpeechMs: 60_000, atLeast: 3 }, link: { to: "/practice/ex-repeat", label: "Record" } },
          { id: "w2-jam-2", week: 2, title: "Two Just a Minute rounds", how: "Pausing is allowed; only fillers, repeats and long gaps cost time.", detect: { kind: "drill", type: "jam", atLeast: 2 }, link: { to: "/drill/jam", label: "Play" } },
          { id: "w2-catch-1", week: 2, title: "Catch it on a new take", how: "Use a take from this week.", detect: { kind: "catch", atLeast: 1, newTakes: true }, link: { to: "/catch-it", label: "Start" } },
        ],
      },
      {
        week: 3, theme: "Take it further", focus: PAUSE_FOCUS,
        steps: [
          { id: "w3-unfamiliar-3", week: 3, title: "Three unfamiliar questions with the same focus", how: "Answer something new while pausing instead of filling.", detect: { kind: "focus", focus: PAUSE_FOCUS, familiarity: "unfamiliar", atLeast: 3 }, link: { to: "/exercises?tab=prompts", label: "Choose" } },
          { id: "w3-roulette-1", week: 3, title: "One round of topic roulette", how: "Spin, think for 10 seconds, speak.", detect: { kind: "drill", type: "roulette", atLeast: 1 }, link: { to: "/drill/roulette", label: "Play" } },
          { id: "w3-compare", week: 3, title: "Listen to a week-1 take against a week-3 take", how: "Use Compare takes to switch between them at the same point. Mark it done when you have listened.", detect: null, link: { to: "/compare", label: "Compare" } },
        ],
      },
      {
        week: 4, theme: "Real conversations", focus: PAUSE_FOCUS,
        steps: [
          { id: "w4-real-2", week: 4, title: "Two real conversations with the focus in mind", how: "Afterwards, note each one in Progress → Real conversations.", detect: { kind: "reflections", atLeast: 2 }, link: { to: "/progress?view=real", label: "Add a reflection" } },
          { id: "w4-aar", week: 4, title: "An after-action note", how: "In a reflection, write what to focus on next time.", detect: { kind: "reflections", atLeast: 1, nextFocus: true }, link: { to: "/progress?view=real", label: "Add a reflection" } },
          { id: "w4-reanswer", week: 4, title: "Answer week 1's first question again and compare", how: "Record it again, then listen to both. Mark it done when you have compared.", detect: null, link: { to: "/sessions", label: "Find it" } },
        ],
      },
    ],
  },
];

export const programmeById = (id: string) => PROGRAMMES.find((p) => p.id === id);

/** The focus of a running programme's week, with its reason; null in week 1, when finished or with none. */
export function weekFocus(run: { programme: string; week: number; completedAt: string | null; stoppedAt: string | null } | null | undefined): { text: string; reason: string } | null {
  if (!run || run.completedAt || run.stoppedAt) return null;
  const def = programmeById(run.programme);
  const week = def?.weeks.find((w) => w.week === run.week);
  return def && week?.focus ? { text: week.focus, reason: `Week ${week.week} of ${def.title.toLowerCase()}: ${week.theme.toLowerCase()}. Keep your own focus if you have one.` } : null;
}
