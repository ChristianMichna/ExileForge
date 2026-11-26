/**
 * Recording and replay of a finished Astrolabe run (F-09). A recording holds what a real run
 * decided: the accepted answers of the planning side (what Claude submitted) and what the player
 * did in the app. Replaying it drives a fresh run through all stages S0 to S11 against the real
 * app: the engine measures with PoB again and every gate checks again, only the decisions are
 * fixed. Nothing here is a game number or a game fact; it is the transcript of an earlier run.
 */

export const RECORDING_FORMAT = "astrolabe-run-recording";

export interface RecordedAnswer {
  readonly type: string;
  readonly value: unknown;
}

export interface Recording {
  readonly format: typeof RECORDING_FORMAT;
  readonly version: 1;
  /** The BuildRequest of the recorded run (names its data release). */
  readonly request: { readonly dataReleaseId: string } & Record<string, unknown>;
  /** Accepted answers of the planning side in the order they were accepted. */
  readonly answers: readonly RecordedAnswer[];
  /** What the player did in the app (variant choice, answers to questions, ...), in order. */
  readonly interventions: readonly Record<string, unknown>[];
}

/** The parts of a stored run (GET /api/runs/:id) a recording needs. */
export interface RunLike {
  readonly request: { readonly dataReleaseId: string } & Record<string, unknown>;
  readonly phase: string;
  readonly results: Readonly<
    Record<string, { type: string; by: string; value: unknown; at: string }>
  >;
  readonly interventions: readonly { intervention: Record<string, unknown>; at: string }[];
}

/** Builds the recording of a run that finished (`done`); anything else is not a transcript. */
export function buildRecording(run: RunLike): Recording {
  if (run.phase !== "done")
    throw new Error(`only a finished run can be recorded, this one is ${run.phase}`);
  const answers = Object.values(run.results)
    .filter((result) => result.by === "claude")
    .sort((a, b) => a.at.localeCompare(b.at))
    .map(({ type, value }) => ({ type, value }));
  const interventions = [...run.interventions]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((entry) => entry.intervention)
    // pausing is not part of a decision transcript
    .filter((i) => i["kind"] !== "pause" && i["kind"] !== "resume");
  return { format: RECORDING_FORMAT, version: 1, request: run.request, answers, interventions };
}

export type ReplayStep =
  | { kind: "task"; task: { taskId: string; type: string; attempt: number } }
  | { kind: "wait_user"; reason?: unknown; retryAfterSeconds?: number }
  | { kind: "done"; guideId: string }
  | { kind: "failed"; error: { code: string; message: string } };

export interface SubmitOutcome {
  result: "accepted" | "rejected";
  findings?: unknown[];
  next: ReplayStep;
}

/** What the replay needs from the app; the end-to-end check implements it over MCP and HTTP. */
export interface ReplayPort {
  next(): Promise<ReplayStep>;
  submit(task: { taskId: string; attempt: number }, payload: unknown): Promise<SubmitOutcome>;
  /** Posts a recorded player action; `answer` actions get the id of the open question. */
  intervene(intervention: Record<string, unknown>): Promise<void>;
}

export class ReplayError extends Error {
  override readonly name = "ReplayError";
}

/** The app is not ready for this player action yet (e.g. variants still being measured): try again later. */
export class ReplayRetry extends Error {
  override readonly name = "ReplayRetry";
}

export interface ReplayResult {
  readonly guideId: string;
  readonly submitted: number;
  readonly interventions: number;
}

export async function replay(
  port: ReplayPort,
  recording: Recording,
  options: { log?: (line: string) => void; maxWaits?: number } = {},
): Promise<ReplayResult> {
  const log = options.log ?? (() => undefined);
  const maxWaits = options.maxWaits ?? 200;
  let answerIndex = 0;
  let interventionIndex = 0;
  let waits = 0;
  let step = await port.next();
  for (;;) {
    switch (step.kind) {
      case "done":
        if (answerIndex !== recording.answers.length) {
          throw new ReplayError(
            `the run finished after ${answerIndex} of ${recording.answers.length} recorded answers`,
          );
        }
        return { guideId: step.guideId, submitted: answerIndex, interventions: interventionIndex };
      case "failed":
        throw new ReplayError(`the run failed: ${step.error.code}: ${step.error.message}`);
      case "wait_user": {
        const intervention = recording.interventions[interventionIndex];
        if (intervention !== undefined) {
          try {
            await port.intervene(intervention);
            interventionIndex += 1;
            log(`player action ${interventionIndex}: ${String(intervention["kind"])}`);
          } catch (error) {
            if (!(error instanceof ReplayRetry) || ++waits > maxWaits) throw error;
          }
        } else if (++waits > maxWaits) {
          throw new ReplayError(
            "the run keeps waiting for the player and nothing more is recorded",
          );
        }
        step = await port.next();
        break;
      }
      case "task": {
        const recorded = recording.answers[answerIndex];
        if (recorded === undefined) {
          throw new ReplayError(
            `the run asks for ${step.task.type} but the recording has no answer left`,
          );
        }
        if (recorded.type !== step.task.type) {
          throw new ReplayError(
            `answer ${answerIndex + 1} was recorded for ${recorded.type}, the run now asks for ${step.task.type}`,
          );
        }
        log(`${step.task.type} (answer ${answerIndex + 1} of ${recording.answers.length})`);
        const outcome = await port.submit(step.task, recorded.value);
        if (outcome.result === "rejected") {
          throw new ReplayError(
            `${step.task.type} was rejected: ${JSON.stringify(outcome.findings ?? []).slice(0, 1500)}`,
          );
        }
        answerIndex += 1;
        step = outcome.next;
        break;
      }
    }
  }
}
