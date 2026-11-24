import { isJsonObject, type Json } from "../json.ts";

/** One changed field, addressed by a JSON pointer (RFC 6901) into the entity. */
export interface FieldChange {
  path: string;
  /** absent if the field did not exist before */
  before?: Json;
  /** absent if the field no longer exists */
  after?: Json;
}

export interface KindDiff {
  added: string[];
  removed: string[];
  changed: { id: string; fields: FieldChange[] }[];
}

export type EntityMap = Readonly<Record<string, Json>>;

function escapePointer(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function sameJson(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    return (
      Array.isArray(b) && a.length === b.length && a.every((v, i) => sameJson(v, b[i] as Json))
    );
  }
  if (isJsonObject(a) && isJsonObject(b)) {
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    return ka.every((k) => Object.hasOwn(b, k) && sameJson(a[k] as Json, b[k] as Json));
  }
  return false;
}

/**
 * Field-level differences between two versions of one entity. Objects are
 * compared per key; arrays of equal length per index; arrays whose length
 * changed are reported as one change of the whole array (index shifts would
 * otherwise flood the diff).
 */
export function diffValue(before: Json, after: Json, path = ""): FieldChange[] {
  if (sameJson(before, after)) return [];
  if (isJsonObject(before) && isJsonObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    const changes: FieldChange[] = [];
    for (const k of keys) {
      const p = `${path}/${escapePointer(k)}`;
      const hasBefore = Object.hasOwn(before, k);
      const hasAfter = Object.hasOwn(after, k);
      if (hasBefore && hasAfter) changes.push(...diffValue(before[k] as Json, after[k] as Json, p));
      else if (hasBefore) changes.push({ path: p, before: before[k] as Json });
      else changes.push({ path: p, after: after[k] as Json });
    }
    return changes;
  }
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    return before.flatMap((v, i) => diffValue(v, after[i] as Json, `${path}/${i}`));
  }
  return [{ path, before, after }];
}

/** Added, removed and changed entities of one kind; all lists sorted by id. */
export function diffEntities(before: EntityMap, after: EntityMap): KindDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: KindDiff["changed"] = [];
  for (const id of Object.keys(after).sort()) {
    if (!Object.hasOwn(before, id)) added.push(id);
  }
  for (const id of Object.keys(before).sort()) {
    if (!Object.hasOwn(after, id)) {
      removed.push(id);
      continue;
    }
    const fields = diffValue(before[id] as Json, after[id] as Json);
    if (fields.length > 0) changed.push({ id, fields });
  }
  return { added, removed, changed };
}
