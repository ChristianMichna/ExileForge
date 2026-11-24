import { readManifest, readShard } from "../snapshot/snapshot.ts";
import { diffEntities, type KindDiff } from "./diff.ts";

/** Machine-readable diff between two snapshots (matches the planned CatalogDiff contract). */
export interface SnapshotDiff {
  from: string;
  to: string;
  kinds: Record<string, KindDiff>;
}

/**
 * Diffs every kind present in either snapshot. A kind missing on one side is
 * an error, not an empty diff: it means the source config changed and the
 * result would silently claim "everything added/removed".
 */
export async function diffSnapshots(fromDir: string, toDir: string): Promise<SnapshotDiff> {
  const [from, to] = await Promise.all([readManifest(fromDir), readManifest(toDir)]);
  if (from.releaseId === to.releaseId) {
    throw new Error(
      `both snapshots have release id ${from.releaseId}; a diff needs two different releases`,
    );
  }
  const fromKinds = from.shards.map((s) => s.kind).sort();
  const toKinds = to.shards.map((s) => s.kind).sort();
  const missing = [
    ...fromKinds.filter((k) => !toKinds.includes(k)).map((k) => `${k} missing in ${to.releaseId}`),
    ...toKinds
      .filter((k) => !fromKinds.includes(k))
      .map((k) => `${k} missing in ${from.releaseId}`),
  ];
  if (missing.length > 0) throw new Error(`snapshots have different kinds: ${missing.join(", ")}`);

  const kinds: Record<string, KindDiff> = {};
  for (const kind of fromKinds) {
    const [a, b] = await Promise.all([readShard(fromDir, from, kind), readShard(toDir, to, kind)]);
    kinds[kind] = diffEntities(a, b);
  }
  return { from: from.releaseId, to: to.releaseId, kinds };
}

/** Short human summary (counts per kind) for logs and PR comments. */
export function summarizeDiff(diff: SnapshotDiff): string {
  const lines = [
    `Diff ${diff.from} -> ${diff.to}`,
    "",
    "| Kind | added | removed | changed |",
    "| --- | ---: | ---: | ---: |",
  ];
  for (const [kind, d] of Object.entries(diff.kinds)) {
    lines.push(
      `| ${kind} | ${String(d.added.length)} | ${String(d.removed.length)} | ${String(d.changed.length)} |`,
    );
  }
  return lines.join("\n") + "\n";
}
