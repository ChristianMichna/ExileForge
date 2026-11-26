import type { Measured, Source } from "@astrolabe/contracts/common";
import type { ProvenanceView, ValueState } from "@astrolabe/ui";

/** The source of a number as the provenance badge shows it. */
function provenanceOf(source: Source): ProvenanceView {
  switch (source.kind) {
    case "pob":
      return { kind: "pob", pobVersion: source.pobVersion, calcProfile: source.calcProfile };
    case "gamedata":
      return { kind: "gamedata", dataRelease: source.dataReleaseId };
    case "market":
      return { kind: "market", provider: source.provider, fetchedAt: source.fetchedAt };
    case "derived": {
      // A derived number names the market data it was computed from (league and date).
      const markets = source.inputs.flatMap((input) =>
        input.kind === "market" ? [`${input.league} ${input.fetchedAt}`] : [],
      );
      const from = markets.length > 0 ? `; market ${markets.join(", ")}` : "";
      return { kind: "derived", formula: `${source.formula} v${source.formulaVersion}${from}` };
    }
  }
}

/**
 * A measured number as the state StatValue shows. An uncalibrated or failed number stays that
 * way; there is no fallback value. `scale` only converts the unit for display (a chance of
 * 0.25 is shown as 25).
 */
export function measuredState(m: Measured<number>, scale = 1): ValueState {
  if (m.status === "uncalibrated") return { status: "uncalibrated", reason: m.reason };
  if (m.status === "failed") return { status: "error", message: m.error.message };
  return { status: "ready", value: m.value * scale, provenance: provenanceOf(m.source) };
}
