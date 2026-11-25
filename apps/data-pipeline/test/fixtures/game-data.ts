import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportGameData, type DatTool } from "../../src/gamedata/export.ts";
import { gameDataConfigSchema } from "../../src/gamedata/config.ts";

export type Rows = Record<string, Record<string, unknown>[]>;

// invented tables; all values are made up for the logic tests
export function tables(): Rows {
  return {
    BaseItemTypes: [
      { Id: "Test/Orb", Name: "Test Orb", ItemClass: 0, DropLevel: 3 },
      { Id: "Test/Orb2", Name: "Greater Test Orb", ItemClass: 0, DropLevel: 40 },
      { Id: "Test/Essence", Name: "Test Essence", ItemClass: 0, DropLevel: 10 },
      { Id: "Test/Omen", Name: "Test Omen", ItemClass: 1, DropLevel: 1 },
      { Id: "Test/Core", Name: "Test Core", ItemClass: 2, DropLevel: 1 },
    ],
    ItemClasses: [{ Id: "StackableCurrency" }, { Id: "Omen" }, { Id: "SoulCore" }],
    CurrencyItems: [0, 1, 2, 3, 4].map((BaseItemType) => ({
      BaseItemType,
      StackSize: 10,
      CurrencyUseType: 2,
      Action: BaseItemType === 0 ? "test_action" : null,
    })),
    AchievementOmenTypes: [{ BaseItemType: 3 }],
    Essences: [{ BaseItemType: 2, Tier: 1, Perfect: true }],
    TieredCurrency: [{ BaseItemType: 1, Tier: 2, MinimumModLevel: 35, LowerTierBaseItemType: 0 }],
    CurrencyExchange: [
      { Item: 0, Category: 0 },
      { Item: 4, Category: 0 },
    ],
    CurrencyExchangeCategories: [{ Id: "Currency" }],
  };
}

export async function write(rows: Rows): Promise<string> {
  const gdConfig = gameDataConfigSchema.parse({
    patchServer: { host: "patch.example", port: 1, handshake: [1], timeoutMs: 1000 },
    schemaUrl: "https://schema.example/schema.json",
    language: "English",
    toolTimeoutMs: 1000,
    tables: Object.entries(rows).map(([name, list]) => ({
      name,
      columns: Object.keys(list[0] ?? {}),
    })),
  });
  const tool: DatTool = {
    name: "fake-dat",
    version: "1.0.0",
    run: async (job) => {
      const dir = join(job.workDir, "tables", job.language);
      await mkdir(dir, { recursive: true });
      const list = (rows[job.table.name] ?? []).map((r, _index) => ({ _index, ...r }));
      await writeFile(join(dir, `${job.table.name}.json`), JSON.stringify(list));
    },
  };
  const dir = join(await mkdtemp(join(tmpdir(), "ef-cur-")), "game-data");
  await exportGameData({
    config: gdConfig,
    patch: { url: "https://cdn.example/9.9.9/", version: "9.9.9" },
    outDir: dir,
    tool,
    schema: { url: gdConfig.schemaUrl, sha256: "b".repeat(64) },
  });
  return dir;
}
