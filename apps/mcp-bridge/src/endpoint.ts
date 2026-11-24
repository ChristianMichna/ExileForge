/** Default port of the ExileForge app (same default as apps/server). */
export const DEFAULT_PORT = 47615;

/**
 * Endpoint of the local app. Only the port is configurable (manifest
 * user_config → EXILEFORGE_PORT); the host is always 127.0.0.1 so the
 * bridge can never be pointed at another machine.
 */
export function endpointFromEnv(env: Record<string, string | undefined>): URL {
  const raw = env["EXILEFORGE_PORT"];
  const port = raw === undefined || raw === "" ? DEFAULT_PORT : Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`EXILEFORGE_PORT must be a port number, got ${JSON.stringify(raw)}`);
  }
  return new URL(`http://127.0.0.1:${port}/mcp`);
}
