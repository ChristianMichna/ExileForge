import { useSyncExternalStore } from "react";

// Hash routing: the Electron shell loads the build from file://, where
// path-based routing has no server to fall back on.

export type RouteId = "overview" | "tree" | "design";

export interface NavEntry {
  readonly id: RouteId | "guide" | "crafting";
  readonly label: string;
  readonly href?: string;
  /** Not built yet; shown so the structure of the app is visible. */
  readonly upcoming?: boolean;
}

export const NAV: readonly NavEntry[] = [
  { id: "overview", label: "Build", href: "#/" },
  { id: "guide", label: "Guide", upcoming: true },
  { id: "tree", label: "Passive Tree", href: "#/tree" },
  { id: "crafting", label: "Crafting", upcoming: true },
  { id: "design", label: "Design System", href: "#/design" },
];

export function parseRoute(hash: string): RouteId {
  if (hash === "#/design") return "design";
  if (hash === "#/tree") return "tree";
  return "overview";
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

export function useRoute(): RouteId {
  return useSyncExternalStore(
    subscribe,
    () => parseRoute(window.location.hash),
    () => "overview",
  );
}
