import type { ReactNode } from "react";
import { ProvenanceBadge } from "./Provenance";
import type { NumberFormat, ValueState } from "./provenance-model";
import { formatNumber } from "./provenance-model";
import "./readout.css";

export interface LedgerRow {
  readonly id: string;
  readonly label: string;
  readonly state: ValueState;
  readonly format?: NumberFormat;
  readonly emphasis?: boolean;
}

/**
 * Readout table for the guide reader: label, hairline leader, mono value.
 * Same state rules as StatValue: no fallback values, provenance on every number.
 */
export function Ledger({ rows, caption }: { rows: readonly LedgerRow[]; caption?: string }) {
  return (
    <table className="ef-ledger">
      {caption ? <caption className="ef-ledger__caption">{caption}</caption> : null}
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.id}
            className={[
              "ef-ledger__row",
              `ef-ledger__row--${row.state.status}`,
              row.emphasis ? "ef-ledger__row--emphasis" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <th scope="row" className="ef-ledger__label">
              {row.label}
              {row.state.status === "ready" ? (
                <span className="ef-ledger__source">
                  <ProvenanceBadge provenance={row.state.provenance} />
                </span>
              ) : null}
            </th>
            <td className="ef-ledger__value">
              <LedgerValue state={row.state} format={row.format ?? "integer"} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LedgerValue({ state, format }: { state: ValueState; format: NumberFormat }) {
  switch (state.status) {
    case "ready":
      return Number.isFinite(state.value) ? (
        <span className="ef-numeric">{formatNumber(state.value, format)}</span>
      ) : (
        <span>Invalid value</span>
      );
    case "loading":
      return <span>Calculating …</span>;
    case "error":
      return <span>Unavailable: {state.message}</span>;
    case "uncalibrated":
      return <span>Uncalibrated: {state.reason}</span>;
  }
}

/** Guide notes: each paragraph becomes a numbered entry (01, 02, …) on the instrument. */
export function GuideNotes({ children }: { children: ReactNode }) {
  return <div className="ef-notes">{children}</div>;
}
