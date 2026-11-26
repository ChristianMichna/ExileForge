import { z } from "zod";
import { ClassificationId, EntityKind } from "../common/ids.js";
import { JsonValue } from "../common/json.js";
import {
  DataReleaseId,
  GameVersion,
  IsoDateTime,
  PobVersion,
  Sha256,
  DATA_RELEASE_ID_PATTERN,
} from "../common/version.js";
import {
  ReleasePath,
  Ascendancy,
  BaseItem,
  CharacterClass,
  CraftingAction,
  Gem,
  Mod,
  PassiveGroup,
  PassiveNode,
  StatTranslation,
  UniqueItem,
} from "./entities.js";

/** Version of the catalog file layout below; bump with a migration. */
export const CATALOG_SCHEMA_VERSION = 1;

/**
 * Where a release-level number comes from. These numbers are read when the
 * release is built and are not engine results, so they carry a plain origin
 * instead of a calc `Source`: `game-data` (tables read from the update
 * servers), `pob-data` (PoB data files) or `pob-code` (a rule that PoB
 * hard-codes, not a data value).
 */
export const ReleaseFactOrigin = z.enum(["game-data", "pob-data", "pob-code"]);
export type ReleaseFactOrigin = z.infer<typeof ReleaseFactOrigin>;

/** Highest character level of the release. Absent when the pipeline could not read it. */
export const MaxCharacterLevel = z.object({
  value: z.int().positive(),
  origin: ReleaseFactOrigin,
});
export type MaxCharacterLevel = z.infer<typeof MaxCharacterLevel>;

/**
 * Passive points of a release, as PoB counts them (Build.lua): each level from
 * `fromLevel` up to the maximum level grants `perLevel` points, and quest
 * rewards add `weaponSetByAct` points on top. PoB's limit for allocated nodes is
 * level points plus all weapon set points (`usedMax`); a consumer must add both
 * and must not cap the main tree at the level points alone. Points from items or nodes
 * ("Grants N Passive Skill Points") are a build matter, not part of the release.
 */
export const PassivePoints = z
  .object({
    mainTree: z.object({
      perLevel: z.int().positive(),
      fromLevel: z.int().positive(),
      origin: ReleaseFactOrigin,
    }),
    /** Weapon set points granted by quests, per act, in act order. */
    weaponSetByAct: z.object({
      acts: z
        .array(
          z.object({
            act: z.int().positive(),
            areaLevel: z.int().positive(),
            points: z.int().positive(),
          }),
        )
        .min(1),
      origin: ReleaseFactOrigin,
    }),
    /**
     * Ascendancy points a character can allocate in total: PoB's limits for the main and the
     * secondary ascendancy (Build.lua). The source has no split per stage or act, so none is
     * given; a consumer must not invent one.
     */
    ascendancy: z
      .object({
        points: z.int().positive(),
        secondaryPoints: z.int().nonnegative(),
        origin: ReleaseFactOrigin,
      })
      .optional(),
  })
  .superRefine((p, ctx) => {
    const seen = new Set<number>();
    p.weaponSetByAct.acts.forEach((a, i) => {
      if (seen.has(a.act)) {
        ctx.addIssue({
          code: "custom",
          path: ["weaponSetByAct", "acts", i, "act"],
          message: "duplicate act",
        });
      }
      seen.add(a.act);
    });
  });
export type PassivePoints = z.infer<typeof PassivePoints>;

/**
 * An equipment slot as PoB names it (the same string PoB uses for an equipped
 * item's slot). Jewel sockets are not listed. What a slot accepts is what PoB's
 * own slot check accepts, read when the release is built.
 */
export const ItemSlot = z
  .object({
    /** PoB slot name, e.g. "Body Armour" or "Ring 2". */
    id: z.string().min(1),
    /** Position in PoB's slot list (1-based), for display order. */
    order: z.int().positive(),
    /**
     * The game's inventory id of this slot (`Inventories.Id`, e.g. for the
     * `.build` export). Set from the release's slot mapping; absent when the
     * slot has no counterpart there, never guessed. Unique within the release.
     */
    gameId: z.string().min(1).optional(),
    /** Display name from PoB; several slots may share one (e.g. a weapon slot and its swap slot). */
    label: z.string().min(1),
    /** Weapon set the slot belongs to (1 = main set, 2 = swap set); absent for non-weapon slots. */
    weaponSet: z.union([z.literal(1), z.literal(2)]).optional(),
    /** Base item classes (`BaseItem.itemClass`) of which PoB accepts every base. */
    itemClasses: z.array(ClassificationId),
    /**
     * Bases of classes that PoB accepts only for some bases (e.g. life flasks
     * in one flask slot, arm limbs in an arm slot), as `BaseItem` ids.
     */
    partialBases: z.array(z.string().min(1)).optional(),
    /**
     * Set when PoB's rule for this slot depends on the item in another slot
     * (the off-hand depends on the main hand). `itemClasses` then lists every
     * class PoB accepts in some state of that slot; whether a class fits right
     * now is PoB's rule and must be checked with PoB.
     */
    dependsOnSlot: z.string().min(1).optional(),
    /** The slot exists only under a build condition PoB checks (e.g. an extra ring slot). */
    optional: z.boolean().optional(),
  })
  .refine((s) => s.itemClasses.length > 0 || (s.partialBases?.length ?? 0) > 0, {
    message: "a slot accepts something",
    path: ["itemClasses"],
  });
