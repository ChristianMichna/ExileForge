import { z } from "zod";
import { PatchStatus } from "@astrolabe/contracts";

/**
 * Result of revalidating one stored guide against a newer data release: the
 * verdict, or the error that stopped the check (never a silent "fine").
 */
export const PatchCheckOutcome = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("status"), status: PatchStatus }),
  z.object({ kind: z.literal("error"), code: z.string().min(1), message: z.string().min(1) }),
]);
export type PatchCheckOutcome = z.infer<typeof PatchCheckOutcome>;

export interface StoredPatchCheck {
  guideId: string;
  outcome: PatchCheckOutcome;
  checkedAt: string;
}
