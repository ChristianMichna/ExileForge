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
import type { DataRelease } from "@astrolabe/contracts/catalog";
import type { EntityRef, JsonValue } from "@astrolabe/contracts/common";
import type { StageConfig } from "../config.js";
import { defineTask, type AnyTaskSpec, type PipelineContext } from "../pipeline.js";
import { S7_GEAR } from "../prompts.js";
import { requestContext } from "./context.js";
import { rejectedFindings } from "./s2-candidates.js";

export const S7_GEAR_PREFIX = "S7.gear-";

/** Result key of one budget tier. */
export const gearKey = (tierId: string): string => `${S7_GEAR_PREFIX}${tierId}`;

/** What one slot accepts, from the release. */
export interface SlotRule {
  id: string;
  /** Accepted `BaseItem.itemClass` values; absent when the slot list is a config override. */
  classes?: readonly string[];
  partialBases?: readonly string[];
  /** The slot's rule depends on another slot; classes are then a necessary condition only. */
  dependsOnSlot?: string;
  /** 2 = swap weapon set; such slots are not required by default. */
  weaponSet?: 1 | 2;
}

/** S7 settings with the slots resolved against the release. */
export type S7Config = Omit<NonNullable<StageConfig["s7"]>, "slots" | "requiredSlots"> & {
  slots: readonly SlotRule[];
  requiredSlots: readonly string[];
};

/**
 * The slots of this run: the release's item slots in PoB order (or the config
 * override), and the slots every tier must fill. Missing facts or unknown
 * override ids are an error text, never a default list.
 */
export function resolveS7(
  base: NonNullable<StageConfig["s7"]>,
  release: DataRelease | undefined,
): S7Config | string {
  const fromRelease = [...(release?.itemSlots?.slots ?? [])].sort((a, b) => a.order - b.order);
  const rules = fromRelease.map((s): SlotRule => ({
    id: s.id,
    classes: s.itemClasses,
    ...(s.partialBases === undefined ? {} : { partialBases: s.partialBases }),
    ...(s.dependsOnSlot === undefined ? {} : { dependsOnSlot: s.dependsOnSlot }),
    ...(s.weaponSet === undefined ? {} : { weaponSet: s.weaponSet }),
  }));
  let slots: SlotRule[];
  if (base.slots !== undefined) {
    const unknownIds =
      rules.length === 0 ? [] : base.slots.filter((id) => !rules.some((r) => r.id === id));
    if (unknownIds.length > 0) {
      return `The s7 slot override names slots the release does not have: ${unknownIds.join(", ")}.`;
    }
    slots = base.slots.map((id) => rules.find((r) => r.id === id) ?? { id });
  } else if (rules.length > 0) {
    slots = rules;
  } else {
    return `Data release ${release?.id ?? "(unknown)"} has no item slots and the config names none; S7 cannot know what to equip. Rebuild the release with the data pipeline.`;
  }
  const unknown = base.requiredSlots?.filter((id) => !slots.some((s) => s.id === id)) ?? [];
  if (unknown.length > 0) return `requiredSlots names unknown slots: ${unknown.join(", ")}`;
  const optional = new Set(
    (release?.itemSlots?.slots ?? []).filter((s) => s.optional === true).map((s) => s.id),
  );
  const requiredSlots =
    base.requiredSlots ??
    slots
      .filter((s) => s.dependsOnSlot === undefined && s.weaponSet !== 2 && !optional.has(s.id))
      .map((s) => s.id);
  return {
    tiers: base.tiers,
    calcProfiles: base.calcProfiles,
    objective: base.objective,
    slots,
    requiredSlots,
  };
}

/** The base item of a spec: its own base, or the base of the unique. */
function baseOf(
  item: ItemSpec,
  ctx: PipelineContext,
): { id: string; itemClass?: string } | undefined {
  const baseId =
    item.kind === "crafted"
      ? item.baseItemId
      : (
          ctx.catalog.get({ kind: "uniqueItem", id: item.uniqueId })?.entity as
            { baseItemId?: string } | undefined
        )?.baseItemId;
  if (baseId === undefined) return undefined;
  const itemClass = (
    ctx.catalog.get({ kind: "baseItem", id: baseId })?.entity as { itemClass?: string } | undefined
  )?.itemClass;
  return itemClass === undefined ? { id: baseId } : { id: baseId, itemClass };
}

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

/** The tiers of this run: from the leveling tier to the endgame tier, in config order. */
export function tiersOf(
  s7: Pick<S7Config, "tiers">,
  budget: { leveling: string; endgame: string },
): { id: string; label: string }[] | undefined {
  const from = s7.tiers.findIndex((t) => t.id === budget.leveling);
  const to = s7.tiers.findIndex((t) => t.id === budget.endgame);
  return from < 0 || to < 0 || from > to ? undefined : s7.tiers.slice(from, to + 1);
}

