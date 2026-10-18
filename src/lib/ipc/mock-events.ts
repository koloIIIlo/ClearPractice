/**
 * The browser preview's real-world practice (roadmap M14): missions, events
 * with their plans, talks and rehearsal reports, the time capsule and listener
 * packs, in memory. Plans tick themselves from the preview's own practice, as
 * in the desktop app. A browser can't save a pack as a file, so saving one
 * records it as if saved, and Import listener answers adds a sample listener's
 * answers to the newest pack (a second import is the same file again).
 */
import { capsuleShows, type CapsuleMonth } from "@/lib/capsule";
import { buildEventPlan } from "@/lib/events/plan";
import { addLocalDays, toLocalDate } from "@/lib/phrase-schedule";
import { talkTemplate } from "@/content/talk-templates";
import { IpcError, type IpcClient } from "./client";
import * as S from "./schemas";
import * as R from "./schemas-real-world";

type Methods =
  | "pickMission" | "getMissionPick" | "clearMission" | "saveEvent" | "saveEventPlan" | "setPlanItemDone" | "linkEventTalk" | "getEvent" | "listEvents"
  | "deleteEvent" | "saveTalk" | "getTalk" | "listTalks" | "deleteTalk" | "recordRehearsal" | "rehearsalReport" | "listRehearsals" | "capsuleOffer"
  | "dismissCapsule" | "exportListenerPack" | "importListenerAnswers" | "listListenerPacks" | "listListenerFeedback" | "setListenerJudgement";

export type MockEventsHost = {
  sessions: S.SessionDetail[];
  trashed(sessionId: string): boolean;
  award(kind: string, refId: string, localDate: string, ids?: { sessionId?: string; attemptId?: string }): number | null;
  takeEvents(attemptId: string): S.TakeEvent[];
  transferReviews(): S.TransferReview[];
  routineRuns(): S.RoutineRun[];
  /** The partner's conversations (not in Trash). */
  conversations(): Promise<S.FactConversation[]>;
  /** A take's current transcript text, when it has one. */
  takeText(attemptId: string): string | null;
};

type EventRow = S.PlannedEvent & { deleted: boolean };
type ItemRow = S.EventPlanItem & { eventId: string };
type SectionRow = S.TalkSection & { deleted: boolean };
type TalkRow = { talk: S.Talk; sections: SectionRow[]; deleted: boolean };
type Rehearsal = { attemptId: string; talkId: string; createdAt: string; sections: { id: string; title: string; targetSeconds: number }[] };
type PackRow = Omit<S.ListenerPack, "answerFiles">;
type FeedbackRow = Omit<S.ListenerFeedback, "sessionId" | "attemptId" | "answers"> & { answers: string[] };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[a-z0-9_-]{1,64}$/;
const MIN_PACE_MS = 5_000;
const NO_MARKS = "No section marks were saved, so the whole take counts as section 1.";
/** The preview's sample listener answers, by question. */
const SAMPLE_ANSWERS = [
  "That the release should wait two weeks so the tests can catch up.",
  "I got a little lost when you talked about the second team.",
  "The example about the login bug helped me follow.",
];

const invalid = (message: string) => new IpcError("invalid", message);
const oneLine = (text: string) => text.split(/\s+/).filter(Boolean).join(" ");
const hasControl = (text: string) => [...text].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

