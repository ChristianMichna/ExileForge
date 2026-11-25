import { describe, expect, it } from "vitest";
import type { CatalogPort } from "../src/ports/catalog.js";
import { createUniqueResolver } from "../src/tools/craft-economy.js";

/** Invented entities; only the fields the resolver reads. */
const entities: Record<string, { entity: Record<string, unknown> }[]> = {
  baseItem: [
    { entity: { id: "base-one", name: "Base One" } },
    { entity: { id: "base-two", name: "Base Two" } },
  ],
  uniqueItem: [
    { entity: { id: "uniq-1", name: "Alpha Piece", baseItemId: "base-one" } },
    { entity: { id: "uniq-2", name: "Twin", baseItemId: "base-one" } },
    { entity: { id: "uniq-3", name: "Twin", baseItemId: "base-two" } },
    { entity: { id: "uniq-4", name: "Triple", baseItemId: "base-one" } },
    { entity: { id: "uniq-5", name: "Triple", baseItemId: "base-one" } },
  ],
};
const catalog = { list: (kind: string) => entities[kind] ?? [] } as unknown as CatalogPort;

describe("createUniqueResolver", () => {
  const resolve = createUniqueResolver(catalog);

  it("resolves a unique name", () => {
    expect(resolve("Alpha Piece", undefined)).toBe("uniq-1");
  });

  it("narrows a repeated name by the base type's name", () => {
    expect(resolve("Twin", "Base Two")).toBe("uniq-3");
    expect(resolve("Twin", "Base One")).toBe("uniq-2");
  });

  it("gives nothing for an ambiguous, unknown or unnarrowed name", () => {
    expect(resolve("Twin", undefined)).toBeUndefined();
    expect(resolve("Triple", "Base One")).toBeUndefined();
    expect(resolve("Nope", "Base One")).toBeUndefined();
  });
});
