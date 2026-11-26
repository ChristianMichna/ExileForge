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

const RARITY_BY_NAME = { normal: "normal", magic: "magic", rare: "rare" } as const;

/** The look of the card; null when the release gives no (known) name for the rarity. */
function rarityOf(card: GuideItemCard): ItemView["rarity"] | null {
  if (card.kind === "unique") return "unique";
  const key = card.rarityName?.toLowerCase() ?? "";
  return key in RARITY_BY_NAME ? RARITY_BY_NAME[key as keyof typeof RARITY_BY_NAME] : null;
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
    // An unknown rarity gets the plain look and a visible note next to the card.
    rarity: rarityOf(card) ?? "normal",
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

function RarityNote({ card }: { card: GuideItemCard }) {
  if (rarityOf(card) !== null) return null;
  return (
    <p role="status">
      The game data this app runs with does not know the rarity
      {card.rarityId === undefined ? "" : ` (${card.rarityId})`}; the card is shown plain.
    </p>
  );
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
        <>
          <ItemTooltip
            item={toItemView(entry.target, `${entry.slot}-target`, dataRelease, plan?.acquisition)}
          />
          <RarityNote card={entry.target} />
        </>
      )}
      {entry.minimum === undefined || entry.minimum === null ? null : (
        <details>
          <summary>Minimum to get started</summary>
          <ItemTooltip item={toItemView(entry.minimum, `${entry.slot}-minimum`, dataRelease)} />
          <RarityNote card={entry.minimum} />
        </details>
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
              <div key={i}>
                <ItemTooltip item={toItemView(alt, `${entry.slot}-alt-${i}`, dataRelease)} />
                <RarityNote card={alt} />
              </div>
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
  if (!view.current) {
    return (
      <Panel title="Gear" kicker="By budget">
        <p role="status">
          Item names and modifier texts come from the current game data. Revalidate this guide to
          see its gear.
        </p>
      </Panel>
    );
  }
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
