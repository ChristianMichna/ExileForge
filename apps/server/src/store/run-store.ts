import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { RunEvent } from "@exileforge/contracts/events";
import { RunRecord } from "../engine/run-record.js";

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
      this.db.exec("ROLLBACK");
      throw new Error(`Saving run ${record.runId} failed`, { cause: error });
    }
  }

  /** Events with seq greater than `afterSeq` (use -1 for all), in order. */
  eventsAfter(runId: string, afterSeq: number): RunEvent[] {
    return this.db
      .prepare("SELECT event FROM events WHERE run_id = ? AND seq > ? ORDER BY seq")
      .all(runId, afterSeq)
      .map((row) => parseRow(RunEvent, row["event"], `event of run ${runId}`));
  }

  close(): void {
    this.db.close();
  }
}

function parseRow<T extends z.ZodType>(schema: T, value: unknown, what: string): z.infer<T> {
  if (typeof value !== "string") throw new Error(`Stored ${what} is not text`);
  const parsed = schema.safeParse(JSON.parse(value));
  if (!parsed.success) {
    throw new Error(`Stored ${what} is damaged: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
