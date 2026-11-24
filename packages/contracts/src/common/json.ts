import { z } from "zod";

/** Any JSON value. Used for opaque payloads (diff before/after, rule parameters). */
export const JsonValue = z.json();
export type JsonValue = z.infer<typeof JsonValue>;
