import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { CalcFake } from "../src/calc/calc-fake.js";
import { ForgeEngine } from "../src/engine/forge-engine.js";
import { ForgeError } from "../src/engine/errors.js";
import { createMemoryLogger } from "../src/logger.js";
import { createForgeMcpServer } from "../src/mcp/forge-mcp.js";
import { RunStore } from "../src/store/run-store.js";
import { createCraft } from "../src/tools/craft-economy.js";
import { CONFIG, RELEASE, fixtureCatalog } from "./fixtures.js";
import { join } from "node:path";

async function connect(
  extra: Parameters<typeof createForgeMcpServer>[0] extends infer D ? Partial<D> : never,
) {
  const catalog = fixtureCatalog();
  const calc = new CalcFake({ dataReleaseId: RELEASE });
  const server = createForgeMcpServer({
    engine: new ForgeEngine({
      store: new RunStore(":memory:"),
      catalog,
      calc,
      config: CONFIG,
      pipelines: [],
      calcProfiles: ["default"],
    }),
    catalog,
    calc,
    calcProfiles: ["default"],
    waitLongPollSeconds: 0,
    logger: createMemoryLogger(),
    ...extra,
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe("craft_simulate and economy_price tools", () => {
  it("exist only when their ports are configured", async () => {
    const without = await connect({});
    expect((await without.listTools()).tools.map((t) => t.name)).not.toContain("craft_simulate");
    const withBoth = await connect({
      craft: () => Promise.reject(new Error("unused")),
      economy: () => Promise.reject(new Error("unused")),
    });
    const names = (await withBoth.listTools()).tools.map((t) => t.name);
    expect(names).toContain("craft_simulate");
    expect(names).toContain("economy_price");
  });

  it("reports a failed price lookup as an error, not as an empty result", async () => {
    const economy = vi.fn(() =>
      Promise.reject(new ForgeError("economy_failed", "reference_currency_unmapped: no mapping")),
    );
    const client = await connect({ economy });
    const result = await client.callTool({
      name: "economy_price",
      arguments: { items: [{ kind: "baseItem", id: "FixBase" }] },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("economy_failed");
  });
});

describe("createCraft", () => {
  it("answers a request for unknown catalog entities as an invalid request", async () => {
    const craft = await createCraft(
      join(import.meta.dirname, "../../../config/crafting/sim.json"),
      fixtureCatalog(),
    );
    await expect(
      craft({
        dataReleaseId: RELEASE,
        baseItemId: "NoSuchBase",
        itemLevel: 80,
        strategy: [],
        targets: [],
      } as never),
    ).rejects.toMatchObject({ name: "ForgeError", code: "invalid_request" });
  });
});
