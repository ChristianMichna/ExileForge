import { z } from "zod";

export const watchConfigSchema = z
  .object({
    $comment: z.string().optional(),
    /** "owner/name" of the upstream Path of Building repository. */
    pobRepo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    /** File that pins the PoB commit, relative to the repository root. */
    pinFile: z.string().min(1),
    /** Regular expression with one group that captures the pinned 40-character commit. */
    pinPattern: z.string().min(1),
  })
  .strict();
export type WatchConfig = z.infer<typeof watchConfigSchema>;

/** The commit pinned in the pin file; throws when the file does not contain exactly one pin. */
export function readPinnedCommit(pinFileText: string, pattern: string): string {
  const matches = [...pinFileText.matchAll(new RegExp(pattern, "g"))];
  const sha = matches[0]?.[1];
  if (matches.length !== 1 || sha === undefined || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(
      `The pin file has ${String(matches.length)} matches for the PoB pin, expected exactly one commit`,
    );
  }
  return sha;
}

export interface WatchInput {
  /** Game version the update server announces now, e.g. "0.5.5.10". */
  gamePatch: string;
  /** Game versions of the published data releases. */
  dataGameVersions: readonly string[];
  pob: { pinnedSha: string; latestTag: string; latestSha: string };
}

export type WatchFindingKind = "new-game-patch" | "new-pob-release";

export interface WatchFinding {
  kind: WatchFindingKind;
  title: string;
  /** What to do next, in order. */
  steps: string[];
}

export interface WatchReport {
  gamePatch: string;
  latestPobTag: string;
  findings: WatchFinding[];
  /**
   * True while a new game patch has no matching PoB release: a data release for it would carry PoB
   * data of an older patch, so the app must stay in catalog-only mode for it (project plan,
   * "Grenzen und Umgang damit").
   */
  catalogOnlyUntilPob: boolean;
}

/** Decides what the hourly watcher reports; pure, so every case is tested. */
export function decide(input: WatchInput): WatchReport {
  const newGamePatch = !input.dataGameVersions.includes(input.gamePatch);
  const newPob = input.pob.latestSha !== input.pob.pinnedSha;
  const findings: WatchFinding[] = [];
  if (newPob) {
    findings.push({
      kind: "new-pob-release",
      title: `New PoB-PoE2 release ${input.pob.latestTag}`,
      steps: [
        `Bump POB_REF in the pin file to ${input.pob.latestSha} (release ${input.pob.latestTag}).`,
        "Let CI run the golden builds and compare the values; release notes list mechanics that changed.",
        newGamePatch
          ? `Then run the "Data release" workflow with game-version ${input.gamePatch}.`
          : 'Then run the "Data release" workflow with the next revision of the current game version.',
      ],
    });
  }
  if (newGamePatch) {
    findings.push({
      kind: "new-game-patch",
      title: `New game patch ${input.gamePatch} has no data release`,
      steps: newPob
        ? [`Publish a data release for ${input.gamePatch} after the PoB bump above.`]
        : [
            `PoB-PoE2 has no release newer than the pinned one, so its data still describes an older patch.`,
            "Do not publish a data release for the new patch as complete. The app stays in catalog-only mode for it until PoB catches up.",
            "Watch the PoB-PoE2 releases; this check runs hourly.",
          ],
    });
  }
  return {
    gamePatch: input.gamePatch,
    latestPobTag: input.pob.latestTag,
    findings,
    catalogOnlyUntilPob: newGamePatch && !newPob,
  };
}

export function renderReport(report: WatchReport): string {
  if (report.findings.length === 0) {
    return `Up to date: game patch ${report.gamePatch} has a data release and the pinned PoB is ${report.latestPobTag}.\n`;
  }
  const lines = [
    `Game patch ${report.gamePatch}, latest PoB-PoE2 release ${report.latestPobTag}.`,
    "",
  ];
  for (const f of report.findings) {
    lines.push(`### ${f.title}`, ...f.steps.map((s, i) => `${String(i + 1)}. ${s}`), "");
  }
  if (report.catalogOnlyUntilPob)
    lines.push("**Catalog-only for the new patch until PoB has a matching release.**", "");
  return lines.join("\n");
}
