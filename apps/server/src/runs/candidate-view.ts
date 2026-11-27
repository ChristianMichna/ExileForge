import {
  ArchetypeCandidate,
  ArchetypeEvaluation,
  CandidateComparisonView,
} from "@astrolabe/contracts/build";
import { CalcResult } from "@astrolabe/contracts/calc";
import { CalcId } from "@astrolabe/contracts/common";
import { collectCalcIds } from "@astrolabe/contracts/guide";
import { collectGuideRefs } from "@astrolabe/revalidate";
import { z } from "zod";
import { ForgeError } from "../engine/errors.js";
import type { RunRecord } from "../engine/run-record.js";
import { refName } from "../guides/guide-view.js";
import type { CalcPort } from "../ports/calc.js";
import type { CatalogPort } from "../ports/catalog.js";

const CANDIDATE_KEY = /^S2\.candidate-(\d+)$/;
const S3_KEYS = (key: string): boolean =>
  key === "S3.evaluations" || key.startsWith("S3.evaluate:");
const Selection = z.object({ candidateKey: z.string().min(1) });

function parseStored<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new ForgeError("invalid_request", `Stored ${what} of the run is not valid.`, {
    cause: parsed.error,
  });
}

/**
 * The candidates of a run with the names of what they refer to and the stored PoB results behind
 * the measured numbers. Works for the stored results of both pipelines. A name or result that is
 * not available stays absent and is listed in `unresolved`; a run of another data release gets no
 * names (an id can mean something else there). The pick is only reported when it names a
 * listed candidate.
 */
export async function buildCandidateView(
  run: RunRecord,
  catalog: CatalogPort,
  calc: CalcPort,
): Promise<CandidateComparisonView> {
  const candidates = Object.entries(run.results)
    .flatMap(([key, stored]) => {
      const index = CANDIDATE_KEY.exec(key)?.[1];
      return index === undefined ? [] : [{ index: Number(index), key, value: stored.value }];
    })
    .sort((a, b) => a.index - b.index)
    .map((c) => parseStored(ArchetypeCandidate, c.value, `candidate ${c.key}`));

  const evaluationKey = Object.keys(run.results).find(S3_KEYS);
  const evaluations =
    evaluationKey === undefined
      ? []
      : parseStored(
          z.array(ArchetypeEvaluation),
          run.results[evaluationKey]?.value,
          "candidate measurements",
        );

  const listed = new Set(candidates.map((c) => c.key));
  const selection = run.results["S4.selection"];
  const picked =
    selection === undefined
      ? run.interventions
          .map((i) => i.intervention)
          .filter((i) => i.kind === "chooseVariant")
          .map((i) => i.candidateKey)
          .at(-1)
      : parseStored(Selection, selection.value, "selection").candidateKey;
  const chosenKey = picked !== undefined && listed.has(picked) ? picked : undefined;

  const current = run.request.dataReleaseId === catalog.dataReleaseId;
  const unresolved = new Set<string>();
  const names: Record<string, string> = {};
  for (const ref of collectGuideRefs({ candidates, evaluations })) {
    const key = `${ref.kind}:${ref.id}`;
    if (key in names || unresolved.has(key)) continue;
    const name = current ? refName(catalog, ref.kind, ref.id) : undefined;
    if (name === undefined) unresolved.add(key);
    else names[key] = name;
  }

  const loaded = await Promise.all(
    collectCalcIds(evaluations).map(async (raw) => {
      const calcId = CalcId.safeParse(raw);
      if (!calcId.success) return { raw, result: undefined };
      return { raw, result: await calc.getResult(calcId.data) };
    }),
  );
  const results: Record<string, CalcResult> = {};
  for (const { raw, result } of loaded) {
    const valid = CalcResult.safeParse(result);
    if (valid.success && valid.data.calcId === raw) results[raw] = valid.data;
    else unresolved.add(`calc:${raw}`);
  }

  return CandidateComparisonView.parse({
    runId: run.runId,
    catalogReleaseId: catalog.dataReleaseId,
    current,
    candidates,
    evaluations,
    ...(chosenKey === undefined ? {} : { chosenKey }),
    names,
    results,
    unresolved: [...unresolved],
  });
}
