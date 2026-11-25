// Own SVG ornaments (no game art). Colours come from ornaments.css (tokens only).
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
      <path className="ef-orn-stroke" d="M6 1 L11 6 L6 11 L1 6 Z" />
      <path className="ef-orn-fill" d="M6 4 L8 6 L6 8 L4 6 Z" />
    </svg>
  );
}

/** Engraved hairline with a small diamond in the middle. Decorative. */
export function OrnamentDivider({ className }: { className?: string }) {
  return (
    <div className={className ? `ef-divider ${className}` : "ef-divider"} aria-hidden="true">
      <span className="ef-divider__line ef-divider__line--start" />
      <Diamond />
      <span className="ef-divider__line ef-divider__line--end" />
    </div>
  );
}

/** Astrolabe mark: an astrolabe ring with a crossed triangle sight. Own design. */
export function Sigil({ size = 40, title }: { size?: number; title?: string }) {
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
      <circle className="ef-sigil__ring" cx="24" cy="24" r="21" />
      <circle className="ef-sigil__ring ef-sigil__ring--inner" cx="24" cy="24" r="15" />
      <path className="ef-sigil__ticks" d="M24 1 V6 M24 42 V47 M1 24 H6 M42 24 H47" />
      <path className="ef-sigil__sight" d="M24 9 L37 31.5 L11 31.5 Z" />
      <path className="ef-sigil__sight ef-sigil__sight--dim" d="M24 39 L11 16.5 L37 16.5 Z" />
      <circle className="ef-sigil__core" cx="24" cy="24" r="2.5" />
    </svg>
  );
}
