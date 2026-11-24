import type { ReactNode } from "react";
import "./callout.css";

export type CalloutTone = "info" | "warning" | "danger" | "success";

const TONE_LABEL: Readonly<Record<CalloutTone, string>> = {
  info: "Hinweis",
  warning: "Warnung",
  danger: "Fehler",
  success: "Erledigt",
};

export interface CalloutProps {
  readonly tone?: CalloutTone;
  readonly title: string;
  readonly children?: ReactNode;
  readonly actions?: ReactNode;
}

/** Message block. Tone is always carried by icon and a text label, not colour alone. */
export function Callout({ tone = "info", title, children, actions }: CalloutProps) {
  return (
    <div className={`ef-callout ef-callout--${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <CalloutIcon tone={tone} />
      <div className="ef-callout__content">
        <p className="ef-callout__title">
          <span className="ef-visually-hidden">{TONE_LABEL[tone]}: </span>
          {title}
        </p>
        {children ? <div className="ef-callout__body">{children}</div> : null}
      </div>
      {actions ? <div className="ef-callout__actions">{actions}</div> : null}
    </div>
  );
}

function CalloutIcon({ tone }: { tone: CalloutTone }) {
  return (
    <svg
      className="ef-callout__icon"
      viewBox="0 0 20 20"
      width="20"
      height="20"
      aria-hidden="true"
      focusable="false"
    >
      <path className="ef-callout__icon-frame" d="M10 1 L19 10 L10 19 L1 10 Z" />
      {tone === "info" ? (
        <>
          <rect className="ef-callout__icon-mark" x="9" y="8.5" width="2" height="6" />
          <rect className="ef-callout__icon-mark" x="9" y="5.5" width="2" height="2" />
        </>
      ) : null}
      {tone === "warning" || tone === "danger" ? (
        <>
          <rect className="ef-callout__icon-mark" x="9" y="5.5" width="2" height="6" />
          <rect className="ef-callout__icon-mark" x="9" y="12.5" width="2" height="2" />
        </>
      ) : null}
      {tone === "success" ? (
        <path className="ef-callout__icon-check" d="M6.5 10.2 L9 12.6 L13.6 7.6" />
      ) : null}
    </svg>
  );
}
