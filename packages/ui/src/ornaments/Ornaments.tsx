// Own SVG ornaments (no game art). Colours come from ornaments.css (tokens only).
import { useId } from "react";
import "./ornaments.css";

export function Diamond({ className }: { className?: string }) {
  return (
    <svg
      className={className ? `ef-diamond ${className}` : "ef-diamond"}
      viewBox="0 0 12 12"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
    >
      <path className="ef-orn-fill" d="M6 0.8 L11.2 6 L6 11.2 L0.8 6 Z" />
    </svg>
  );
}

/** Glowing weld seam with a small ingot in the middle. Decorative. */
export function OrnamentDivider({ className }: { className?: string }) {
  return (
    <div className={className ? `ef-divider ${className}` : "ef-divider"} aria-hidden="true">
      <span className="ef-divider__line ef-divider__line--start" />
      <span className="ef-divider__ingot" />
      <span className="ef-divider__line ef-divider__line--end" />
    </div>
  );
}

/** ExileForge mark: a flame rising from an anvil. Own design. */
export function Sigil({ size = 40, title }: { size?: number; title?: string }) {
  const gradientId = useId();
  const labelled = title !== undefined;
  return (
    <svg
      className="ef-sigil"
      viewBox="0 0 48 48"
      width={size}
      height={size}
      role={labelled ? "img" : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
    >
      {labelled ? <title>{title}</title> : null}
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="ef-sigil__stop-top" />
          <stop offset="1" className="ef-sigil__stop-bottom" />
        </linearGradient>
      </defs>
      <path className="ef-sigil__anvil" d="M5 30 H43 L37 36 H29 V42 H19 V36 H11 Z" />
      <path
        d="M24 3 C31.5 11 34.5 15.5 32.5 22.5 C31.3 26.6 28.5 28.6 24 29.5 C19.5 28.6 16.7 26.6 15.5 22.5 C13.5 15.5 16.5 11 24 3 Z"
        fill={`url(#${gradientId})`}
      />
      <path className="ef-sigil__core" d="M24 13.5 L27.5 20 L24 25 L20.5 20 Z" />
    </svg>
  );
}
