import { z } from "zod";
import { CoachingModel, CoachingPreview, ClipName, PhraseSuggestion, PickedClip } from "./schemas";

const id = z.string().min(1).max(200);
const approval = z.object({ requestId: id, payloadSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const PhraseInput = z.object({ sessionIds: z.array(id).min(1).max(12), model: CoachingModel.nullable() }).strict();
export const NamesInput = z.object({ texts: z.array(z.string().trim().min(1).max(1000)).min(1).max(40), model: CoachingModel.nullable() }).strict();
export const PicksInput = z.object({ stagingId: id, model: CoachingModel.nullable(), toneHint: z.boolean(), wanted: z.number().int().min(1).max(20) }).strict();
export const Approval = approval;
export const PicksApproval = approval.extend({ stagingId: id }).strict();
export { CoachingPreview, ClipName, PhraseSuggestion, PickedClip };
