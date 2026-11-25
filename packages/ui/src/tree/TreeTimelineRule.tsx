import { useId } from "react";
import type { TreeTimeline } from "./tree-timeline";

export interface TreeTimelineRuleProps {
  readonly timeline: TreeTimeline;
  readonly cursor: number;
  /** Stage the cursor is in (a boundary can belong to either neighbour). */
  readonly stage: number;
  readonly onCursor: (cursor: number) => void;
  readonly playing: boolean;
  readonly onPlay: (playing: boolean) => void;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * The level timeline as an engraved rule: one bracket per stage, a tick per
 * passive point, and a native range input as the cursor (keyboard and
 * screen readers work as usual).
 */
export function TreeTimelineRule({
  timeline,
  cursor,
  stage,
  onCursor,
  playing,
  onPlay,
}: TreeTimelineRuleProps) {
  const id = useId();
  const total = Math.max(1, timeline.steps.length);
  const current = timeline.stages[stage];
  const pct = (n: number) => `${(n / total) * 100}%`;
  const goStage = (i: number) => {
    const s = timeline.stages[i];
    if (s) onCursor(s.to);
  };

  return (
    <div className="ef-tree-rule">
      <div className="ef-tree-rule__controls">
        <button
          type="button"
          className="ef-tree-rule__button"
          onClick={() => goStage(stage - 1)}
          disabled={stage <= 0}
          aria-label="Previous stage"
        >
          <span aria-hidden="true">◂◂</span>
        </button>
        <button
          type="button"
          className="ef-tree-rule__button ef-tree-rule__button--play"
          onClick={() => onPlay(!playing)}
          aria-pressed={playing}
          aria-label={playing ? "Pause allocation playback" : "Play allocation of this stage"}
        >
          <span aria-hidden="true">{playing ? "❚❚" : "▶"}</span>
        </button>
        <button
          type="button"
          className="ef-tree-rule__button"
          onClick={() => goStage(stage + 1)}
          disabled={stage >= timeline.stages.length - 1}
          aria-label="Next stage"
        >
          <span aria-hidden="true">▸▸</span>
        </button>
      </div>

      <div className="ef-tree-rule__track">
        <ol className="ef-tree-rule__stages">
          {timeline.stages.map((s, i) => (
            <li
              key={s.key}
              className="ef-tree-rule__stage"
              data-state={i < stage ? "done" : i === stage ? "current" : "upcoming"}
              style={{ left: pct(s.from), width: pct(s.to - s.from) }}
            >
              <button
                type="button"
                className="ef-tree-rule__stage-button"
                onClick={() => goStage(i)}
                aria-current={i === stage ? "step" : undefined}
              >
                <span className="ef-tree-rule__stage-no">{pad2(i + 1)}</span>
                <span className="ef-tree-rule__stage-label">{s.label}</span>
                <span className="ef-tree-rule__stage-levels">
                  Lv {s.levelRange[0]}–{s.levelRange[1]}
                </span>
              </button>
            </li>
          ))}
        </ol>
        <div className="ef-tree-rule__ticks" aria-hidden="true">
          {timeline.steps.map((step, i) => (
            <span
              key={`${String(i)}-${step.nodeId}`}
              className={`ef-tree-rule__tick ef-tree-rule__tick--${step.op}`}
              data-passed={i < cursor ? "true" : undefined}
              style={{ left: pct(i + 0.5) }}
            />
          ))}
          <span className="ef-tree-rule__fill" style={{ width: pct(cursor) }} />
        </div>
        <label className="ef-visually-hidden" htmlFor={id}>
          Passive points allocated
        </label>
        <input
          id={id}
          className="ef-tree-rule__input"
          type="range"
          min={0}
          max={timeline.steps.length}
          step={1}
          value={cursor}
          onChange={(e) => onCursor(Number(e.currentTarget.value))}
          aria-valuetext={
            current
              ? `${current.label}, point ${String(cursor - current.from)} of ${String(current.to - current.from)}`
              : String(cursor)
          }
        />
      </div>
    </div>
  );
}
