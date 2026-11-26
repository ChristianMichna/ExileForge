import { describe, expect, it } from "vitest";
import type { ProgressionStage } from "@astrolabe/contracts/build";
import { gemChanges } from "./gem-changes";

const gem = (gemId: string, level = 1) => ({ gemId, level });
const stage = (
  skills: { key: string; gem: ReturnType<typeof gem>; supports: ReturnType<typeof gem>[] }[],
) => ({ state: { skills } }) as unknown as ProgressionStage;

describe("gemChanges", () => {
  it("has nothing to compare for the first stage", () => {
    expect(gemChanges(undefined, stage([]))).toEqual([]);
  });

  it("finds new and dropped skills, level changes and support changes by skill key", () => {
    const before = stage([
      { key: "main", gem: gem("A", 1), supports: [gem("S1"), gem("S2")] },
      { key: "old", gem: gem("O"), supports: [gem("OS")] },
    ]);
    const after = stage([
      { key: "main", gem: gem("A", 5), supports: [gem("S1"), gem("S3")] },
      { key: "new", gem: gem("N"), supports: [gem("NS")] },
    ]);
    const changes = gemChanges(before, after);
    expect(changes).toContainEqual(
      expect.objectContaining({ kind: "supports", gemId: "A", added: ["S3"], dropped: ["S2"] }),
    );
    expect(changes).toContainEqual(
      expect.objectContaining({ kind: "level", gemId: "A", from: 1, to: 5 }),
    );
    expect(changes).toContainEqual(
      expect.objectContaining({ kind: "new", gemId: "N", added: ["NS"] }),
    );
    expect(changes).toContainEqual(
      expect.objectContaining({ kind: "removed", gemId: "O", dropped: ["OS"] }),
    );
  });

  it("reports nothing when the setup is the same", () => {
    const same = stage([{ key: "main", gem: gem("A"), supports: [gem("S1")] }]);
    expect(gemChanges(same, same)).toEqual([]);
  });

  it("reports a swapped skill gem under the same key as a swap, not as a level change", () => {
    const before = stage([{ key: "main", gem: gem("Old", 18), supports: [gem("S1")] }]);
    const after = stage([{ key: "main", gem: gem("New", 1), supports: [gem("S1")] }]);
    const changes = gemChanges(before, after);
    expect(changes).toEqual([
      expect.objectContaining({ kind: "swap", gemId: "New", fromGemId: "Old" }),
    ]);
  });
});
