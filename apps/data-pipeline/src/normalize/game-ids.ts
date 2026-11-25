import type { DataRelease, PassiveNode } from "@astrolabe/contracts/catalog";
import { z } from "zod";
import { readGameDataManifest, readGameDataTable } from "../gamedata/export.ts";
import type { Finding, NormalizeConfig } from "./catalog.ts";

type GameIdsConfig = NormalizeConfig["gameIds"];
type Slots = NonNullable<DataRelease["itemSlots"]>["slots"];

export interface GameIdsSummary {
  passivesWithGameId: number;
  passivesWithoutGameId: number;
  slotsWithGameId: number;
  slotsWithoutGameId: number;
}

/**
 * The game's markup in names, e.g. "[Spirit|Spirit]" or "[Mana]": the displayed
 * part is what the player sees and what PoB writes. Lower-cased and
 * whitespace-collapsed so both sides compare equal.
 */
export function normalizeName(name: string): string {
  return name
    .replace(/\[([^\]|]*)\|([^\]]*)\]/g, "$2")
    .replace(/\[([^\]]*)\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseRows(table: string, rows: readonly unknown[], schema: z.ZodType) {
  return rows.map((row, i) => {
    const parsed = schema.safeParse(row);
    if (!parsed.success)
      throw new Error(`game-data ${table} row ${String(i)}: ${z.prettifyError(parsed.error)}`, {
        cause: parsed.error,
      });
    return parsed.data as Record<string, unknown>;
  });
}

/**
 * Adds the game's string ids to the passive nodes (table row with the same
 * node id and the same name) and to the slots (explicit config mapping from the
 * PoB slot name to an `Inventories.Id` that must exist). A node without exactly
 * one matching row, or with a different name, gets no id and is counted; a
 * mapping to an unknown inventory id is an error. Nothing is guessed. Table
 * rows without a PoB node (empty names, unused rows) are not a problem.
 */
export async function applyGameIds(opts: {
  gameDataDir: string;
  config: GameIdsConfig;
  passiveNodes: readonly (Pick<PassiveNode, "name"> & { pobNodeId?: number | undefined })[];
  slots: Slots;
}): Promise<{
  passiveGameIds: (string | undefined)[];
  slots: Slots;
  summary: GameIdsSummary;
  findings: Finding[];
  errors: Finding[];
}> {
  const { config } = opts;
  const findings: Finding[] = [];
  const errors: Finding[] = [];
  const manifest = await readGameDataManifest(opts.gameDataDir);

  const rowSchema = z.object({
    [config.passives.nodeIdColumn]: z.number().int().nonnegative().nullish(),
    [config.passives.idColumn]: z.string(),
    [config.passives.nameColumn]: z.string(),
  });
  const rows = parseRows(
    config.passives.table,
    await readGameDataTable(opts.gameDataDir, manifest, config.passives.table),
    rowSchema,
  );
  const byNodeId = new Map<number, Record<string, unknown>[]>();
  for (const r of rows) {
    const nodeId = r[config.passives.nodeIdColumn];
    if (typeof nodeId !== "number") continue;
    const list = byNodeId.get(nodeId) ?? [];
    list.push(r);
    byNodeId.set(nodeId, list);
  }

  const summary: GameIdsSummary = {
    passivesWithGameId: 0,
    passivesWithoutGameId: 0,
    slotsWithGameId: 0,
    slotsWithoutGameId: 0,
  };
  const reasons = { none: 0, duplicate: 0, name: 0, emptyId: 0 };
  const examples: string[] = [];
  const passiveGameIds = opts.passiveNodes.map((node) => {
    const candidates = node.pobNodeId === undefined ? [] : (byNodeId.get(node.pobNodeId) ?? []);
    let why: keyof typeof reasons | undefined;
    let id: string | undefined;
    if (candidates.length === 0) why = "none";
    else if (candidates.length > 1) why = "duplicate";
    else {
      const row = candidates[0] as Record<string, unknown>;
      const rowName = String(row[config.passives.nameColumn]);
      const rowId = String(row[config.passives.idColumn]);
      if (normalizeName(rowName) !== normalizeName(node.name)) why = "name";
      else if (rowId === "") why = "emptyId";
      else id = rowId;
    }
    if (id === undefined) {
      summary.passivesWithoutGameId++;
      if (why) reasons[why]++;
      if (examples.length < 5)
        examples.push(`${String(node.pobNodeId)} "${node.name}" (${why ?? "?"})`);
    } else summary.passivesWithGameId++;
    return id;
  });
  if (summary.passivesWithoutGameId > 0)
    findings.push({
      kind: "gameId",
      id: "passives",
      message: `${String(summary.passivesWithoutGameId)} passive nodes have no game id (no row ${String(reasons.none)}, several rows ${String(reasons.duplicate)}, other name ${String(reasons.name)}, empty id ${String(reasons.emptyId)}); e.g. ${examples.join("; ")}`,
    });
  const taken = new Map<string, number>();
  passiveGameIds.forEach((g, i) => {
    if (g === undefined) return;
    const first = taken.get(g);
    if (first !== undefined)
      errors.push({
        kind: "gameId",
        id: g,
        message: `game id is used by passive nodes ${String(opts.passiveNodes[first]?.pobNodeId)} and ${String(opts.passiveNodes[i]?.pobNodeId)}`,
      });
    else taken.set(g, i);
  });

  const invRows = parseRows(
    config.slots.table,
    await readGameDataTable(opts.gameDataDir, manifest, config.slots.table),
    z.object({ [config.slots.idColumn]: z.string() }),
  );
  const inventoryIds = new Set(invRows.map((r) => String(r[config.slots.idColumn])));
  const slotIds = new Set(opts.slots.map((s) => s.id));
  for (const [pobSlot, invId] of Object.entries(config.slots.map)) {
    if (!slotIds.has(pobSlot))
      findings.push({
        kind: "gameId",
        id: pobSlot,
        message: "mapped slot is not a slot of the release",
      });
    if (!inventoryIds.has(invId))
      errors.push({
        kind: "gameId",
        id: pobSlot,
        message: `${config.slots.table} has no row ${invId}`,
      });
  }
  const slots = opts.slots.map((slot) => {
    const gameId = config.slots.map[slot.id];
    if (gameId === undefined || !inventoryIds.has(gameId)) {
      summary.slotsWithoutGameId++;
      return slot;
    }
    summary.slotsWithGameId++;
    return { ...slot, gameId };
  });
  const unmapped = slots.filter((s) => s.gameId === undefined).map((s) => s.id);
  if (unmapped.length > 0)
    findings.push({
      kind: "gameId",
      id: "slots",
      message: `${String(unmapped.length)} slots have no game id: ${unmapped.join(", ")}`,
    });
  return { passiveGameIds, slots, summary, findings, errors };
}
