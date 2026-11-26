import type { ProgressionStage } from "@astrolabe/contracts/build";

type Skill = ProgressionStage["state"]["skills"][number];

export interface GemChange {
  readonly kind: "new" | "removed" | "level" | "supports";
  readonly skillKey: string;
  /** Catalog gem ids involved: the skill gem first, then supports that were added or removed. */
  readonly gemId: string;
  readonly added: readonly string[];
  readonly dropped: readonly string[];
  readonly from?: number;
  readonly to?: number;
}

/** What changes in the skill setup from the previous stage to this one, by the skill's stable key. */
export function gemChanges(
  previous: ProgressionStage | undefined,
  stage: ProgressionStage,
): GemChange[] {
  if (previous === undefined) return [];
  const before = new Map<string, Skill>(previous.state.skills.map((s) => [s.key, s]));
  const now = new Map<string, Skill>(stage.state.skills.map((s) => [s.key, s]));
  const changes: GemChange[] = [];
  for (const skill of stage.state.skills) {
    const old = before.get(skill.key);
    if (old === undefined) {
      changes.push({
        kind: "new",
        skillKey: skill.key,
        gemId: skill.gem.gemId,
        added: skill.supports.map((s) => s.gemId),
        dropped: [],
      });
      continue;
    }
    const oldSupports = old.supports.map((s) => s.gemId);
    const supports = skill.supports.map((s) => s.gemId);
    const added = supports.filter((id) => !oldSupports.includes(id));
    const dropped = oldSupports.filter((id) => !supports.includes(id));
    if (old.gem.gemId !== skill.gem.gemId || added.length > 0 || dropped.length > 0) {
      changes.push({
        kind: "supports",
        skillKey: skill.key,
        gemId: skill.gem.gemId,
        added,
        dropped,
      });
    }
    if (old.gem.level !== skill.gem.level) {
      changes.push({
        kind: "level",
        skillKey: skill.key,
        gemId: skill.gem.gemId,
        added: [],
        dropped: [],
        from: old.gem.level,
        to: skill.gem.level,
      });
    }
  }
  for (const old of previous.state.skills) {
    if (!now.has(old.key)) {
      changes.push({
        kind: "removed",
        skillKey: old.key,
        gemId: old.gem.gemId,
        added: [],
        dropped: old.supports.map((s) => s.gemId),
      });
    }
  }
  return changes;
}
