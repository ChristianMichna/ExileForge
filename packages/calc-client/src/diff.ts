import type {
  BuildState,
  EquippedItem,
  ItemSpec,
  PassiveNodeId,
  PatchOp,
  SkillSetup,
} from "@exileforge/contracts";
import { PatchPlanError } from "./errors.ts";

/**
 * Renders an item as PoB item text. Needs catalog data (names, mod lines), so
 * the caller supplies it; calc-client has no catalog of its own.
 */
export type ItemTextRenderer = (item: ItemSpec, slot: string) => string;

export interface DiffOptions {
  /** Required as soon as an item differs between the two states. */
  renderItem?: ItemTextRenderer;
}

/** Key order independent JSON, to compare plain data structurally. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
      );
    }
    return v;
  });
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of values) (seen.has(v) ? dup : seen).add(v);
  return [...dup];
}

/** All allocated nodes of a state by id; ascendancy nodes belong to the shared tree (set 0). */
function allocatedNodes(state: BuildState): Map<PassiveNodeId, number> {
  const nodes = new Map<PassiveNodeId, number>();
  for (const n of state.tree.allocated) {
    if (nodes.has(n.nodeId)) {
      throw new PatchPlanError("Passive node allocated twice in one state", n.nodeId);
    }
    nodes.set(n.nodeId, n.weaponSet);
  }
  for (const id of state.tree.ascendancy) {
    if (nodes.has(id)) {
      throw new PatchPlanError("Passive node allocated twice in one state", id);
    }
    nodes.set(id, 0);
  }
  return nodes;
}

function treeOps(from: BuildState, to: BuildState): PatchOp[] {
  const before = allocatedNodes(from);
  const after = allocatedNodes(to);
  const remove: PassiveNodeId[] = [];
  const add = new Map<number, PassiveNodeId[]>();
  for (const [id, set] of before) {
    // a node that moves to another weapon set is removed and allocated again
    if (!after.has(id) || after.get(id) !== set) remove.push(id);
  }
  for (const [id, set] of after) {
    if (before.get(id) === set) continue;
    add.set(set, [...(add.get(set) ?? []), id]);
  }
  const ops: PatchOp[] = [];
  if (remove.length > 0) ops.push({ op: "deallocateNodes", nodeIds: remove });
  // shared nodes first: weapon set paths may run through them
  for (const set of [...add.keys()].sort((a, b) => a - b)) {
    const nodeIds = add.get(set) ?? [];
    ops.push(
      set === 0
        ? { op: "allocateNodes", nodeIds }
        : { op: "allocateNodes", nodeIds, weaponSet: set },
    );
  }
  return ops;
}

function skillOps(from: BuildState, to: BuildState): PatchOp[] {
  for (const state of [from, to]) {
    const dup = duplicates(state.skills.map((s) => s.key));
    if (dup.length > 0)
      throw new PatchPlanError("Skill key used twice in one state", dup.join(", "));
  }
  const before = new Map(from.skills.map((s) => [s.key, s]));
  const after = new Map(to.skills.map((s) => [s.key, s]));
  const ops: PatchOp[] = [];
  for (const key of before.keys()) {
    if (!after.has(key)) ops.push({ op: "removeSkill", groupKey: key });
  }
  for (const [key, skill] of after) {
    const old = before.get(key);
    if (old && canonical(old) === canonical(skill)) continue;
    ops.push(setSkillOp(skill));
  }
  return ops;
}

function setSkillOp(skill: SkillSetup): PatchOp {
  return {
    op: "setSkill",
    groupKey: skill.key,
    gemId: skill.gem.gemId,
    level: skill.gem.level,
    quality: skill.gem.quality,
    supports: skill.supports.map((s) => ({ gemId: s.gemId, level: s.level, quality: s.quality })),
    ...(skill.weaponSet === undefined ? {} : { weaponSet: skill.weaponSet }),
  };
}

function itemOps(from: BuildState, to: BuildState, options: DiffOptions): PatchOp[] {
  for (const state of [from, to]) {
    const dup = duplicates(state.items.map((i) => i.slot));
    if (dup.length > 0) throw new PatchPlanError("Slot used twice in one state", dup.join(", "));
  }
  const before = new Map<string, EquippedItem>(from.items.map((i) => [i.slot, i]));
  const after = new Map<string, EquippedItem>(to.items.map((i) => [i.slot, i]));
  const ops: PatchOp[] = [];
  for (const slot of before.keys()) {
    if (!after.has(slot)) ops.push({ op: "removeItem", slot });
  }
  for (const [slot, equipped] of after) {
    const old = before.get(slot);
    if (old && canonical(old.item) === canonical(equipped.item)) continue;
    if (!options.renderItem) {
      throw new PatchPlanError("Item changed but no item text renderer was given", slot);
    }
    ops.push({ op: "setItem", slot, itemText: options.renderItem(equipped.item, slot) });
  }
  return ops;
}

function configOps(from: BuildState, to: BuildState): PatchOp[] {
  const ops: PatchOp[] = [];
  for (const key of Object.keys(from.config)) {
    if (!(key in to.config)) {
      throw new PatchPlanError(
        "A config override cannot be removed by a patch; set it to a value",
        key,
      );
    }
  }
  for (const [key, value] of Object.entries(to.config)) {
    if (from.config[key] !== value) ops.push({ op: "setConfig", key, value });
  }
  return ops;
}

/**
 * The patch ops that turn the state `from` (what the calc service has loaded)
 * into `to`. Pure: no numbers, no PoB. Equal states give an empty list; a
 * change no op can express throws `PatchPlanError` instead of being dropped.
 */
export function diffBuildState(
  from: BuildState,
  to: BuildState,
  options: DiffOptions = {},
): PatchOp[] {
  const ops: PatchOp[] = [];
  if (from.classId !== to.classId) ops.push({ op: "setClass", classId: to.classId });
  if (from.ascendancyId !== to.ascendancyId || (ops.length > 0 && to.ascendancyId)) {
    if (!to.ascendancyId) {
      throw new PatchPlanError("An ascendancy cannot be removed by a patch", from.ascendancyId);
    }
    ops.push({ op: "setAscendancy", ascendancyId: to.ascendancyId });
  }
  if (from.level !== to.level) ops.push({ op: "setLevel", level: to.level });
  ops.push(
    ...treeOps(from, to),
    ...skillOps(from, to),
    ...itemOps(from, to, options),
    ...configOps(from, to),
  );
  return ops;
}
