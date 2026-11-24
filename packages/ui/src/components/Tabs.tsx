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
   * "underline" for ordinary tabs; "timeline" draws the forge timeline:
   * stages as ingots on a heat seam, earlier stages cooled, the current one glowing.
   */
  readonly variant?: "underline" | "timeline";
  readonly className?: string;
}

/** Controlled tabs following the WAI-ARIA tabs pattern (automatic activation). */
export function Tabs({
  items,
  value,
  onChange,
  label,
  variant = "underline",
  className,
}: TabsProps) {
  const baseId = useId();
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const enabled = items.filter((item) => !item.disabled);
  const active = items.find((item) => item.id === value);
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
        next = enabled[(index + 1) % enabled.length];
        break;
      case "ArrowLeft":
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

  const activeIndex = items.findIndex((item) => item.id === value);
  // Layout only: how far the heat seam is lit (0 % to 100 %).
  const seamStyle = {
    "--ef-progress": `${items.length > 1 ? (Math.max(activeIndex, 0) / (items.length - 1)) * 100 : 0}%`,
  } as CSSProperties;
  const classes = ["ef-tabs", `ef-tabs--${variant}`, className].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      <div
        className="ef-tabs__list"
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        style={variant === "timeline" ? seamStyle : undefined}
      >
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
              className={`ef-tabs__tab ef-tabs__tab--${phase}`}
              onClick={() => onChange(item.id)}
            >
              {variant === "timeline" ? (
                <span className="ef-tabs__ingot" aria-hidden="true" />
              ) : null}
              <span className="ef-tabs__label">{item.label}</span>
              {item.hint ? <span className="ef-tabs__hint">{item.hint}</span> : null}
            </button>
          );
        })}
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
