import { z } from "zod";
import { GateResult } from "@astrolabe/contracts/build";
import type { JsonValue } from "@astrolabe/contracts/common";
import { type CalcId, PobVersion } from "@astrolabe/contracts/common";
import {
  GUIDE_SCHEMA_VERSION,
  type GuideDocument,
  PublishedGuide,
} from "@astrolabe/contracts/guide";
import type { StageConfig } from "../config.js";
import type { PipelineContext, PlanStep } from "../pipeline.js";
import { GuideDraft } from "./s10-validate.js";

export const S11_GUIDE_KEY = "S11.guide";

type S11Config = NonNullable<StageConfig["s11"]>;

const StoredReport = z.object({
  passed: z.boolean(),
  gates: z.array(GateResult),
  draft: GuideDraft,
});

/** Every `pobVersion` the measured values of the draft name (the guide is built from one engine). */
export function pobVersionsOf(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) pobVersionsOf(v, found);
  } else if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      if (k === "pobVersion" && typeof v === "string") found.add(v);
      else pobVersionsOf(v, found);
    }
  }
  return found;
}

/** Every calc id the draft refers to (stage and gear-tier measurements). */
export function calcIdsOf(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) calcIdsOf(v, found);
  } else if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      if (k === "calcId" && typeof v === "string") found.add(v);
      else calcIdsOf(v, found);
    }
  }
  return found;
}

/** Share (0–100) of the weighted guide parts that are not empty, with the weights of the config. */
export function completenessOf(draft: GuideDraft, weights: S11Config["weights"]): number {
  const filled: Record<keyof S11Config["weights"], boolean> = {
    summary: true,
    mechanics: true,
    progression: draft.progression.stages.length > 0,
    gear: draft.gear.tiers.length > 0,
    crafting: draft.crafting.length > 0,
    playstyle: true,
    atlas: true,
    variants: draft.variants.length > 0,
    faq: draft.faq.length > 0,
  };
  const entries = Object.entries(weights) as [keyof S11Config["weights"], number][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  const got = entries.reduce((sum, [k, w]) => sum + (filled[k] ? w : 0), 0);
  return (100 * got) / total;
}

/** S11: the validated draft becomes the published guide with metadata and the validation report. */
export function publishStep(ctx: PipelineContext, cfg: S11Config, promptVersion: string): PlanStep {
  void ctx;
  return {
    kind: "server",
    key: S11_GUIDE_KEY,
    type: "S11",
    run: async (runCtx) => {
      const report = StoredReport.safeParse(runCtx.result("S10.report"));
      if (!report.success) {
        throw new Error("The stored validation report is unreadable; redo stage S10", {
          cause: report.error,
        });
      }
      if (!report.data.passed) {
        throw new Error("The guide did not pass validation and cannot be published");
      }
      const { draft } = report.data;
      // Sourced values name their PoB version; the plain calc references (calcId) are read from the
      // stored results, so a guide whose prices are uncalibrated still knows its engine.
      const found = pobVersionsOf(draft);
      for (const id of calcIdsOf(draft)) {
        const result = await runCtx.calc.getResult(id as CalcId);
        if (result === undefined) {
          throw new Error(
            `The calculation ${id} of the guide is gone; redo the stage that made it`,
          );
        }
        found.add(result.pobVersion);
      }
      const versions = [...found];
      const pobVersion = versions[0];
      if (versions.length !== 1 || pobVersion === undefined) {
        throw new Error(
          `The guide must carry exactly one PoB version in its measured values, found ${String(versions.length)}`,
        );
      }
      const document: GuideDocument = {
        ...draft,
        metadata: {
          // The run id is a uuid and names the guide, so the stored guide and the run share one id.
          guideId: runCtx.run.runId,
          revision: 0,
          schemaVersion: GUIDE_SCHEMA_VERSION,
          dataReleaseId: runCtx.run.request.dataReleaseId,
          pobVersion: PobVersion.parse(pobVersion),
          generatedAt: new Date().toISOString(),
          // The client does not report which model answered which task.
          models: [],
          promptVersions: { forge: promptVersion },
          seeds: {},
        },
        validation: {
          gates: report.data.gates,
          completenessScore: completenessOf(draft, cfg.weights),
          scoringConfigVersion: cfg.scoringConfigVersion,
          passed: report.data.passed,
        },
      };
      const published = PublishedGuide.safeParse(document);
      if (!published.success) {
        throw new Error("The assembled guide is not valid", { cause: published.error });
      }
      return JSON.parse(JSON.stringify(published.data)) as JsonValue;
    },
  };
}
