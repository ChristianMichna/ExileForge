import type { EntityKind } from "@astrolabe/contracts";

/** One catalog reference found in a guide, with the JSON pointer of the place it stands at. */
export interface GuideRef {
  kind: EntityKind;
  id: string;
  location: string;
  /** `ProgressionStage.key` if the place is inside a stage. */
  stageKey?: string;
}

/**
 * Field names of the guide contracts that hold a catalog id, and what they point to.
 * An array of ids is found through the same name. Ids that are not catalog ids
 * (`StatId`, classification ids, calc ids) are not listed on purpose.
 */
const KIND_BY_FIELD: Readonly<Record<string, EntityKind>> = {
  classId: "characterClass",
  ascendancyId: "ascendancy",
  ascendancyCandidates: "ascendancy",
  mainSkillId: "gem",
  supportCandidates: "gem",
  gemId: "gem",
  modId: "mod",
  uniqueId: "uniqueItem",
  relevantUniques: "uniqueItem",
  baseItemId: "baseItem",
  currencyItemId: "baseItem",
  nodeId: "passiveNode",
  allocationOrder: "passiveNode",
  respecs: "passiveNode",
  relevantNodes: "passiveNode",
  ascendancy: "passiveNode",
  actionIds: "craftingAction",
};

const ENTITY_KINDS: ReadonlySet<string> = new Set<EntityKind>([
  "baseItem",
  "mod",
  "uniqueItem",
  "gem",
  "passiveNode",
  "passiveGroup",
  "characterClass",
  "ascendancy",
  "craftingAction",
  "statTranslation",
]);

const pointer = (parent: string, key: string | number): string =>
  `${parent}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** `{ kind, id }` objects as used by `EntityRef`, rich text entity segments and item specs. */
function asEntityRef(v: Record<string, unknown>): { kind: EntityKind; id: string } | undefined {
  const { kind, id } = v;
  if (typeof kind === "string" && ENTITY_KINDS.has(kind) && typeof id === "string" && id !== "")
    return { kind: kind as EntityKind, id };
  return undefined;
}

/**
 * Every catalog reference of a guide (any JSON that follows `GuideDocument`), in document
 * order. Pure and does not look at the catalog: an id that is wrong is a G1 matter, not
 * a patch matter.
 */
export function collectGuideRefs(guide: unknown): GuideRef[] {
  const found: GuideRef[] = [];
  const walk = (node: unknown, at: string, stageKey: string | undefined): void => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, pointer(at, i), stageKey));
      return;
    }
    if (!isRecord(node)) return;
    const stage = at.startsWith("/progression/stages/") && typeof node["key"] === "string";
    const here = stage && at.split("/").length === 4 ? (node["key"] as string) : stageKey;
    const ref = asEntityRef(node);
    if (ref) found.push({ ...ref, location: at, ...(here ? { stageKey: here } : {}) });
    for (const [field, value] of Object.entries(node)) {
      const kind = KIND_BY_FIELD[field];
      const where = pointer(at, field);
      if (kind !== undefined) {
        const ids = Array.isArray(value) ? value : [value];
        ids.forEach((id, i) => {
          if (typeof id === "string" && id !== "")
            found.push({
              kind,
              id,
              location: Array.isArray(value) ? pointer(where, i) : where,
              ...(here ? { stageKey: here } : {}),
            });
        });
        if (!Array.isArray(value) || value.every((x) => typeof x === "string")) continue;
      }
      walk(value, where, here);
    }
  };
  walk(guide, "", undefined);
  return found;
}
