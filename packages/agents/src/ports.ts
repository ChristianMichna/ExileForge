import type {
  ArchetypeCandidate,
  ArchetypeEvaluation,
  BuildRequest,
  SkillProfile,
  TargetBuild,
} from "@astrolabe/contracts/build";
import type { BuildState, CalcOutcome } from "@astrolabe/contracts/build";
import type { CalcResult, ConfigOverrides } from "@astrolabe/contracts/calc";
import type {
  CalcId,
  CalcProfileId,
  DataReleaseId,
  EntityKind,
  EntityRef,
} from "@astrolabe/contracts/common";

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
    /** The player's overrides of the calc profiles; they win over `state.config`. */
    overrides?: ConfigOverrides;
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

/** Input of one skeleton build (S3). */
export interface SkeletonRequest {
  request: BuildRequest;
  profile: SkillProfile;
  candidate: ArchetypeCandidate;
}

/**
 * Builds and measures the skeleton build of one candidate: short tree
 * optimisation plus the main skill with supports, every number from PoB.
 * Only present when the real engine runs; calc-fake cannot provide it.
 */
export interface SkeletonPort {
  evaluate(input: SkeletonRequest): Promise<ArchetypeEvaluation>;
}

/** Input of the endgame target tree (S5): the chosen candidate with its final skill setup. */
export interface TargetRequest {
  request: BuildRequest;
  profile: SkillProfile;
  candidate: ArchetypeCandidate;
  /** The build to optimise: class, level and skills as chosen; tree empty. */
  state: BuildState;
  /** Points the main tree may use. */
  passivePoints: number;
}

/** Result of the target tree: the build with its tree and a measurement per calc profile. */
export interface TargetTree {
  state: BuildState;
  calcs: Record<CalcProfileId, CalcOutcome>;
}

/**
 * Optimises the endgame passive tree of the chosen build and measures it.
 * Present only with the real engine, like the skeleton port.
 */
export interface TargetPort {
  optimizeTree(input: TargetRequest): Promise<TargetTree>;
}

/** Input of the progression (S6): the validated target and the stages' point budgets. */
export interface ProgressionRequest {
  request: BuildRequest;
  profile: SkillProfile;
  candidate: ArchetypeCandidate;
  target: TargetBuild;
  stages: readonly { key: string; budget: number }[];
}

/** One stage of the progression: nested tree, allocation order and a measurement per profile. */
export interface ProgressionStageTree {
  key: string;
  state: BuildState;
  allocationOrder: string[];
  respecs: string[];
  calcs: Record<CalcProfileId, CalcOutcome>;
}

/**
 * Orders the target tree into nested stages and measures each one.
 * Present only with the real engine, like the skeleton port.
 */
export interface ProgressionPort {
  optimizeProgression(input: ProgressionRequest): Promise<ProgressionStageTree[]>;
}
