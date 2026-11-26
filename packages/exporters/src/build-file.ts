import { z } from "zod";
import type { PublishedGuide } from "@astrolabe/contracts/guide";

/*
 * The `.build` file of the game's Build Planner (format "Version 1 (Experimental)"): JSON with
 * passives, skills (with supports) and inventory hints, each with a level interval. Item values
 * and meta gems are not part of the format.
 */

const LevelInterval = z.tuple([z.int().nonnegative(), z.int().nonnegative()]);

export const BuildFile = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  ascendancy: z.string().min(1).optional(),
  passives: z.array(
    z.object({
      id: z.string().min(1),
      level_interval: LevelInterval,
      weapon_set: z.int().min(1).max(2).optional(),
    }),
  ),
  skills: z.array(
    z.object({
      id: z.string().min(1),
      level_interval: LevelInterval,
      support_skills: z.array(z.object({ id: z.string().min(1), level_interval: LevelInterval })),
    }),
  ),
  inventory_slots: z.array(
    z.object({
      inventory_id: z.string().min(1),
      level_interval: LevelInterval,
      unique_name: z.string().min(1).optional(),
      additional_text: z.string().optional(),
    }),
  ),
});
export type BuildFile = z.infer<typeof BuildFile>;

/** What the exporter cannot know itself: the game's own ids and names for catalog entities. */
export interface BuildFileResolvers {
  /** The game's string id of a passive node (`PassiveSkills.Id`); undefined if the release has none. */
  passiveGameId(nodeId: string): string | undefined;
  /** The game's inventory id of a slot (`Inventories.Id`); undefined for slots without one. */
  slotGameId(slotId: string): string | undefined;
  /** The unique's name as the game lists it; undefined if the catalog does not know it. */
  uniqueName(uniqueId: string): string | undefined;
  /** Display name of a catalog entity (base item, mod, gem, class). */
  entityName(ref: { kind: "baseItem" | "mod" | "gem"; id: string }): string | undefined;
}

export interface BuildFileResult {
  file: BuildFile;
  /** Everything left out because the game id or name is missing; never filled with a guess. */
  omitted: string[];
}

type Stage = PublishedGuide["progression"]["stages"][number];
type Interval = [number, number];

/**
 * Runs of consecutive stages in which `keyOf` returns the same value for a subject: one run is
 * one entry of the file, spanning from the first level of its first stage to the last level of its
 * last stage.
 */
function runs(
  stages: readonly Stage[],
  subjects: (stage: Stage) => ReadonlyMap<string, string>,
): { subject: string; value: string; interval: Interval; firstStage: number }[] {
  const out: { subject: string; value: string; interval: Interval; firstStage: number }[] = [];
  const open = new Map<string, (typeof out)[number]>();
  stages.forEach((stage, index) => {
    const now = subjects(stage);
    for (const [subject, run] of [...open]) {
      if (now.get(subject) !== run.value) open.delete(subject);
    }
    for (const [subject, value] of now) {
      const run = open.get(subject);
      if (run === undefined) {
        const fresh = {
          subject,
          value,
          interval: [stage.levelRange[0], stage.levelRange[1]] as Interval,
          firstStage: index,
        };
        out.push(fresh);
        open.set(subject, fresh);
      } else {
        run.interval = [run.interval[0], stage.levelRange[1]];
      }
    }
  });
  return out;
}

