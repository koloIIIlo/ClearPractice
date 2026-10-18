/**
 * Exposure ladder templates (roadmap 12.2, appendix C.6): graded steps from
 * easy to hard to start a ladder from. You can edit, reorder and add steps.
 * IDs never change once shipped; the wording is reviewed before release.
 */
export type ExposureTemplate = { id: string; title: string; summary: string; steps: readonly string[] };

export const EXPOSURE_TEMPLATES: readonly ExposureTemplate[] = [
  {
    id: "meetings",
    title: "Meetings",
    summary: "From recording yourself alone to running a meeting.",
    steps: [
      "Record yourself alone and listen back.",
      "Send a voice message to a colleague.",
      "Say good morning and ask about someone's weekend.",
      "Ask one question in a team meeting.",
      "Give a one-minute update.",
      "Disagree politely with one point.",
      "Present for five minutes.",
      "Run a meeting.",
    ],
  },
  {
    id: "social",
    title: "Social situations",
    summary: "From ordering at a cafe to giving a short toast.",
    steps: [
      "Order at a cafe.",
      "Ask a shop assistant a question.",
      "Make small talk in a queue.",
      "Introduce yourself to someone at an event.",
      "Join a group conversation.",
      "Tell a story at dinner.",
      "Suggest a plan to a group.",
      "Give a short toast.",
    ],
  },
  {
    id: "presentations",
    title: "Presentations",
    summary: "From your phone camera to a talk at an event.",
    steps: [
      "Present to your phone camera.",
      "Present to one friend.",
      "Present to two or three people.",
      "Answer questions after a short talk.",
      "Present at a team meeting.",
      "Present to people you don't know.",
      "Present with a time limit.",
      "Give a talk at an event.",
    ],
  },
  {
    id: "phone",
    title: "Phone calls",
    summary: "From repeating a voicemail greeting to leading a call.",
    steps: [
      "Listen to a voicemail greeting and repeat it.",
      "Call a recorded information line.",
      "Call a shop with a simple question.",
      "Book an appointment by phone.",
      "Call a friend in English.",
      "Handle a call about a problem.",
      "Make a call with a stranger on speaker in a room.",
      "Lead a call with several people.",
    ],
  },
];

export const templateById = (id: string | null | undefined) => EXPOSURE_TEMPLATES.find((t) => t.id === id);
