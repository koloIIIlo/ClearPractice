/**
 * Everything the refresh loop evaluates with, in one chunk that
 * EngagementProvider loads on its first pass (start-up JS budget, roadmap 7.1).
 */
export { stageForDays } from "@/lib/engagement/companion";
export { evalContext } from "@/lib/engagement/criteria";
export { evaluate, evaluateAreas, isEmptyDiff } from "@/lib/engagement/evaluate";
export { generateWeeklyQuests } from "@/lib/engagement/quests";
export { celebrationsFrom, limitBatch } from "./celebrations";
