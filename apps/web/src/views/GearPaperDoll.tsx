import { useState } from "react";
import type { CSSProperties } from "react";
import { ItemTooltip } from "@astrolabe/ui";
import type { GuideGearEntry, GuideView } from "@astrolabe/contracts/guide";
import { GEAR_LAYOUT } from "../guide/gear-layout";
import { rarityOf, toItemView } from "../guide/gear-item";

/*
 * The gear as it sits on a character: one framed cell per slot in the arrangement of
 * config/web/gear-layout.json. Hovering or focusing a cell shows the full item card; selecting it
 * opens the slot's notes below. Slots the layout does not know go to a row underneath. The frames
 * and glyphs are our own; no game graphics.
 */

interface Props {
  readonly entries: readonly GuideGearEntry[];
  readonly view: GuideView;
  readonly selected: string | null;
  readonly onSelect: (slot: string) => void;
}

function cellStyle(slot: string): CSSProperties | undefined {
  const area = GEAR_LAYOUT.slots[slot];
  if (area === undefined) return undefined;
  return {
    gridColumn: `${area.col} / span ${area.colSpan}`,
    gridRow: `${area.row} / span ${area.rowSpan}`,
  };
}

function Cell({
  entry,
  view,
  selected,
  onSelect,
}: {
  entry: GuideGearEntry;
  view: GuideView;
  selected: boolean;
  onSelect: (slot: string) => void;
}) {
  const area = GEAR_LAYOUT.slots[entry.slot];
  const rarity = entry.target === null ? "empty" : (rarityOf(entry.target) ?? "normal");
  const glyph = GEAR_LAYOUT.glyphs[entry.slot] ?? "◇";
  const [dismissed, setDismissed] = useState(false);
  const tipId = `gear-tip-${entry.budgetTier}-${entry.slot.replace(/\s+/g, "-")}`;
  const vertical = area !== undefined && area.row > 3 ? "up" : "down";
  const side = area !== undefined && area.col > GEAR_LAYOUT.columns / 2 ? "left" : "right";
  const plan = view.guide.gear.tiers
    .find((t) => t.budgetTier === entry.budgetTier)
    ?.slots.find((s) => s.slot === entry.slot);
  return (
    <div
      className="gear-cell"
      style={cellStyle(entry.slot)}
      data-rarity={rarity}
      {...(dismissed ? { "data-dismissed": "" } : {})}
      onMouseLeave={() => setDismissed(false)}
      onBlur={() => setDismissed(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setDismissed(true);
      }}
    >
      <button
        type="button"
        className="gear-cell__frame"
        aria-pressed={selected}
        {...(entry.target === null ? {} : { "aria-describedby": tipId })}
        onClick={() => onSelect(entry.slot)}
      >
        <span className="gear-cell__glyph" aria-hidden="true">
          {glyph}
        </span>
        <span className="gear-cell__slot">{entry.slot}</span>
        {entry.target === null ? (
          <span className="gear-cell__name">Not in game data</span>
        ) : (
          <>
            <span className="gear-cell__name">{entry.target.name ?? entry.target.baseName}</span>
            {entry.target.name === undefined ? null : (
              <span className="gear-cell__base">{entry.target.baseName}</span>
            )}
          </>
        )}
      </button>
      {entry.target !== null ? (
        <div
          id={tipId}
          className={`gear-cell__hover gear-cell__hover--${side} gear-cell__hover--${vertical}`}
          role="tooltip"
        >
          <ItemTooltip
            item={toItemView(
              entry.target,
              `${entry.budgetTier}-${entry.slot}-hover`,
              view.catalogReleaseId,
              plan?.acquisition,
            )}
          />
        </div>
      ) : null}
    </div>
  );
}

export function GearPaperDoll({ entries, view, selected, onSelect }: Props) {
  const placed = entries.filter((e) => GEAR_LAYOUT.slots[e.slot] !== undefined);
  const others = entries.filter((e) => GEAR_LAYOUT.slots[e.slot] === undefined);
  const rows = Math.max(
    1,
    ...placed.map(
      (e) => (GEAR_LAYOUT.slots[e.slot]?.row ?? 1) + (GEAR_LAYOUT.slots[e.slot]?.rowSpan ?? 1) - 1,
    ),
  );
  return (
    <div className="gear-doll">
      <div
        className="gear-doll__body"
        style={{
          gridTemplateColumns: `repeat(${GEAR_LAYOUT.columns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, var(--gear-row, 4rem))`,
        }}
      >
        {placed.map((e) => (
          <Cell
            key={e.slot}
            entry={e}
            view={view}
            selected={selected === e.slot}
            onSelect={onSelect}
          />
        ))}
      </div>
      {others.length > 0 ? (
        <div className="gear-doll__extras">
          {others.map((e) => (
            <Cell
              key={e.slot}
              entry={e}
              view={view}
              selected={selected === e.slot}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
