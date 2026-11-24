# ExileForge – Datenmodell eines Builds (Entwurf v0.2)

Stand: 2026-11-24. Notation als TypeScript-Typen, weil das am lesbarsten ist.
Quelle der Wahrheit werden laut [Projektplan](projektplan.md) **Zod-Schemas in
`packages/contracts`**, aus denen JSON Schema, OpenAPI und LLM-Tool-Definitionen
erzeugt werden. **⚠ Annahme** markiert ungeprüfte Punkte.
Ein Beispiel steht in [`examples/build.example.json`](../examples/build.example.json)
(noch in der Struktur v0.1).

## Zuordnung zu den Verträgen des Plans

Dieses Modell entstand vor dem Plan. Die Typen bleiben inhaltlich gültig, werden
aber auf die Stufen-Verträge der Build-Pipeline verteilt:

| Hier (v0.1) | Vertrag im Plan | Pipeline-Stufe |
| --- | --- | --- |
| `BuildRequest` | `BuildRequest` (plus Ausschlüsse, Komplexitätstoleranz) | S0 |
| – (neu) | `SkillProfile` | S1 |
| `Variant` | `ArchetypeCandidate` (+ Skelett-Build und Vergleichsmatrix aus S3) | S2–S4 |
| `Stage` des Endgames | `TargetBuild` | S5 |
| `Guide.stages[]`, `TreeState`, `SkillSetup` | `ProgressionPlan` | S6 |
| `ItemPlan`, `ItemSpec`, `ModSpec` | `GearPlan` (je Budget-Stufe) | S7 |
| `CraftPlan`, `CraftStep` | `CraftingPlan` (Entscheidungsbaum, Monte-Carlo-Ergebnis) | S8 |
| `Guide`, `GuideNote` | `GuideDocument` (11 Pflichtbausteine) | S9 |
| `CheckResult` | Prüfbericht der Gates G1–G8 + Vollständigkeits-Score | S10 |
| `ExportRecord` | Exporte (`.build`, PoB-Code je Stufe, Markdown/PDF) | S11 |
| `Sourced<T>`, Platzhalter `{{calc…}}` | `calcRef` + Zahlen-Linter | überall |
| `PatchStatus` | Revalidierung gegen ein neues Daten-Release (F-19) | – |

Änderungen gegenüber v0.1:

- **IDs:** Kanonisch sind die internen Spiel-IDs aus dem Katalog
  (z. B. `Metadata/Items/Gems/…`, PassiveSkills-IDs), dieselben wie im
  `.build`-Format. PoB-eigene numerische Knoten-IDs sind nur Zusatzfeld.
  Jede Referenz muss im Katalog der Ziel-Version existieren (Gate G1).
- **Versionen:** Statt nur `gameVersion` trägt jeder Build die
  **Daten-Release-ID** (z. B. `poe2-1.0.0.3+r2`), die PoB-Version, Calc-Profil,
  Modelle, Prompt-Versionen und Seeds.
- **Calc-Profile:** Jedes `CalcResult` nennt sein Profil (`mapping`, `pinnacle`, `uber`).
- **Stufen:** PoE2 1.0 hat Akte 1–6; Standard sind mindestens 10 Stufen.

## Grundregeln

1. **Der Build beschreibt Entscheidungen, PoB liefert Zahlen.** Felder, die die
   KI oder der Nutzer setzt (Knoten, Gems, Items, Craft-Schritte), stehen
   getrennt von Rechenergebnissen (`CalcResult`).
2. **Jede Zahl hat eine Herkunft.** Ein Zahlenwert, der angezeigt wird, ist
   immer ein `Sourced<number>` mit `source` und Version. Es gibt keine
   Zahlenfelder ohne Herkunft.
3. **IDs statt Namen.** Gems, Knoten, Mods und Basen werden über stabile IDs
   referenziert; Namen kommen aus den Spieldaten der jeweiligen Version. So
   erkennt die Patch-Prüfung entfernte oder geänderte Dinge.
4. **Versioniert.** Jede Änderung erzeugt eine neue Revision; Ergebnisse hängen
   an Revision + PoB-Version.

