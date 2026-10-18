import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { registerContentPacks, StoredContentPack, validateContentPack } from "../content-pack";
import { DatabaseHealth } from "./schemas-content";

async function command<T>(name: string, schema: { parse(value: unknown): T }, args?: Record<string, unknown>): Promise<T> {
  try { return schema.parse(await invoke(name, args)); }
  catch (error) { throw error instanceof Error ? error : new Error(typeof error === "string" ? error : "Content storage is unavailable."); }
}
export const nativeContent = {
  listContentPacks: async () => registerContentPacks(await command("list_content_packs", StoredContentPack.array())),
  importContentPack: async () => {
    const raw = await command("import_content_pack", z.string().nullable(), { json: null });
    if (raw === null) return null;
    const pack = validateContentPack(raw);
    await command("import_content_pack", z.string(), { json: raw });
    const rows = await nativeContent.listContentPacks();
    return rows.find((r) => validateContentPack(r.json).id === pack.id) ?? null;
  },
  removeContentPack: async (id: string) => {
    await command("remove_content_pack", z.null(), { id });
    await nativeContent.listContentPacks();
  },
  getDatabaseHealth: () => command("get_database_health", DatabaseHealth),
  dismissDatabaseCompaction: async () => { await command("dismiss_database_compaction", z.null()); },
  compactDatabase: async () => { await command("compact_database", z.null()); },
};
