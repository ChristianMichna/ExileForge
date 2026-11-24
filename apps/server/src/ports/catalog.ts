import type { EntityKind, EntityRef } from "@exileforge/contracts/common";
import type { DataReleaseId } from "@exileforge/contracts/common";

/** One catalog entry as the server needs it: id, display name, full entity as data. */
export interface CatalogEntry {
  kind: EntityKind;
  id: string;
  name?: string;
  entity: unknown;
}

/** Read access to the catalog of one data release (gate G1 and the catalog tools). */
export interface CatalogPort {
  readonly dataReleaseId: DataReleaseId;
  get(ref: EntityRef): CatalogEntry | undefined;
  /** Case-insensitive substring search on name and id. */
  search(query: { kind?: EntityKind; text: string; limit: number }): CatalogEntry[];
}
