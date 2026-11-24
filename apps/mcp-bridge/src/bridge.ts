import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/** Shown to Claude (and so to the user) when the app is not reachable. */
export const APP_NOT_RUNNING =
  "The ExileForge app is not running or not reachable. Start ExileForge on this computer, then try again.";

/** JSON-RPC server error code for "app not reachable" (implementation-defined range). */
export const APP_UNREACHABLE_CODE = -32001;

export interface BridgeLogger {
  error(message: string, context?: Record<string, unknown>): void;
}

/**
 * Forwards MCP messages unchanged between Claude Desktop (local, stdio) and
 * the ExileForge app (remote, HTTP on 127.0.0.1). No tool logic, no data of
 * its own. If the app cannot be reached, requests get a clear error instead
 * of hanging; notifications are dropped and logged.
 */
export async function startBridge(
  local: Transport,
  remote: Transport,
  logger: BridgeLogger,
): Promise<{ close(): Promise<void> }> {
  local.onmessage = (message: JSONRPCMessage) => {
    remote.send(message).catch((error: unknown) => {
      logger.error("forwarding to the ExileForge app failed", { error: describe(error) });
      if ("id" in message && "method" in message) {
        local
          .send({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: APP_UNREACHABLE_CODE, message: APP_NOT_RUNNING },
          })
          .catch((sendError: unknown) =>
            logger.error("answering Claude failed", { error: describe(sendError) }),
          );
      }
    });
  };
  remote.onmessage = (message: JSONRPCMessage) => {
    local
      .send(message)
      .catch((error: unknown) =>
        logger.error("forwarding to Claude failed", { error: describe(error) }),
      );
  };
  remote.onerror = (error) => logger.error("app connection error", { error: describe(error) });
  local.onerror = (error) => logger.error("stdio error", { error: describe(error) });

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await Promise.allSettled([remote.close(), local.close()]);
  };
  local.onclose = () => void close();

  await remote.start();
  await local.start();
  return { close };
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause === undefined ? "" : ` (cause: ${describe(error.cause)})`;
  return `${error.name}: ${error.message}${cause}`;
}
