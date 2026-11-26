import type { ValueState } from "@astrolabe/ui";

/** The sources a measured number can name, as far as the window shows them. */
type AnySourceView =
  | { kind: "pob"; pobVersion: string; calcProfile: string }
  | { kind: "gamedata"; dataReleaseId: string }
  | { kind: "market"; provider: string; fetchedAt: string }
  | { kind: "derived"; formula: string };

/**
 * A measured number as the state StatValue shows. An uncalibrated or failed number stays that
 * way; there is no fallback value. `scale` only converts the unit for display (a chance of
 * 0.25 is shown as 25 %).
 */
export type MeasuredNumber =
  | { status: "ok"; value: number; source: AnySourceView }
  | { status: "uncalibrated"; reason: string }
  | { status: "failed"; error: { message: string } };

export function measuredState(m: MeasuredNumber, scale = 1): ValueState {
  if (m.status === "uncalibrated") return { status: "uncalibrated", reason: m.reason };
  if (m.status === "failed") return { status: "error", message: m.error.message };
  const source = m.source;
  switch (source.kind) {
    case "pob":
      return {
        status: "ready",
        value: m.value * scale,
        provenance: { kind: "pob", pobVersion: source.pobVersion, calcProfile: source.calcProfile },
      };
    case "gamedata":
      return {
        status: "ready",
        value: m.value * scale,
        provenance: { kind: "gamedata", dataRelease: source.dataReleaseId },
      };
    case "market":
      return {
        status: "ready",
        value: m.value * scale,
        provenance: { kind: "market", provider: source.provider, fetchedAt: source.fetchedAt },
      };
    case "derived":
      return {
        status: "ready",
        value: m.value * scale,
        provenance: { kind: "derived", formula: source.formula },
      };
  }
}
