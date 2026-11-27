import type { Gem } from "@astrolabe/contracts/catalog";
import type { CatalogPort } from "./ports.js";
import type { StageConfig } from "./config.js";

/** `minion` block of config/agents/stages.json. */
export type MinionStatsConfig = NonNullable<StageConfig["minion"]>;

/**
 * Whether the main skill is a minion skill: its catalog gem is of the configured kind. A skill
 * that is not in the catalog is not judged here (G1 reports it).
 */
export function isMinionSkill(
  catalog: Pick<CatalogPort, "get">,
  mainSkillId: string,
  minion: MinionStatsConfig | undefined,
): boolean {
  if (minion === undefined) return false;
  const entry = catalog.get({ kind: "gem", id: mainSkillId });
  const kind = (entry?.entity as Pick<Gem, "kind"> | undefined)?.kind;
  return kind !== undefined && minion.skillKinds.includes(kind);
}

/**
 * The PoB stat that measures the same thing for a minion build: a minion skill's damage is in
 * PoB's `Minion…` outputs, the player's own DPS stays 0. Names without an entry stay as they are.
 */
export function minionStatName(minion: MinionStatsConfig, name: string): string {
  return minion.statMap[name] ?? name;
}

/** Objective weights with the minion stat names; two weights landing on one stat are an error. */
export function minionWeights(
  minion: MinionStatsConfig,
  weights: Readonly<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, weight] of Object.entries(weights)) {
    const target = minionStatName(minion, name);
    if (target in out) {
      throw new Error(
        `The minion stat map sends two objective weights to ${target}; remove one of them in config/agents/stages.json`,
      );
    }
    out[target] = weight;
  }
  return out;
}

/** Metric floors (stat held to another measured stat) with the minion stat names on both sides; a clash is an error. */
export function minionMetricFloors(
  minion: MinionStatsConfig,
  floors: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [stat, other] of Object.entries(floors)) {
    const target = minionStatName(minion, stat);
    if (target in out) {
      throw new Error(
        `The minion stat map sends two metric floors to ${target}; remove one of them in config/agents/stages.json`,
      );
    }
    out[target] = minionStatName(minion, other);
  }
  return out;
}

/** The stage settings of a minion build: gear objective and damage gate read the minion stats. */
export function withMinionStats(config: StageConfig, minion: MinionStatsConfig): StageConfig {
  return {
    ...config,
    ...(config.s7 === undefined
      ? {}
      : {
          s7: {
            ...config.s7,
            objective: {
              ...config.s7.objective,
              weights: minionWeights(minion, config.s7.objective.weights),
            },
          },
        }),
    ...(config.s10 === undefined
      ? {}
      : {
          s10: {
            ...config.s10,
            stats: { ...config.s10.stats, dps: minionStatName(minion, config.s10.stats.dps) },
          },
        }),
  };
}