export type ItemSlot = z.infer<typeof ItemSlot>;

export const ItemSlots = z
  .object({ slots: z.array(ItemSlot).min(1), origin: ReleaseFactOrigin })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    const seenGame = new Set<string>();
    v.slots.forEach((slot, i) => {
      if (seen.has(slot.id)) {
        ctx.addIssue({ code: "custom", path: ["slots", i, "id"], message: "duplicate slot" });
      }
      seen.add(slot.id);
      if (slot.gameId !== undefined) {
        if (seenGame.has(slot.gameId))
          ctx.addIssue({
            code: "custom",
            path: ["slots", i, "gameId"],
            message: "duplicate gameId",
          });
        seenGame.add(slot.gameId);
      }
    });
  });
export type ItemSlots = z.infer<typeof ItemSlots>;

/**
 * Which of the release's classification ids are damage types and which are
 * defence layers, so guide text and summaries can be checked against the
 * release instead of free strings. Absent when the pipeline could not derive
 * them; consumers then say so instead of guessing.
 */
export const ReleaseClassifications = z
  .object({
    damageTypes: z.array(ClassificationId).min(1),
    defenceLayers: z.array(ClassificationId).min(1),
    origin: ReleaseFactOrigin,
  })
  .superRefine((v, ctx) => {
    for (const key of ["damageTypes", "defenceLayers"] as const) {
      if (new Set(v[key]).size !== v[key].length) {
        ctx.addIssue({ code: "custom", path: [key], message: "duplicate id" });
      }
    }
  });
export type ReleaseClassifications = z.infer<typeof ReleaseClassifications>;

/**
 * Item rarities of the release in ascending order, with the most affixes an
 * item of that rarity carries per generation type (for crafting rules). A
 * rarity without `maxAffixes` carries none through crafting (e.g. normal) or
 * is not crafted at all (unique). Absent when the pipeline could not derive
 * them; consumers then call crafting "uncalibrated" instead of guessing.
 */
export const ReleaseRarities = z
  .object({
    rarities: z
      .array(
        z.object({
          id: ClassificationId,
          name: z.string().min(1),
          /** Mods per generation type id (e.g. prefix and suffix) at most. */
          maxAffixes: z.record(ClassificationId, z.int().nonnegative()).optional(),
          /**
           * Limits that differ for base items of an item class (`BaseItem.itemClass`), in the
           * same form as `maxAffixes`; a class listed here uses these limits instead.
           */
          maxAffixesByItemClass: z
            .record(ClassificationId, z.record(ClassificationId, z.int().nonnegative()))
            .optional(),
        }),
      )
      .min(1),
    origin: ReleaseFactOrigin,
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.rarities.forEach((r, i) => {
      if (seen.has(r.id))
        ctx.addIssue({ code: "custom", path: ["rarities", i, "id"], message: "duplicate rarity" });
      seen.add(r.id);
    });
  });
export type ReleaseRarities = z.infer<typeof ReleaseRarities>;

