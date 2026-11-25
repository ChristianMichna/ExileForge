/** A price fetch failed in a way the caller must see; carries a stable code. */
export class EconomyError extends Error {
  override readonly name = "EconomyError";
  constructor(
    readonly code: EconomyErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export type EconomyErrorCode =
  | "http_error"
  | "network_error"
  | "timeout"
  | "response_too_large"
  | "invalid_response"
  | "no_league"
  | "reference_currency_unmapped"
  | "rate_limited"
  | "implausible_response"
  | "cache_error";
