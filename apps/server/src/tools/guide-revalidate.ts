import { existsSync } from "node:fs";
import { join } from "node:path";
import { DataReleaseId, type GuideTools, type PatchStatus } from "@astrolabe/contracts";
import { RevalidationError } from "@astrolabe/revalidate";
import { ForgeError } from "../engine/errors.js";
import { loadReleaseForRevalidation, revalidateStoredGuide } from "./revalidate.js";

/** Upper bound on chain length so a cyclic or absurd `previousReleaseId` chain cannot loop. */
const MAX_CHAIN_LENGTH = 200;

export type GuideRevalidatePort = (
  input: ReturnType<(typeof GuideTools)["guide.revalidate"]["input"]["parse"]>,
) => Promise<PatchStatus>;

export interface GuideRevalidateDeps {
  /** Newest stored guide with this id (see `RunStore.findGuide`), unvalidated. */
  findGuide: (guideId: string) => unknown;
  /** Directory holding unpacked data releases, one folder per release id. */
  releasesDir: string;
  now: () => Date;
}

/** F-19 as an MCP tool: only ids come in; guide and releases are looked up in the server's own storage. */
export function createGuideRevalidate(deps: GuideRevalidateDeps): GuideRevalidatePort {
  const dirOf = (id: string): string => {
    // the id pattern allows no path separators; parse again so a path can never get here
    const valid = DataReleaseId.parse(id);
    return join(deps.releasesDir, valid);
  };
  return async ({ guideId, toReleaseId }) => {
    const guide = deps.findGuide(guideId);
    if (guide === undefined) {
      throw new ForgeError("guide_not_found", `No stored guide with id ${guideId}.`);
    }
    const ownId = (guide as { metadata?: { dataReleaseId?: unknown } } | null)?.metadata
      ?.dataReleaseId;
    const parsedOwn = DataReleaseId.safeParse(ownId);
    if (!parsedOwn.success) {
      throw new ForgeError("guide_invalid", "The stored guide names no valid data release.");
    }
    const own: string = parsedOwn.data;
    if (own === toReleaseId) {
      throw new ForgeError("release_not_newer", "The guide was built with this release.");
    }
    if (!existsSync(dirOf(toReleaseId))) {
      throw new ForgeError("release_unknown", `Data release ${toReleaseId} is not installed.`);
    }
    const chain: string[] = [];
    try {
      let current: string = toReleaseId;
      for (let i = 0; i < MAX_CHAIN_LENGTH; i += 1) {
        chain.unshift(current);
        if (current === own) break;
        const { release } = await loadReleaseForRevalidation(dirOf(current), { withDiff: false });
        if (release.previousReleaseId === undefined) {
          throw new ForgeError(
            "release_not_newer",
            `${toReleaseId} does not descend from the guide's release ${own}.`,
          );
        }
        current = release.previousReleaseId;
      }
      if (chain[0] !== own) {
        throw new ForgeError("diff_missing", "The release chain is too long or cyclic.");
      }
      return await revalidateStoredGuide({
        guide,
        releaseDirs: chain.map(dirOf),
        now: deps.now,
      });
    } catch (error) {
      if (error instanceof ForgeError) throw error;
      if (error instanceof RevalidationError) {
        throw new ForgeError("diff_missing", error.message, { cause: error });
      }
      throw error;
    }
  };
}
