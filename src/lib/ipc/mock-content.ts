import { ContentPack, StoredContentPack, registerContentPacks, validateContentPack } from "../content-pack";
import type { DatabaseHealth } from "./schemas-content";

export function createMockContent() {
  let rows: StoredContentPack[] = [];
  let dismissedAtMs: number | null = null;
  let compacted = false;
  const sample: ContentPack = { format: "clearpractice-content-pack", version: 1, id: "sample", title: "Neighbourhood stories", prompts: [{ id: "market", text: "Describe a visit to a local market.", tags: ["storytelling"], favorite: false, source: "bundled", conditions: { familiarity: "familiar", preparationSeconds: 15, targetSeconds: 60, audience: null, followUp: false } }], drillTopics: { jam: [{ id: "square", text: "A town square" }] }, scenarios: [], missions: [] };
  const listContentPacks = async () => registerContentPacks(structuredClone(rows));
  return {
    listContentPacks,
    importContentPack: async () => {
      const row = { json: JSON.stringify(sample), importedAtMs: Date.now() };
      rows = [row]; await listContentPacks(); return row;
    },
    removeContentPack: async (id: string) => { rows = rows.filter((r) => validateContentPack(r.json).id !== id); await listContentPacks(); },
    getDatabaseHealth: async (): Promise<DatabaseHealth> => ({ pageCount: 100, freePages: compacted ? 0 : 30, pageSize: 4096, dismissedAtMs, offerCompact: !compacted && (dismissedAtMs === null || Date.now() - dismissedAtMs >= 31 * 86400000) }),
    dismissDatabaseCompaction: async () => { dismissedAtMs = Date.now(); },
    compactDatabase: async () => { compacted = true; },
  };
}
