// Sample data for layout and screenshots only.
// Everything here is invented: names, items, mods and numbers are fantasy
// values (marked as provenance "sample", fixture "calc-fake"). Nothing is
// game data and nothing may be copied into the catalog or a real guide.
// Real views get their data from packages/contracts once that lands.
import type { ItemView, ProvenanceView, ValueState } from "@exileforge/ui";

const SAMPLE: ProvenanceView = { kind: "sample", fixture: "calc-fake" };

function sample(value: number): ValueState {
  return { status: "ready", value, provenance: SAMPLE };
}

export interface SampleStat {
  readonly id: string;
  readonly label: string;
  readonly state: ValueState;
  readonly format: "integer" | "percent" | "decimal1";
  readonly emphasis?: boolean;
}

export interface SampleStage {
  readonly id: string;
  readonly label: string;
  readonly levels: string;
  readonly stats: readonly SampleStat[];
  readonly notes: readonly string[];
}

export const SAMPLE_BUILD = {
  kicker: "Beispiel-Build · Fantasiewerte",
  name: "Glutweber",
  idea: "Funkenketten-Zauber mit Glut-Aufladungen, Fokus auf Flächenschaden",
} as const;

export const SAMPLE_STAGES: readonly SampleStage[] = [
  {
    id: "s1",
    label: "Einstieg",
    levels: "Stufe 1–12",
    stats: [
      { id: "dps", label: "Treffer-DPS", state: sample(1840), format: "integer", emphasis: true },
      { id: "life", label: "Leben", state: sample(412), format: "integer" },
      { id: "es", label: "Energieschild", state: sample(96), format: "integer" },
      { id: "res", label: "Feuerwiderstand", state: sample(38), format: "percent" },
      { id: "speed", label: "Zauber pro Sekunde", state: sample(2.4), format: "decimal1" },
      {
        id: "ehp",
        label: "Effektive Lebenspunkte",
        state: { status: "loading" },
        format: "integer",
      },
      {
        id: "cost",
        label: "Kosten der Stufe",
        state: { status: "uncalibrated", reason: "Kein Marktpreis für diese Liga" },
        format: "integer",
      },
    ],
    notes: [
      "Zuerst die Funkenkette sockeln, Unterstützung folgt mit der zweiten Fassung.",
      "Widerstände vor Schaden priorisieren, bis die Anzeige grün ist.",
      "Kettenrüstung beim Händler prüfen, sobald Gold reicht.",
    ],
  },
  {
    id: "s2",
    label: "Aufbau",
    levels: "Stufe 13–28",
    stats: [
      { id: "dps", label: "Treffer-DPS", state: sample(6120), format: "integer", emphasis: true },
      { id: "life", label: "Leben", state: sample(864), format: "integer" },
      { id: "es", label: "Energieschild", state: sample(240), format: "integer" },
      { id: "res", label: "Feuerwiderstand", state: sample(54), format: "percent" },
      { id: "speed", label: "Zauber pro Sekunde", state: sample(2.9), format: "decimal1" },
      {
        id: "ehp",
        label: "Effektive Lebenspunkte",
        state: { status: "error", message: "Worker-Zeitlimit nach 30 s überschritten" },
        format: "integer",
      },
    ],
    notes: ["Zweite Glutquelle über den Baum holen.", "Ringe mit Widerstand tauschen."],
  },
  {
    id: "s3",
    label: "Übergang",
    levels: "Stufe 29–52",
    stats: [
      { id: "dps", label: "Treffer-DPS", state: sample(21400), format: "integer", emphasis: true },
      { id: "life", label: "Leben", state: sample(1720), format: "integer" },
    ],
    notes: ["Waffenset 2 für Bewegungsfertigkeiten belegen."],
  },
  {
    id: "s4",
    label: "Endgame-Start",
    levels: "Stufe 53–75",
    stats: [
      { id: "dps", label: "Treffer-DPS", state: sample(88200), format: "integer", emphasis: true },
    ],
    notes: ["Crafting-Plan für den Körperpanzer starten."],
  },
  {
    id: "s5",
    label: "Endgame-Ziel",
    levels: "Stufe 76+",
    stats: [
      {
        id: "dps",
        label: "Treffer-DPS",
        state: {
          status: "ready",
          value: 412000,
          stale: true,
          provenance: SAMPLE,
        },
        format: "integer",
        emphasis: true,
      },
    ],
    notes: ["Nach dem letzten Patch neu zu prüfen."],
  },
];

