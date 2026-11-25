// Fake calc worker for supervisor tests (calc-fake): speaks the worker
// protocol of lua/worker.lua without Path of Building. Numbers are
// deterministic fantasy values, never game values.
//
// Started like the real worker: node fake-worker.mjs <dir> <init.json>
// FAKE_MODE=fail-start | protocol-2 changes start behaviour; calc.stats with
// mainSkill "crash" | "hang" | "garbage" | "wrong-id" | "bad-result" misbehaves on purpose.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const MARKER = "@@EXILEFORGE_RPC@@";
const init = JSON.parse(readFileSync(process.argv[3], "utf8"));
const mode = process.env.FAKE_MODE ?? "";

if (mode === "fail-start") {
  process.stderr.write("fake: refusing to start\n");
  process.exit(3);
}

const sha = (s) => createHash("sha256").update(s).digest("hex");
const send = (obj) => process.stdout.write(`${MARKER}${JSON.stringify(obj)}\n`);
const states = new Map();
let next = 1;

// PoB-style noise on stdout must be ignored by the supervisor.
process.stdout.write("Loading main script...\n");

function rpcError(id, kind, message, detail) {
  send({ jsonrpc: "2.0", id, error: { code: -32000, message, data: { kind, detail } } });
}

const handlers = {
  "meta.version": () => ({
    protocolVersion: mode === "protocol-2" ? 2 : init.protocolVersion,
    pobVersion: "0.0.1",
    gameVersion: "0.5",
    dataReleaseId: init.dataReleaseId ?? "poe2-0.5+r0",
    dataHash: init.dataHash,
  }),
  "build.load": (p, id) => {
    if (!p.payload.startsWith("<PathOfBuilding2")) {
      rpcError(id, "build_load_failed", "Not a Path of Building (PoE2) build");
      return undefined;
    }
    const handle = `w${next++}`;
    states.set(handle, p.payload);
    return { handle, warnings: [`fake loaded ${handle}`] };
  },
  "build.export": (p, id) => {
    if (!states.has(p.handle))
      return rpcError(id, "unknown_handle", "Unknown build handle", p.handle);
    return { payload: states.get(p.handle) };
  },
  "build.applyPatch": (p, id) => {
    const xml = states.get(p.handle);
    if (xml === undefined) return rpcError(id, "unknown_handle", "Unknown build handle", p.handle);
    if (p.ops.some((o) => o.op === "setLevel" && o.level > 100)) {
      return rpcError(id, "invalid_params", "Level above maximum", "op 1 (setLevel)");
    }
    const handle = `w${next++}`;
    states.set(handle, `${xml}<!--${JSON.stringify(p.ops)}-->`);
    return { handle, warnings: [] };
  },
  "build.release": (p, id) => {
    if (!states.delete(p.handle))
      return rpcError(id, "unknown_handle", "Unknown build handle", p.handle);
    return {};
  },
  "calc.stats": (p, id) => {
    const xml = states.get(p.handle);
    if (xml === undefined) return rpcError(id, "unknown_handle", "Unknown build handle", p.handle);
    if (!init.profiles[p.profile])
      return rpcError(id, "invalid_params", "Unknown calc profile", p.profile);
    switch (p.mainSkill) {
      case "crash":
        process.exit(1);
        break;
      case "hang":
        return undefined;
      case "garbage":
        process.stdout.write(`${MARKER}{not json\n`);
        return undefined;
      case "wrong-id":
        send({ jsonrpc: "2.0", id: id + 1000, result: {} });
        return undefined;
      case "bad-result":
        return { calcId: "x" };
      default:
    }
    const inputHash = sha(xml);
    return {
      calcId: `calc-${sha(`${inputHash}|${p.profile}`).slice(0, 40)}`,
      pobVersion: "0.0.1",
      dataReleaseId: init.dataReleaseId ?? "poe2-0.5+r0",
      calcProfile: p.profile,
      inputHash,
      computedAt: new Date().toISOString(),
      mainSkill: p.mainSkill ?? "Fake Skill",
      stats: { FakeLength: xml.length, FakePid: process.pid },
      warnings: [],
      unsupportedMods: [],
    };
  },
};

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const req = JSON.parse(line);
  const handler = handlers[req.method];
  if (!handler) return rpcError(req.id, "unknown_method", "Method not supported", req.method);
  const result = handler(req.params ?? {}, req.id);
  if (result !== undefined) send({ jsonrpc: "2.0", id: req.id, result });
});
