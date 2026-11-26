import { useEffect, useState } from "react";

/** Result of a request that can still be running or have failed; never an empty default. */
export type Loaded<T> =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly value: T };

export function useLoaded<T>(load: (signal: AbortSignal) => Promise<T>, key: string): Loaded<T> {
  const [state, setState] = useState<{ key: string; loaded: Loaded<T> }>({
    key,
    loaded: { status: "loading" },
  });
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setState({ key, loaded: { status: "ready", value } });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          key,
          loaded: {
            status: "error",
            message: error instanceof Error ? error.message : "The request failed.",
          },
        });
      },
    );
    return () => controller.abort();
    // `load` is a fresh function each render; the key says when the request is another one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state.loaded : { status: "loading" };
}
