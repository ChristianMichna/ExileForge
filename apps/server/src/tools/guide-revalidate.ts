import { existsSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
import {
  DataReleaseId,
  GuideDocument,
  type GuideTools,
  type PatchStatus,
} from "@astrolabe/contracts";
import { RevalidationError } from "@astrolabe/revalidate";
import { ForgeError } from "../engine/errors.js";
import type { Logger } from "../logger.js";
import { loadReleaseForRevalidation, revalidateStoredGuide } from "./revalidate.js";

/** Upper bound on chain length so an absurd `previousReleaseId` chain cannot loop for long. */
const MAX_CHAIN_LENGTH = 200;

export type GuideRevalidatePort = (
  input: z.infer<(typeof GuideTools)["guide.revalidate"]["input"]>,
) => Promise<PatchStatus>;

export interface GuideRevalidateDeps {
  /** Newest stored guide with this id (see `RunStore.findGuide`), unvalidated. */
  findGuide: (guideId: string) => unknown;
  /** Directory holding unpacked data releases, one folder per release id. */
  releasesDir: string;
  now: () => Date;
  logger?: Logger;
}

/** F-19 as an MCP tool: only ids come in; guide and releases are looked up in the server's own storage. */
export function createGuideRevalidate(deps: GuideRevalidateDeps): GuideRevalidatePort {
  const dirOf = (id: string): string => join(deps.releasesDir, DataReleaseId.parse(id));
  const installed = (id: string): boolean => existsSync(join(dirOf(id), "manifest.json"));
  return async ({ guideId, toReleaseId }) => {
    const stored = deps.findGuide(guideId);
    if (stored === undefined) {
      throw new ForgeError("guide_not_found", `No stored guide with id ${guideId}.`);
    }
    const parsed = GuideDocument.safeParse(stored);
    if (!parsed.success) {
      throw new ForgeError(
        "guide_invalid",
        `The stored guide ${guideId} does not match the contract.`,
        {
          cause: parsed.error,
        },
      );
    }
    const own: string = parsed.data.metadata.dataReleaseId;
    if (!installed(toReleaseId)) {
      throw new ForgeError("release_unknown", `Data release ${toReleaseId} is not installed.`);
    }
    if (own === toReleaseId) {
      throw new ForgeError("release_not_newer", "The guide was built with this release.");
    }
    const chain: string[] = [];
    const seen = new Set<string>();
    try {
      let current: string = toReleaseId;
      for (;;) {
        if (seen.has(current) || chain.length >= MAX_CHAIN_LENGTH) {
          throw new ForgeError("diff_missing", "The release chain is cyclic or too long.");
        }
        seen.add(current);
        chain.unshift(current);
        if (current === own) break;
        if (!installed(current)) {
          throw new ForgeError(
            "diff_missing",
            `Data release ${current} of the chain is not installed.`,
          );
        }
        const { release } = await loadReleaseForRevalidation(dirOf(current), { withDiff: false });
        if (release.id !== current) {
          throw new ForgeError("diff_missing", `The folder of ${current} holds another release.`);
        }
        if (release.previousReleaseId === undefined) {
          throw new ForgeError(
            "release_not_newer",
            `${toReleaseId} does not descend from the guide's release ${own}.`,
          );
        }
        current = release.previousReleaseId;
      }
      return await revalidateStoredGuide({
        guide: parsed.data,
        releaseDirs: chain.map(dirOf),
        now: deps.now,
      });
    } catch (error) {
      if (error instanceof ForgeError) throw error;
      if (error instanceof RevalidationError) {
        // The original message names local paths; it stays in the log, the client gets release ids only.
        deps.logger?.error("guide revalidation could not be made", { error, guideId });
        throw new ForgeError(
          "diff_missing",
          `The release chain ${own} to ${toReleaseId} is incomplete or damaged. The app log has details.`,
          { cause: error },
        );
      }
      throw error;
    }
  };
}
