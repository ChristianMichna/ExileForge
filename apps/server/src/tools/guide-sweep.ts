import type { DataReleaseId } from "@astrolabe/contracts";
import { ForgeError } from "../engine/errors.js";
import type { Logger } from "../logger.js";
import type { PatchCheckOutcome, StoredPatchCheck } from "../store/patch-check.js";
import type { GuideRevalidatePort } from "./guide-revalidate.js";

export interface GuideSweepDeps {
  listGuideIds: () => string[];
  revalidate: GuideRevalidatePort;
  /** Data release the stored guide was built with; undefined if it cannot be read. */
  builtWith: (guideId: string) => string | undefined;
  save: (
    guideId: string,
    toReleaseId: string,
    outcome: PatchCheckOutcome,
    checkedAt: string,
  ) => void;
  list: (toReleaseId: DataReleaseId) => StoredPatchCheck[];
  /** The data release the server runs with; guides are checked against it. */
  currentReleaseId: DataReleaseId;
  now: () => Date;
  logger: Logger;
}

export interface GuideSweepView {
  releaseId: string;
  running: boolean;
  /** Set when the last sweep itself failed (not a single guide). */
  error?: string;
  guides: StoredPatchCheck[];
}

/**
 * F-19, automatic: after a new data release is installed, every stored guide
 * built with an older release is revalidated against it. A guide that cannot
 * be checked (missing diff, damaged record) is recorded with the error code,
 * never skipped silently. Guides built with the current release need nothing.
 */
export class GuideSweeper {
  private running = false;
  private error: string | undefined;

  constructor(private readonly deps: GuideSweepDeps) {}

  view(): GuideSweepView {
    return {
      releaseId: this.deps.currentReleaseId,
      running: this.running,
      ...(this.error === undefined ? {} : { error: this.error }),
      guides: this.deps.list(this.deps.currentReleaseId),
    };
  }

  /** Runs one sweep; a second call while one runs does nothing. */
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.error = undefined;
    try {
      for (const guideId of this.deps.listGuideIds()) {
        await this.check(guideId);
      }
    } catch (error) {
      this.deps.logger.error("guide sweep failed", { error });
      this.error = "The check of the stored guides stopped early. The app log has details.";
    } finally {
      this.running = false;
    }
  }

  private async check(guideId: string): Promise<void> {
    const toReleaseId = this.deps.currentReleaseId;
    // A guide built with the current release needs no check.
    if (this.deps.builtWith(guideId) === toReleaseId) return;
    const checkedAt = this.deps.now().toISOString();
    let outcome: PatchCheckOutcome;
    try {
      const status = await this.deps.revalidate({ guideId, toReleaseId });
      outcome = { kind: "status", status };
    } catch (error) {
      if (error instanceof ForgeError) {
        outcome = { kind: "error", code: error.code, message: error.message };
      } else {
        this.deps.logger.error("guide revalidation failed", { error, guideId });
        outcome = {
          kind: "error",
          code: "internal",
          message: "The check failed. The app log has details.",
        };
      }
    }
    this.deps.save(guideId, toReleaseId, outcome, checkedAt);
  }
}
