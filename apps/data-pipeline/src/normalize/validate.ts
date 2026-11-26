import {
  Ascendancy,
  BaseItem,
  CraftingAction,
  CharacterClass,
  Gem,
  Mod,
  PassiveGroup,
  PassiveNode,
  StatTranslation,
  UniqueItem,
} from "@astrolabe/contracts/catalog";
import type { z } from "zod";
import type { CatalogEntities, Finding } from "./catalog.ts";

const SCHEMAS: Record<keyof CatalogEntities, z.ZodType> = {
  baseItem: BaseItem,
  craftingAction: CraftingAction,
  mod: Mod,
  uniqueItem: UniqueItem,
  gem: Gem,
  passiveNode: PassiveNode,
  passiveGroup: PassiveGroup,
  characterClass: CharacterClass,
  ascendancy: Ascendancy,
  statTranslation: StatTranslation,
};

export interface ValidationResult {
  /** entities as parsed by the contract (unknown fields stripped) */
  entities: Record<keyof CatalogEntities, unknown[]>;
  /** block the release: contract violations, duplicate ids, broken references */
  errors: Finding[];
}

function idOf(e: unknown): string {
  return typeof e === "object" && e !== null && "id" in e && typeof e.id === "string"
    ? e.id
    : "<no id>";
}

/**
 * Gate before a release: every entity must satisfy its contract schema, ids
 * are unique per kind, and every reference resolves inside the release
 * (Leitprinzip "Keine Entität ohne Katalog-ID", gate G1 for the catalog itself).
 */
export function validateCatalog(input: CatalogEntities): ValidationResult {
  const errors: Finding[] = [];
  const entities = {} as Record<keyof CatalogEntities, unknown[]>;
  const ids = {} as Record<keyof CatalogEntities, Set<string>>;

  for (const kind of Object.keys(SCHEMAS) as (keyof CatalogEntities)[]) {
    const schema = SCHEMAS[kind];
    const parsed: unknown[] = [];
    const seen = new Set<string>();
    // references resolve only to entities that passed their contract
    const valid = new Set<string>();
    for (const e of input[kind]) {
      const id = idOf(e);
      if (seen.has(id)) errors.push({ kind, id, message: "duplicate id" });
      seen.add(id);
      const res = schema.safeParse(e);
      if (!res.success) {
        const issues = res.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ");
        errors.push({ kind, id, message: `contract: ${issues}` });
        continue;
      }
      parsed.push(res.data);
      valid.add(id);
    }
    entities[kind] = parsed;
    ids[kind] = valid;
  }

  const ref = (
    kind: keyof CatalogEntities,
    id: string,
    field: string,
    target: keyof CatalogEntities,
    value: string,
  ) => {
    if (!ids[target].has(value))
      errors.push({ kind, id, message: `${field} → unknown ${target} "${value}"` });
  };

  for (const b of input.baseItem as { id: string; implicitModIds?: string[] }[]) {
    for (const m of b.implicitModIds ?? []) ref("baseItem", b.id, "implicitModIds", "mod", m);
  }
  const itemClasses = new Set(input.baseItem.map((b) => String(b.itemClass)));
  for (const a of input.craftingAction as {
    id: string;
    itemId?: string;
    effects?: { params?: { modByItemClass?: unknown } }[];
  }[]) {
    if (a.itemId !== undefined) ref("craftingAction", a.id, "itemId", "baseItem", a.itemId);
    for (const effect of a.effects ?? []) {
      const byClass = effect.params?.modByItemClass;
      if (typeof byClass !== "object" || byClass === null) continue;
      for (const [cls, mod] of Object.entries(byClass)) {
        if (!itemClasses.has(cls))
          errors.push({
            kind: "craftingAction",
            id: a.id,
            message: `modByItemClass → unknown item class "${cls}"`,
          });
        if (typeof mod !== "string") {
          errors.push({
            kind: "craftingAction",
            id: a.id,
            message: `modByItemClass → mod for "${cls}" is not an id`,
          });
          continue;
        }
        ref("craftingAction", a.id, "modByItemClass", "mod", mod);
      }
    }
  }
  for (const u of input.uniqueItem as {
    id: string;
    baseItemId?: string;
    variants?: { id?: string }[];
    mods?: { variantIds?: string[]; allocatesNodeId?: string; grantsGemId?: string }[];
  }[]) {
    ref("uniqueItem", u.id, "baseItemId", "baseItem", u.baseItemId ?? "");
    const variants = new Set((u.variants ?? []).map((v) => v.id));
    for (const m of u.mods ?? []) {
      if (m.allocatesNodeId !== undefined)
        ref("uniqueItem", u.id, "mods.allocatesNodeId", "passiveNode", m.allocatesNodeId);
      if (m.grantsGemId !== undefined)
        ref("uniqueItem", u.id, "mods.grantsGemId", "gem", m.grantsGemId);
      for (const v of m.variantIds ?? []) {
        if (!variants.has(v))
          errors.push({
            kind: "uniqueItem",
            id: u.id,
            message: `variantIds → unknown variant "${v}"`,
          });
      }
    }
  }
  for (const n of input.passiveNode as {
    id: string;
    connections?: string[];
    ascendancyId?: string;
    classStartFor?: string[];
    unlockedBy?: { ascendancyId?: string; nodeIds: string[] };
    position?: { groupId?: string };
    arcs?: { to: string }[];
  }[]) {
    for (const c of n.connections ?? []) ref("passiveNode", n.id, "connections", "passiveNode", c);
    if (n.position?.groupId !== undefined)
      ref("passiveNode", n.id, "position.groupId", "passiveGroup", n.position.groupId);
    for (const a of n.arcs ?? []) {
      ref("passiveNode", n.id, "arcs", "passiveNode", a.to);
      if (!(n.connections ?? []).includes(a.to))
        errors.push({
          kind: "passiveNode",
          id: n.id,
          message: `arcs → ${a.to} is not a connection`,
        });
    }
    if (n.ascendancyId !== undefined)
      ref("passiveNode", n.id, "ascendancyId", "ascendancy", n.ascendancyId);
    for (const c of n.classStartFor ?? [])
      ref("passiveNode", n.id, "classStartFor", "characterClass", c);
    if (n.unlockedBy?.ascendancyId !== undefined)
      ref("passiveNode", n.id, "unlockedBy.ascendancyId", "ascendancy", n.unlockedBy.ascendancyId);
    for (const u of n.unlockedBy?.nodeIds ?? []) {
      ref("passiveNode", n.id, "unlockedBy.nodeIds", "passiveNode", u);
      if (u === n.id)
        errors.push({ kind: "passiveNode", id: n.id, message: "unlockedBy names the node itself" });
    }
  }
  for (const c of input.characterClass as {
    id: string;
    startNodeId?: string;
    ascendancyIds?: string[];
  }[]) {
    ref("characterClass", c.id, "startNodeId", "passiveNode", c.startNodeId ?? "");
    for (const a of c.ascendancyIds ?? [])
      ref("characterClass", c.id, "ascendancyIds", "ascendancy", a);
  }
  for (const a of input.ascendancy as {
    id: string;
    classId?: string;
    startNodeId?: string;
    nodeIds?: string[];
  }[]) {
    ref("ascendancy", a.id, "classId", "characterClass", a.classId ?? "");
    if (a.startNodeId !== undefined)
      ref("ascendancy", a.id, "startNodeId", "passiveNode", a.startNodeId);
    for (const n of a.nodeIds ?? []) ref("ascendancy", a.id, "nodeIds", "passiveNode", n);
  }
  return { entities, errors };
}
