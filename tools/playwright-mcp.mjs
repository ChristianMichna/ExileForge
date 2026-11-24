#!/usr/bin/env node
// Starts the Playwright MCP server (pinned in package.json) for Claude Code,
// registered in .mcp.json. Picks a browser that exists here:
//   - Claude Code cloud sessions: the preinstalled Chromium (/opt/pw-browsers),
//     without sandbox because the container runs as root
//   - otherwise Playwright MCP's default (installed Google Chrome); if none is
//     found, Claude can call the server's browser_install tool.
// Headless and isolated (fresh profile per session, nothing persisted).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
let cli;
try {
  cli = path.join(path.dirname(require.resolve("@playwright/mcp/package.json")), "cli.js");
} catch (err) {
  console.error(
    "Playwright MCP is not installed. Run `pnpm install` (or tools/dev-setup.sh).",
    err,
  );
  process.exit(1);
}

const args = [cli, "--headless", "--isolated", ...process.argv.slice(2)];
const cloudChromium = path.join(
  process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers",
  "chromium",
);
if (process.platform === "linux" && existsSync(cloudChromium)) {
  // Cloud containers run as root, where Chromium refuses its sandbox.
  args.push("--executable-path", cloudChromium, "--no-sandbox");
}

const child = spawn(process.execPath, args, { stdio: "inherit" });
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
child.on("error", (err) => {
  console.error("Could not start Playwright MCP.", err);
  process.exit(1);
});
