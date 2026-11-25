import { useEffect, useState } from "react";
import { getDesktopBridge, type AppStatus } from "./bridge";

export type DesktopStatus =
  | { readonly kind: "browser" }
  | { readonly kind: "loading" }
  | { readonly kind: "unreachable"; readonly message: string }
  | { readonly kind: "desktop"; readonly status: AppStatus };

/** Status of the desktop shell (server, updates). `browser` outside the desktop app. */
export function useDesktopStatus(): DesktopStatus {
  const bridge = getDesktopBridge();
  const [state, setState] = useState<DesktopStatus>(
    bridge ? { kind: "loading" } : { kind: "browser" },
  );
  useEffect(() => {
    if (!bridge) return;
    let active = true;
    const unsubscribe = bridge.onStatus((status) => {
      if (active) setState({ kind: "desktop", status });
    });
    bridge
      .getStatus()
      .then((status) => {
        // A change event that arrived first is newer than this snapshot.
        if (active)
          setState((prev) => (prev.kind === "desktop" ? prev : { kind: "desktop", status }));
      })
      .catch((error: unknown) => {
        if (active) {
          setState((prev) =>
            prev.kind === "desktop"
              ? prev
              : {
                  kind: "unreachable",
                  message:
                    error instanceof Error ? error.message : "The app status is unavailable.",
                },
          );
        }
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge]);
  return state;
}
