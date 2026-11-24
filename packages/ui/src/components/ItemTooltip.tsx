import type { ReactElement } from "react";
import { Fragment } from "react";
import type { Rarity } from "../theme/tokens";
import { RARITY_LABELS } from "../theme/tokens";
import { ProvenanceBadge } from "./Provenance";
import type { ProvenanceView } from "./provenance-model";
import "./item-tooltip.css";

/** Mirrors ModSpec.kind in docs/data-model.md; replaced by the contract type once it lands. */
export type ModKind = "prefix" | "suffix" | "implicit" | "enchant" | "rune" | "desecrated";

/** Display model of one modifier line. Text comes from the catalog, never typed by hand. */
export interface ItemModView {
  readonly id: string;
  readonly text: string;
  readonly kind: ModKind;
  /** Mod tier as given by the catalog (1 = best). */
  readonly tier?: number;
  /** Roll range text from the catalog, shown on demand. */
  readonly range?: string;
  /** Marks mods that matter most for the build (priority order in the guide). */
  readonly priority?: boolean;
}

export interface ItemPropertyView {
  readonly label: string;
  readonly value: string;
  /** Value differs from the base (e.g. raised by mods). */
  readonly augmented?: boolean;
}

export interface ItemRequirementView {
  readonly label: string;
  readonly value: string;
  /** False when the planned character cannot meet it at this stage. */
  readonly met: boolean;
}

export interface ItemView {
  readonly id: string;
  readonly rarity: Rarity;
  /** Unique or rare name; normal and magic items only have the base line. */
  readonly name?: string;
  readonly baseType: string;
  readonly itemClass: string;
  readonly properties: readonly ItemPropertyView[];
  readonly requirements: readonly ItemRequirementView[];
  readonly implicits: readonly ItemModView[];
  readonly explicits: readonly ItemModView[];
  readonly flavour?: string;
  readonly corrupted?: boolean;
  /** Where the guide suggests getting it (vendor, craft, trade). */
  readonly acquisition?: string;
  /** Source of every number on the card (catalog release, PoB, sample fixture). */
  readonly provenance: ProvenanceView;
}

export interface ItemTooltipProps {
  readonly item: ItemView;
  /** Shows mod tiers and roll ranges (planner view). */
  readonly showTiers?: boolean;
  readonly className?: string;
}

const MOD_KIND_SHORT: Readonly<Record<ModKind, string>> = {
  implicit: "Impl.",
  prefix: "P",
  suffix: "S",
  enchant: "Ench.",
  rune: "Rune",
  desecrated: "Desc.",
};

const MOD_KIND_LABEL: Readonly<Record<ModKind, string>> = {
  implicit: "Implicit",
  prefix: "Prefix",
  suffix: "Suffix",
  enchant: "Enchantment",
  rune: "Rune",
  desecrated: "Desecrated",
};

/** Item slate: rarity kicker, name, sections, mod lines. Own artwork, no game art. */
export function ItemTooltip({ item, showTiers = false, className }: ItemTooltipProps) {
  const twoLine = item.rarity === "rare" || item.rarity === "unique";
  const title = twoLine && item.name ? item.name : item.baseType;
  const classes = [
    "ef-item",
    `ef-item--${item.rarity}`,
    showTiers ? "ef-item--tiers" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const sections: ReactElement[] = [];
  if (item.properties.length > 0) {
    sections.push(
      <dl key="props" className="ef-item__section ef-item__props">
        {item.properties.map((p) => (
          <div key={p.label} className="ef-item__prop">
            <dt>{p.label}:</dt>
            <dd
              className={
                p.augmented
                  ? "ef-item__prop-value ef-item__prop-value--augmented"
                  : "ef-item__prop-value"
              }
            >
              {p.value}
            </dd>
          </div>
        ))}
      </dl>,
    );
  }
  if (item.requirements.length > 0) {
    sections.push(
      <p key="reqs" className="ef-item__section ef-item__reqs">
        <span className="ef-item__reqs-label">Requires </span>
        {item.requirements.map((r, i) => (
          <Fragment key={r.label}>
            {i > 0 ? ", " : null}
            <span className={r.met ? "ef-item__req" : "ef-item__req ef-item__req--unmet"}>
              {r.label} <span className="ef-numeric">{r.value}</span>
              {r.met ? null : <span className="ef-visually-hidden"> (not met)</span>}
            </span>
          </Fragment>
        ))}
      </p>,
    );
  }
  if (item.implicits.length > 0) {
    sections.push(
      <ModList key="impl" mods={item.implicits} showTiers={showTiers} label="Implicit modifiers" />,
    );
  }
  if (item.explicits.length > 0 || item.corrupted) {
    sections.push(
      <div key="expl" className="ef-item__section">
        {item.explicits.length > 0 ? (
          <ModList mods={item.explicits} showTiers={showTiers} label="Modifiers" bare />
        ) : null}
        {item.corrupted ? <p className="ef-item__corrupted">Corrupted</p> : null}
      </div>,
    );
  }
  if (item.flavour) {
    sections.push(
      <p key="flavour" className="ef-item__section ef-item__flavour">
        {item.flavour}
      </p>,
    );
  }

  return (
    <article className={classes} aria-label={`${RARITY_LABELS[item.rarity]}: ${title}`}>
      <header className="ef-item__header">
        <p className="ef-item__kicker">
          <span className="ef-item__rarity">{RARITY_LABELS[item.rarity]}</span>
          <span aria-hidden="true"> · </span>
          <span>{item.itemClass}</span>
          <span className="ef-visually-hidden">, </span>
        </p>
        {twoLine && item.name ? <h3 className="ef-item__name">{item.name}</h3> : null}
        {twoLine && item.name ? (
          <p className="ef-item__base">{item.baseType}</p>
        ) : (
          <h3 className="ef-item__name">{item.baseType}</h3>
        )}
      </header>
      <div className="ef-item__body">
        {sections.map((section, i) => (
          <Fragment key={section.key ?? i}>
            {i > 0 ? <ItemSeparator /> : null}
            {section}
          </Fragment>
        ))}
      </div>
      <footer className="ef-item__footer">
        {item.acquisition ? (
          <span>
            <span className="ef-item__footer-label">Source</span> {item.acquisition}
          </span>
        ) : null}
        <ProvenanceBadge provenance={item.provenance} />
      </footer>
    </article>
  );
}

function ModList({
  mods,
  showTiers,
  label,
  bare = false,
}: {
  mods: readonly ItemModView[];
  showTiers: boolean;
  label: string;
  bare?: boolean;
}) {
  return (
    <ul className={bare ? "ef-item__mods" : "ef-item__section ef-item__mods"} aria-label={label}>
      {mods.map((mod) => (
        <li
          key={mod.id}
          className={[
            "ef-item__mod",
            `ef-item__mod--${mod.kind}`,
            mod.priority ? "ef-item__mod--priority" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <span className="ef-item__mod-text">{mod.text}</span>
          {showTiers && (mod.kind === "prefix" || mod.kind === "suffix") ? (
            <span className="ef-item__mod-meta" title={MOD_KIND_LABEL[mod.kind]}>
              <span aria-hidden="true">{MOD_KIND_SHORT[mod.kind]}</span>
              <span className="ef-visually-hidden">{MOD_KIND_LABEL[mod.kind]}</span>
              {mod.tier !== undefined ? <span className="ef-numeric">T{mod.tier}</span> : null}
              {mod.range ? (
                <span className="ef-item__mod-range ef-numeric">{mod.range}</span>
              ) : null}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ItemSeparator() {
  return <div className="ef-item__separator" aria-hidden="true" />;
}
