import { describe, expect, it } from "vitest";
import {
  buildRecording,
  replay,
  ReplayError,
  ReplayRetry,
  type ReplayPort,
  type ReplayStep,
  type Recording,
  type RunLike,
} from "../e2e/recording.ts";

const request = { dataReleaseId: "poe2-test+r1" };
const run: RunLike = {
  request,
  phase: "done",
  results: {
    "S1.profile": { type: "S1.profile", by: "claude", value: { b: 2 }, at: "2026-01-01T00:00:02Z" },
    "S0.skill": { type: "S0.skill", by: "claude", value: { a: 1 }, at: "2026-01-01T00:00:01Z" },
    "S3.table": { type: "S3.table", by: "server", value: {}, at: "2026-01-01T00:00:03Z" },
  },
  interventions: [
    { intervention: { kind: "chooseVariant", candidateKey: "c1" }, at: "2026-01-01T00:00:05Z" },
    { intervention: { kind: "pause" }, at: "2026-01-01T00:00:04Z" },
  ],
};

/** A fake app that asks for the given types in order, waits once for the player, then is done. */
function fakeApp(types: string[], waitAfter = 1) {
  const log: string[] = [];
  let index = 0;
  let waitingFor: "player" | undefined;
  const current = (): ReplayStep => {
    if (waitingFor === "player") return { kind: "wait_user" };
    const type = types[index];
    return type === undefined
      ? { kind: "done", guideId: "g1" }
      : { kind: "task", task: { taskId: `t${index}`, type, attempt: 1 } };
  };
  const port: ReplayPort = {
    next: () => Promise.resolve(current()),
    submit: (task, payload) => {
      log.push(`submit ${task.taskId} ${JSON.stringify(payload)}`);
      index += 1;
      if (index === waitAfter) waitingFor = "player";
      return Promise.resolve({ result: "accepted", next: current() });
    },
    intervene: (i) => {
      log.push(`intervene ${String(i["kind"])}`);
      waitingFor = undefined;
      return Promise.resolve();
    },
  };
  return { port, log };
}

describe("buildRecording", () => {
  it("keeps the planning answers in acceptance order and the player's decisions", () => {
    const recording = buildRecording(run);
    expect(recording.answers).toEqual([
      { type: "S0.skill", value: { a: 1 } },
      { type: "S1.profile", value: { b: 2 } },
    ]);
    expect(recording.interventions).toEqual([{ kind: "chooseVariant", candidateKey: "c1" }]);
  });

  it("refuses a run that is not finished", () => {
    expect(() => buildRecording({ ...run, phase: "planning" })).toThrow(/planning/);
  });
});

describe("replay", () => {
  const recording: Recording = buildRecording(run);

  it("answers each task from the recording and acts when the app waits for the player", async () => {
    const { port, log } = fakeApp(["S0.skill", "S1.profile"]);
    const result = await replay(port, recording);
    expect(result).toEqual({ guideId: "g1", submitted: 2, interventions: 1 });
    expect(log).toEqual(['submit t0 {"a":1}', "intervene chooseVariant", 'submit t1 {"b":2}']);
  });

  it("fails with both names when the run asks for another task than was recorded", async () => {
    const { port } = fakeApp(["S0.skill", "S2.candidate"]);
    await expect(replay(port, recording)).rejects.toThrow(/S1\.profile.*S2\.candidate/);
  });

  it("fails when a recorded answer is rejected now, naming the findings", async () => {
    const { port } = fakeApp(["S0.skill"]);
    port.submit = () =>
      Promise.resolve({
        result: "rejected",
        findings: [{ code: "x" }],
        next: { kind: "done", guideId: "g" },
      });
    await expect(replay(port, recording)).rejects.toThrow(/rejected.*"code":"x"/);
  });

  it("fails when the run ends before all answers were used", async () => {
    const { port } = fakeApp(["S0.skill"], 99);
    await expect(replay(port, recording)).rejects.toBeInstanceOf(ReplayError);
  });

  it("fails when the run keeps waiting and nothing more is recorded", async () => {
    const port: ReplayPort = {
      next: () => new Promise((r) => setTimeout(() => r({ kind: "wait_user" }), 10)),
      submit: () => Promise.reject(new Error("unused")),
      intervene: () => Promise.resolve(),
    };
    await expect(
      replay(port, { ...recording, interventions: [] }, { timeoutMs: 30 }),
    ).rejects.toThrow(/waiting/);
  });

  it("tries a player action again when the app is not ready for it yet", async () => {
    const { port, log } = fakeApp(["S0.skill", "S1.profile"]);
    const inner = port.intervene;
    let refused = 2;
    port.intervene = (i) =>
      refused-- > 0 ? Promise.reject(new ReplayRetry("not measured yet")) : inner(i);
    const result = await replay(port, recording);
    expect(result.interventions).toBe(1);
    expect(log.filter((l) => l.startsWith("intervene"))).toHaveLength(1);
  });

  it("gives up on a player action that is never accepted", async () => {
    const { port } = fakeApp(["S0.skill", "S1.profile"]);
    port.intervene = () => Promise.reject(new ReplayRetry("never"));
    await expect(replay(port, recording, { timeoutMs: 30 })).rejects.toThrow(/never/);
  });
});
