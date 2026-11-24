// Typed names for token-driven variants. Values live in tokens.css only.

export const RARITIES = ["normal", "magic", "rare", "unique"] as const;
export type Rarity = (typeof RARITIES)[number];

export const RARITY_LABELS: Readonly<Record<Rarity, string>> = {
  normal: "Normal",
  magic: "Magisch",
  rare: "Selten",
  unique: "Einzigartig",
};

/** Token groups shown in the design gallery. Names only, never values. */
export const COLOR_TOKEN_GROUPS: ReadonlyArray<{
  readonly title: string;
  readonly tokens: readonly string[];
}> = [
  {
    title: "Grund",
    tokens: ["ground", "surface-1", "surface-2", "surface-3", "inset", "line", "line-strong"],
  },
  { title: "Akzent", tokens: ["bronze-dark", "bronze", "gold", "gold-bright"] },
  { title: "Text", tokens: ["text", "text-muted", "text-faint"] },
  { title: "Rückmeldung", tokens: ["danger", "warning", "success", "info"] },
  {
    title: "Seltenheit",
    tokens: ["rarity-normal", "rarity-magic", "rarity-rare", "rarity-unique", "gem", "currency"],
  },
  {
    title: "Herkunft",
    tokens: [
      "prov-pob",
      "prov-market",
      "prov-derived",
      "prov-gamedata",
      "prov-sample",
      "prov-uncalibrated",
    ],
  },
];

export const SPACE_STEPS = [1, 2, 3, 4, 5, 6, 7] as const;

export function colorVar(token: string): string {
  return `var(--ef-color-${token})`;
}
