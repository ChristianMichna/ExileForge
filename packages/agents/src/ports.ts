import type { BuildState, CalcOutcome } from "@exileforge/contracts/build";
import type { CalcResult } from "@exileforge/contracts/calc";
import type {
  CalcId,
  CalcProfileId,
  DataReleaseId,
  EntityKind,
  EntityRef,
} from "@exileforge/contracts/common";

/** Which engine answers: the PoB worker pool, or calc-fake (fantasy values, tests and PoC only). */
export type CalcEngineKind = "pob" | "fake";

/**
 * The pipeline's narrow view of the calc service. A failed calculation is a
 * `failed` outcome, never a zero or an empty result.
 */
export interface CalcPort {
  readonly engine: CalcEngineKind;
  calculate(input: {
    state: BuildState;
    profiles: readonly CalcProfileId[];
  }): Promise<Record<CalcProfileId, CalcOutcome>>;
  /** Result of an earlier calculation; undefined if the id is unknown. */
  getResult(calcId: CalcId): Promise<CalcResult | undefined>;
}

/** One catalog entry as the pipeline needs it: id, display name, full entity as data. */
export interface CatalogEntry {
  kind: EntityKind;
  id: string;
  name?: string;
  entity: unknown;
}

export interface CatalogQuery {
  kind?: EntityKind;
  /** Case-insensitive substring of name or id; empty matches everything. */
  text?: string;
  /** Entity must carry all of these tags (entities without tags never match). */
  tags?: readonly string[];
  limit: number;
}

/** Read access to the catalog of one data release (gate G1, catalog tools, deterministic steps). */
export interface CatalogPort {
  readonly dataReleaseId: DataReleaseId;
  get(ref: EntityRef): CatalogEntry | undefined;
  search(query: CatalogQuery): CatalogEntry[];
  /** All entries of a kind in catalog order. */
  list(kind: EntityKind): CatalogEntry[];
  /** Whether any mod, passive node or gem of the release uses this stat id. */
  hasStat(statId: string): boolean;
}
