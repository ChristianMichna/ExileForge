import { useState } from "react";
import { ItemTooltip, Panel, Tabs } from "@astrolabe/ui";
import type { ItemModView, ItemView } from "@astrolabe/ui";
import type {
  GuideGearEntry,
  GuideItemCard,
  GuideItemLine,
  GuideView,
} from "@astrolabe/contracts/guide";

/*
 * The gear plan of a guide: one tab per budget tier, one card per slot. Names and modifier texts
 * come from the server's catalog (`GuideView.gear`); an item the catalog does not know is shown
 * as unavailable, never as its id dressed up as a name.
 */

const RARITY_BY_NAME = {
  normal: "normal",
  magic: "magic",
  rare: "rare",
  unique: "unique",
} as const;

function rarityOf(name: string): ItemView["rarity"] {
  const key = name.toLowerCase();
  return key in RARITY_BY_NAME ? RARITY_BY_NAME[key as keyof typeof RARITY_BY_NAME] : "normal";
}

function modView(line: GuideItemLine, index: number, implicit: boolean): ItemModView {
  return {
    id: line.modId ?? `line-${index}`,
    text: line.text ?? `Unknown modifier${line.modId === undefined ? "" : ` (${line.modId})`}`,
    // Tiers are not shown on guide cards, so the prefix/suffix split stays invisible here.
    kind: implicit ? "implicit" : line.generationType === "suffix" ? "suffix" : "prefix",
    ...(line.tier === undefined ? {} : { tier: line.tier }),
  };
}

export function toItemView(
  card: GuideItemCard,
  id: string,
  dataRelease: string,
  acquisition?: string,
): ItemView {
  return {
    id,
    rarity: rarityOf(card.rarityName),
    ...(card.name === undefined ? {} : { name: card.name }),
    baseType: card.baseName,
    itemClass: card.itemClass,
    properties: [],
    requirements: [],
    implicits: card.implicits.map((l, i) => modView(l, i, true)),
    explicits: card.explicits.map((l, i) => modView(l, i, false)),
    ...(acquisition === undefined ? {} : { acquisition }),
    provenance: { kind: "gamedata", dataRelease },
  };
}

function Slot({ entry, view }: { entry: GuideGearEntry; view: GuideView }) {
  const plan = view.guide.gear.tiers
    .find((t) => t.budgetTier === entry.budgetTier)
    ?.slots.find((s) => s.slot === entry.slot);
  const dataRelease = view.catalogReleaseId;
  return (
    <section className="gear-slot" aria-label={entry.slot}>
      <h3>{entry.slot}</h3>
      {entry.target === null ? (
        <p role="status">This item is not in the game data this app runs with.</p>
      ) : (
        <ItemTooltip
          item={toItemView(entry.target, `${entry.slot}-target`, dataRelease, plan?.acquisition)}
        />
      )}
      {entry.alternatives.length > 0 ? (
        <details>
          <summary>{entry.alternatives.length} alternative(s)</summary>
          {entry.alternatives.map((alt, i) =>
            alt === null ? (
              <p key={i} role="status">
                This item is not in the game data this app runs with.
              </p>
            ) : (
              <ItemTooltip key={i} item={toItemView(alt, `${entry.slot}-alt-${i}`, dataRelease)} />
            ),
          )}
        </details>
      ) : null}
    </section>
  );
}

export function GearSection({ view }: { view: GuideView }) {
  const tiers = [...new Set(view.gear.map((g) => g.budgetTier))];
  const [tier, setTier] = useState(tiers[0] ?? "");
  if (tiers.length === 0) return null;
  return (
    <Panel title="Gear" kicker="By budget">
      <Tabs
        label="Budget tier"
        value={tier}
        onChange={setTier}
        items={tiers.map((id) => ({
          id,
          label: id,
          content: (
            <div className="gear-grid">
              {view.gear
                .filter((g) => g.budgetTier === id)
                .map((entry) => (
                  <Slot key={entry.slot} entry={entry} view={view} />
                ))}
            </div>
          ),
        }))}
      />
    </Panel>
  );
}
