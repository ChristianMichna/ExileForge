import type { DataRelease } from "@astrolabe/contracts/catalog";
import type { StageConfig } from "../config.js";

/** One row of the progression table: what S6 needs to know about a stage. */
export type S6Row = NonNullable<NonNullable<StageConfig["s6"]>["stages"]>[number];

/**
 * The progression stages from the release facts: one campaign stage per act
 * that grants weapon set points (level band ends at the act's area level,
 * points are the level points at that level plus the weapon set points of all
 * acts so far), then one endgame stage at the maximum level with every point.
 * Assumes that a character is about at the area level when it finishes the
 * act; that is a planning approximation the plan states, not a game rule.
 * Missing facts are an error message, never a default table.
 */
export function releaseStageTable(release: DataRelease | undefined): S6Row[] | string {
  const max = release?.maxCharacterLevel;
  const points = release?.passivePoints;
  if (release === undefined || max === undefined || points === undefined) {
    return `Data release ${release?.id ?? "(unknown)"} has no maximum character level or passive point rules; S6 cannot derive the stages. Rebuild the release with the data pipeline.`;
  }
  const levelPoints = (level: number): number =>
    Math.max(0, level - points.mainTree.fromLevel + 1) * points.mainTree.perLevel;
  const acts = [...points.weaponSetByAct.acts].sort((a, b) => a.act - b.act);
  const rows: S6Row[] = [];
  let weaponSet = 0;
  let previousEnd = 0;
  for (const act of acts) {
    const end = Math.min(act.areaLevel, max.value);
    weaponSet += act.points;
    if (end <= previousEnd) continue;
    rows.push({
      key: `act-${act.act}`,
      label: `Act ${act.act}`,
      kind: "campaign",
      act: act.act,
      levelRange: [previousEnd + 1, end],
      passivePoints: levelPoints(end) + weaponSet,
    });
    previousEnd = end;
  }
  const total = levelPoints(max.value) + weaponSet;
  const last = rows.at(-1);
  if (last !== undefined && previousEnd >= max.value && last.passivePoints !== total) {
    // Acts past the maximum level add their points to the last stage, so it matches S5.
    rows[rows.length - 1] = { ...last, passivePoints: total };
  }
  if (previousEnd < max.value) {
    rows.push({
      key: "endgame",
      label: "Endgame",
      kind: "endgame",
      levelRange: [previousEnd + 1, max.value],
      passivePoints: total,
    });
  }
  return rows;
}