## Herkunft von Zahlen

```ts
type Source =
  | { kind: "pob"; pobVersion: string; calcId: string }        // Rechenergebnis
  | { kind: "gamedata"; gameVersion: string; table: string }    // z. B. Mod-Gewichte
  | { kind: "market"; provider: "poe.ninja" | "trade"; fetchedAt: string; league: string }
  | { kind: "derived"; from: string[]; formula: string };       // z. B. Erwartungswert aus gamedata + market

interface Sourced<T> { value: T; source: Source }
```

`derived` ist für Crafting nötig: Erwartete Kosten = erwartete Versuche
(aus Mod-Gewichten) × Preis (vom Markt). Die Formel wird mitgespeichert, damit
nachvollziehbar ist, wie die Zahl entstand. Die KI schreibt nie eine Zahl
direkt.

## Wurzel: Build

```ts
interface Build {
  id: string;                    // UUID
  revision: number;
  schemaVersion: 1;
  name: string;
  createdAt: string; updatedAt: string;
  gameVersion: string;           // z. B. "0.5.2" — für diese Version geplant
  league: string;                // für Preise, z. B. "Standard" oder aktuelle Liga

  request: BuildRequest;         // was der Spieler wollte
  variants: Variant[];           // geplante Varianten (Phase 1)
  chosenVariantId?: string;
  guide?: Guide;                 // ausgearbeiteter Guide (Phase 2)

  patchStatus: PatchStatus;
}
```

## Anfrage: Skill-Idee und Vorlieben

```ts
interface BuildRequest {
  skillIdea: string;             // Freitext, z. B. "Blitzpfeile mit Beschwörungen"
  mainSkillGemId?: string;       // falls direkt gewählt
  preferences: {
    playstyle: ("melee" | "ranged" | "caster" | "minion" | "totem" | "trap" | "other")[];
    pace: "slow-tanky" | "balanced" | "fast-clear";
    focus: "mapping" | "bossing" | "allround";
    defense: ("life" | "energyShield" | "armour" | "evasion" | "block" | "mixed")[];
    budget: { leveling: Budget; endgame: Budget };
    mode: { hardcore: boolean; ssf: boolean };
    avoid?: string[];            // z. B. Klassen, Mechaniken, Uniques
    notes?: string;
  };
}

type Budget = "league-start" | "low" | "medium" | "high" | "mirror";
```

## Varianten (Phase 1)

```ts
interface Variant {
  id: string;
  title: string;                 // z. B. "Deadeye – Blitz, Evasion"
  classId: string;               // PoB-Klassen-ID
  ascendancyId: string;
  summary: string;               // Erklärtext der KI, nur Platzhalter statt Zahlen
  pros: string[]; cons: string[];
  snapshot: Stage;               // ein repräsentativer Endgame-Stand zum Vergleich
  calc?: CalcResult;             // PoB-Rechnung dieses Stands
}
```

## Guide (Phase 2)

```ts
interface Guide {
  variantId: string;
  stages: Stage[];               // in Spielreihenfolge
  crafts: CraftPlan[];           // referenziert aus ItemPlan.craftPlanId
  exports: ExportRecord[];
}
```

### Stufe

Eine Stufe ist ein durchrechenbarer Stand des Charakters. Standard laut Plan
mindestens 10 Stufen (konfigurierbar in `config/`), z. B.:
Akt 1 · Akt 2 · Akt 3 · Akt 4 · Akt 5 · Akt 6 · Übergang zu Maps · frühe Maps ·
Atlas-Fortschritt · Pinnacle-ready · Endgame-Ausbau · optional Luxus.

```ts
interface Stage {
  id: string;
  order: number;
  label: string;                 // "Akt 2 – Level 18–28"
  kind: "campaign" | "endgame";
  act?: number;
  levelRange: [number, number];  // Charakterlevel von–bis
  budget?: Budget;               // nur Endgame-Stufen

  tree: TreeState;
  skills: SkillSetup[];
  items: ItemPlan[];
  config: CalcConfig;            // PoB-Konfiguration (Gegner, Buffs, Ladungen …)
  notes: GuideNote[];            // Erklärtexte, Platzhalter auf CalcResult

  calc?: CalcResult;             // PoB-Ergebnis für genau diesen Stand
  checks?: CheckResult[];        // Prüfregeln (Resistenzen, Spirit, Attribute …)
}
```

