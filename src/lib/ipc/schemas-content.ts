export { StoredContentPack } from "../content-pack";
import { z } from "zod";
export const DatabaseHealth = z.object({ pageCount: z.number().int().nonnegative(), freePages: z.number().int().nonnegative(), pageSize: z.number().int().positive(), offerCompact: z.boolean(), dismissedAtMs: z.number().int().nonnegative().nullable() }).strict();
export type DatabaseHealth = z.infer<typeof DatabaseHealth>;
