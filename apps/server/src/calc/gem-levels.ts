import { Gem } from "@astrolabe/contracts/catalog";
import type { BuildState } from "@astrolabe/contracts/build";
import type { CatalogPort } from "../ports/catalog.js";

/**
 * The highest gem level whose level requirement the character meets, never above `cap` (the level
 * the build aims for). The requirement comes from the gem's catalog levels, not from a rule here.
 * A gem that cannot be used yet keeps its lowest level, so a gate can name it.
 */
function usableLevel(gem: Gem, characterLevel: number, cap: number): number {
  const usable = gem.levels
    .filter((l) => l.level <= cap && (l.requirements.level ?? 0) <= characterLevel)
    .map((l) => l.level);
  return usable.length > 0 ? Math.max(...usable) : Math.min(...gem.levels.map((l) => l.level));
}

/**
 * The state with every skill and support gem at the highest level its catalog requirement allows
 * at the given character level. Gems the catalog does not know are an error: nothing is guessed.
 */
export function scaleGemLevels(
  state: BuildState,
  characterLevel: number,
  catalog: CatalogPort,
): BuildState {
  const scale = <T extends { gemId: string; level: number }>(ref: T): T => {
    const entry = catalog.get({ kind: "gem", id: ref.gemId });
    if (entry === undefined) throw new Error(`Gem ${ref.gemId} is not in the catalog`);
    const gem = Gem.parse(entry.entity);
    return { ...ref, level: usableLevel(gem, characterLevel, ref.level) };
  };
  return {
    ...state,
    skills: state.skills.map((s) => ({
      ...s,
      gem: scale(s.gem),
      supports: s.supports.map(scale),
    })),
  };
}