### Passive Tree

```ts
interface TreeState {
  treeVersion: string;           // Tree-Version aus PoB
  allocated: AllocatedNode[];    // vollständiger Stand am Ende der Stufe
  ascendancy: AllocatedNode[];
  // Reihenfolge, in der die neuen Punkte dieser Stufe gesetzt werden:
  allocationOrder: number[];     // PoB-Knoten-IDs, nur die neu dazugekommenen
  respecs?: number[];            // Knoten, die in dieser Stufe wieder entfernt werden
}

interface AllocatedNode {
  nodeId: number;                // PoB-Knoten-ID (numerisch)
  ggId?: string;                 // GGG-PassiveSkills-ID für .build, z. B. "strength89"
  weaponSet?: 0 | 1 | 2;         // 0 = beide, 1/2 = Waffenset
  reason?: string;               // kurzer Grund, ohne Zahlen
}
```

### Gems

In PoE2 sitzen Supports im Skill-Gem selbst, nicht in Item-Sockeln.

```ts
interface SkillSetup {
  id: string;
  role: "main" | "secondary" | "aura" | "buff" | "movement" | "utility" | "minion";
  gem: GemRef;
  supports: GemRef[];
  weaponSet?: 0 | 1 | 2;
  acquiredAt?: { act?: number; level?: number; how: "quest" | "drop" | "vendor" | "uncut-gem" };
  replaces?: string;             // id eines SkillSetup aus einer früheren Stufe
}

interface GemRef {
  gemId: string;                 // PoB-Gem-ID
  ggBaseType?: string;           // "Metadata/Items/Gems/SkillGem…" für .build
  level: number;
  quality: number;
}
```

### Ausrüstung

```ts
type Slot =
  | "Weapon1" | "Offhand1" | "Weapon2" | "Offhand2"
  | "Helm" | "BodyArmour" | "Gloves" | "Boots" | "Belt"
  | "Amulet" | "Ring1" | "Ring2" | "Flask1" | "Flask2" | "Charm1" | "Charm2" | "Charm3"
  | "Jewel";                     // ⚠ Annahme: Slotnamen nach PoB, Übersetzung für .build im Exporter

interface ItemPlan {
  id: string;
  slot: Slot;
  priority: "core" | "important" | "nice";
  item: ItemSpec;                // was angestrebt wird (geht so in PoB)
  minimum?: ItemSpec;            // was gerade noch reicht
  alternatives?: ItemSpec[];
  acquisition: "drop" | "vendor" | "trade" | "craft";
  craftPlanId?: string;
  estimatedCost?: Sourced<Price>;
}

interface ItemSpec {
  rarity: "normal" | "magic" | "rare" | "unique";
  baseTypeId: string;            // PoB-Basis
  uniqueName?: string;
  itemLevel?: number;
  quality?: number;
  mods: ModSpec[];
  runes?: string[];              // Sockel-Augmente
  pobText?: string;              // fertiger Item-Text für PoB, vom Exporter erzeugt
}

interface ModSpec {
  modId: string;                 // Mod-ID aus den Spieldaten
  kind: "prefix" | "suffix" | "implicit" | "enchant" | "rune" | "desecrated";
  tier?: number;
  value?: number[];              // angenommener Wert (für die PoB-Rechnung)
  required: boolean;             // muss vs. schön
}
```

### Crafting mit Kosten

