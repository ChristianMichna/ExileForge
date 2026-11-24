import { z } from "zod";
import { EntityKind } from "../common/ids.js";
import { JsonValue } from "../common/json.js";
import {
  DataReleaseId,
  GameVersion,
  IsoDateTime,
  PobVersion,
  Sha256,
  parseDataReleaseId,
} from "../common/version.js";
import {
  Ascendancy,
  BaseItem,
  CharacterClass,
  CraftingAction,
  Gem,
  Mod,
  PassiveNode,
  StatTranslation,
  UniqueItem,
} from "./entities.js";

/** Version of the catalog file layout below; bump with a migration. */
export const CATALOG_SCHEMA_VERSION = 1;

export const DataRelease = z
  .object({
    id: DataReleaseId,
    gameVersion: GameVersion,
    pobVersion: PobVersion,
    pipelineRevision: z.int().positive(),
    /** Hashes of the inputs (PoB tree, data files …) keyed by source name. */
    sourceHashes: z.record(z.string().min(1), Sha256),
    createdAt: IsoDateTime,
    previousReleaseId: DataReleaseId.optional(),
    /** Path of the CatalogDiff against previousReleaseId, inside the release. */
    diffPath: z.string().min(1).optional(),
  })
  .superRefine((r, ctx) => {
    const parsed = parseDataReleaseId(r.id);
    if (parsed.gameVersion !== r.gameVersion) {
      ctx.addIssue({ code: "custom", path: ["gameVersion"], message: "does not match id" });
    }
    if (parsed.revision !== r.pipelineRevision) {
      ctx.addIssue({ code: "custom", path: ["pipelineRevision"], message: "does not match id" });
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
        path: z.string().min(1),
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
export const CatalogDiff = z.object({
  schemaVersion: z.literal(CATALOG_SCHEMA_VERSION),
  from: DataReleaseId,
  to: DataReleaseId,
  kinds: z.partialRecord(EntityKind, KindDiff),
});
export type CatalogDiff = z.infer<typeof CatalogDiff>;
