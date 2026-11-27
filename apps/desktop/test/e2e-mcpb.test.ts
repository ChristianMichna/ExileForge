import { describe, expect, it } from "vitest";
import { resolveLaunch, type McpbManifest } from "../e2e/mcpb.ts";

const manifest: McpbManifest = {
  server: {
    mcp_config: {
      command: "node",
      args: ["${__dirname}/server/index.js"],
      env: { ASTROLABE_PORT: "${user_config.port}" },
    },
  },
  user_config: { port: { default: 47615 } },
};

describe("resolveLaunch", () => {
  it("fills in the extension folder and the user setting defaults like Claude Desktop", () => {
    expect(resolveLaunch(manifest, "C:\\ext", "C:\\node.exe")).toEqual({
      command: "C:\\node.exe",
      args: ["C:\\ext/server/index.js"],
      env: { ASTROLABE_PORT: "47615" },
    });
  });

  it("fails on a variable without a value instead of passing an empty string", () => {
    const broken: McpbManifest = {
      server: { mcp_config: { command: "node", env: { X: "${user_config.missing}" } } },
    };
    expect(() => resolveLaunch(broken, "/ext", "node")).toThrow(/user_config\.missing/);
  });
});
