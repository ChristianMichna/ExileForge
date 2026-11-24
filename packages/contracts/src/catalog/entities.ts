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
  StatId,
  StatTranslationId,
  UniqueItemId,
} from "../common/ids.js";
import { GameVersion } from "../common/version.js";
import { JsonValue } from "../common/json.js";

/*
 * Canonical catalog entities (Projektplan "Kanonisches Schema").
 * Rules:
 * - ids are internal game ids, references use ids, never names
 * - game classifications (item class, mod generation type, gem kind, node
 *   kind, tags, attributes) are open ClassificationIds from the data release
 * - numbers here are game data; whoever shows them cites a GamedataSource
 * - unknown fields are stripped so an older app can read a newer release
 */

const name = z.string().min(1).describe("Display name in the release's default language");
const nonNegInt = z.int().nonnegative();

/** Path of a file (asset, shard, diff) inside the data release. */
export const AssetPath = z
  .string()
  .min(1)
  .regex(/^(?!\/)(?!.*\.\.)[\w./-]+$/, "relative path inside the release, no ..")
  .describe("Asset path relative to the data release root");
export type AssetPath = z.infer<typeof AssetPath>;

/** A stat with its roll range. min === max for fixed values. */
export const StatRange = z
  .object({ statId: StatId, min: z.number(), max: z.number() })
  .refine((s) => s.min <= s.max, { message: "min must be <= max", path: ["max"] });
export type StatRange = z.infer<typeof StatRange>;

/** Value of a base property: fixed or a range (e.g. weapon damage). */
export const PropertyValue = z.union([
  z.number(),
  z
    .object({ min: z.number(), max: z.number() })
    .refine((r) => r.min <= r.max, { message: "min must be <= max", path: ["max"] }),
]);
export type PropertyValue = z.infer<typeof PropertyValue>;

export const Requirements = z.object({
  level: nonNegInt.optional(),
  /** Attribute requirement by attribute id from the release. */
  attributes: z.record(ClassificationId, nonNegInt).default({}),
});
export type Requirements = z.infer<typeof Requirements>;

export const BaseItem = z.object({
  id: BaseItemId,
  name,
  itemClass: ClassificationId,
  tags: z.array(ClassificationId),
  requirements: Requirements,
  implicitModIds: z.array(ModId),
  /** Base properties keyed by property id (defences, weapon values …). */
  properties: z.record(z.string().min(1), PropertyValue),
  socketCapacity: nonNegInt.optional(),
  dropLevel: nonNegInt,
  icon: AssetPath.optional(),
});
export type BaseItem = z.infer<typeof BaseItem>;

export const SpawnWeight = z.object({ tag: ClassificationId, weight: nonNegInt });
export type SpawnWeight = z.infer<typeof SpawnWeight>;

export const Mod = z.object({
  id: ModId,
  /** Mod families/groups; two mods sharing a group exclude each other. */
  groups: z.array(ClassificationId),
  generationType: ClassificationId,
  domain: ClassificationId,
  /** Tier within its family as computed by the pipeline (1 = best); absent if not tiered. */
  tier: z.int().positive().optional(),
  requiredLevel: nonNegInt,
  stats: z.array(StatRange),
  spawnWeights: z.array(SpawnWeight),
  tags: z.array(ClassificationId).default([]),
  /** Rendered text in the default language; source of truth is StatTranslation. */
  text: z.string().optional(),
});
export type Mod = z.infer<typeof Mod>;

export const UniqueModLine = z.object({
  /** Mod id if the release has one for this line. */
  modId: ModId.optional(),
  stats: z.array(StatRange),
  text: z.string().optional(),
  /** Restrict this line to some variants; absent = all variants. */
  variantIds: z.array(z.string().min(1)).optional(),
});
export type UniqueModLine = z.infer<typeof UniqueModLine>;

export const UniqueItem = z.object({
  id: UniqueItemId,
  name,
  baseItemId: BaseItemId,
  mods: z.array(UniqueModLine),
  variants: z.array(z.object({ id: z.string().min(1), name })).default([]),
  introducedIn: GameVersion.optional(),
  dropSources: z.array(z.string().min(1)).default([]),
  icon: AssetPath.optional(),
});
export type UniqueItem = z.infer<typeof UniqueItem>;

