export { loadPobSources, pobSourcesSchema, type PobSources } from "./config.ts";
export { diffEntities, diffValue, type FieldChange, type KindDiff } from "./diff/diff.ts";
export {
  CATALOG_DIFF_FILE,
  diffCatalogs,
  summarizeCatalogDiff,
  writeCatalogDiff,
} from "./diff/catalog-diff.ts";
export { diffSnapshots, summarizeDiff, type SnapshotDiff } from "./diff/snapshot-diff.ts";
export { extractRaw, pobInstallFromHome, type PobInstall } from "./pob/extract.ts";
export { buildSnapshot } from "./snapshot/build.ts";
export {
  readManifest,
  readShard,
  releaseId,
  snapshotManifestSchema,
  type SnapshotManifest,
} from "./snapshot/snapshot.ts";
export type { Json } from "./json.ts";
export {
  modLines,
  resolveModStats,
  type ModStatResult,
  type ModStatSummary,
} from "./normalize/mod-stats.ts";
export {
  StatMatcher,
  shapeKey,
  type MatchResult,
  type StatValue,
} from "./normalize/stat-matcher.ts";
export {
  loadNormalizeConfig,
  normalizeCatalog,
  normalizeConfigSchema,
  type CatalogEntities,
  type Finding,
  type NormalizeConfig,
} from "./normalize/catalog.ts";
export { buildCatalog, type CatalogBuildResult } from "./normalize/release.ts";
export { validateCatalog, type ValidationResult } from "./normalize/validate.ts";
export {
  gameDataConfigSchema,
  loadGameDataConfig,
  type GameDataConfig,
} from "./gamedata/config.ts";
export {
  exportGameData,
  gameDataManifestSchema,
  readGameDataManifest,
  readGameDataTable,
  resolveDatTool,
  TableMissingError,
  type GameDataManifest,
  type GameDataRow,
} from "./gamedata/export.ts";
export { parsePatchReply, queryPatchServer, type PatchInfo } from "./gamedata/patch.ts";
