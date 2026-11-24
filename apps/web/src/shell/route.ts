import { useSyncExternalStore } from "react";

// Hash routing: the Electron shell loads the build from file://, where
// path-based routing has no server to fall back on.

export type RouteId = "overview" | "design";

export interface NavEntry {
  readonly id: RouteId | "guide" | "tree" | "crafting";
  readonly label: string;
  readonly href?: string;
  /** Not built yet; shown so the structure of the app is visible. */
  readonly upcoming?: boolean;
}

export const NAV: readonly NavEntry[] = [
  { id: "overview", label: "Build Overview", href: "#/" },
  { id: "guide", label: "Guide", upcoming: true },
  { id: "tree", label: "Passive Tree", upcoming: true },
  { id: "crafting", label: "Crafting", upcoming: true },
  { id: "design", label: "Design System", href: "#/design" },
];

export function parseRoute(hash: string): RouteId {
  return hash === "#/design" ? "design" : "overview";
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
