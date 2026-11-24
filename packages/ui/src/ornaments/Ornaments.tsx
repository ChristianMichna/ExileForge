// Own SVG ornaments (no game art). Colours come from CSS classes in
// ornaments.css, which use tokens only.
import "./ornaments.css";

export type CornerPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export function CornerOrnament({ position }: { position: CornerPosition }) {
  return (
    <svg
      className={`ef-corner ef-corner--${position}`}
      viewBox="0 0 30 30"
      width="30"
      height="30"
      aria-hidden="true"
      focusable="false"
    >
      <path className="ef-orn-stroke" d="M1.5 21 V7.5 L7.5 1.5 H21" />
      <path className="ef-orn-stroke-soft" d="M5.5 25 V10 L10 5.5 H25" />
      <path className="ef-orn-fill" d="M7.5 4.2 L10.8 7.5 L7.5 10.8 L4.2 7.5 Z" />
      <circle className="ef-orn-fill" cx="21" cy="1.5" r="1.4" />
      <circle className="ef-orn-fill" cx="1.5" cy="21" r="1.4" />
    </svg>
  );
}

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
      <path className="ef-orn-inner" d="M6 3.6 L8.4 6 L6 8.4 L3.6 6 Z" />
    </svg>
  );
}

/** Ornamental horizontal rule with a centre diamond. */
export function OrnamentDivider({ className }: { className?: string }) {
  return (
    <div className={className ? `ef-divider ${className}` : "ef-divider"} aria-hidden="true">
      <span className="ef-divider__line ef-divider__line--start" />
      <Diamond />
      <span className="ef-divider__line ef-divider__line--end" />
    </div>
  );
}

/** ExileForge mark: an anvil-cut gem over a forge flame. Own design. */
export function Sigil({ size = 32, title }: { size?: number; title?: string }) {
  const labelled = title !== undefined;
  return (
    <svg
      className="ef-sigil"
      viewBox="0 0 40 40"
      width={size}
      height={size}
      role={labelled ? "img" : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
    >
      {labelled ? <title>{title}</title> : null}
      <path className="ef-sigil__frame" d="M20 1.5 L38.5 20 L20 38.5 L1.5 20 Z" />
      <path className="ef-sigil__frame-inner" d="M20 6 L34 20 L20 34 L6 20 Z" />
      <path
        className="ef-sigil__flame"
        d="M20 9.5 C23.5 14 26 16.8 24.6 21.2 C23.9 23.3 22.4 24.4 20 25.2 C17.6 24.4 16.1 23.3 15.4 21.2 C14 16.8 16.5 14 20 9.5 Z"
      />
      <path className="ef-sigil__core" d="M20 15.5 L22.6 20.3 L20 23 L17.4 20.3 Z" />
      <path
        className="ef-sigil__anvil"
        d="M12.5 27 H27.5 L25.5 29.5 H22.5 V31.5 H17.5 V29.5 H14.5 Z"
      />
    </svg>
  );
}
