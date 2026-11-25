// Sample data for layout and screenshots only.
// Everything here is invented: names, items, mods and numbers are fantasy
// values (marked as provenance "sample", fixture "calc-fake"). Nothing is
// game data and nothing may be copied into the catalog or a real guide.
// Real views get their data from packages/contracts once that lands.
import type { ItemView, ProvenanceView, ValueState } from "@astrolabe/ui";

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
  kicker: "Sample build · made-up values",
  name: "Emberweaver",
  idea: "Chain-spark spell with ember stacks, focused on area damage",
} as const;

export const SAMPLE_STAGES: readonly SampleStage[] = [
  {
    id: "s1",
    label: "Start",
    levels: "Level 1–12",
    stats: [
      { id: "dps", label: "Hit DPS", state: sample(1840), format: "integer", emphasis: true },
      { id: "life", label: "Life", state: sample(412), format: "integer" },
      { id: "es", label: "Energy Shield", state: sample(96), format: "integer" },
      { id: "res", label: "Fire Resistance", state: sample(38), format: "percent" },
      { id: "speed", label: "Casts per Second", state: sample(2.4), format: "decimal1" },
      {
        id: "ehp",
        label: "Effective Hit Pool",
        state: { status: "loading" },
        format: "integer",
      },
      {
        id: "cost",
        label: "Stage Cost",
        state: { status: "uncalibrated", reason: "No market price for this league" },
        format: "integer",
      },
    ],
    notes: [
      "Socket the chain spark first; support follows with the second slot.",
      "Prioritise resistances over damage until the indicator turns green.",
      "Swap the starting armour piece for one with resistance.",
    ],
  },
  {
    id: "s2",
    label: "Build-up",
    levels: "Level 13–28",
    stats: [
      { id: "dps", label: "Hit DPS", state: sample(6120), format: "integer", emphasis: true },
      { id: "life", label: "Life", state: sample(864), format: "integer" },
      { id: "es", label: "Energy Shield", state: sample(240), format: "integer" },
      { id: "res", label: "Fire Resistance", state: sample(54), format: "percent" },
      { id: "speed", label: "Casts per Second", state: sample(2.9), format: "decimal1" },
      {
        id: "ehp",
        label: "Effective Hit Pool",
        state: { status: "error", message: "Worker timed out after 30 s" },
        format: "integer",
      },
    ],
    notes: ["Pick up a second ember source from the tree.", "Swap rings for ones with resistance."],
  },
  {
    id: "s3",
    label: "Transition",
    levels: "Level 29–52",
    stats: [
      { id: "dps", label: "Hit DPS", state: sample(21400), format: "integer", emphasis: true },
      { id: "life", label: "Life", state: sample(1720), format: "integer" },
    ],
    notes: ["Prepare a second skill setup for movement."],
  },
  {
    id: "s4",
    label: "Early Endgame",
    levels: "Level 53–75",
    stats: [
      { id: "dps", label: "Hit DPS", state: sample(88200), format: "integer", emphasis: true },
    ],
    notes: ["Start the crafting plan for the body armour."],
  },
  {
    id: "s5",
    label: "Endgame Goal",
    levels: "Level 76+",
    stats: [
      {
        id: "dps",
        label: "Hit DPS",
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
    notes: ["Needs a recheck after the latest patch."],
  },
];

export const SAMPLE_ITEMS: readonly ItemView[] = [
  {
    id: "sample/unique-helm",
    rarity: "unique",
    name: "Crown of the Silent Ember",
    baseType: "Soot Hood",
    itemClass: "Helmet",
    properties: [
      { label: "Energy Shield", value: "84", augmented: true },
      { label: "Quality", value: "+12%", augmented: true },
    ],
    requirements: [
      { label: "Level", value: "24", met: true },
      { label: "Int", value: "48", met: true },
    ],
    implicits: [],
    explicits: [
      { id: "u1", text: "+31 to maximum Energy Shield", kind: "prefix" },
      {
        id: "u2",
        text: "Ember stacks last 2 seconds longer",
        kind: "suffix",
        priority: true,
      },
      { id: "u3", text: "+22% to Fire Resistance", kind: "suffix" },
    ],
    flavour: "What once has burned never forgets the cold.",
    acquisition: "Drop, market price uncalibrated",
    provenance: SAMPLE,
  },
  {
    id: "sample/rare-body",
    rarity: "rare",
    name: "Ash Ward",
    baseType: "Slag Plate",
    itemClass: "Body Armour",
    properties: [
      { label: "Armour", value: "312", augmented: true },
      { label: "Energy Shield", value: "120" },
    ],
    requirements: [
      { label: "Level", value: "45", met: true },
      { label: "Str", value: "62", met: true },
      { label: "Int", value: "88", met: false },
    ],
    implicits: [{ id: "r0", text: "+12% to Fire Resistance", kind: "implicit" }],
    explicits: [
      {
        id: "r1",
        text: "+86 to maximum Life",
        kind: "prefix",
        tier: 2,
        range: "(80–94)",
        priority: true,
      },
      { id: "r2", text: "34% increased Energy Shield", kind: "prefix", tier: 3, range: "(27–35)" },
      { id: "r3", text: "+28% to Cold Resistance", kind: "suffix", tier: 4, range: "(26–30)" },
      { id: "r4", text: "+19 to Intelligence", kind: "suffix", tier: 5, range: "(18–22)" },
    ],
    acquisition: "Crafting plan",
    provenance: SAMPLE,
  },
  {
    id: "sample/magic-ring",
    rarity: "magic",
    baseType: "Fiery Bronze Band of Reach",
    itemClass: "Ring",
    properties: [],
    requirements: [{ label: "Level", value: "12", met: true }],
    implicits: [{ id: "m0", text: "+8% to Fire Resistance", kind: "implicit" }],
    explicits: [
      { id: "m1", text: "+14% to Fire Resistance", kind: "suffix" },
      { id: "m2", text: "9% increased Ember Duration", kind: "suffix" },
    ],
    acquisition: "Vendor",
    provenance: SAMPLE,
  },
  {
    id: "sample/normal-staff",
    rarity: "normal",
    baseType: "Coal Staff",
    itemClass: "Staff",
    properties: [{ label: "Spell Power", value: "+16%" }],
    requirements: [{ label: "Level", value: "3", met: true }],
    implicits: [{ id: "n0", text: "Gain an ember stack on kill", kind: "implicit" }],
    explicits: [],
    acquisition: "Starting gear",
    provenance: SAMPLE,
  },
];