```ts
interface CraftPlan {
  id: string;
  target: ItemSpec;
  startFrom: { baseTypeId: string; itemLevel: number; cost?: Sourced<Price> };
  steps: CraftStep[];
  expectedTotal?: Sourced<Price>;     // derived
  worstCaseHint?: string;
}

interface CraftStep {
  order: number;
  action:
    | "transmute" | "augment" | "regal" | "exalt" | "chaos" | "annul"
    | "alchemy" | "essence" | "omen" | "rune" | "bench" | "corrupt" | "other";
  currencyId: string;                 // Spieldaten-ID der Währung/Essenz/Omen
  quantityPerAttempt: number;
  goal: string;                       // was dieser Schritt erreichen soll
  successChance?: Sourced<number>;    // aus Mod-Gewichten (gamedata/derived)
  expectedAttempts?: Sourced<number>; // derived
  expectedCost?: Sourced<Price>;      // derived
  onFail: { action: "repeat" | "goto" | "restart" | "accept"; gotoOrder?: number };
}

interface Price { amount: number; currency: "exalted" | "divine" | "chaos" | string }
```

**⚠ Annahme:** Die Liste der Craft-Aktionen passt zum aktuellen PoE2-Stand und
muss mit jedem größeren Patch geprüft werden.

### Rechenergebnisse aus PoB

```ts
interface CalcResult {
  calcId: string;
  pobVersion: string;
  gameVersion: string;
  inputHash: string;             // Hash des PoB-XML, das gerechnet wurde
  calcProfile: "mapping" | "pinnacle" | "uber" | string; // config/calc-profiles/
  computedAt: string;
  mainSkillId: string;
  stats: {                       // feste Auswahl für Anzeige und Vergleich
    dps?: number; hitDps?: number; dotDps?: number;
    life: number; energyShield: number; mana: number; spirit: number;
    armour: number; evasion: number;
    resists: { fire: number; cold: number; lightning: number; chaos: number };
    blockChance?: number;
    ehp?: number;
    movementSpeed?: number;
    attributes: { str: number; dex: number; int: number };
  };
  raw: Record<string, number>;   // vollständige PoB-Ausgabe (mainOutput)
  warnings: string[];            // PoB-Hinweise, z. B. fehlende Attribute
}
```

Felder unter `stats` sind Zahlen ohne eigenes `Sourced`, weil das ganze
`CalcResult` die Herkunft trägt (`pobVersion`, `calcId`).

### Prüfungen, Notizen, Export, Patch

```ts
interface CheckResult { rule: string; ok: boolean; detail: string; calcId: string }

interface GuideNote {
  target?: { kind: "node" | "skill" | "item" | "craft" | "stage"; id: string };
  text: string;                  // darf {{calc.stats.life}} usw. enthalten, keine Ziffern
}

interface CalcConfig { [pobConfigKey: string]: boolean | number | string }

interface ExportRecord {
  kind: "build-file" | "pob-code";
  stageIds: string[];
  gameVersion: string;
  createdAt: string;
  path?: string;
}

interface PatchStatus {
  checkedFor?: { pobVersion: string; gameVersion: string; at: string };
  state: "ok" | "needs-review" | "broken" | "unchecked";
  findings: { stageId: string; kind: "removed" | "changed" | "stat-drift"; detail: string }[];
}
```

## Abbildung auf die `.build`-Datei

| ExileForge | `.build` |
| --- | --- |
| `Guide.stages[].tree.allocated[].ggId` | `passives[].id` |
| `AllocatedNode.weaponSet` | `passives[].weapon_set` |
| erste/letzte Stufe, in der ein Knoten vorkommt → Level | `passives[].level_interval` |
| `SkillSetup.gem.ggBaseType` / `supports[].ggBaseType` | `skills[].id` / `skills[].support_skills[]` |
| `ItemPlan.slot` | `inventory_slots[].inventory_id` |
| `ItemSpec.uniqueName` | `inventory_slots[].unique_name` |
| Kurztext aus `ItemPlan` (wichtigste Mods) | `inventory_slots[].additional_text` |
| `Variant.ascendancyId` | `ascendancy` (**⚠ Annahme:** Schreibweise offen) |

Alle Stufen landen in **einer** Datei; der Lebenslauf jedes Eintrags wird über
`level_interval` ausgedrückt. Item-Werte, Crafting und Zahlen gehen dabei
verloren; dafür gibt es den Guide in der Web-App und die PoB-Codes.
