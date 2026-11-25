import { z } from "zod";
import {
  type ArchetypeCandidate,
  type BuildState,
  type Finding,
  GearSlotPlan,
  ItemSpec,
  Rationale,
  type TargetBuild,
} from "@astrolabe/contracts/build";
import type { EntityRef, JsonValue } from "@astrolabe/contracts/common";
import type { StageConfig } from "../config.js";
import { defineTask, type AnyTaskSpec, type PipelineContext } from "../pipeline.js";
import { S7_GEAR } from "../prompts.js";
import { requestContext } from "./context.js";
import { rejectedFindings } from "./s2-candidates.js";

export const S7_GEAR_PREFIX = "S7.gear-";

/** Result key of one budget tier. */
export const gearKey = (tierId: string): string => `${S7_GEAR_PREFIX}${tierId}`;

/** S7 settings; absent when slots and tiers have not been set yet. */
export type S7Config = NonNullable<StageConfig["s7"]>;

/** What Claude chooses per slot; prices and gain per cost are measured afterwards. */
export const GearChoice = z.object({
  slots: z
    .array(
      z.object({
        slot: z.string().min(1),
        priority: GearSlotPlan.shape.priority,
        target: ItemSpec,
        acquisition: GearSlotPlan.shape.acquisition,
        rationale: z.array(Rationale).min(1),
      }),
    )
    .min(1),
});
export type GearChoice = z.infer<typeof GearChoice>;

/** The tiers of this run: every configured tier up to and including the endgame budget. */
export function tiersOf(
  s7: S7Config,
  endgame: string,
): { id: string; label: string }[] | undefined {
  const index = s7.tiers.findIndex((t) => t.id === endgame);
  return index < 0 ? undefined : s7.tiers.slice(0, index + 1);
}

/** Item references of a spec, for the catalog check (G1). */
export function itemEntities(item: ItemSpec): EntityRef[] {
  if (item.kind === "unique") return [{ kind: "uniqueItem", id: item.uniqueId }];
  return [
    { kind: "baseItem", id: item.baseItemId },
    ...item.mods.map((m): EntityRef => ({ kind: "mod", id: m.modId })),
    ...item.socketables.map((s): EntityRef =>
      s.kind === "craftingAction"
        ? { kind: "craftingAction", id: s.id }
        : { kind: "baseItem", id: s.id },
    ),
  ];
}

/** The endgame build wearing the chosen items; everything else as the target has it. */
export function geared(target: BuildState, choice: GearChoice): BuildState {
  return {
    ...target,
    items: choice.slots.map((s) => ({ slot: s.slot, item: s.target })),
  };
}

/** S7 part 1: the gear of one budget tier (Claude), checked against the catalog and measured with PoB. */
export function gearTask(
  ctx: PipelineContext,
  config: StageConfig,
  s7: S7Config,
  tier: { id: string; label: string },
  chosen: ArchetypeCandidate,
  target: TargetBuild,
): AnyTaskSpec {
  return defineTask<GearChoice>({
    key: gearKey(tier.id),
    type: `S7.gear-${tier.id}`,
    promptVersion: config.promptVersion,
    instructions: S7_GEAR,
    context: {
      request: requestContext(ctx),
      chosen,
      tier,
      slots: s7.slots,
      targetBuild: JSON.parse(JSON.stringify(target)) as JsonValue,
    },
    schema: GearChoice,
    allowedTools: ["catalog_search", "catalog_get", "calc_evaluate"],
    entities: (c) =>
      c.slots.flatMap((s, i) => [
        ...itemEntities(s.target).map((ref, j) => ({ path: `/slots/${i}/target/${j}`, ref })),
        ...s.rationale.flatMap((r, j) =>
          r.subject === undefined
            ? []
            : [{ path: `/slots/${i}/rationale/${j}/subject`, ref: r.subject }],
        ),
      ]),
    richText: (c) =>
      c.slots.flatMap((s, i) =>
        s.rationale.map((r, j) => ({ path: `/slots/${i}/rationale/${j}/reason`, text: r.reason })),
      ),
    check: async (c, checkCtx) => {
      const findings: Finding[] = [];
      const seen = new Set<string>();
      c.slots.forEach((s, i) => {
        if (!s7.slots.includes(s.slot) || seen.has(s.slot)) {
          findings.push({
            gate: "schema",
            severity: "error",
            code: "unknown_or_duplicate_slot",
            message: `Slot ${s.slot} is unknown or given twice. Use each of: ${s7.slots.join(", ")}.`,
            path: `/slots/${i}/slot`,
          });
        }
        seen.add(s.slot);
      });
      findings.push(
        ...rejectedFindings(
          checkCtx,
          c.slots.flatMap((s, i) =>
            itemEntities(s.target).map((ref, j) => ({ path: `/slots/${i}/target/${j}`, ref })),
          ),
        ),
      );
      if (findings.length > 0) return findings;
      const outcomes = await checkCtx.calc.calculate({
        state: geared(target.state, c),
        profiles: s7.calcProfiles,
      });
      for (const [profile, outcome] of Object.entries(outcomes)) {
        if (outcome.status === "failed") {
          findings.push({
            gate: "G2",
            severity: "error",
            code: "calc_failed",
            message: `The engine could not calculate this gear (profile ${profile}): ${outcome.error.message}`,
            path: "/slots",
          });
        }
      }
      return findings;
    },
  });
}
