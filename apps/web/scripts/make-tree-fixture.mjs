// Builds the passive tree fixture of the web app from a catalog produced by
// apps/data-pipeline (`exileforge-data catalog …`):
//
//   node apps/web/scripts/make-tree-fixture.mjs data-snapshots/catalog
//
// Tree geometry is game data from the release (kept in contract shape). The
// allocation is a made-up sample: a seeded walk from the first class's start
// towards nearby notables, split into stages, with one respec. It is no real
// build and is marked as sample everywhere it is shown.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const OUT = new URL("../src/fixtures/passive-tree.json", import.meta.url);

/** Sample stages: labels and level ranges of the sample build, cumulative points (invented). */
const STAGES = [
  { key: "s1", label: "Start", levelRange: [1, 12], points: 11 },
  { key: "s2", label: "Build-up", levelRange: [13, 28], points: 27 },
  { key: "s3", label: "Transition", levelRange: [29, 52], points: 50, ascendancy: 3 },
  { key: "s4", label: "Early Endgame", levelRange: [53, 75], points: 72, respec: 3 },
  { key: "s5", label: "Endgame Goal", levelRange: [76, 100], points: 96, ascendancy: 3 },
];
const SEED = 7;
const NEAREST = 4;

const dir = process.argv[2];
if (!dir) {
  console.error("usage: make-tree-fixture.mjs <catalog-dir>");
  process.exit(2);
}

async function shard(kind) {
  const json = JSON.parse(await readFile(join(dir, `${kind}.json`), "utf8"));
  if (json.kind !== kind) throw new Error(`${kind}.json holds ${json.kind}`);
  return json;
}

const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
const nodes = (await shard("passiveNode")).entities;
const groups = (await shard("passiveGroup")).entities;
const classes = (await shard("characterClass")).entities;
const ascendancies = (await shard("ascendancy")).entities;

// deterministic PRNG (mulberry32)
let state = SEED;
const random = () => {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const byId = new Map(nodes.map((n) => [n.id, n]));
const adjacency = new Map();
for (const n of nodes) {
  for (const t of n.connections) {
    if (!byId.has(t)) continue;
    adjacency.set(n.id, [...(adjacency.get(n.id) ?? []), t]);
    adjacency.set(t, [...(adjacency.get(t) ?? []), n.id]);
  }
}

const cls = [...classes].sort((a, b) => a.id.localeCompare(b.id))[0];
if (!cls) throw new Error("catalog has no character class");
const asc = ascendancies.find((a) => a.classId === cls.id && a.startNodeId && a.nodeIds.length > 4);
if (!asc) throw new Error(`class ${cls.id} has no ascendancy with nodes`);

/** Shortest path from the allocated set (plus sources) to the nearest of `targets`. */
function pathsFrom(sources, allowed) {
  const prev = new Map();
  const dist = new Map();
  const queue = [...sources];
  for (const s of sources) dist.set(s, 0);
  while (queue.length > 0) {
    const id = queue.shift();
    for (const next of adjacency.get(id) ?? []) {
      if (dist.has(next) || !allowed(byId.get(next))) continue;
      dist.set(next, dist.get(id) + 1);
      prev.set(next, id);
      queue.push(next);
    }
  }
  const path = (target) => {
    const out = [];
    for (let id = target; id !== undefined && dist.get(id) > 0; id = prev.get(id)) out.unshift(id);
    return out;
  };
  return { dist, path };
}

const mainNode = (n) => n && !n.ascendancyId && n.kind !== "decoration" && !n.classStartFor.length;
const ascNode = (n) => n && n.ascendancyId === asc.id;
const isTarget = (n) => n.kind === "notable" || n.kind === "keystone";

const allocated = new Set();
function grow(budget, allowed, start) {
  const order = [];
  while (order.length < budget) {
    const { dist, path } = pathsFrom([start, ...allocated], allowed);
    const candidates = [...dist.keys()]
      .filter((id) => !allocated.has(id) && isTarget(byId.get(id)))
      .sort((a, b) => dist.get(a) - dist.get(b) || a.localeCompare(b))
      .slice(0, NEAREST);
    if (candidates.length === 0) break;
    const target = candidates[Math.floor(random() * candidates.length)];
    for (const id of path(target)) {
      if (order.length >= budget) break;
      if (allocated.has(id)) continue;
      allocated.add(id);
      order.push(id);
    }
  }
  return order;
}

/** Allocated nodes whose removal keeps the rest connected to the start. */
function removableLeaves(pool, start) {
  return pool.filter((id) => {
    const rest = new Set([...allocated].filter((x) => x !== id));
    const { dist } = pathsFrom([start], (n) => n && rest.has(n.id));
    return [...rest].filter((x) => mainNode(byId.get(x))).every((x) => dist.has(x));
  });
}

const stages = [];
let points = 0;
for (const [i, s] of STAGES.entries()) {
  const respecs = [];
  if (s.respec) {
    const earlier = stages
      .flatMap((st) => st.allocationOrder)
      .filter((id) => mainNode(byId.get(id)));
    for (let k = 0; k < s.respec; k++) {
      const leaves = removableLeaves(
        earlier.filter((id) => allocated.has(id)),
        cls.startNodeId,
      );
      const pick = leaves[leaves.length - 1 - k] ?? leaves[0];
      if (!pick) break;
      allocated.delete(pick);
      respecs.push(pick);
    }
    points -= respecs.length;
  }
  // a respec moves points elsewhere: the refunded nodes stay out for this stage
  const order = grow(
    s.points - points,
    (n) => mainNode(n) && !respecs.includes(n.id),
    cls.startNodeId,
  );
  points += order.length;
  if (s.ascendancy) {
    if (!allocated.has(asc.startNodeId)) {
      allocated.add(asc.startNodeId);
      order.push(asc.startNodeId);
    }
    order.push(...grow(s.ascendancy, ascNode, asc.startNodeId));
  }
  stages.push({
    key: s.key,
    order: i,
    label: s.label,
    levelRange: s.levelRange,
    allocationOrder: order,
    respecs,
  });
}

const used = new Set([
  ...nodes
    .filter((n) => mainNode(n) || ascNode(n) || n.kind === "decoration" || n.classStartFor.length)
    .map((n) => n.id),
]);
const keep = nodes
  .filter((n) => used.has(n.id) && (!n.ascendancyId || n.ascendancyId === asc.id))
  .map((n) => ({
    id: n.id,
    name: n.name,
    kind: n.kind,
    stats: n.stats.map((s) => ({ text: s.text })),
    position: n.position,
    connections: n.connections,
    arcs: n.arcs,
    classStartFor: n.classStartFor,
    ...(n.ascendancyId ? { ascendancyId: n.ascendancyId } : {}),
  }));
const groupIds = new Set(keep.map((n) => n.position.groupId));

const fixture = {
  $comment:
    "Generated by apps/web/scripts/make-tree-fixture.mjs. Tree geometry and passives: game data from the data release below. Class choice and allocation: made-up sample, not a build.",
  dataRelease: manifest.release.id,
  pobVersion: manifest.release.pobVersion,
  classId: cls.id,
  ascendancy: { id: asc.id, name: asc.name },
  passiveNodes: keep,
  passiveGroups: groups.filter((g) => groupIds.has(g.id)),
  sampleStages: stages,
};
await writeFile(OUT, `${JSON.stringify(fixture)}\n`, "utf8");
console.log(
  `wrote ${keep.length} nodes, ${fixture.passiveGroups.length} groups, ${stages.length} stages (${points} points) to ${OUT.pathname}`,
);
