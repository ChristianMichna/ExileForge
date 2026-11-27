import type { ProgressionStage } from "@astrolabe/contracts/build";
import type { GuideView } from "@astrolabe/contracts/guide";
import { Panel, ProvenanceBadge } from "@astrolabe/ui";
import { GUIDE_STATS } from "../guide/guide-stats";

/*
 * How the build grows: one small chart per emphasised engine number, a point per progression stage
 * at its level. Values are read from the stored Path of Building results, the same as the stage
 * numbers. A stage without a result for the stat has no point (a gap), never a zero.
 */

interface Point {
  readonly level: number;
  readonly label: string;
  readonly value: number | undefined;
}

function pointsOf(stat: string, stages: readonly ProgressionStage[], view: GuideView): Point[] {
  return stages.map((stage) => {
    let value: number | undefined;
    for (const profile of GUIDE_STATS.calcProfiles) {
      const outcome = stage.calcs[profile];
      if (outcome?.status !== "ok") continue;
      value = view.results[outcome.calcId]?.stats[stat];
      if (value !== undefined) break;
    }
    return { level: stage.levelRange[1], label: stage.label, value };
  });
}

const W = 320;
const H = 120;
const PAD = { l: 8, r: 8, t: 10, b: 18 };

function Chart({ title, points }: { title: string; points: readonly Point[] }) {
  const known = points.filter((p): p is Point & { value: number } => p.value !== undefined);
  if (known.length === 0) return null;
  const maxV = Math.max(...known.map((p) => p.value));
  const lo = Math.min(...points.map((p) => p.level));
  const hi = Math.max(...points.map((p) => p.level));
  const x = (level: number): number =>
    PAD.l + (hi === lo ? 0.5 : (level - lo) / (hi - lo)) * (W - PAD.l - PAD.r);
  const y = (v: number): number => H - PAD.b - (maxV <= 0 ? 0 : v / maxV) * (H - PAD.t - PAD.b);
  // A gap in the data breaks the line instead of bridging it.
  const runs: (Point & { value: number })[][] = [];
  for (const p of points) {
    if (p.value === undefined) runs.push([]);
    else (runs[runs.length - 1] ?? runs[runs.push([]) - 1])?.push({ ...p, value: p.value });
  }
  const last = known[known.length - 1];
  return (
    <figure className="power-curve__chart">
      <figcaption>
        <span>{title}</span>
        {last === undefined ? null : (
          <strong>
            {new Intl.NumberFormat("en-US", { notation: "compact" }).format(last.value)}
          </strong>
        )}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title} by stage`}>
        <line
          className="power-curve__axis"
          x1={PAD.l}
          x2={W - PAD.r}
          y1={H - PAD.b}
          y2={H - PAD.b}
        />
        {runs
          .filter((r) => r.length > 1)
          .map((r, i) => (
            <polyline
              key={i}
              className="power-curve__line"
              points={r.map((p) => `${x(p.level)},${y(p.value)}`).join(" ")}
            />
          ))}
        {known.map((p) => (
          <g key={`${p.level}-${p.label}`}>
            <circle className="power-curve__dot" cx={x(p.level)} cy={y(p.value)} r={3}>
              <title>{`${p.label}: ${new Intl.NumberFormat("en-US").format(Math.round(p.value))}`}</title>
            </circle>
          </g>
        ))}
        <text className="power-curve__tick" x={PAD.l} y={H - 4}>
          {`Lv ${String(lo)}`}
        </text>
        <text className="power-curve__tick" x={W - PAD.r} y={H - 4} textAnchor="end">
          {`Lv ${String(hi)}`}
        </text>
      </svg>
    </figure>
  );
}

export function PowerCurve({ view }: { view: GuideView }) {
  const stages = [...view.guide.progression.stages].sort((a, b) => a.order - b.order);
  const charts = GUIDE_STATS.stats
    .filter((s) => s.emphasis === true)
    .map((s) => ({ s, points: pointsOf(s.stat, stages, view) }))
    .filter(({ points }) => points.some((p) => p.value !== undefined));
  if (charts.length === 0) return null;
  const first = stages.flatMap((s) => Object.values(s.calcs)).find((o) => o.status === "ok");
  const result = first?.status === "ok" ? view.results[first.calcId] : undefined;
  return (
    <Panel title="Power curve" kicker="How the build grows">
      <div className="power-curve">
        {charts.map(({ s, points }) => (
          <Chart key={s.stat} title={s.label} points={points} />
        ))}
      </div>
      {result === undefined ? null : (
        <ProvenanceBadge
          provenance={{
            kind: "pob",
            pobVersion: result.pobVersion,
            calcProfile: result.calcProfile,
          }}
        />
      )}
    </Panel>
  );
}
