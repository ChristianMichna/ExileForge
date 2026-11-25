import type { SkeletonPort, SkeletonRequest } from "@exileforge/agents";
import {
  optimizeTree,
  TreeGraph,
  createPobTreeEvaluator,
  type CalcRequester as OptimizerPool,
  type OptimizerConfig,
  type TreeOptimizeResult,
} from "@exileforge/optimizer";
import { ArchetypeEvaluation, BuildState } from "@exileforge/contracts/build";
import type { CharacterClass, PassiveNode } from "@exileforge/contracts/catalog";
import type { PassiveNodeId } from "@exileforge/contracts/common";
import type { CalcProfileId } from "@exileforge/contracts/common";
import type { CalcPort } from "../ports/calc.js";
import type { CatalogPort } from "../ports/catalog.js";
import type { Logger } from "../logger.js";
import type { PobCalc } from "./pob-calc.js";

/** Settings of the skeleton build (config/agents/stages.json → s3). */
export interface SkeletonSettings {
  level: number;
  passivePoints: number;
  gemLevel: number;
  supportCount: number;
  calcProfiles: readonly CalcProfileId[];
  objective: { weights: Record<string, number>; floors: Record<string, number> };
}

export interface PobSkeletonOptions {
  pob: Pick<PobCalc, "withBuild">;
  /** The pool the optimizer measures with (same one PobCalc uses). */
  pool: OptimizerPool;
  /** Persisting calc port, so calc references of the evaluation stay valid. */
  calc: CalcPort;
  catalog: CatalogPort;
  optimizerConfig: OptimizerConfig;
  settings: SkeletonSettings;
  logger: Logger;
  /** Replaceable in tests. */
  optimize?: typeof optimizeTree;
}

/**
 * S3 on Path of Building: main skill with the profile's first supports on the
 * candidate's class and ascendancy, then a short tree optimisation within
 * the configured point budget, then the full measurement per calc profile.
 * The skeleton has no items; gear comes in later stages.
 */
export class PobSkeleton implements SkeletonPort {
  private readonly graphs = new Map<string, TreeGraph>();

  constructor(private readonly options: PobSkeletonOptions) {}

  async evaluate(input: SkeletonRequest): Promise<ArchetypeEvaluation> {
    const { settings, catalog } = this.options;
    const { candidate, profile } = input;
    if (catalog.dataReleaseId !== input.request.dataReleaseId) {
      throw new Error(
        `Request targets ${input.request.dataReleaseId} but the loaded catalog is ${catalog.dataReleaseId}`,
      );
    }
    const empty = BuildState.parse({
      classId: candidate.classId,
      ascendancyId: candidate.ascendancyId,
      level: settings.level,
      tree: { allocated: [] },
      skills: [
        {
          key: "main",
          role: "main",
          gem: { gemId: profile.mainSkillId, level: settings.gemLevel },
          supports: profile.supportCandidates
            .slice(0, settings.supportCount)
            .map((gemId) => ({ gemId, level: settings.gemLevel })),
        },
      ],
      items: [],
      config: {},
    });
    const graph = this.graphFor(candidate.classId);
    const excluded = input.request.exclusions
      .filter((e) => e.kind === "passiveNode")
      .map((e) => e.id as PassiveNodeId);
    const optimize = this.options.optimize ?? optimizeTree;

    const result: TreeOptimizeResult = await this.options.pob.withBuild(empty, (handle) =>
      optimize({
        graph,
        allocated: [],
        budget: settings.passivePoints,
        objective: settings.objective,
        evaluator: createPobTreeEvaluator({
          pool: this.options.pool,
          handle,
          profile: settings.calcProfiles[0] as CalcProfileId,
          baseAllocated: [],
          overrides: input.request.calcOverrides,
        }),
        config: this.options.optimizerConfig,
        priorityNodeIds: profile.relevantNodes.filter((id) => graph.has(id)),
        forbiddenNodeIds: excluded.filter((id) => graph.has(id)),
      }),
    );
    if (!result.feasible || result.failedEvaluationCount > 0) {
      this.options.logger.info("skeleton optimisation is incomplete", {
        candidate: candidate.key,
        feasible: result.feasible,
        violations: result.violations,
        failedEvaluations: result.failedEvaluationCount,
        stoppedBy: result.stoppedBy,
      });
    }
    const skeleton = BuildState.parse({
      ...empty,
      tree: { allocated: result.allocated.map((nodeId) => ({ nodeId })), ascendancy: [] },
    });
    const calcs = await this.options.calc.calculate({
      state: skeleton,
      profiles: settings.calcProfiles,
      overrides: input.request.calcOverrides,
    });
    return ArchetypeEvaluation.parse({ candidateKey: candidate.key, skeleton, calcs });
  }

  private graphFor(classId: string): TreeGraph {
    const cached = this.graphs.get(classId);
    if (cached !== undefined) return cached;
    const entry = this.options.catalog.get({ kind: "characterClass", id: classId });
    if (entry === undefined) throw new Error(`Class ${classId} is not in the catalog`);
    const nodes = this.options.catalog.list("passiveNode").map((e) => e.entity as PassiveNode);
    const graph = TreeGraph.build(nodes, (entry.entity as CharacterClass).startNodeId);
    this.graphs.set(classId, graph);
    return graph;
  }
}
