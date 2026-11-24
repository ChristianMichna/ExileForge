/** JSON value as written by the extractor and compared by the diff. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export function isJsonObject(value: Json | undefined): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
