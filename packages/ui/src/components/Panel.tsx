import type { ReactNode } from "react";
import { useId } from "react";
import { CornerOrnament, Diamond } from "../ornaments/Ornaments";
import "./panel.css";

export interface PanelProps {
  readonly title?: string;
  /** Small caps line above the title, e.g. the section of the guide. */
  readonly kicker?: string;
  /** Controls shown at the right end of the header. */
  readonly actions?: ReactNode;
  /** "framed" draws the corner ornaments; "plain" is for nested panels. */
  readonly variant?: "framed" | "plain";
  readonly className?: string;
  readonly children: ReactNode;
}

export function Panel({
  title,
  kicker,
  actions,
  variant = "framed",
  className,
  children,
}: PanelProps) {
  const titleId = useId();
  const classes = ["ef-panel", `ef-panel--${variant}`, className].filter(Boolean).join(" ");
  return (
    <section className={classes} aria-labelledby={title ? titleId : undefined}>
      {variant === "framed" ? (
        <>
          <CornerOrnament position="top-left" />
          <CornerOrnament position="top-right" />
          <CornerOrnament position="bottom-left" />
          <CornerOrnament position="bottom-right" />
        </>
      ) : null}
      {title || actions ? (
        <header className="ef-panel__header">
          <div className="ef-panel__heading">
            {kicker ? <p className="ef-panel__kicker">{kicker}</p> : null}
            {title ? (
              <h2 id={titleId} className="ef-panel__title">
                <Diamond className="ef-panel__title-mark" />
                {title}
              </h2>
            ) : null}
          </div>
          {actions ? <div className="ef-panel__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="ef-panel__body">{children}</div>
    </section>
  );
}