export const GemLevel = z.object({
  level: z.int().positive(),
  requirements: Requirements,
  /** Per-level values (cost, reservation, damage …) keyed by stat id. */
  stats: z.record(z.string().min(1), z.number()),
});
export type GemLevel = z.infer<typeof GemLevel>;

export const Gem = z.object({
  id: GemId,
  name,
  /** Gem kind (skill, support, spirit, meta …) as defined by the release. */
  kind: ClassificationId,
  tags: z.array(ClassificationId),
  levels: z.array(GemLevel).min(1),
  qualityStats: z.array(StatRange).default([]),
  /** For supports: which skills they may support, by tags. */
  supportRules: z
    .object({
      requiredTags: z.array(ClassificationId).default([]),
      excludedTags: z.array(ClassificationId).default([]),
    })
    .optional(),
  icon: AssetPath.optional(),
});
export type Gem = z.infer<typeof Gem>;

export const PassiveNode = z.object({
  id: PassiveNodeId,
  /** Numeric node id used by Path of Building; secondary to `id`. */
  pobNodeId: nonNegInt.optional(),
  name,
  /** Node kind (small, notable, keystone, jewel socket …) as defined by the release. */
  kind: ClassificationId,
  stats: z.array(z.object({ statId: StatId.optional(), text: z.string().min(1) })),
  position: z.object({
    groupId: z.string().min(1),
    orbit: nonNegInt,
    orbitIndex: nonNegInt,
  }),
  connections: z.array(PassiveNodeId),
  classStartFor: z.array(CharacterClassId).default([]),
  ascendancyId: AscendancyId.optional(),
  icon: AssetPath.optional(),
});
export type PassiveNode = z.infer<typeof PassiveNode>;

export const CharacterClass = z.object({
  id: CharacterClassId,
  name,
  baseAttributes: z.record(ClassificationId, nonNegInt),
  startNodeId: PassiveNodeId,
  ascendancyIds: z.array(AscendancyId),
});
export type CharacterClass = z.infer<typeof CharacterClass>;

export const Ascendancy = z.object({
  id: AscendancyId,
  name,
  classId: CharacterClassId,
  startNodeId: PassiveNodeId.optional(),
  nodeIds: z.array(PassiveNodeId),
  /** How ascendancy points are unlocked; source ids come from the release. */
  pointUnlocks: z.array(z.object({ source: ClassificationId, points: z.int().positive() })),
});
export type Ascendancy = z.infer<typeof Ascendancy>;

/**
 * Declarative crafting rule ("adds a random mod from pool P, weighted").
 * The op vocabulary and its params are owned by packages/crafting-sim and
 * versioned there; new currencies of a patch should be data only.
 */
export const CraftingRule = z.object({
  op: z.string().min(1),
  params: z.record(z.string(), JsonValue).default({}),
});
export type CraftingRule = z.infer<typeof CraftingRule>;

export const CraftingAction = z.object({
  id: CraftingActionId,
  name,
  /** Action kind (currency, omen, essence, socketable …) as defined by the release. */
  kind: ClassificationId,
  /** The item that is consumed, if the action is an item. */
  itemId: BaseItemId.optional(),
  preconditions: z.array(CraftingRule).default([]),
  effects: z.array(CraftingRule).min(1),
  icon: AssetPath.optional(),
});
export type CraftingAction = z.infer<typeof CraftingAction>;

export const StatTranslation = z
  .object({
    id: StatTranslationId,
    statIds: z.array(StatId).min(1),
    /** BCP 47 language tag. */
    lang: z.string().min(2).max(35),
    variants: z
      .array(
        z.object({
          /** One condition per stat id, same order as statIds. */
          conditions: z.array(
            z.object({
              min: z.number().optional(),
              max: z.number().optional(),
              negated: z.boolean().default(false),
            }),
          ),
          /** Template with {0}, {1} … placeholders. */
          template: z.string().min(1),
          /** Formatter ids per placeholder, defined by the release. */
          formatters: z.array(z.string()).default([]),
        }),
      )
      .min(1),
  })
  .superRefine((t, ctx) => {
    t.variants.forEach((v, i) => {
      if (v.conditions.length !== t.statIds.length) {
        ctx.addIssue({
          code: "custom",
          path: ["variants", i, "conditions"],
          message: "needs one condition per stat id",
        });
      }
    });
  });
export type StatTranslation = z.infer<typeof StatTranslation>;
