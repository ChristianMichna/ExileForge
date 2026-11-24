/** Minimal structured logger: one JSON line per entry on stderr (no console.log in product code). */
export interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export function createStderrLogger(component: string): Logger {
  const write = (level: string, message: string, context?: Record<string, unknown>) => {
    const entry = {
      at: new Date().toISOString(),
      level,
      component,
      message,
      ...serialise(context),
    };
    process.stderr.write(`${JSON.stringify(entry)}\n`);
  };
  return {
    info: (message, context) => write("info", message, context),
    error: (message, context) => write("error", message, context),
  };
}

/** Errors are not JSON-serialisable; keep name, message, stack and cause chain. */
function serialise(context?: Record<string, unknown>): Record<string, unknown> {
  if (context === undefined) return {};
  return Object.fromEntries(Object.entries(context).map(([k, v]) => [k, describe(v)]));
}

function describe(value: unknown): unknown {
  if (!(value instanceof Error)) return value;
  return {
    name: value.name,
    message: value.message,
    stack: value.stack,
    ...(value.cause === undefined ? {} : { cause: describe(value.cause) }),
  };
}

/** Logger for tests: keeps entries in memory. */
export function createMemoryLogger(): Logger & { entries: { level: string; message: string }[] } {
  const entries: { level: string; message: string }[] = [];
  return {
    entries,
    info: (message) => entries.push({ level: "info", message }),
    error: (message) => entries.push({ level: "error", message }),
  };
}