/** Catalog references of an item spec with their JSON pointers below the spec. */
export function itemEntities(item: ItemSpec): { path: string; ref: EntityRef }[] {
  if (item.kind === "unique") {
    return [{ path: "/uniqueId", ref: { kind: "uniqueItem", id: item.uniqueId } }];
  }
  return [
    { path: "/baseItemId", ref: { kind: "baseItem", id: item.baseItemId } },
    ...item.mods.map((m, k) => ({
      path: `/mods/${k}/modId`,
      ref: { kind: "mod" as const, id: m.modId },
    })),
    ...item.socketables.map((x, k) => ({
      path: `/socketables/${k}/id`,
      ref: {
        kind: x.kind === "craftingAction" ? ("craftingAction" as const) : ("baseItem" as const),
        id: x.id,
      },
    })),
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
  earlier: readonly { tier: string; gear: JsonValue }[],
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
      slots: s7.slots.map((x) => x.id),
      requiredSlots: [...s7.requiredSlots],
      earlierTiers: earlier as unknown as JsonValue,
      targetBuild: JSON.parse(JSON.stringify(target)) as JsonValue,
    },
    schema: GearChoice,
    allowedTools: ["catalog_search", "catalog_get", "calc_evaluate"],
    entities: (c) =>
      c.slots.flatMap((s, i) => [
        ...itemEntities(s.target).map((e) => ({ path: `/slots/${i}/target${e.path}`, ref: e.ref })),
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
        if (!s7.slots.some((x) => x.id === s.slot) || seen.has(s.slot)) {
          findings.push({
            gate: "schema",
            severity: "error",
            code: "unknown_or_duplicate_slot",
            message: `Slot ${s.slot} is unknown or given twice. Use each of: ${s7.slots.map((x) => x.id).join(", ")}.`,
            path: `/slots/${i}/slot`,
          });
        }
        seen.add(s.slot);
      });
      for (const slot of s7.requiredSlots) {
        if (!seen.has(slot)) {
          findings.push({
            gate: "schema",
            severity: "error",
            code: "missing_slot",
            message: `Slot ${slot} has no item. Every required slot needs one.`,
            path: "/slots",
          });
        }
      }
      c.slots.forEach((s, i) => {
        const rule = s7.slots.find((x) => x.id === s.slot);
        if (rule?.classes === undefined) return;
        const base = baseOf(s.target, checkCtx);
        if (base?.itemClass === undefined) {
          findings.push({
            gate: "G1",
            severity: "error",
            code: "base_unresolved",
            message: `The base item class of this item could not be read from the catalog, so the slot cannot be checked.`,
            path: `/slots/${i}/target`,
          });
          return;
        }
        const fits =
          rule.classes.includes(base.itemClass) || (rule.partialBases ?? []).includes(base.id);
        if (fits && rule.dependsOnSlot !== undefined) {
          findings.push({
            gate: "G3",
            severity: "warning",
            code: "dependent_slot_unchecked",
            message: `Whether this item fits slot ${s.slot} depends on the item in ${rule.dependsOnSlot}; only the class union is checked here.`,
            path: `/slots/${i}/target`,
          });
        }
        if (!fits) {
          findings.push({
            gate: "G3",
            severity: "error",
            code: "item_not_allowed_in_slot",
            message: `Slot ${s.slot} does not accept items of class ${base.itemClass}. Accepted classes: ${rule.classes.join(", ") || "(none)"}${rule.partialBases === undefined ? "" : `; accepted bases: ${rule.partialBases.join(", ")}`}.`,
            path: `/slots/${i}/target`,
          });
        }
      });
      if (checkCtx.run.request.mode.ssf) {
        c.slots.forEach((s, i) => {
          if (s.acquisition === "trade") {
            findings.push({
              gate: "G3",
              severity: "error",
              code: "trade_in_ssf",
              message: "This run is solo self-found; items cannot be acquired by trade.",
              path: `/slots/${i}/acquisition`,
            });
          }
        });
      }
      findings.push(
        ...rejectedFindings(
          checkCtx,
          c.slots.flatMap((s, i) =>
            itemEntities(s.target).map((e) => ({
              path: `/slots/${i}/target${e.path}`,
              ref: e.ref,
            })),
          ),
        ),
      );
      if (findings.some((f) => f.severity === "error")) return findings;
      const outcomes = await checkCtx.calc.calculate({
        state: geared(target.state, c),
        profiles: s7.calcProfiles,
      });
      for (const profile of s7.calcProfiles) {
        const outcome = outcomes[profile];
        if (outcome === undefined) {
          findings.push({
            gate: "G2",
            severity: "error",
            code: "calc_missing",
            message: `The engine returned no result for profile ${profile}.`,
            path: "/slots",
          });
        } else if (outcome.status === "failed") {
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
