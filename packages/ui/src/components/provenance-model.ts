// View model for "where does this number come from". UI-local on purpose:
// it is mapped from the Sourced<T> contract in packages/contracts once that
// lands, so the components never depend on pipeline internals.

export type ProvenanceView =
  | { readonly kind: "pob"; readonly pobVersion: string; readonly calcProfile: string }
  | { readonly kind: "market"; readonly provider: string; readonly fetchedAt: string }
  | { readonly kind: "derived"; readonly formula: string }
  | { readonly kind: "gamedata"; readonly dataRelease: string }
  /** Fixture/fake value for layout and demos. Never presented as a real value. */
  | { readonly kind: "sample"; readonly fixture: string };

export type ProvenanceKind = ProvenanceView["kind"];

/**
 * State of a displayed number. There is deliberately no fallback value:
 * loading, error and uncalibrated are visible states, never 0.
 */
export type ValueState =
  | {
      readonly status: "ready";
      readonly value: number;
      readonly provenance: ProvenanceView;
      /** True when the value was calculated for an older data release. */
      readonly stale?: boolean;
    }
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "uncalibrated"; readonly reason: string };

export function provenanceLabel(p: ProvenanceView): string {
  switch (p.kind) {
    case "pob":
      return `PoB ${p.pobVersion} · ${p.calcProfile}`;
    case "market":
      return `Market · ${p.provider} · ${p.fetchedAt}`;
    case "derived":
      return `Derived · ${p.formula}`;
    case "gamedata":
      return `Game data · ${p.dataRelease}`;
    case "sample":
      return `Sample value · ${p.fixture}`;
  }
}

export type NumberFormat = "integer" | "decimal1" | "percent" | "multiplier";

const FORMATTERS: Readonly<Record<NumberFormat, Intl.NumberFormat>> = {
  integer: new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }),
  decimal1: new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  percent: new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }),
  multiplier: new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
};

/** Formats an engine value for display. Formatting only; never derives values. */
export function formatNumber(value: number, format: NumberFormat): string {
  if (!Number.isFinite(value)) {
    throw new Error(`formatNumber: non-finite value ${String(value)} cannot be displayed`);
  }
  const text = FORMATTERS[format].format(value);
  if (format === "percent") return `${text}%`;
  if (format === "multiplier") return `×${text}`;
  return text;
}
