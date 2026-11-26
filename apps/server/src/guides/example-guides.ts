import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { GuideFile } from "@astrolabe/contracts/guide";
import type { Logger } from "../logger.js";
import type { RunStore } from "../store/run-store.js";

export interface ExampleGuidesOutcome {
  readonly imported: number;
  /** Guides that were already stored (an earlier start imported them). */
  readonly alreadyStored: number;
  /** Files that could not be imported; each one is also logged with its reason. */
  readonly failed: readonly string[];
}

/**
 * Imports the guide files of a folder (`*.json`, the `GuideFile` format) that the store does not
 * hold yet, so the app shows real guides on its first start. A file that cannot be read or is
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
    return { imported: 0, alreadyStored: 0, failed: [dir] };
  }
  let imported = 0;
  let alreadyStored = 0;
  const failed: string[] = [];
  for (const name of names) {
    try {
      const raw: unknown = JSON.parse(await readFile(join(dir, name), "utf8"));
      const file = GuideFile.parse(raw);
      if (store.findGuide(file.guide.metadata.guideId) !== undefined) {
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
  return { imported, alreadyStored, failed };
}
