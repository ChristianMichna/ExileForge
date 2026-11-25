import type { ArchetypeCandidate } from "@astrolabe/contracts/build";
import type { PlanStep } from "../pipeline.js";

export const S4_KEY = "S4.selection";

/**
 * S4: the player picks one candidate in the Astrolabe app (an intervention
 * `chooseVariant`). Until then the run waits; no candidate is chosen on the
 * player's behalf.
 */
export function selectionWait(candidates: readonly ArchetypeCandidate[]): PlanStep {
  return {
    kind: "wait_user",
    reason: [
      {
        type: "text",
        text: `The ${candidates.length} candidate builds are measured. The player now picks one of them in the Astrolabe app; do not choose for them. Call forge_next again.`,
      },
    ],
  };
}

/** Stores the pick so later stages stay on it even if another pick arrives afterwards. */
export function selectionStep(candidateKey: string): PlanStep {
  return {
    kind: "server",
    key: S4_KEY,
    type: "S4.select",
    run: async () => Promise.resolve({ candidateKey }),
  };
}
