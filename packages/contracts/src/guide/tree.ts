import { z } from "zod";
import { PassiveGroup, PassiveNode } from "../catalog/entities.js";
import { DataReleaseId } from "../common/version.js";

/**
 * The passive tree of the data release the server runs with (server: GET /api/tree): every
 * node and group with its geometry, so the window can draw a guide's allocation. An entry the
 * server cannot read as a node or group is not left out silently; it is listed in `skipped`.
 */
export const PassiveTreeData = z.object({
  dataReleaseId: DataReleaseId,
  passiveNodes: z.array(PassiveNode),
  passiveGroups: z.array(PassiveGroup),
  /** `<kind>:<id>` of catalog entries that did not match their schema and are not in the lists. */
  skipped: z.array(z.string().min(1)),
});
export type PassiveTreeData = z.infer<typeof PassiveTreeData>;
