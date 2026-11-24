import { z } from "zod";
import {
  AscendancyId,
  BaseItemId,
  CharacterClassId,
  ClassificationId,
  CraftingActionId,
  GemId,
  ModId,
  PassiveNodeId,
  UniqueItemId,
} from "../common/ids.js";

/*
 * A calculable character state: decisions only (ids, levels, slots), no
 * results. PoB computes the numbers for a state; the CalcResult is attached
 * by reference where the state is used.
 */

/** Weapon set index as used by PoB and the .build format; meaning and range are checked by PoB. */
export const WeaponSet = z.int().nonnegative();

export const AllocatedNode = z.object({
  nodeId: PassiveNodeId,
  weaponSet: WeaponSet.default(0),
});
export type AllocatedNode = z.infer<typeof AllocatedNode>;

export const TreeState = z.object({
  allocated: z.array(AllocatedNode),
  ascendancy: z.array(PassiveNodeId).default([]),
});
export type TreeState = z.infer<typeof TreeState>;

export const GemRef = z.object({
  gemId: GemId,
  level: z.int().positive(),
  quality: z.int().nonnegative().default(0),
});
export type GemRef = z.infer<typeof GemRef>;

export const SkillSetup = z.object({
  /** Stable key across stages, so gem swaps can be tracked (G6). */
  key: z.string().min(1).max(64),
  role: z.enum(["main", "secondary", "buff", "movement", "utility", "minion"]),
  gem: GemRef,
  supports: z.array(GemRef),
  weaponSet: WeaponSet.optional(),
});
export type SkillSetup = z.infer<typeof SkillSetup>;

export const ModSpec = z.object({
  modId: ModId,
  /** Assumed roll as fraction of the mod range (0 = min, 1 = max); the value itself comes from game data. */
  rollFraction: z.number().min(0).max(1).default(0.5),
  required: z.boolean(),
});
export type ModSpec = z.infer<typeof ModSpec>;

export const ItemSpec = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("unique"),
    uniqueId: UniqueItemId,
    variantId: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal("crafted"),
    baseItemId: BaseItemId,
    /** Rarity id from the release. */
    rarity: ClassificationId,
    itemLevel: z.int().positive().optional(),
    mods: z.array(ModSpec),
    socketables: z
      .array(
        z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("craftingAction"), id: CraftingActionId }),
          z.object({ kind: z.literal("baseItem"), id: BaseItemId }),
        ]),
      )
      .default([]),
  }),
]);
export type ItemSpec = z.infer<typeof ItemSpec>;

export const EquippedItem = z.object({
  /** Slot id (PoB slot name); translated for .build by the exporter. */
  slot: z.string().min(1),
  item: ItemSpec,
});
export type EquippedItem = z.infer<typeof EquippedItem>;

/** Everything PoB needs to calculate one character state. */
export const BuildState = z.object({
  classId: CharacterClassId,
  ascendancyId: AscendancyId.optional(),
  level: z.int().positive(),
  tree: TreeState,
  skills: z.array(SkillSetup),
  items: z.array(EquippedItem),
  /** PoB configuration overrides on top of the calc profile. */
  config: z.record(z.string().min(1), z.union([z.boolean(), z.number(), z.string()])).default({}),
});
export type BuildState = z.infer<typeof BuildState>;