export const DataRelease = z
  .object({
    id: DataReleaseId,
    gameVersion: GameVersion,
    pobVersion: PobVersion,
    pipelineRevision: z.int().positive(),
    /** Hashes of the inputs (PoB tree, data files …) keyed by source name. */
    sourceHashes: z.record(z.string().min(1), Sha256),
    /** Absent (never 0) when the pipeline could not read the value; consumers block visibly. */
    maxCharacterLevel: MaxCharacterLevel.optional(),
    passivePoints: PassivePoints.optional(),
    /** Equipment slots and the item classes each accepts; absent when PoB could not be asked. */
    itemSlots: ItemSlots.optional(),
    /**
     * Where `PassiveNode.gameId` and `ItemSlot.gameId` come from. Present when
     * the pipeline read them; `game-data` means the game's tables read in CI.
     */
    gameIds: z.object({ origin: ReleaseFactOrigin }).optional(),
    /** Damage types and defence layers of the release; absent when the pipeline could not derive them. */
    classifications: ReleaseClassifications.optional(),
    /** Item rarities and their affix limits; absent when the pipeline could not derive them. */
    rarities: ReleaseRarities.optional(),
    createdAt: IsoDateTime,
    previousReleaseId: DataReleaseId.optional(),
    /** Path of the CatalogDiff against previousReleaseId, inside the release. */
    diffPath: ReleasePath.optional(),
  })
  .superRefine((r, ctx) => {
    // The id field has its own regex issue; never throw inside validation.
    const match = DATA_RELEASE_ID_PATTERN.exec(r.id);
    if (!match) return;
    const parsed = { gameVersion: match[1], revision: Number(match[2]) };
    if (parsed.gameVersion !== r.gameVersion) {
      ctx.addIssue({ code: "custom", path: ["gameVersion"], message: "does not match id" });
    }
    if (parsed.revision !== r.pipelineRevision) {
      ctx.addIssue({ code: "custom", path: ["pipelineRevision"], message: "does not match id" });
    }
    if (
      r.maxCharacterLevel !== undefined &&
      r.passivePoints !== undefined &&
      r.passivePoints.mainTree.fromLevel > r.maxCharacterLevel.value
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["passivePoints", "mainTree", "fromLevel"],
        message: "is above maxCharacterLevel",
      });
    }
    if (r.diffPath !== undefined && r.previousReleaseId === undefined) {
      ctx.addIssue({ code: "custom", path: ["diffPath"], message: "needs previousReleaseId" });
    }
  });
export type DataRelease = z.infer<typeof DataRelease>;

const shard = <K extends EntityKind, T extends z.ZodType>(kind: K, entity: T) =>
  z.object({
    schemaVersion: z.literal(CATALOG_SCHEMA_VERSION),
    dataReleaseId: DataReleaseId,
    kind: z.literal(kind),
    entities: z.array(entity),
  });

/** One file of a data release: all entities of one kind. */
export const CatalogShard = z.discriminatedUnion("kind", [
  shard("baseItem", BaseItem),
  shard("mod", Mod),
  shard("uniqueItem", UniqueItem),
  shard("gem", Gem),
  shard("passiveNode", PassiveNode),
  shard("passiveGroup", PassiveGroup),
  shard("characterClass", CharacterClass),
  shard("ascendancy", Ascendancy),
  shard("craftingAction", CraftingAction),
  shard("statTranslation", StatTranslation),
]);
export type CatalogShard = z.infer<typeof CatalogShard>;

/** Entry file of a data release; the app verifies every shard hash before use. */
export const CatalogManifest = z
  .object({
    schemaVersion: z.literal(CATALOG_SCHEMA_VERSION),
    release: DataRelease,
    shards: z.array(
      z.object({
        kind: EntityKind,
        path: ReleasePath,
        sha256: Sha256,
        count: z.int().nonnegative(),
      }),
    ),
  })
  .superRefine((m, ctx) => {
    const seen = new Set<string>();
    m.shards.forEach((s, i) => {
      if (seen.has(s.kind)) {
        ctx.addIssue({ code: "custom", path: ["shards", i, "kind"], message: "duplicate kind" });
      }
      seen.add(s.kind);
    });
  });
export type CatalogManifest = z.infer<typeof CatalogManifest>;

export const FieldChange = z.object({
  /** JSON pointer into the entity, e.g. "/stats/0/max". */
  path: z.string().startsWith("/"),
  before: JsonValue.optional(),
  after: JsonValue.optional(),
});
export type FieldChange = z.infer<typeof FieldChange>;

export const KindDiff = z.object({
  added: z.array(z.string().min(1)),
  removed: z.array(z.string().min(1)),
  changed: z.array(z.object({ id: z.string().min(1), fields: z.array(FieldChange).min(1) })),
});
export type KindDiff = z.infer<typeof KindDiff>;

/** Machine-readable diff between two data releases (basis for F-19 revalidation). */
export const CatalogDiff = z
  .object({
    schemaVersion: z.literal(CATALOG_SCHEMA_VERSION),
    from: DataReleaseId,
    to: DataReleaseId,
    kinds: z.partialRecord(EntityKind, KindDiff),
  })
  .refine((d) => d.from !== d.to, { message: "from and to must differ", path: ["to"] });
export type CatalogDiff = z.infer<typeof CatalogDiff>;
