import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { useId, useRef } from "react";
import "./tabs.css";

export interface TabItem {
  readonly id: string;
  readonly label: string;
  /** Short hint after the label, e.g. a level range. */
  readonly hint?: string;
  readonly disabled?: boolean;
  readonly content: ReactNode;
}

export interface TabsProps {
  readonly items: readonly TabItem[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  /** Accessible name of the tab list. */
  readonly label: string;
  /**
   * "underline" for ordinary tabs; "dial" draws the astrolabe: stages as
   * marks on a ring, the arc lit up to the current stage, the panel beside it.
   */
  readonly variant?: "underline" | "dial";
  /** Content in the centre of the dial (e.g. the key stat of the stage). */
  readonly dialCenter?: ReactNode;
  readonly className?: string;
}

/** Ring geometry of the dial in percent of its box. */
const DIAL_RADIUS = 41;

/** Controlled tabs following the WAI-ARIA tabs pattern (automatic activation). */
export function Tabs({
  items,
  value,
  onChange,
  label,
  variant = "underline",
  dialCenter,
  className,
}: TabsProps) {
  const baseId = useId();
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const enabled = items.filter((item) => !item.disabled);
  const active = items.find((item) => item.id === value);
  const activeIndex = items.findIndex((item) => item.id === value);
  // Keep the tab list reachable by keyboard even if value is unknown or disabled.
  const focusableId = active && !active.disabled ? active.id : (enabled[0]?.id ?? undefined);

  function focusAndSelect(id: string) {
    onChange(id);
    tabRefs.current.get(id)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (enabled.length === 0) return;
    const index = Math.max(
      0,
      enabled.findIndex((item) => item.id === value),
    );
    let next: TabItem | undefined;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = enabled[(index + 1) % enabled.length];
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = enabled[(index - 1 + enabled.length) % enabled.length];
        break;
      case "Home":
        next = enabled[0];
        break;
      case "End":
        next = enabled[enabled.length - 1];
        break;
      default:
        return;
    }
    if (next) {
      event.preventDefault();
      focusAndSelect(next.id);
    }
  }

  const isDial = variant === "dial";
  const classes = ["ef-tabs", `ef-tabs--${variant}`, className].filter(Boolean).join(" ");
  const progress = items.length > 0 ? Math.max(activeIndex, 0) / items.length : 0;

  return (
    <div className={classes}>
      <div className={isDial ? "ef-tabs__dial" : undefined}>
        {isDial ? <DialRings progress={progress} /> : null}
        {isDial && dialCenter ? <div className="ef-tabs__dial-center">{dialCenter}</div> : null}
        <div className="ef-tabs__list" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
          {items.map((item, index) => {
            const selected = item.id === value;
            const phase = selected ? "current" : index < activeIndex ? "done" : "upcoming";
            return (
              <button
                key={item.id}
                ref={(node) => {
                  if (node) tabRefs.current.set(item.id, node);
                  else tabRefs.current.delete(item.id);
                }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${item.id}`}
                aria-selected={selected}
                aria-controls={`${baseId}-panel-${item.id}`}
                tabIndex={item.id === focusableId ? 0 : -1}
                disabled={item.disabled}
                className={[
                  "ef-tabs__tab",
                  `ef-tabs__tab--${phase}`,
                  isDial ? `ef-tabs__tab--${dialSide(index, items.length)}` : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={isDial ? dialPosition(index, items.length) : undefined}
                onClick={() => onChange(item.id)}
              >
                {isDial ? <span className="ef-tabs__mark" aria-hidden="true" /> : null}
                <span className="ef-tabs__label">
                  {isDial ? (
                    <span className="ef-tabs__numeral">{toNumeral(index + 1)} · </span>
                  ) : null}
                  {item.label}
                </span>
                {item.hint ? <span className="ef-tabs__hint">{item.hint}</span> : null}
              </button>
            );
          })}
        </div>
      </div>
      {active ? (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${active.id}`}
          aria-labelledby={`${baseId}-tab-${active.id}`}
          className="ef-tabs__panel"
          tabIndex={0}
        >
          {active.content}
        </div>
      ) : null}
    </div>
  );
}

function dialAngle(index: number, count: number): number {
  return (index / count) * 2 * Math.PI - Math.PI / 2;
}

/** Horizontal share of the ring beyond which a label sits beside its mark, not below it. */
const SIDE_THRESHOLD = 0.3;

/** Which way the label of a mark points: outwards on the sides, centred at top and bottom. */
function dialSide(index: number, count: number): "start" | "end" | "centre" {
  const x = Math.cos(dialAngle(index, count));
  if (x > SIDE_THRESHOLD) return "end";
  if (x < -SIDE_THRESHOLD) return "start";
  return "centre";
}

/** Places stage n of count on the ring, starting at the top, clockwise. Layout only. */
function dialPosition(index: number, count: number): CSSProperties {
  const angle = dialAngle(index, count);
  return {
    left: `${50 + DIAL_RADIUS * Math.cos(angle)}%`,
    top: `${50 + DIAL_RADIUS * Math.sin(angle)}%`,
  };
}

const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

function toNumeral(n: number): string {
  return NUMERALS[n - 1] ?? String(n);
}

function DialRings({ progress }: { progress: number }) {
  const arc = progress * 100;
  return (
    <svg className="ef-tabs__rings" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <circle className="ef-tabs__ring ef-tabs__ring--outer" cx="50" cy="50" r="48" />
      <circle className="ef-tabs__ring ef-tabs__ring--ticks" cx="50" cy="50" r="45.5" />
      <circle className="ef-tabs__ring" cx="50" cy="50" r={DIAL_RADIUS} />
      <circle className="ef-tabs__ring ef-tabs__ring--track" cx="50" cy="50" r="27" />
      <circle
        className="ef-tabs__ring ef-tabs__ring--progress"
        cx="50"
        cy="50"
        r="27"
        pathLength="100"
        strokeDasharray={`${arc} 100`}
        transform="rotate(-90 50 50)"
      />
      <polygon className="ef-tabs__ring ef-tabs__ring--sigil" points="50,22 74.2,64 25.8,64" />
      <polygon className="ef-tabs__ring ef-tabs__ring--sigil" points="50,78 74.2,36 25.8,36" />
    </svg>
  );
}
