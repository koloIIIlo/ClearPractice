import { IpcError, type IpcClient } from "./client";
import * as S from "./schemas-social";
import { clubClock, COUNTERS, KIND_LABELS, lightAt } from "../social/club";

type Methods = "saveClubMeeting" | "listClubMeetings" | "getClubMeeting" | "deleteClubMeeting" | "saveClubSpeech" | "clubSummary" | "exportClubSummary" | "openClubLight" | "publishClubLight" | "onClubLight";

/** Loaded only when Club is visited. Each preview client owns its meetings. */
export function createMockSocial(): Pick<IpcClient, Methods> {
  const meetings = new Map<string, S.ClubMeetingView>();
  let serial = 0;
  const nextId = (kind: string) => `${kind}-${Date.now()}-${++serial}`;
  const get = (id: string) => {
    const view = meetings.get(id);
    if (!view) throw new IpcError("not_found", "This meeting no longer exists.");
    return view;
  };
  const listeners = new Set<(state: S.ClubLightState) => void>();
  let channel: BroadcastChannel | null = null;
  const deliver = (value: unknown) => {
    const parsed = S.ClubLightState.safeParse(value);
    if (parsed.success) listeners.forEach((listener) => listener(parsed.data));
  };
  const summary = (id: string) => {
    const { meeting, speeches } = get(id);
    const cell = (value: string) => value.replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");
    const header = ["Speaker", "Kind", "Time (Measured)", "Light reached", ...COUNTERS.map((c) => c.label), "Word used (Your note)"];
    const rows = speeches.map((s) => [cell(s.speaker), KIND_LABELS[s.kind], s.seconds === null ? "not timed" : clubClock(s.seconds * 1000),
      s.seconds === null ? "–" : lightAt(s.seconds * 1000, s.targetMinSeconds, s.targetMaxSeconds) ?? "none",
      ...COUNTERS.map((c) => String(s.counts[c.id] ?? 0)), s.wordUsed === null ? "–" : s.wordUsed ? "used" : "not used"]);
    return `# ${meeting.title}\n\n${meeting.localDate} · Word of the day: ${meeting.wordOfTheDay || "–"}\n\nCounts: Your note\n\n${[header, header.map(() => "---"), ...rows].map((r) => `| ${r.join(" | ")} |`).join("\n")}\n\n${speeches.filter((s) => s.notes).map((s) => `- ${s.speaker}: ${s.notes}`).join("\n")}\n`;
  };
  // The browser preview's sample meetings: one under way (the run view), one finished (the summary).
  const speech = (id: string, position: number, speaker: string, kind: S.ClubKind, window: [number, number] | null, seconds: number | null, counts: Partial<Record<S.ClubCounter, number>> = {}, wordUsed: boolean | null = null, notes = "") =>
    ({ id, position, speaker, kind, targetMinSeconds: window?.[0] ?? null, targetMaxSeconds: window?.[1] ?? null, seconds, counts, wordUsed, notes });
  for (const view of [
    { meeting: { id: "club-sample", title: "Thursday speaking club", localDate: "2026-10-15", wordOfTheDay: "candid", createdAt: "2026-10-15T18:00:00.000Z" },
      speeches: [speech("club-s1", 1, "Maria", "prepared", [300, 420], 371, { um: 2, so: 1 }, true, "Clear opening story."),
        speech("club-s2", 2, "Tom", "table_topic", [60, 120], 94, { uh: 1 }, false),
        speech("club-s3", 3, "Priya", "table_topic", [60, 120], null),
        speech("club-s4", 4, "Jon", "evaluation", [120, 180], null)] },
    { meeting: { id: "club-finished", title: "October workshop", localDate: "2026-10-08", wordOfTheDay: "", createdAt: "2026-10-08T18:00:00.000Z" },
      speeches: [speech("club-f1", 1, "Ana", "prepared", [300, 420], 433, { um: 1, like: 3 }),
        speech("club-f2", 2, "Ben", "evaluation", [120, 180], 151, {}, null, "Two concrete suggestions.")] },
  ]) meetings.set(view.meeting.id, S.ClubMeetingView.parse(view));
  return {
    saveClubMeeting: async (input) => {
      const clean = S.ClubMeetingInput.parse(input);
      const old = clean.id ? get(clean.id) : null;
      const view = S.ClubMeetingView.parse({
        meeting: { id: old?.meeting.id ?? nextId("club"), title: clean.title, localDate: clean.localDate, wordOfTheDay: clean.wordOfTheDay, createdAt: old?.meeting.createdAt ?? new Date().toISOString() },
        speeches: clean.speeches.map((s, i) => ({ seconds: null, counts: {}, wordUsed: null, notes: "", ...old?.speeches.find((o) => o.id === s.id),
          ...s, id: old?.speeches.find((o) => o.id === s.id)?.id ?? nextId("speech"), position: i + 1 })),
      });
      meetings.set(view.meeting.id, view);
      return structuredClone(view);
    },
    listClubMeetings: async () => S.ClubMeetingSummary.array().parse([...meetings.values()].sort((a, b) => b.meeting.localDate.localeCompare(a.meeting.localDate) || b.meeting.createdAt.localeCompare(a.meeting.createdAt)).map((v) => ({
      id: v.meeting.id, title: v.meeting.title, localDate: v.meeting.localDate, speeches: v.speeches.length, timed: v.speeches.filter((s) => s.seconds !== null).length,
    }))),
    getClubMeeting: async (id) => structuredClone(get(id)),
    deleteClubMeeting: async (id) => { get(id); meetings.delete(id); },
    saveClubSpeech: async (meetingId, speechId, result) => {
      const clean = S.ClubSpeechResult.parse(result);
      const view = get(meetingId);
      const speech = view.speeches.find((s) => s.id === speechId);
      if (!speech) throw new IpcError("not_found", "This speaker is no longer on the agenda.");
      Object.assign(speech, clean, { notes: clean.notes.trim(), counts: Object.fromEntries(Object.entries(clean.counts).filter(([, count]) => count! > 0)) });
      return structuredClone(view);
    },
    clubSummary: async (id) => summary(id),
    exportClubSummary: async (id) => {
      const view = get(id);
      const name = `${view.meeting.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").trim().slice(0, 80)} ${view.meeting.localDate}.md`;
      const url = URL.createObjectURL(new Blob([summary(id)], { type: "text/markdown;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url; link.download = name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return name;
    },
    openClubLight: async () => {
      const light = window.open("#/club/light", "club-light");
      if (!light) throw new IpcError("popup_blocked", "Allow pop-ups to open the timing light.");
      light.focus();
    },
    publishClubLight: async (state) => {
      const clean = S.ClubLightState.parse(state);
      deliver(clean);
      if (typeof BroadcastChannel !== "undefined") {
        const sender = channel ?? new BroadcastChannel("club-light-state");
        sender.postMessage(clean);
        if (!channel) sender.close();
      }
    },
    onClubLight: async (listener) => {
      listeners.add(listener);
      if (!channel && typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel("club-light-state");
        channel.onmessage = (event) => deliver(event.data);
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) { channel?.close(); channel = null; }
      };
    },
  };
}