/** The guide as `.build` content. Missing game ids are listed in `omitted`, never invented. */
export function guideToBuildFile(
  guide: PublishedGuide,
  resolve: BuildFileResolvers,
  name: string,
): BuildFileResult {
  const omitted: string[] = [];
  const stages = [...guide.progression.stages].sort((a, b) => a.order - b.order);

  const passiveRuns = runs(stages, (s) => {
    const nodes = new Map<string, string>();
    for (const n of s.state.tree.allocated) nodes.set(n.nodeId, String(n.weaponSet));
    for (const n of s.state.tree.ascendancy) nodes.set(n, "0");
    return nodes;
  });
  const orderOf = new Map<string, number>();
  stages.forEach((s) => s.allocationOrder.forEach((n, i) => orderOf.set(`${s.key}/${n}`, i)));
  const passives = passiveRuns
    .sort(
      (a, b) =>
        a.firstStage - b.firstStage ||
        (orderOf.get(`${stages[a.firstStage]?.key ?? ""}/${a.subject}`) ?? Infinity) -
          (orderOf.get(`${stages[b.firstStage]?.key ?? ""}/${b.subject}`) ?? Infinity),
    )
    .flatMap((r) => {
      const id = resolve.passiveGameId(r.subject);
      if (id === undefined) {
        omitted.push(`passive ${r.subject}: the release has no game id`);
        return [];
      }
      const set = Number(r.value);
      return [
        { id, level_interval: r.interval, ...(set >= 1 && set <= 2 ? { weapon_set: set } : {}) },
      ];
    });

  // A skill entry spans the stages in which the active gem stays the same; supports likewise.
  const skillRuns = runs(stages, (s) => new Map(s.state.skills.map((k) => [k.key, k.gem.gemId])));
  const skills = skillRuns.map((r) => {
    const supportRuns = runs(
      stages.filter((s) => s.levelRange[1] >= r.interval[0] && s.levelRange[0] <= r.interval[1]),
      (s) => {
        const skill = s.state.skills.find((k) => k.key === r.subject);
        return new Map((skill?.supports ?? []).map((g) => [g.gemId, g.gemId]));
      },
    );
    return {
      id: r.value,
      level_interval: r.interval,
      support_skills: supportRuns.map((sr) => ({ id: sr.value, level_interval: sr.interval })),
    };
  });

  const itemText = (item: Stage["state"]["items"][number]["item"]): string | undefined => {
    if (item.kind === "unique") return undefined;
    const base = resolve.entityName({ kind: "baseItem", id: item.baseItemId });
    if (base === undefined) {
      omitted.push(`base item ${item.baseItemId}: no name`);
      return undefined;
    }
    const mods = item.mods
      .filter((m) => m.required)
      .map((m) => resolve.entityName({ kind: "mod", id: m.modId }))
      .filter((n): n is string => n !== undefined);
    return `${item.rarity} ${base}${mods.length > 0 ? `: ${mods.join(", ")}` : ""}`;
  };
  const itemKey = (item: Stage["state"]["items"][number]["item"]): string =>
    item.kind === "unique"
      ? `unique:${item.uniqueId}`
      : `crafted:${item.baseItemId}:${item.mods.map((m) => m.modId).join(",")}`;
  const itemOf = new Map<string, Stage["state"]["items"][number]["item"]>();
  const itemRuns = runs(stages, (s) => {
    const slots = new Map<string, string>();
    for (const e of s.state.items) {
      const key = itemKey(e.item);
      slots.set(e.slot, key);
      itemOf.set(key, e.item);
    }
    return slots;
  });
  const inventory_slots = itemRuns.flatMap((r): BuildFile["inventory_slots"] => {
    const inventoryId = resolve.slotGameId(r.subject);
    if (inventoryId === undefined) {
      omitted.push(`slot ${r.subject}: the release has no inventory id`);
      return [];
    }
    const item = itemOf.get(r.value);
    if (item === undefined) return [];
    if (item.kind === "unique") {
      const unique = resolve.uniqueName(item.uniqueId);
      if (unique === undefined) {
        omitted.push(`unique ${item.uniqueId}: the catalog has no name`);
        return [];
      }
      return [{ inventory_id: inventoryId, level_interval: r.interval, unique_name: unique }];
    }
    const text = itemText(item);
    return text === undefined
      ? []
      : [{ inventory_id: inventoryId, level_interval: r.interval, additional_text: text }];
  });

  const file = BuildFile.parse({
    name,
    ascendancy: guide.summary.ascendancyId,
    passives,
    skills,
    inventory_slots,
  });
  return { file, omitted };
}
