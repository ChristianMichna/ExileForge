import { PassiveGroup, PassiveNode } from "@astrolabe/contracts/catalog";
import type { PassiveTreeData } from "@astrolabe/contracts/guide";
import type { CatalogPort } from "../ports/catalog.js";

/** The passive nodes and groups of the loaded release; entries that break their schema are listed in `skipped`. */
export function buildPassiveTreeData(catalog: CatalogPort): PassiveTreeData {
  const skipped: string[] = [];
  const passiveNodes: PassiveNode[] = [];
  for (const entry of catalog.list("passiveNode")) {
    const node = PassiveNode.safeParse(entry.entity);
    if (node.success) passiveNodes.push(node.data);
    else skipped.push(`passiveNode:${entry.id}`);
  }
  const passiveGroups: PassiveGroup[] = [];
  for (const entry of catalog.list("passiveGroup")) {
    const group = PassiveGroup.safeParse(entry.entity);
    if (group.success) passiveGroups.push(group.data);
    else skipped.push(`passiveGroup:${entry.id}`);
  }
  return { dataReleaseId: catalog.dataReleaseId, passiveNodes, passiveGroups, skipped };
}
