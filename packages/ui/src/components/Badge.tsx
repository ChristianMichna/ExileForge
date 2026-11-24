import type { ReactNode } from "react";
import "./badge.css";

export type BadgeTone = "neutral" | "gold" | "danger" | "warning" | "success" | "info";

export interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly children: ReactNode;
  readonly className?: string;
}

/** Small chamfered label for states and categories. */
export function Badge({ tone = "neutral", children, className }: BadgeProps) {
  const classes = ["ef-badge", `ef-badge--${tone}`, className].filter(Boolean).join(" ");
  return <span className={classes}>{children}</span>;
}
