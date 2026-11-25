/** A BuildState change that cannot be expressed as patch ops; never replaced by a guess. */
export class PatchPlanError extends Error {
  readonly detail: string | undefined;

  constructor(message: string, detail?: string, options?: ErrorOptions) {
    super(detail === undefined ? message : `${message}: ${detail}`, options);
    this.name = "PatchPlanError";
    this.detail = detail;
  }
}
