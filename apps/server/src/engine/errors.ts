/** Error codes Claude or the frontend can act on; messages are short and in English. */
export type ForgeErrorCode =
  | "unknown_run"
  | "unknown_session_code"
  | "session_code_expired"
  | "too_many_attempts"
  | "stale_task"
  | "no_open_task"
  | "unknown_ask"
  | "run_finished"
  | "invalid_intervention"
  | "invalid_request";

/** Expected failure of a forge operation (bad input or state), not a bug. */
export class ForgeError extends Error {
  constructor(
    readonly code: ForgeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ForgeError";
  }
}
