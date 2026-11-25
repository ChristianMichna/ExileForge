export type OptimizerErrorKind =
  "invalid_input" | "base_failed" | "infeasible" | "evaluator_failed" | "aborted";

/** The optimizer cannot give a result; it never returns a made-up one. */
export class OptimizerError extends Error {
  readonly kind: OptimizerErrorKind;

  constructor(kind: OptimizerErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OptimizerError";
    this.kind = kind;
  }
}