export function createMockEvents(host: MockEventsHost): {
  methods: Pick<IpcClient, Methods>;
  /** Checks a reflection's mission and event before it is saved; returns the mission's week. */
  checkReview(input: S.TransferInput): string | null;
  /** After the reflection is saved: the mission's week is done, with XP for the mission and the event's first debrief. */
  logReview(review: S.TransferReview, week: string | null): void;
  facts(): Pick<S.PracticeFacts, "events" | "listenerAnswers" | "missionPicks">;
} {
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${Date.now()}-${++seq}`;
  const now = () => new Date().toISOString();
  const today = () => toLocalDate(new Date());

  // ── Missions (14.1) ──
  const picks = new Map<string, S.MissionPick>();

  // ── Events (14.2) and talks (14.3) ──
  const events: EventRow[] = [];
  const items: ItemRow[] = [];
  const talks: TalkRow[] = [];
  const rehearsals: Rehearsal[] = [];
  const liveEvent = (id: string) => {
    const event = events.find((e) => e.id === id && !e.deleted);
    if (!event) throw new IpcError("not_found", "This event no longer exists.");
    return event;
  };
  const liveTalk = (id: string) => {
    const talk = talks.find((t) => t.talk.id === id && !t.deleted);
    if (!talk) throw new IpcError("not_found", "This talk no longer exists.");
    return talk;
  };
  const takeOf = (attemptId: string) => {
    for (const session of host.sessions) {
      if (host.trashed(session.id)) continue;
      const attempt = session.attempts.find((a) => a.id === attemptId);
      if (attempt) return { session, attempt };
    }
    return null;
  };
  const strip = ({ deleted: _, ...e }: EventRow): S.PlannedEvent => R.PlannedEvent.parse(structuredClone(e));

  /** Ticks the items whose work has appeared, each piece of work used once, in plan order. */
  const refresh = async (event: EventRow) => {
    const list = items.filter((i) => i.eventId === event.id).sort((a, b) => a.position - b.position);
    const used = new Set(list.flatMap((i) => (i.refId ? [i.refId] : [])));
    const conversations = await host.conversations();
    for (const item of list) {
      if (item.doneAt || item.byHand) continue;
      let candidates: string[] = [];
      switch (item.kind) {
        case "outline":
          candidates = event.talkId && talks.some((t) => t.talk.id === event.talkId && !t.deleted && t.sections.some((s) => !s.deleted)) ? [event.talkId] : [];
          break;
        case "run_through":
        case "dress_rehearsal":
          candidates = rehearsals
            .filter((r) => r.talkId === event.talkId)
            .flatMap((r) => {
              const take = takeOf(r.attemptId);
              return take && take.session.localDate >= item.localDate ? [{ id: r.attemptId, day: take.session.localDate, at: r.createdAt }] : [];
            })
            .sort((a, b) => a.day.localeCompare(b.day) || a.at.localeCompare(b.at))
            .map((r) => r.id);
          break;
        case "qa_drill":
          candidates = [
            ...conversations.filter((c) => c.scenarioId === "qa-panel" && c.localDate >= item.localDate).map((c) => ({ id: c.id, day: c.localDate })),
            ...host.sessions.filter((s) => s.exerciseType === "boss" && s.attemptCount > 0 && !host.trashed(s.id) && s.localDate >= item.localDate).map((s) => ({ id: s.id, day: s.localDate })),
          ]
            .sort((a, b) => a.day.localeCompare(b.day))
            .map((c) => c.id);
          break;
        case "mock":
          candidates = conversations.filter((c) => c.scenarioId !== "qa-panel" && c.localDate >= item.localDate).map((c) => c.id);
          break;
        case "routine":
          candidates = host.routineRuns().filter((r) => r.eventId === event.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((r) => r.id);
          break;
        case "debrief":
          candidates = host.transferReviews().filter((r) => r.kind === "aar" && r.extra?.eventId === event.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((r) => r.id);
          break;
      }
      const found = candidates.find((c) => !used.has(c));
      if (found) {
        item.doneAt = now();
        item.refId = found;
        used.add(found);
      }
    }
  };
  const debriefDone = (eventId: string) => host.transferReviews().some((r) => r.kind === "aar" && r.extra?.eventId === eventId);
  const view = async (event: EventRow): Promise<S.EventView> => {
    await refresh(event);
    const list = items.filter((i) => i.eventId === event.id).sort((a, b) => a.position - b.position).map(({ eventId: _, ...item }) => item);
    return R.EventView.parse(structuredClone({ event: strip(event), items: list, debriefDone: debriefDone(event.id) }));
  };
  const cleanEvent = (input: S.EventInput) => {
    const title = oneLine(input.title);
    if (title.length < 2 || title.length > 120) throw invalid("Give the event a title of 2 to 120 characters.");
    if (!S.RealEventKind.options.includes(input.kind)) throw invalid("Choose the kind of event from the list.");
    if (!DAY.test(input.localDate)) throw invalid("Choose a day.");
    if (input.startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.startTime)) throw invalid("Choose a time like 14:30.");
    if (input.minutes != null && (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 480)) throw invalid("Choose a length of 1 to 480 minutes.");
    const audience = oneLine(input.audience);
    const goal = oneLine(input.goal);
    if (audience.length > 200) throw invalid("Keep the audience under 200 characters.");
    if (goal.length > 500) throw invalid("Keep the goal under 500 characters.");
    return { title, kind: input.kind, localDate: input.localDate, startTime: input.startTime || null, minutes: input.minutes ?? null, audience, goal };
  };
  const savePlan = (eventId: string, inputs: S.EventPlanItemInput[]) => {
    if (inputs.length > 20) throw invalid("A plan has at most 20 items.");
    const cleaned = inputs.map((i) => {
      if (!DAY.test(i.localDate)) throw invalid("Choose a day.");
      if (!S.EventItemKind.options.includes(i.kind)) throw invalid("Choose each item's kind from the list.");
      const title = oneLine(i.title);
      if (!title || title.length > 120) throw invalid("Give each item a short title.");
      return { localDate: i.localDate, kind: i.kind, title };
    });
    const done = items.filter((i) => i.eventId === eventId && i.doneAt);
    if (done.length + cleaned.length > 20) throw invalid("A plan has at most 20 items.");
    for (let at = items.length - 1; at >= 0; at -= 1) if (items[at].eventId === eventId && !items[at].doneAt) items.splice(at, 1);
    // By day; a done item comes first on its day, so it keeps its place.
    const order = [...done.map((item) => ({ day: item.localDate, item, input: null })), ...cleaned.map((input) => ({ day: input.localDate, item: null, input }))]
      .map((x, i) => ({ ...x, i }))
      .sort((a, b) => a.day.localeCompare(b.day) || Number(!!a.input) - Number(!!b.input) || a.i - b.i);
    order.forEach((x, n) => {
      if (x.item) x.item.position = n + 1;
      else items.push({ id: nextId("item"), eventId, position: n + 1, ...x.input!, doneAt: null, refId: null, byHand: false });
    });
  };

  // ── Rehearsal reports (14.3) ──
  const report = (r: Rehearsal): S.RehearsalReport => {
    const take = takeOf(r.attemptId);
    if (!take) throw new IpcError("not_found", "This rehearsal is unavailable.");
    const end = take.attempt.durationMs;
    const starts: (number | null)[] = r.sections.map((_, i) => (i === 0 ? 0 : null));
    let marked = false;
    for (const mark of host.takeEvents(r.attemptId).filter((m) => m.kind === "section_mark")) {
      const index = r.sections.findIndex((s) => s.id === mark.data.sectionId);
      if (index > 0 && starts[index] === null) {
        starts[index] = Math.min(mark.atMs, end);
        marked = true;
      }
    }
    const order = starts.flatMap((s, i) => (s === null ? [] : [{ start: s, i }])).sort((a, b) => a.start - b.start || a.i - b.i);
    const spans = new Map(order.map((o, k) => [o.i, { start: o.start, stop: Math.max(o.start, order[k + 1]?.start ?? end) }]));
    // The preview has no transcript of a simulated take: sample numbers, about two words a second.
    const sections = r.sections.map((s, i) => {
      const span = spans.get(i);
      const actualMs = span ? span.stop - span.start : 0;
      const words = Math.round((actualMs / 1000) * 2.1);
      return {
        sectionId: s.id, title: s.title, targetSeconds: s.targetSeconds, reached: !!span, actualMs, words,
        paceWpm: actualMs >= MIN_PACE_MS ? Math.round((words * 60_000) / actualMs) : null, hesitations: actualMs >= 20_000 ? 1 : 0,
      };
    });
    return R.RehearsalReport.parse({
      attemptId: r.attemptId, talkId: r.talkId, sessionId: take.session.id, localDate: take.session.localDate, createdAt: r.createdAt, sections,
      totalTargetSeconds: r.sections.reduce((n, s) => n + s.targetSeconds, 0), totalActualMs: sections.reduce((n, s) => n + s.actualMs, 0),
      note: !marked && r.sections.length > 1 ? NO_MARKS : null, transcribed: true,
    });
  };
  const talkView = (row: TalkRow): S.TalkView => {
    const sections = row.sections.filter((s) => !s.deleted).sort((a, b) => a.position - b.position).map(({ deleted: _, ...s }) => s);
    return R.TalkView.parse(structuredClone({
      talk: row.talk, sections, targetSeconds: sections.reduce((n, s) => n + s.targetSeconds, 0),
      rehearsals: rehearsals.filter((r) => r.talkId === row.talk.id && takeOf(r.attemptId)).length,
    }));
  };
  const saveTalk = (input: S.TalkInput, sampleId?: string): TalkRow => {
    const title = oneLine(input.title);
    if (title.length < 2 || title.length > 120) throw invalid("Give the talk a title of 2 to 120 characters.");
    if (input.template && !KEY.test(input.template)) throw invalid("Choose a template from the list.");
    if (input.sections.length === 0 || input.sections.length > 20) throw invalid("A talk has 1 to 20 sections.");
    const sections = input.sections.map((s) => {
      const sectionTitle = oneLine(s.title);
      if (!sectionTitle || sectionTitle.length > 80) throw invalid("Give each section a title of up to 80 characters.");
      const keywords = s.keywords.map(oneLine).filter(Boolean);
      if (s.keywords.length > 3 || keywords.length !== s.keywords.length || keywords.some((k) => k.length > 30)) throw invalid("Use up to 3 keywords per section, each up to 30 characters.");
      if (s.notes.length > 2000) throw invalid("Keep each section's notes under 2,000 characters.");
      if (!Number.isInteger(s.targetSeconds) || s.targetSeconds < 5 || s.targetSeconds > 3600) throw invalid("Give each section a target between 5 seconds and an hour.");
      return { id: s.id ?? null, title: sectionTitle, keywords, notes: s.notes.trim(), targetSeconds: s.targetSeconds };
    });
    const stamp = now();
    let row = input.id ? liveTalk(input.id) : undefined;
    if (!row) {
      row = { talk: { id: sampleId ?? nextId("talk"), title, template: input.template ?? null, createdAt: stamp, updatedAt: stamp }, sections: [], deleted: false };
      talks.push(row);
    }
    row.talk = { ...row.talk, title, template: input.template ?? null, updatedAt: stamp };
    const kept = new Set<string>();
    const next: SectionRow[] = sections.map((s, i) => {
      const existing = s.id ? row!.sections.find((x) => x.id === s.id && !x.deleted) : undefined;
      const id = existing ? existing.id : nextId("section");
      kept.add(id);
      return { id, position: i + 1, title: s.title, keywords: s.keywords, notes: s.notes, targetSeconds: s.targetSeconds, deleted: false };
    });
    row.sections = [...next, ...row.sections.filter((s) => !kept.has(s.id)).map((s) => ({ ...s, deleted: true, position: s.position + 100_000 }))];
    return row;
  };

  // ── The time capsule (14.5) ──
  const months = new Map<string, CapsuleMonth>();
  const capsuleDone = (month: string) => host.sessions.some((s) => s.exerciseType === "capsule" && s.attemptCount > 0 && !host.trashed(s.id) && s.localDate.slice(0, 7) === month);

  // ── Listener packs (14.4) ──
  const packs: PackRow[] = [];
  const feedback: FeedbackRow[] = [];
  // Packs and answers go with their take only when it is deleted for good, which the preview never does.
  const packView = (p: PackRow): S.ListenerPack => R.ListenerPack.parse({ ...p, answerFiles: feedback.filter((f) => f.packId === p.id).length });
  const feedbackView = (f: FeedbackRow): S.ListenerFeedback => {
    const pack = packs.find((p) => p.id === f.packId)!;
    return R.ListenerFeedback.parse({ ...f, sessionId: pack.sessionId, attemptId: pack.attemptId, answers: pack.questions.map((question, i) => ({ question, answer: f.answers[i] ?? "" })) });
  };

  const methods: Pick<IpcClient, Methods> = {
    pickMission: async (week, missionId) => {
      if (!DAY.test(week)) throw invalid("Choose a day.");
      if (missionId !== null && !KEY.test(missionId)) throw invalid("Choose a mission from the list.");
      if (picks.get(week)?.doneAt) throw invalid("This week's mission is already done.");
      const pick: S.MissionPick = { week, missionId, pickedAt: now(), reviewId: null, doneAt: null };
      picks.set(week, pick);
      return R.MissionPick.parse(structuredClone(pick));
    },
    getMissionPick: async (week) => (picks.has(week) ? R.MissionPick.parse(structuredClone(picks.get(week))) : null),
    clearMission: async (week) => {
      if (!picks.get(week)?.doneAt) picks.delete(week);
    },
    saveEvent: async (input) => {
      const clean = cleanEvent(input);
      if (input.id) {
        const event = liveEvent(input.id);
        Object.assign(event, clean);
        return strip(event);
      }
      const event: EventRow = { id: nextId("event"), ...clean, talkId: null, createdAt: now(), deleted: false };
      events.push(event);
      return strip(event);
    },
    saveEventPlan: async (eventId, inputs) => {
      const event = liveEvent(eventId);
      savePlan(eventId, inputs);
      return view(event);
    },
    setPlanItemDone: async (itemId, done) => {
      const item = items.find((i) => i.id === itemId);
      if (!item) throw new IpcError("not_found", "This plan item no longer exists.");
      const event = liveEvent(item.eventId);
      Object.assign(item, { doneAt: done ? now() : null, refId: null, byHand: true });
      return view(event);
    },
    linkEventTalk: async (eventId, talkId) => {
      const event = liveEvent(eventId);
      liveTalk(talkId);
      event.talkId = talkId;
      return view(event);
    },
    getEvent: async (eventId) => view(liveEvent(eventId)),
    listEvents: async () => {
      const live = events.filter((e) => !e.deleted).sort((a, b) => a.localDate.localeCompare(b.localDate) || (a.startTime ?? "").localeCompare(b.startTime ?? "") || a.createdAt.localeCompare(b.createdAt));
      return Promise.all(live.map(view));
    },
    deleteEvent: async (eventId) => {
      liveEvent(eventId).deleted = true;
    },
    saveTalk: async (input) => talkView(saveTalk(input)),
    getTalk: async (talkId) => talkView(liveTalk(talkId)),
    listTalks: async () => talks.filter((t) => !t.deleted).sort((a, b) => b.talk.updatedAt.localeCompare(a.talk.updatedAt)).map(talkView),
    deleteTalk: async (talkId) => {
      liveTalk(talkId).deleted = true;
    },
    recordRehearsal: async (talkId, attemptId) => {
      const talk = liveTalk(talkId);
      const take = takeOf(attemptId);
      if (!take || take.session.exerciseType !== "rehearsal") throw invalid("Only a saved rehearsal take can be added to a talk.");
      let found = rehearsals.find((r) => r.attemptId === attemptId);
      if (!found) {
        found = { attemptId, talkId, createdAt: now(), sections: talk.sections.filter((s) => !s.deleted).sort((a, b) => a.position - b.position).map((s) => ({ id: s.id, title: s.title, targetSeconds: s.targetSeconds })) };
        rehearsals.push(found);
      }
      return report(found);
    },
    rehearsalReport: async (attemptId) => {
      const found = rehearsals.find((r) => r.attemptId === attemptId);
      if (!found) throw new IpcError("not_found", "This rehearsal is unavailable.");
      return report(found);
    },
    listRehearsals: async (talkId) => rehearsals.filter((r) => r.talkId === talkId && takeOf(r.attemptId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(report),
    capsuleOffer: async (day) => {
      if (!DAY.test(day)) throw invalid("Choose a day.");
      const month = day.slice(0, 7);
      if (!months.has(month)) months.set(month, { offeredOn: day, dismissed: false });
      const state = months.get(month)!;
      const done = capsuleDone(month);
      return R.CapsuleOffer.parse({ month, offeredOn: state.offeredOn, done, dismissed: state.dismissed, show: capsuleShows(state, day, done) });
    },
    dismissCapsule: async (month) => {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw invalid("Invalid month.");
      months.set(month, { offeredOn: months.get(month)?.offeredOn ?? `${month}-01`, dismissed: true });
    },
    exportListenerPack: async (attemptId, questions, from, includeTranscript) => {
      const cleaned = questions.map((q) => oneLine(q));
      if (cleaned.length === 0 || cleaned.length > 5 || cleaned.some((q) => !q || q.length > 160 || hasControl(q))) throw invalid("Ask one to five questions of up to 160 characters each.");
      const name = oneLine(from);
      if (name.length > 60) throw invalid("Keep your name under 60 characters.");
      const take = takeOf(attemptId);
      if (!take) throw new IpcError("not_found", "This take is unavailable.");
      if (includeTranscript && !host.takeText(attemptId)) throw invalid("This take has no transcript to include yet.");
      const pack: PackRow = { id: nextId("pack"), sessionId: take.session.id, attemptId, questions: cleaned, from: name, includeTranscript, createdAt: now() };
      packs.unshift(pack);
      return packView(pack);
    },
    importListenerAnswers: async () => {
      const pack = packs[0];
      if (!pack) throw invalid("Save a pack for a listener first. In the desktop app you choose the answer file they sent back.");
      const existing = feedback.find((f) => f.packId === pack.id);
      if (existing) return R.ListenerImport.parse({ feedback: feedbackView(existing), alreadyImported: true });
      const row: FeedbackRow = {
        id: nextId("listener"), packId: pack.id, listenerName: "Sam", answers: pack.questions.map((_, i) => SAMPLE_ANSWERS[i] ?? "A sample answer from the browser preview."),
        answeredAt: now(), importedAt: now(), mainPointUnderstood: null,
      };
      feedback.unshift(row);
      host.award("listener_answers", row.id, today(), { sessionId: pack.sessionId, attemptId: pack.attemptId });
      return R.ListenerImport.parse({ feedback: feedbackView(row), alreadyImported: false });
    },
    listListenerPacks: async (sessionId) => packs.filter((p) => !sessionId || p.sessionId === sessionId).map(packView),
    listListenerFeedback: async (sessionId) => feedback.filter((f) => !sessionId || packs.find((p) => p.id === f.packId)!.sessionId === sessionId).map(feedbackView),
    setListenerJudgement: async (feedbackId, understood) => {
      const row = feedback.find((f) => f.id === feedbackId);
      if (!row) throw new IpcError("not_found", "These answers no longer exist.");
      row.mainPointUnderstood = understood;
      return feedbackView(row);
    },
  };

  const checkReview = (input: S.TransferInput): string | null => {
    let week: string | null = null;
    if (input.missionId) {
      if (!KEY.test(input.missionId)) throw invalid("Choose a mission from the list.");
      const open = [...picks.values()].filter((p) => p.missionId === input.missionId && !p.doneAt).sort((a, b) => b.week.localeCompare(a.week))[0];
      if (!open) throw invalid("This mission isn't open. Pick it in This week first.");
      week = open.week;
    }
    const eventId = input.extra?.eventId;
    if (eventId) {
      if (input.kind !== "aar") throw invalid("Only an after-action review has these answers.");
      liveEvent(eventId);
    }
    return week;
  };
  const logReview = (review: S.TransferReview, week: string | null) => {
    const pick = week ? picks.get(week) : undefined;
    if (pick && week) {
      Object.assign(pick, { doneAt: review.createdAt, reviewId: review.id });
      host.award("mission", week, review.localDate);
    }
    if (review.extra?.eventId) host.award("event_debrief", review.extra.eventId, review.localDate);
  };
  const facts = (): Pick<S.PracticeFacts, "events" | "listenerAnswers" | "missionPicks"> => ({
    events: events.filter((e) => !e.deleted).sort((a, b) => a.localDate.localeCompare(b.localDate)).map((e) => ({ id: e.id, kind: e.kind, localDate: e.localDate, debriefDone: debriefDone(e.id) })),
    listenerAnswers: feedback
      .filter((f) => takeOf(packs.find((p) => p.id === f.packId)!.attemptId))
      .map((f) => ({ id: f.id, attemptId: packs.find((p) => p.id === f.packId)!.attemptId, localDate: toLocalDate(new Date(f.importedAt)), mainPointAnswered: f.mainPointUnderstood === true })),
    missionPicks: [...picks.values()].sort((a, b) => a.week.localeCompare(b.week)).map((p) => ({ week: p.week, missionId: p.missionId, done: !!p.doneAt })),
  });

  // The preview's sample: an interview in six days, its plan, and a STAR outline already written.
  const day = today();
  const star = talkTemplate("star")!;
  const sampleTalk = saveTalk(
    {
      title: "Interview at Acme: my answers", template: star.id,
      sections: star.sections.map((s, i) => ({ title: s.title, keywords: [["migration", "deadline"], ["lead"], ["plan", "pairing", "tests"], ["two weeks early"]][i] ?? [], notes: "", targetSeconds: s.targetSeconds })),
    },
    "talk-sample",
  );
  const sample: EventRow = {
    id: "event-sample", title: "Interview at Acme", kind: "interview", localDate: addLocalDays(day, 6), startTime: "10:00", minutes: 45,
    audience: "Two engineers and a hiring manager", goal: "I can lead a small team through a difficult migration.", talkId: sampleTalk.talk.id, createdAt: now(), deleted: false,
  };
  events.push(sample);
  // Its days are relative to today, so it reads the same whenever the preview opens.
  savePlan(sample.id, buildEventPlan(sample, day));
  return { methods, checkReview, logReview, facts };
}
