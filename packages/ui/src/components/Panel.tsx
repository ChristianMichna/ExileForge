import type { ReactNode } from "react";
import { useId } from "react";
import "./panel.css";

export interface PanelProps {
  readonly title?: string;
  /** Small caps line above the title, e.g. the stage of the guide. */
  readonly kicker?: string;
  /** Controls shown at the right end of the header. */
  readonly actions?: ReactNode;
  /** "plate" is a riveted iron plate; "recessed" is a sunken tray for nested content. */
  readonly variant?: "plate" | "recessed";
  readonly className?: string;
  readonly children: ReactNode;
}

export function Panel({
  title,
  kicker,
  actions,
  variant = "plate",
  className,
  children,
}: PanelProps) {
  const titleId = useId();
  const classes = ["ef-panel", `ef-panel--${variant}`, className].filter(Boolean).join(" ");
  return (
    <section className={classes} aria-labelledby={title ? titleId : undefined}>
      {title || actions || kicker ? (
        <header className="ef-panel__header">
          <div className="ef-panel__heading">
            {kicker ? <p className="ef-panel__kicker">{kicker}</p> : null}
            {title ? (
              <h2 id={titleId} className="ef-panel__title">
                {title}
              </h2>
            ) : null}
          </div>
          <span className="ef-panel__rule" aria-hidden="true" />
          {actions ? <div className="ef-panel__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="ef-panel__body">{children}</div>
    </section>
  );
}
