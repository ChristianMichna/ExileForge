import { DataReleaseId } from "@astrolabe/contracts";

export interface ParsedReleaseId {
  readonly gameVersion: readonly number[];
  readonly revision: number;
}

/** Splits `poe2-<gameVersion>+r<revision>` into numbers; throws for anything else. */
export function parseReleaseId(id: string): ParsedReleaseId {
  const valid = DataReleaseId.parse(id);
  const match = /^poe2-(\d+(?:\.\d+){1,3})\+r(\d+)$/.exec(valid);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(`Not a data release id: ${id}`);
  }
  return { gameVersion: match[1].split(".").map(Number), revision: Number(match[2]) };
}

/** Orders release ids by game version (numeric, per part), then revision. Negative: a is older. */
export function compareReleaseIds(a: string, b: string): number {
  const x = parseReleaseId(a);
  const y = parseReleaseId(b);
  const length = Math.max(x.gameVersion.length, y.gameVersion.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (x.gameVersion[i] ?? 0) - (y.gameVersion[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return x.revision - y.revision;
}

/** Tag of the GitHub release of a data release: `data-poe2-<gameVersion>-r<revision>`. */
export function tagOf(id: string): string {
  parseReleaseId(id);
  return `data-${id.replace("+", "-")}`;
}

/** Inverse of `tagOf`; undefined for tags that are not data releases. */
export function releaseIdOfTag(tag: string): string | undefined {
  const match = /^data-(poe2-\d+(?:\.\d+){1,3})-(r\d+)$/.exec(tag);
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  const id = `${match[1]}+${match[2]}`;
  return DataReleaseId.safeParse(id).success ? id : undefined;
}
