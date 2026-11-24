import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./button.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Shows a busy state, e.g. while PoB calculates. Disables the button. */
  readonly busy?: boolean;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  busy = false,
  icon,
  className,
  disabled,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  const classes = ["ef-button", `ef-button--${variant}`, `ef-button--${size}`, className]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      {...rest}
      type={type}
      className={classes}
      disabled={disabled === true || busy}
      aria-busy={busy || undefined}
    >
      <span className="ef-button__face">
        {busy ? <span className="ef-button__spinner" aria-hidden="true" /> : icon}
        <span>{children}</span>
      </span>
    </button>
  );
}
