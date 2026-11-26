import { describe, expect, it } from "vitest";
import type { PublishedGuide } from "@astrolabe/contracts/guide";
import { BuildFile, guideToBuildFile } from "../src/build-file.js";

const skill = (gem: string, supports: string[]) => ({
  key: "main",
  role: "main",
  gem: { gemId: gem, level: 1, quality: 0 },
  supports: supports.map((gemId) => ({ gemId, level: 1, quality: 0 })),
});
const stage = (
  key: string,
  order: number,
  levelRange: [number, number],
  nodes: [string, number][],
  skills: object[],
  items: object[] = [],
) => ({
  key,
  order,
  levelRange,
  allocationOrder: nodes.map(([n]) => n),
  state: {
    tree: {
      allocated: nodes.map(([nodeId, weaponSet]) => ({ nodeId, weaponSet })),
      ascendancy: [],
    },
    skills,
    items,
  },
});
const guide = {
  summary: { ascendancyId: "Asc1" },
  progression: {
    stages: [
      stage(
        "a",
        0,
        [1, 10],
        [
          ["n1", 0],
          ["n2", 0],
        ],
        [skill("G", ["S1"])],
      ),
      stage(
        "b",
        1,
        [11, 20],
        [
          ["n1", 0],
          ["n2", 0],
          ["n3", 1],
          ["n9", 0],
        ],
        [skill("G", ["S1", "S2"])],
        [
          { slot: "Ring 1", item: { kind: "unique", uniqueId: "U" } },
          {
            slot: "Weapon 1",
            item: {
              kind: "crafted",
              baseItemId: "Wand",
              rarity: "Rare",
              mods: [{ modId: "M", required: true }],
            },
          },
          { slot: "Weapon 1 Swap", item: { kind: "unique", uniqueId: "U" } },
        ],
      ),
      stage(
        "c",
        2,
        [21, 30],
        [
          ["n1", 0],
          ["n3", 1],
        ],
        [skill("G2", [])],
      ),
    ],
  },
} as never as PublishedGuide;
const resolve = {
  passiveGameId: (id: string) => (id === "n9" ? undefined : `game_${id}`),
  slotGameId: (id: string) => (id === "Weapon 1 Swap" ? undefined : id.replace(" ", "")),
  uniqueName: (id: string) => `Unique ${id}`,
  entityName: (r: { id: string }) => `Name ${r.id}`,
};

describe("guideToBuildFile", () => {
  const { file, omitted } = guideToBuildFile(guide, resolve, "Test build");

  it("spans each passive over the stages it stays allocated in", () => {
    expect(file.passives).toEqual([
      { id: "game_n1", level_interval: [1, 30] },
      { id: "game_n2", level_interval: [1, 20] },
      { id: "game_n3", level_interval: [11, 30], weapon_set: 1 },
    ]);
  });

  it("splits a skill where the active gem changes and spans supports separately", () => {
    expect(file.skills).toEqual([
      {
        id: "G",
        level_interval: [1, 20],
        support_skills: [
          { id: "S1", level_interval: [1, 20] },
          { id: "S2", level_interval: [11, 20] },
        ],
      },
      { id: "G2", level_interval: [21, 30], support_skills: [] },
    ]);
  });

  it("names uniques and describes rares", () => {
    expect(file.inventory_slots).toEqual([
      { inventory_id: "Ring1", level_interval: [11, 20], unique_name: "Unique U" },
      {
        inventory_id: "Weapon1",
        level_interval: [11, 20],
        additional_text: "Rare Name Wand: Name M",
      },
    ]);
  });

  it("lists what has no game id instead of guessing", () => {
    expect(omitted).toEqual([
      "passive n9: the release has no game id",
      "slot Weapon 1 Swap: the release has no inventory id",
    ]);
  });

  it("produces a file that satisfies the format schema", () => {
    expect(BuildFile.safeParse(file).success).toBe(true);
    expect(file.ascendancy).toBe("Asc1");
  });
});
