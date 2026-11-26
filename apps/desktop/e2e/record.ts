/**
 * Saves a finished run of the local Astrolabe app as a recording (see recording.ts) that the
 * Windows end-to-end check replays. Run it on the PC where the app runs, after a run reached
 * "done" (the guide exists):
 *
 *   node --experimental-strip-types e2e/record.ts <runId> [out file] [--port 47615]
 *
 * It reads the access token from %APPDATA%\Astrolabe\access-token (the same file the Claude
 * extension reads) and only talks to 127.0.0.1. Commit the file as e2e/fixtures/run-recording.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { buildRecording, type RunLike } from "./recording.ts";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const runId = args[0];
if (runId === undefined) throw new Error("usage: record.ts <runId> [out file] [--port N]");
const out = resolve(args[1] ?? "run-recording.json");
const portFlag = process.argv.indexOf("--port");
const port = portFlag < 0 ? 47615 : Number(process.argv[portFlag + 1]);
if (!Number.isInteger(port)) throw new Error("--port needs a number");

const appData = process.env["APPDATA"];
const tokenFile =
  appData !== undefined && appData !== ""
    ? join(appData, "Astrolabe", "access-token")
    : join(homedir(), ".config", "astrolabe", "access-token");
const token = readFileSync(tokenFile, "utf8").trim();

const response = await fetch(`http://127.0.0.1:${port}/api/runs/${encodeURIComponent(runId)}`, {
  headers: { authorization: `Bearer ${token}` },
});
if (!response.ok)
  throw new Error(`GET run ${runId}: HTTP ${response.status} ${await response.text()}`);
const recording = buildRecording((await response.json()) as RunLike);
writeFileSync(out, JSON.stringify(recording));
console.log(
  `${recording.answers.length} answers and ${recording.interventions.length} player actions saved to ${out}`,
);
