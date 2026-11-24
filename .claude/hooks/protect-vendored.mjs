#!/usr/bin/env node
// PreToolUse hook: blocks edits to the pinned Path of Building PoE2 submodule.
// CLAUDE.md rule 5: PoB is never patched; changes belong in bridge.lua.
// Exit code 2 blocks the tool call and shows stderr to Claude.

import path from "node:path";

const PROTECTED = ["services/pob-worker/PathOfBuilding/"];

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0); // not our business; never block on malformed hook input
  }
  const filePath = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
  if (typeof filePath !== "string") process.exit(0);

  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const rel = path.relative(root, path.resolve(root, filePath)).split(path.sep).join("/");

  const hit = PROTECTED.find((p) => rel === p.slice(0, -1) || rel.startsWith(p));
  if (hit) {
    process.stderr.write(
      `Blockiert: ${rel} liegt im gepinnten PoB-PoE2-Submodul (${hit}). ` +
        "PoB wird nicht gepatcht (CLAUDE.md Regel 5). " +
        "Änderung stattdessen in services/pob-worker/bridge.lua umsetzen.\n",
    );
    process.exit(2);
  }
  process.exit(0);
});
