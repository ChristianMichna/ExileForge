import { BuildState } from "@astrolabe/contracts/build";
import type { BuildFormat } from "@astrolabe/contracts/calc";
import type { CharacterClassId } from "@astrolabe/contracts/common";
import type { BaseBuild, BaseBuildProvider } from "./pob-calc.js";

/**
 * Where fresh class builds come from: PoB itself creates and exports them.
 * `CalcPool.baseBuild` (PoB thread, separate PR) is the intended implementation; open until it lands.
 */
export interface BaseBuildSource {
  baseBuild(classId: CharacterClassId): Promise<{ format: BuildFormat; payload: string }>;
}

/**
 * Starting build per class: level 1, empty tree, no skills, items or
 * ascendancy. The state is fixed by this contract, the payload comes from PoB,
 * so the repository holds no hand-written build files.
 */
export class ClassBaseBuilds implements BaseBuildProvider {
  private readonly cache = new Map<string, Promise<BaseBuild>>();

  constructor(private readonly source: BaseBuildSource) {}

  baseFor(state: BuildState): Promise<BaseBuild> {
    const classId = state.classId;
    let build = this.cache.get(classId);
    if (build === undefined) {
      build = this.source.baseBuild(classId).then((exported) => ({
        ...exported,
        state: BuildState.parse({
          classId,
          level: 1,
          tree: { allocated: [] },
          skills: [],
          items: [],
          config: {},
        }),
      }));
      this.cache.set(classId, build);
      // A failed export must not stay cached.
      build.catch(() => this.cache.delete(classId));
    }
    return build;
  }
}
