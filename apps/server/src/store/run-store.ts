import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { CalcResult } from "@astrolabe/contracts/calc";
import { RunEvent } from "@astrolabe/contracts/events";
import { RunRecord } from "../engine/run-record.js";
import { PatchCheckOutcome, type StoredPatchCheck } from "./patch-check.js";

/**
 * SQLite store for runs and their event log (node:sqlite, no native
 * add-on to build for Windows). One JSON row per run; events append-only.
 */
export class RunStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        session_code TEXT,
        record TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS runs_session_code ON runs(session_code);
      CREATE TABLE IF NOT EXISTS calc_results (
        calc_id TEXT PRIMARY KEY,
        result TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS patch_checks (
        guide_id TEXT NOT NULL,
        to_release_id TEXT NOT NULL,
        outcome TEXT NOT NULL,
        checked_at TEXT NOT NULL,
        PRIMARY KEY (guide_id, to_release_id)
      );
      CREATE TABLE IF NOT EXISTS events (
        run_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        event TEXT NOT NULL,
        PRIMARY KEY (run_id, seq)
      );
    `);
  }

  load(runId: string): RunRecord | undefined {
    const row = this.db.prepare("SELECT record FROM runs WHERE run_id = ?").get(runId);
    return row === undefined ? undefined : parseRow(RunRecord, row["record"], `run ${runId}`);
  }

  findBySessionCode(code: string): RunRecord | undefined {
    const row = this.db.prepare("SELECT record FROM runs WHERE session_code = ?").get(code);
    return row === undefined ? undefined : parseRow(RunRecord, row["record"], `code ${code}`);
  }

  /**
   * The stored guide (result of stage S11) with this id; when several runs carry the id, the
   * most recently saved one. Undefined if no run has produced it.
   */
  findGuide(guideId: string): unknown {
    const rows = this.db
      .prepare(
        "SELECT record FROM runs WHERE json_extract(record, '$.guideId') = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1",
      )
      .all(guideId);
    const row = rows[0];
    if (row === undefined) return undefined;
    const record = parseRow(RunRecord, row["record"], `guide ${guideId}`);
    return record.results["S11.guide"]?.value;
  }

  /** Ids of all stored guides (a run that produced a guide carries its id); newest first, each once. */
  listGuideIds(): string[] {
    const rows = this.db
      .prepare(
        `SELECT json_extract(record, '$.guideId') AS guide_id FROM runs
         WHERE json_extract(record, '$.guideId') IS NOT NULL
         ORDER BY updated_at DESC, rowid DESC`,
      )
      .all();
    const ids: string[] = [];
    for (const row of rows) {
      const id = row["guide_id"];
      if (typeof id === "string" && !ids.includes(id)) ids.push(id);
    }
    return ids;
  }

  /** Keeps the outcome of the newest revalidation of a guide against a release (replaces an older one). */
  savePatchCheck(
    guideId: string,
    toReleaseId: string,
    outcome: PatchCheckOutcome,
    checkedAt: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO patch_checks (guide_id, to_release_id, outcome, checked_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(guide_id, to_release_id) DO UPDATE SET outcome = excluded.outcome,
           checked_at = excluded.checked_at`,
      )
      .run(guideId, toReleaseId, JSON.stringify(outcome), checkedAt);
  }

  /** Stored revalidation outcomes against one release. */
  listPatchChecks(toReleaseId: string): StoredPatchCheck[] {
    return this.db
      .prepare(
        "SELECT guide_id, outcome, checked_at FROM patch_checks WHERE to_release_id = ? ORDER BY guide_id",
      )
      .all(toReleaseId)
      .map((row) => ({
        guideId: String(row["guide_id"]),
        outcome: parseRow(
          PatchCheckOutcome,
          row["outcome"],
          `patch check ${String(row["guide_id"])}`,
        ),
        checkedAt: String(row["checked_at"]),
      }));
  }

  /** Saves the run and its new events in one transaction. */
  save(record: RunRecord, events: readonly RunEvent[]): void {
    const upsert = this.db.prepare(
      `INSERT INTO runs (run_id, session_code, record, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET session_code = excluded.session_code,
         record = excluded.record, updated_at = excluded.updated_at`,
    );
    const insertEvent = this.db.prepare("INSERT INTO events (run_id, seq, event) VALUES (?, ?, ?)");
    this.db.exec("BEGIN");
    try {
      upsert.run(
        record.runId,
        record.sessionCode?.code ?? null,
        JSON.stringify(record),
        new Date().toISOString(),
      );
      for (const event of events) {
        insertEvent.run(event.runId, event.seq, JSON.stringify(event));
      }
      this.db.exec("COMMIT");
    } catch (error) {
      let rollbackNote = "";
      try {
        this.db.exec("ROLLBACK");
      } catch (rollbackError) {
        rollbackNote = `; rollback failed too: ${String(rollbackError)}`;
      }
      throw new Error(`Saving run ${record.runId} failed${rollbackNote}`, { cause: error });
    }
  }

  /** Events with seq greater than `afterSeq` (use -1 for all), in order. */
  eventsAfter(runId: string, afterSeq: number): RunEvent[] {
    return this.db
      .prepare("SELECT event FROM events WHERE run_id = ? AND seq > ? ORDER BY seq")
      .all(runId, afterSeq)
      .map((row) => parseRow(RunEvent, row["event"], `event of run ${runId}`));
  }

  saveCalcResult(result: CalcResult): void {
    this.db
      .prepare("INSERT OR REPLACE INTO calc_results (calc_id, result) VALUES (?, ?)")
      .run(result.calcId, JSON.stringify(result));
  }

  loadCalcResult(calcId: string): CalcResult | undefined {
    const row = this.db.prepare("SELECT result FROM calc_results WHERE calc_id = ?").get(calcId);
    return row === undefined ? undefined : parseRow(CalcResult, row["result"], `calc ${calcId}`);
  }

  close(): void {
    this.db.close();
  }
}

function parseRow<T extends z.ZodType>(schema: T, value: unknown, what: string): z.infer<T> {
  if (typeof value !== "string") throw new Error(`Stored ${what} is not text`);
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch (error) {
    throw new Error(`Stored ${what} is not valid JSON`, { cause: error });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Stored ${what} is damaged: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