export const SAMPLE_ITEMS: readonly ItemView[] = [
  {
    id: "sample/unique-helm",
    rarity: "unique",
    name: "Krone der stillen Glut",
    baseType: "Rußhaube",
    itemClass: "Helm",
    properties: [
      { label: "Energieschild", value: "84", augmented: true },
      { label: "Qualität", value: "+12 %", augmented: true },
    ],
    requirements: [
      { label: "Stufe", value: "24", met: true },
      { label: "Int", value: "48", met: true },
    ],
    implicits: [],
    explicits: [
      { id: "u1", text: "+31 zu maximalem Energieschild", kind: "prefix" },
      {
        id: "u2",
        text: "Glut-Aufladungen halten 2 Sekunden länger",
        kind: "suffix",
        priority: true,
      },
      { id: "u3", text: "+22 % Feuerwiderstand", kind: "suffix" },
    ],
    flavour: "Was einmal brennt, vergisst die Kälte nie.",
    acquisition: "Drop, Marktpreis unkalibriert",
  },
  {
    id: "sample/rare-body",
    rarity: "rare",
    name: "Aschen-Wehr",
    baseType: "Schlackenpanzer",
    itemClass: "Körperrüstung",
    properties: [
      { label: "Rüstung", value: "312", augmented: true },
      { label: "Energieschild", value: "120" },
    ],
    requirements: [
      { label: "Stufe", value: "45", met: true },
      { label: "Str", value: "62", met: true },
      { label: "Int", value: "88", met: false },
    ],
    implicits: [{ id: "r0", text: "+12 % Feuerwiderstand", kind: "implicit" }],
    explicits: [
      {
        id: "r1",
        text: "+86 zu maximalem Leben",
        kind: "prefix",
        tier: 2,
        range: "(80–94)",
        priority: true,
      },
      { id: "r2", text: "34 % erhöhter Energieschild", kind: "prefix", tier: 3, range: "(27–35)" },
      { id: "r3", text: "+28 % Kältewiderstand", kind: "suffix", tier: 4, range: "(26–30)" },
      { id: "r4", text: "+19 zu Intelligenz", kind: "suffix", tier: 5, range: "(18–22)" },
    ],
    acquisition: "Crafting-Plan, Schritt 3",
  },
  {
    id: "sample/magic-ring",
    rarity: "magic",
    baseType: "Feuriger Bronzereif der Weite",
    itemClass: "Ring",
    properties: [],
    requirements: [{ label: "Stufe", value: "12", met: true }],
    implicits: [{ id: "m0", text: "+8 % Feuerwiderstand", kind: "implicit" }],
    explicits: [
      { id: "m1", text: "+14 % Feuerwiderstand", kind: "suffix" },
      { id: "m2", text: "9 % erhöhte Gegenstandsseltenheit", kind: "suffix" },
    ],
    acquisition: "Händler",
  },
  {
    id: "sample/normal-staff",
    rarity: "normal",
    baseType: "Kohlenstab",
    itemClass: "Stab",
    properties: [{ label: "Zauberkraft", value: "+16 %" }],
    requirements: [{ label: "Stufe", value: "3", met: true }],
    implicits: [{ id: "n0", text: "Erhält eine Glut-Aufladung beim Kill", kind: "implicit" }],
    explicits: [],
    acquisition: "Startausrüstung",
  },
];
