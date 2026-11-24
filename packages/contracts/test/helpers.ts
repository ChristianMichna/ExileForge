/** Returns a shallow copy of `obj` without `key` (for "field missing" cases). */
export function without<T extends object>(obj: T, key: keyof T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key)) as Partial<T>;
}
