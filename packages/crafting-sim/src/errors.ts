/** The request refers to something that is not in the data release or is malformed. */
export class CraftSimInputError extends Error {
  override readonly name = "CraftSimInputError";
}
