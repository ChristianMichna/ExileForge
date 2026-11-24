import type { ReactNode } from "react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { TreeCamera, TreeHighlight, TreeRenderer } from "./renderer";
import type { PassiveTreeView } from "./tree-model";

export interface TreeCanvasHandle {
  fit(ids?: Iterable<string>, padding?: number, minSpan?: number): void;
  zoomBy(factor: number): void;
  panBy(dx: number, dy: number): void;
  project(id: string): { x: number; y: number } | undefined;
}

export interface TreeCanvasProps {
  readonly view: PassiveTreeView;
  readonly highlight: TreeHighlight;
  /** Nodes to frame on start (with generous context); the whole tree when absent. */
  readonly initialFit?: readonly string[];
  readonly bezel?: boolean;
  readonly label: string;
  readonly onHover?: (hit: { id: string; x: number; y: number } | null) => void;
  readonly onSelect?: (id: string | null) => void;
  readonly onCamera?: (camera: TreeCamera) => void;
  /** HTML layered over the canvas (labels, tooltip, HUD). */
  readonly children?: ReactNode;
  readonly className?: string;
}

const PAN_STEP = 80;
/** Framing of the build: padding share and minimum span in tree units. */
const CONTEXT_PADDING = 0.14;
const CONTEXT_SPAN = 5200;
const ZOOM_STEP = 1.25;

type Status = { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string };

/**
 * Hosts the WebGL tree. The renderer module is loaded on demand so the rest
 * of the UI (and its tests) never needs WebGL. Failing WebGL is shown as an
 * error, never as an empty tree.
 */
export const TreeCanvas = forwardRef<TreeCanvasHandle, TreeCanvasProps>(function TreeCanvas(
  { view, highlight, initialFit, bezel, label, onHover, onSelect, onCamera, children, className },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<TreeRenderer | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const callbacks = useRef({ onHover, onSelect, onCamera });
  callbacks.current = { onHover, onSelect, onCamera };
  const highlightRef = useRef(highlight);
  highlightRef.current = highlight;
  const fitRef = useRef(initialFit);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let renderer: TreeRenderer | null = null;
    import("./renderer")
      .then(({ TreeRenderer }) =>
        TreeRenderer.create(host, {
          view,
          ...(bezel !== undefined ? { bezel } : {}),
          onHover: (hit) => callbacks.current.onHover?.(hit),
          onSelect: (id) => callbacks.current.onSelect?.(id),
          onCamera: (camera) => callbacks.current.onCamera?.(camera),
        }),
      )
      .then((r) => {
        if (cancelled) {
          r.destroy();
          return;
        }
        renderer = r;
        rendererRef.current = r;
        r.setHighlight(highlightRef.current);
        if (fitRef.current && fitRef.current.length > 0)
          r.fit(fitRef.current, CONTEXT_PADDING, CONTEXT_SPAN);
        else r.fit();
        setStatus({ kind: "ready" });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        setStatus({ kind: "error", message });
      });
    return () => {
      cancelled = true;
      rendererRef.current = null;
      renderer?.destroy();
    };
  }, [view, bezel]);

  useEffect(() => {
    rendererRef.current?.setHighlight(highlight);
  }, [highlight]);

  useImperativeHandle(
    ref,
    () => ({
      fit: (ids, padding, minSpan) => rendererRef.current?.fit(ids, padding, minSpan),
      zoomBy: (f) => rendererRef.current?.zoomBy(f),
      panBy: (dx, dy) => rendererRef.current?.panBy(dx, dy),
      project: (id) => rendererRef.current?.project(id),
    }),
    [],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    const r = rendererRef.current;
    if (!r) return;
    const keys: Record<string, () => void> = {
      ArrowLeft: () => r.panBy(PAN_STEP, 0),
      ArrowRight: () => r.panBy(-PAN_STEP, 0),
      ArrowUp: () => r.panBy(0, PAN_STEP),
      ArrowDown: () => r.panBy(0, -PAN_STEP),
      "+": () => r.zoomBy(ZOOM_STEP),
      "=": () => r.zoomBy(ZOOM_STEP),
      "-": () => r.zoomBy(1 / ZOOM_STEP),
      "0": () => r.fit(),
    };
    const action = keys[e.key];
    if (action) {
      e.preventDefault();
      action();
    }
  };

  return (
    <div
      className={["ef-tree-canvas", className].filter(Boolean).join(" ")}
      data-status={status.kind}
    >
      <div
        ref={hostRef}
        className="ef-tree-canvas__host"
        role="application"
        aria-roledescription="passive tree"
        aria-label={`${label}. Drag or use arrow keys to pan, mouse wheel or plus and minus to zoom, 0 to show the whole tree.`}
        tabIndex={0}
        onKeyDown={onKeyDown}
      />
      {status.kind === "loading" ? (
        <p className="ef-tree-canvas__status" role="status">
          Drawing tree…
        </p>
      ) : null}
      {status.kind === "error" ? (
        <p className="ef-tree-canvas__status ef-tree-canvas__status--error" role="alert">
          Tree cannot be drawn: {status.message}
        </p>
      ) : null}
      {children}
    </div>
  );
});
