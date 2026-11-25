import type { CalcErrorKind } from "@astrolabe/contracts";

/**
 * Error of the calc service. `kind` follows the calc RPC contract
 * (`CalcErrorKind`), so callers can tell a bad build from a crashed worker
 * without parsing messages.
 */
export class CalcServiceError extends Error {
  override readonly name = "CalcServiceError";
  readonly kind: CalcErrorKind;
  readonly detail: string | undefined;

  constructor(kind: CalcErrorKind, message: string, detail?: string, options?: ErrorOptions) {
    super(detail ? `${message}: ${detail}` : message, options);
    this.kind = kind;
    this.detail = detail;
  }
}

export function isCalcServiceError(err: unknown): err is CalcServiceError {
  return err instanceof CalcServiceError;
}
