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
 * item's slot). Jewel sockets are tied to passive nodes and are not listed.
 */
export const ItemSlot = z.object({
  /** PoB slot name, e.g. "Body Armour" or "Ring 2". */
  id: z.string().min(1),
  /** Display name from PoB; several slots may share one (e.g. "Ring 1" and the swap slot). */
  label: z.string().min(1),
  /** Weapon set the slot belongs to (1 = main set, 2 = swap set); absent for non-weapon slots. */
  weaponSet: z.union([z.literal(1), z.literal(2)]).optional(),
  /** Base item classes (`BaseItem.itemClass`) that PoB accepts in this slot. */
  itemClasses: z.array(ClassificationId).min(1),
});
export type ItemSlot = z.infer<typeof ItemSlot>;

export const ItemSlots = z
  .object({ slots: z.array(ItemSlot).min(1), origin: ReleaseFactOrigin })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.slots.forEach((slot, i) => {
      if (seen.has(slot.id)) {
        ctx.addIssue({ code: "custom", path: ["slots", i, "id"], message: "duplicate slot" });
      }
      seen.add(slot.id);
    });
  });
export type ItemSlots = z.infer<typeof ItemSlots>;

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
