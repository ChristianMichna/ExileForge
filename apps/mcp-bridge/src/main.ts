#!/usr/bin/env node
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startBridge } from "./bridge.js";
import { endpointFromEnv } from "./endpoint.js";
import { defaultTokenFile, fetchWithToken } from "./token.js";

// stdout belongs to the MCP protocol; all diagnostics go to stderr (Claude Desktop's MCP log).
const logger = {
  error: (message: string, context?: Record<string, unknown>) =>
    process.stderr.write(
      `${JSON.stringify({ at: new Date().toISOString(), message, ...context })}\n`,
    ),
};

try {
  const endpoint = endpointFromEnv(process.env);
  const tokenFile = process.env["ASTROLABE_TOKEN_FILE"] || defaultTokenFile(process.env);
  const remote = new StreamableHTTPClientTransport(endpoint, { fetch: fetchWithToken(tokenFile) });
  await startBridge(new StdioServerTransport(), remote, logger);
} catch (error) {
  logger.error("bridge failed to start", { error: String(error) });
  process.exit(1);
}
