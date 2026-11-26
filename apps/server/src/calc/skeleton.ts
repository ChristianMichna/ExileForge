import type {
  ProgressionPort,
  ProgressionRequest,
  ProgressionStageTree,
  SkeletonPort,
  SkeletonRequest,
  TargetPort,
  TargetRequest,
  TargetTree,
} from "@astrolabe/agents";
import {
  optimizeProgression,
  optimizeTree,
  TreeGraph,
  createPobTreeEvaluator,
  type CalcRequester as OptimizerPool,
  type OptimizerConfig,
  type TreeOptimizeResult,
} from "@astrolabe/optimizer";
import { ArchetypeEvaluation, BuildState } from "@astrolabe/contracts/build";
import type { CharacterClass, PassiveNode } from "@astrolabe/contracts/catalog";
import type { PassiveNodeId } from "@astrolabe/contracts/common";
import type { CalcProfileId } from "@astrolabe/contracts/common";
import type { CalcPort } from "../ports/calc.js";
import type { CatalogPort } from "../ports/catalog.js";
import type { Logger } from "../logger.js";
import { scaleGemLevels } from "./gem-levels.js";
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

/** Settings of the progression (config/agents/stages.json → s6, without the stage table). */
export interface ProgressionSettings {
  calcProfiles: readonly CalcProfileId[];
  objective: {
    weights: Record<string, number>;
    floors: Record<string, number>;
    floorsFromMetrics?: Record<string, string>;
  };
}

/** Settings of the endgame target tree (config/agents/stages.json → s5, without level and points). */
export interface TargetSettings {
  calcProfiles: readonly CalcProfileId[];
  objective: {
    weights: Record<string, number>;
    floors: Record<string, number>;
    floorsFromMetrics?: Record<string, string>;
  };
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
  /** Present when S5 is configured. */
  target?: TargetSettings;
  /** Present when S6 is configured. */
  progression?: ProgressionSettings;
  logger: Logger;
  /** Replaceable in tests. */
  optimize?: typeof optimizeTree;
  optimizeStages?: typeof optimizeProgression;
}

/**
 * S3 on Path of Building: main skill with the profile's first supports on the
 * candidate's class and ascendancy, then a short tree optimisation within
 * the configured point budget, then the full measurement per calc profile.
 * The skeleton has no items; gear comes in later stages.
 */
export class PobSkeleton implements SkeletonPort, TargetPort, ProgressionPort {
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
    const result = await this.optimizeFrom(empty, {
      request: input.request,
      profile,
      candidateKey: candidate.key,
      classId: candidate.classId,
      budget: settings.passivePoints,
      objective: settings.objective,
      calcProfile: settings.calcProfiles[0] as CalcProfileId,
    });
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

  /** S5: optimises the endgame tree of the chosen build and measures it with every target profile. */
  async optimizeTree(input: TargetRequest): Promise<TargetTree> {
    const settings = this.options.target;
    if (settings === undefined)
      throw new Error("The target tree settings (stages.json s5) are not configured");
    if (this.options.catalog.dataReleaseId !== input.request.dataReleaseId) {
      throw new Error(
        `Request targets ${input.request.dataReleaseId} but the loaded catalog is ${this.options.catalog.dataReleaseId}`,
      );
    }
    const start = BuildState.parse({ ...input.state, tree: { allocated: [], ascendancy: [] } });
    const result = await this.optimizeFrom(start, {
      request: input.request,
      profile: input.profile,
      candidateKey: input.candidate.key,
      classId: input.candidate.classId,
      budget: input.passivePoints,
      objective: settings.objective,
      calcProfile: settings.calcProfiles[0] as CalcProfileId,
    });
    const state = BuildState.parse({
      ...start,
      tree: { allocated: result.allocated.map((nodeId) => ({ nodeId })), ascendancy: [] },
    });
    const calcs = await this.options.calc.calculate({
      state,
      profiles: settings.calcProfiles,
      overrides: input.request.calcOverrides,
    });
    // The target is the validated endgame build: an incomplete tree or a failed measurement must
    // show up as a failed job, never as a target with missing numbers.
    if (!result.feasible) {
      throw new Error(
        `The tree optimisation could not meet the objective floors: ${JSON.stringify(result.violations)}`,
      );
    }
    for (const [profileId, outcome] of Object.entries(calcs)) {
      if (outcome.status === "failed") {
        throw new Error(
          `The engine could not measure the target tree (profile ${profileId}): ${outcome.error.message}`,
        );
      }
    }
    return { state, calcs };
  }

