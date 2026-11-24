import type { ProvenanceKind, ProvenanceView } from "./provenance";
import { provenanceLabel } from "./provenance";
import "./provenance.css";

const KIND_NAME: Readonly<Record<ProvenanceKind, string>> = {
  pob: "Path of Building",
  market: "Marktpreis",
  derived: "abgeleitet",
  gamedata: "Spieldaten",
  sample: "Beispielwert",
};

/** Marker shape differs per kind so colour is never the only signal. */
function Marker({ kind }: { kind: ProvenanceKind }) {
  return (
    <svg
      className={`ef-prov__marker ef-prov__marker--${kind}`}
      viewBox="0 0 8 8"
      width="8"
      height="8"
      aria-hidden="true"
      focusable="false"
    >
      {kind === "pob" ? <path d="M4 0 L8 4 L4 8 L0 4 Z" /> : null}
      {kind === "market" ? <circle cx="4" cy="4" r="3.5" /> : null}
      {kind === "derived" ? <path d="M4 0.5 L7.5 7.5 H0.5 Z" /> : null}
      {kind === "gamedata" ? <rect x="0.5" y="0.5" width="7" height="7" /> : null}
      {kind === "sample" ? <path d="M0.5 0.5 H7.5 V7.5 H0.5 Z M2.5 2.5 V5.5 H5.5 V2.5 Z" /> : null}
    </svg>
  );
}

export interface ProvenanceBadgeProps {
  readonly provenance: ProvenanceView;
  /** Compact shows only the marker and kind; the full label is in the title. */
  readonly compact?: boolean;
}

export function ProvenanceBadge({ provenance, compact = false }: ProvenanceBadgeProps) {
  const label = provenanceLabel(provenance);
  return (
    <span
      className={`ef-prov ef-prov--${provenance.kind}`}
      title={`${KIND_NAME[provenance.kind]}: ${label}`}
    >
      <Marker kind={provenance.kind} />
      <span className="ef-prov__text">{compact ? KIND_NAME[provenance.kind] : label}</span>
    </span>
  );
}
