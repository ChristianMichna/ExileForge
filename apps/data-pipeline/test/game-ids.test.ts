import { describe, expect, it } from "vitest";
import { applyGameIds, normalizeName } from "../src/normalize/game-ids.ts";
import { cfg } from "./fixtures/raw-catalog.ts";
import { tables, write } from "./fixtures/game-data.ts";

const config = cfg.gameIds;
const nodes = [
  { pobNodeId: 1, name: "Start" },
  { pobNodeId: 2, name: "Big" },
  { pobNodeId: 3, name: "Asc Start" },
  { pobNodeId: 5, name: "Ring" },
  { pobNodeId: 7, name: "Nowhere" },
  { name: "No PoB id" },
];
const slots = [
  { id: "Fake Finger", order: 1, label: "Fake Finger", itemClasses: ["Ring"] },
  { id: "Fake Hand 2", order: 2, label: "Fake Hand", itemClasses: ["Sword"] },
  { id: "Fake Charm", order: 3, label: "Fake Charm", itemClasses: ["Charm"] },
];

describe("normalizeName", () => {
  it("drops markup, case and spacing", () => {
    expect(normalizeName(" [Fire|Fire]  Test [Mana] ")).toBe("fire test mana");
  });
});

describe("applyGameIds", () => {
  it("matches by node id and name and counts everything else", async () => {
    const dir = await write(tables());
    const res = await applyGameIds({ gameDataDir: dir, config, passiveNodes: nodes, slots });
    expect(res.errors).toEqual([]);
    expect(res.passiveGameIds).toEqual([
      "fixture_start",
      "fixture_big",
      undefined, // other name
      undefined, // two rows
      undefined, // no row
      undefined, // no PoB node id
    ]);
    expect(res.summary).toMatchObject({ passivesWithGameId: 2, passivesWithoutGameId: 4 });
    const text = res.findings.map((f) => f.message).join("\n");
    expect(text).toMatch(
      /4 passive nodes have no game id \(no row 2, several rows 1, other name 1/,
    );
    expect(res.slots.map((s) => [s.id, (s as { gameId?: string }).gameId])).toEqual([
      ["Fake Finger", "FixtureFinger"],
      ["Fake Hand 2", "FixtureHand2"],
      ["Fake Charm", undefined],
    ]);
    expect(res.summary).toMatchObject({ slotsWithGameId: 2, slotsWithoutGameId: 1 });
    expect(text).toMatch(/1 slots have no game id: Fake Charm; Inventories rows no slot maps to: /);
  });

  it("is an error when two nodes would get the same id", async () => {
    const t = tables();
    t.PassiveSkills = [
      { Id: "same", Name: "Start", PassiveSkillGraphId: 1 },
      { Id: "same", Name: "Big", PassiveSkillGraphId: 2 },
    ];
    const dir = await write(t);
    const res = await applyGameIds({ gameDataDir: dir, config, passiveNodes: nodes, slots });
    expect(res.errors.map((e) => e.message).join("\n")).toMatch(
      /game id is used by passive nodes 1 and 2/,
    );
  });

  it("is an error when the mapping names an inventory id the table lacks", async () => {
    const bad = { ...config, slots: { ...config.slots, map: { "Fake Hand 2": "Missing1" } } };
    const dir = await write(tables());
    const res = await applyGameIds({ gameDataDir: dir, config: bad, passiveNodes: nodes, slots });
    expect(res.errors.map((e) => e.message)).toEqual(["Inventories has no row Missing1"]);
    expect(res.slots.every((s) => (s as { gameId?: string }).gameId === undefined)).toBe(true);
  });

  it("aborts when a required table is missing", async () => {
    const t = tables();
    delete (t as Record<string, unknown>).Inventories;
    const dir = await write(t);
    await expect(
      applyGameIds({ gameDataDir: dir, config, passiveNodes: nodes, slots }),
    ).rejects.toThrow(/no table Inventories/);
  });

  it("reports a mapped slot that the release lacks and an empty id", async () => {
    const t = tables();
    t.PassiveSkills = [{ Id: "", Name: "Start", PassiveSkillGraphId: 1 }];
    const dir = await write(t);
    const cfg2 = { ...config, slots: { ...config.slots, map: { Gone: "FixtureHand2" } } };
    const res = await applyGameIds({ gameDataDir: dir, config: cfg2, passiveNodes: nodes, slots });
    const text = res.findings.map((f) => f.message).join("\n");
    expect(text).toMatch(/mapped slot is not a slot of the release/);
    expect(text).toMatch(/empty id 1/);
  });

  it("aborts when PassiveSkills is missing", async () => {
    const t = tables();
    delete (t as Record<string, unknown>).PassiveSkills;
    const dir = await write(t);
    await expect(
      applyGameIds({ gameDataDir: dir, config, passiveNodes: nodes, slots }),
    ).rejects.toThrow(/no table PassiveSkills/);
  });
});
