import type { DataRelease } from "@astrolabe/contracts/catalog";
import { z } from "zod";
import { readGameDataManifest, readGameDataTable } from "../gamedata/export.ts";
import type { Json } from "../json.ts";
import type { Finding, NormalizeConfig } from "./catalog.ts";

type ReleaseFacts = Pick<DataRelease, "maxCharacterLevel" | "passivePoints">;

const levelRow = z.object({ Level: z.int().positive() });
const questRow = z.object({
  /**
   * PoB (Build.lua) counts a reward of Type "Cruel" as an act of its own. Today's data has no
   * Type; if it appears, the counting rule would need to be mirrored, so it is an error here.
   */
  Type: z.never().optional(),
  Act: z.int().positive(),
  AreaLevel: z.int().positive(),
  questPoints: z.int().positive().optional(),
});

/** Highest level of the `ExperienceLevels` table of the game data. */
export async function readMaxCharacterLevel(gameDataDir: string, table: string): Promise<number> {
  const manifest = await readGameDataManifest(gameDataDir);
  const rows = await readGameDataTable(gameDataDir, manifest, table);
  const levels = rows.map((r, i) => {
    const parsed = levelRow.safeParse(r);
    if (!parsed.success)
      throw new Error(`game-data table ${table} row ${String(i)} has no valid Level`, {
        cause: parsed.error,
      });
    return parsed.data.Level;
  });
  if (levels.length === 0) throw new Error(`game-data table ${table} is empty`);
  return Math.max(...levels);
}

/**
 * Weapon set points per act from PoB's quest rewards, the way PoB itself
 * counts them (Build.lua): only rewards with `questPoints` count, and the
 * area level of an act is the highest one among those rewards.
 */
export function weaponSetPointsByAct(
  questRewards: Record<string, Json>,
): { act: number; areaLevel: number; points: number }[] {
  const acts = new Map<number, { areaLevel: number; points: number }>();
  for (const [id, raw] of Object.entries(questRewards).sort(([a], [b]) => a.localeCompare(b))) {
    const parsed = questRow.safeParse(raw);
    if (!parsed.success)
      throw new Error(`quest reward ${id} is malformed`, { cause: parsed.error });
    const q = parsed.data;
    if (q.questPoints === undefined) continue;
    const entry = acts.get(q.Act) ?? { areaLevel: 0, points: 0 };
    acts.set(q.Act, {
      areaLevel: Math.max(entry.areaLevel, q.AreaLevel),
      points: entry.points + q.questPoints,
    });
  }
  return [...acts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([act, v]) => ({ act, areaLevel: v.areaLevel, points: v.points }));
}

/**
 * The release-level facts for the server's S5. A fact that cannot be read is
 * left out and reported as a finding; it is never replaced by a default.
 */
export async function buildReleaseFacts(opts: {
  config: NormalizeConfig["releaseFacts"];
  questRewards: Record<string, Json>;
  gameDataDir?: string;
}): Promise<{ facts: ReleaseFacts; findings: Finding[] }> {
  const { config } = opts;
  const facts: ReleaseFacts = {};
  const findings: Finding[] = [];

  if (opts.gameDataDir === undefined) {
    findings.push({
      kind: "release",
      id: "maxCharacterLevel",
      message: "no game data given, maxCharacterLevel is left out",
    });
  } else {
    facts.maxCharacterLevel = {
      value: await readMaxCharacterLevel(opts.gameDataDir, config.maxLevelTable),
      origin: "game-data",
    };
  }

  const acts = weaponSetPointsByAct(opts.questRewards);
  if (acts.length === 0) {
    findings.push({
      kind: "release",
      id: "passivePoints",
      message: "PoB lists no quest reward with passive points, passivePoints is left out",
    });
  } else {
    facts.passivePoints = {
      mainTree: { ...config.mainTree, origin: "pob-code" },
      weaponSetByAct: { acts, origin: "pob-data" },
    };
  }
  return { facts, findings };
}