  /** S6: orders the target tree into nested stages and measures each stage. */
  async optimizeProgression(input: ProgressionRequest): Promise<ProgressionStageTree[]> {
    const settings = this.options.progression;
    if (settings === undefined) {
      throw new Error("The progression settings (stages.json s6) are not configured");
    }
    if (this.options.catalog.dataReleaseId !== input.request.dataReleaseId) {
      throw new Error(
        `Request targets ${input.request.dataReleaseId} but the loaded catalog is ${this.options.catalog.dataReleaseId}`,
      );
    }
    const base = BuildState.parse({
      ...input.target.state,
      tree: { allocated: [], ascendancy: [] },
    });
    const graph = this.graphFor(input.candidate.classId);
    const targetNodes = input.target.state.tree.allocated.map((n) => n.nodeId as PassiveNodeId);
    const result = await this.options.pob.withBuild(base, (handle) =>
      (this.options.optimizeStages ?? optimizeProgression)({
        graph,
        target: targetNodes,
        stages: input.stages.map((s) => ({ key: s.key, budget: s.budget })),
        objective: settings.objective,
        evaluator: createPobTreeEvaluator({
          pool: this.options.pool,
          handle,
          profile: settings.calcProfiles[0] as CalcProfileId,
          baseAllocated: [],
          overrides: input.request.calcOverrides,
        }),
        config: this.options.optimizerConfig,
        priorityNodeIds: input.profile.relevantNodes.filter((id) => graph.has(id)),
      }),
    );
    if (result.failedEvaluationCount > 0) {
      this.options.logger.info("progression had failed evaluations", {
        candidate: input.candidate.key,
        failedEvaluations: result.failedEvaluationCount,
        firstFailures: result.failedEvaluations.slice(0, 3),
      });
    }
    const last = result.stages.at(-1);
    if (last === undefined || last.allocated.length < targetNodes.length) {
      throw new Error(
        `The last stage ends with ${last?.allocated.length ?? 0} of ${targetNodes.length} target nodes; raise its passive points`,
      );
    }
    const out: ProgressionStageTree[] = [];
    for (const stage of result.stages) {
      const level = input.stages.find((s) => s.key === stage.key)?.level;
      if (level === undefined) throw new Error(`Stage ${stage.key} has no level`);
      if (!stage.feasible) {
        throw new Error(
          `Stage ${stage.key} could not meet the objective floors: ${JSON.stringify(stage.violations)}`,
        );
      }
      // The gems of a stage are at the level its character level allows, not at the target's.
      const state = scaleGemLevels(
        BuildState.parse({
          ...base,
          level,
          tree: { allocated: stage.allocated.map((nodeId) => ({ nodeId })), ascendancy: [] },
        }),
        level,
        this.options.catalog,
      );
      const calcs = await this.options.calc.calculate({
        state,
        profiles: settings.calcProfiles,
        overrides: input.request.calcOverrides,
      });
      for (const [profileId, outcome] of Object.entries(calcs)) {
        if (outcome.status === "failed") {
          throw new Error(
            `The engine could not measure stage ${stage.key} (profile ${profileId}): ${outcome.error.message}`,
          );
        }
      }
      out.push({
        key: stage.key,
        state,
        allocationOrder: stage.allocationOrder,
        respecs: stage.respecs,
        unspent: stage.unspent,
        calcs,
      });
    }
    return out;
  }

  /** Tree optimisation from an empty tree within a budget; logs when it ends incomplete. */
  private async optimizeFrom(
    start: BuildState,
    job: {
      request: SkeletonRequest["request"];
      profile: SkeletonRequest["profile"];
      candidateKey: string;
      classId: string;
      budget: number;
      objective: {
        weights: Record<string, number>;
        floors: Record<string, number>;
        floorsFromMetrics?: Record<string, string>;
      };
      calcProfile: CalcProfileId;
    },
  ): Promise<TreeOptimizeResult> {
    const graph = this.graphFor(job.classId);
    const excluded = job.request.exclusions
      .filter((e) => e.kind === "passiveNode")
      .map((e) => e.id as PassiveNodeId);
    const optimize = this.options.optimize ?? optimizeTree;
    const result: TreeOptimizeResult = await this.options.pob.withBuild(start, (handle) =>
      optimize({
        graph,
        allocated: [],
        budget: job.budget,
        objective: job.objective,
        evaluator: createPobTreeEvaluator({
          pool: this.options.pool,
          handle,
          profile: job.calcProfile,
          baseAllocated: [],
          overrides: job.request.calcOverrides,
        }),
        config: this.options.optimizerConfig,
        priorityNodeIds: job.profile.relevantNodes.filter((id) => graph.has(id)),
        forbiddenNodeIds: excluded.filter((id) => graph.has(id)),
      }),
    );
    if (!result.feasible || result.failedEvaluationCount > 0) {
      this.options.logger.info("tree optimisation is incomplete", {
        candidate: job.candidateKey,
        feasible: result.feasible,
        violations: result.violations,
        failedEvaluations: result.failedEvaluationCount,
        firstFailures: result.failedEvaluations.slice(0, 3),
        stoppedBy: result.stoppedBy,
      });
    }
    return result;
  }

  private graphFor(classId: string): TreeGraph {
    const cached = this.graphs.get(classId);
    if (cached !== undefined) return cached;
    const entry = this.options.catalog.get({ kind: "characterClass", id: classId });
    if (entry === undefined) throw new Error(`Class ${classId} is not in the catalog`);
    const nodes = this.options.catalog.list("passiveNode").map((e) => e.entity as PassiveNode);
    const graph = TreeGraph.build(
      nodes,
      (entry.entity as CharacterClass).startNodeId,
      this.options.optimizerConfig.lockedNodeGameIdPrefixes,
    );
    this.graphs.set(classId, graph);
    return graph;
  }
}
