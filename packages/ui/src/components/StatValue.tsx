import type { ReactNode } from "react";
import { Badge } from "./Badge";
import { ProvenanceBadge } from "./Provenance";
import type { NumberFormat, ValueState } from "./provenance";
import { formatNumber } from "./provenance";
import "./stat-value.css";

export interface StatValueProps {
  readonly label: string;
  readonly state: ValueState;
  readonly format?: NumberFormat;
  /** Emphasised stats (e.g. DPS) get the large display size. */
  readonly emphasis?: boolean;
}

/** One key figure with its provenance and explicit loading/error/uncalibrated states. */
export function StatValue({ label, state, format = "integer", emphasis = false }: StatValueProps) {
  const classes = ["ef-stat", `ef-stat--${state.status}`, emphasis ? "ef-stat--emphasis" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes} aria-busy={state.status === "loading" || undefined}>
      <dt className="ef-stat__label">{label}</dt>
      <dd className="ef-stat__value">
        <StatBody state={state} format={format} />
      </dd>
    </div>
  );
}

function StatBody({ state, format }: { state: ValueState; format: NumberFormat }) {
  switch (state.status) {
    case "ready":
      if (!Number.isFinite(state.value)) {
        return (
          <>
            <span className="ef-stat__status-text">Invalid value</span>
            <span className="ef-stat__meta ef-stat__meta--error">
              Source returned a non-finite value
            </span>
          </>
        );
      }
      return (
        <>
          <span className="ef-stat__number ef-numeric">{formatNumber(state.value, format)}</span>
          <span className="ef-stat__meta">
            <ProvenanceBadge provenance={state.provenance} />
            {state.stale ? <Badge tone="warning">Outdated after patch</Badge> : null}
          </span>
        </>
      );
    case "loading":
      return (
        <>
          <span className="ef-stat__placeholder" aria-hidden="true" />
          <span className="ef-stat__meta ef-stat__meta--status">Calculating …</span>
        </>
      );
    case "error":
      return (
        <>
          <span className="ef-stat__status-text">Value unavailable</span>
          <span className="ef-stat__meta ef-stat__meta--error">{state.message}</span>
        </>
      );
    case "uncalibrated":
      return (
        <>
          <span className="ef-stat__status-text">Uncalibrated</span>
          <span className="ef-stat__meta ef-stat__meta--status">{state.reason}</span>
        </>
      );
  }
}

/** Groups StatValues as a description list. */
export function StatGrid({ children }: { children: ReactNode }) {
  return <dl className="ef-stat-grid">{children}</dl>;
}
