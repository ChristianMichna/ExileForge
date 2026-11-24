#!/usr/bin/env node
// PostToolUse hook: formats the edited file with the project's own Prettier.
// No-op until Prettier is installed in node_modules, so it is safe in the
// current planning phase. Never fails the tool call.

import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx", ".json", ".css", ".md", ".yml", ".yaml", ".html",
]);
const SKIP = ["vendor/", "node_modules/", "pnpm-lock.yaml"];

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  try {
    const input = JSON.parse(raw);
    const filePath = input?.tool_input?.file_path;
    if (typeof filePath !== "string") return;

    const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
    const abs = path.resolve(root, filePath);
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (rel.startsWith("..") || SKIP.some((s) => rel.startsWith(s) || rel === s)) return;
    if (!EXTENSIONS.has(path.extname(abs))) return;

    const bin = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "prettier.cmd" : "prettier");
    if (!existsSync(bin) || !existsSync(abs)) return;

    const res = spawnSync(bin, ["--write", "--log-level", "warn", abs], {
      cwd: root,
      encoding: "utf8",
      timeout: 20_000,
      shell: process.platform === "win32", // .cmd shims need a shell on Windows; args are not user-controlled
    });
    if (res.status !== 0 && res.stderr) process.stderr.write(`prettier: ${res.stderr}`);
  } catch (err) {
    process.stderr.write(`format-on-edit: ${err instanceof Error ? err.message : String(err)}\n`);
  }
});
