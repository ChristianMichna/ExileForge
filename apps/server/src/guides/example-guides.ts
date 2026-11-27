import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { GuideFile } from "@astrolabe/contracts/guide";
import type { Logger } from "../logger.js";
import type { RunStore } from "../store/run-store.js";

export interface ExampleGuidesOutcome {
  readonly imported: number;
  /** Guides that were already stored unchanged (an earlier start imported them). */
  readonly alreadyStored: number;
  /** Set when the folder itself could not be read; `failed` then lists no files. */
  readonly folderError?: string;
  /** Files that could not be imported; each one is also logged with its reason. */
  readonly failed: readonly string[];
}

/**
 * Imports the guide files of a folder (`*.json`, the `GuideFile` format) that the store does not
 * hold yet or holds in another version, so the app shows real guides on its first start. A file that cannot be read or is
 * refused is logged and listed in the outcome; it never stops the server and never passes as
 * imported. An unreadable folder is an error too, not "no examples".
 */
export async function importExampleGuides(
  dir: string,
  store: Pick<RunStore, "findGuide" | "importGuide">,
  logger: Logger,
  now: () => Date,
): Promise<ExampleGuidesOutcome> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    logger.error("the folder of example guides cannot be read", { dir, error });
    return {
      imported: 0,
      alreadyStored: 0,
      failed: [],
      folderError: error instanceof Error ? error.message : String(error),
    };
  }
  let imported = 0;
  let alreadyStored = 0;
  const failed: string[] = [];
  for (const name of names) {
    try {
      const raw: unknown = JSON.parse(await readFile(join(dir, name), "utf8"));
      const file = GuideFile.parse(raw);
      // A copy that differs (a revised example of a later app version) is replaced; the store
      // refuses to overwrite the guide of a run of this installation.
      if (isDeepStrictEqual(store.findGuide(file.guide.metadata.guideId), file.guide)) {
        alreadyStored += 1;
        continue;
      }
      store.importGuide(file, now().toISOString());
      imported += 1;
    } catch (error) {
      failed.push(name);
      logger.error("an example guide could not be imported", { file: name, error });
    }
  }
  logger.info("example guides", { dir, imported, alreadyStored, failed: failed.length });
  return { imported, alreadyStored, failed };
}
