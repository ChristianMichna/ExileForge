import {
  GuideRevalidateErrorCode,
  type DataReleaseId,
  type GuidePatchCheck,
  type GuidePatchStatusView,
  type PatchCheckOutcome,
} from "@astrolabe/contracts";
import { z } from "zod";
import { ForgeError } from "../engine/errors.js";
import type { Logger } from "../logger.js";
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
  list: (toReleaseId: DataReleaseId) => GuidePatchCheck[];
  /** The data release the server runs with; guides are checked against it. */
  currentReleaseId: DataReleaseId;
  now: () => Date;
  logger: Logger;
}

const GUIDE_ID = z.uuid();

/**
 * F-19, automatic: after a new data release is installed, every stored guide
 * built with an older release is revalidated against it. A guide that cannot
 * be checked (missing diff, damaged record) is recorded with the error code,
 * never skipped silently. Guides built with the current release need nothing.
 */
export class GuideSweeper {
  private current: Promise<void> | undefined;
  private stopped = false;
  private error: string | undefined;

  constructor(private readonly deps: GuideSweepDeps) {}

  view(): GuidePatchStatusView {
    // Results of guides that no longer exist are not shown.
    const existing = new Set(this.deps.listGuideIds());
    return {
      enabled: true,
      releaseId: this.deps.currentReleaseId,
      running: this.current !== undefined,
      ...(this.error === undefined ? {} : { error: this.error }),
      guides: this.deps.list(this.deps.currentReleaseId).filter((g) => existing.has(g.guideId)),
    };
  }

  /**
   * Runs one sweep; a call while one runs does nothing (the running one covers the same
   * guides). Without `force`, guides that already have a verdict for this release are not
   * checked again; guides whose last check failed are.
   */
  run(options: { force?: boolean } = {}): Promise<void> {
    if (this.current !== undefined) return this.current;
    this.error = undefined;
    const done = this.sweep(options.force === true).finally(() => {
      this.current = undefined;
    });
    this.current = done;
    return done;
  }

  /** Ends a running sweep after the guide it is checking and waits for it; call before the store closes. */
  async stop(): Promise<void> {
    this.stopped = true;
    await this.current;
  }

  private async sweep(force: boolean): Promise<void> {
    try {
      const have = new Set(
        this.deps
          .list(this.deps.currentReleaseId)
          .filter((g) => g.outcome.kind === "status")
          .map((g) => g.guideId),
      );
      for (const guideId of this.deps.listGuideIds()) {
        if (this.stopped) return;
        if (!GUIDE_ID.safeParse(guideId).success) {
          // A damaged run record: no guide this app could show or check.
          this.deps.logger.error("a stored run carries a guide id that is not valid", { guideId });
          continue;
        }
        if (!force && have.has(guideId)) continue;
        await this.check(guideId);
      }
    } catch (error) {
      this.deps.logger.error("guide sweep failed", { error });
      this.error = "The check of the stored guides stopped early. The app log has details.";
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
      const known =
        error instanceof ForgeError ? GuideRevalidateErrorCode.safeParse(error.code) : undefined;
      if (error instanceof ForgeError && known?.success) {
        outcome = { kind: "error", code: known.data, message: error.message };
      } else {
        this.deps.logger.error("guide revalidation failed", { error, guideId });
        outcome = {
          kind: "error",
          code: "internal",
          message: "The check failed. The app log has details.",
        };
      }
    }
    // The store may close while a check runs; its result is dropped then, not written.
    if (this.stopped) return;
    this.deps.save(guideId, toReleaseId, outcome, checkedAt);
  }
}
