import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { TokenInvalidError, TokenMissingError } from "./token.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/** Shown to Claude (and so to the user) when the app is not reachable. */
export const APP_NOT_RUNNING =
  "The Astrolabe app is not running or not reachable. Start Astrolabe on this computer, then try again.";
/** The app answered but refused the access token. */
export const TOKEN_REJECTED =
  "The Astrolabe app refused the access token. Reconnect Claude from the Astrolabe app (Connect with Claude), then try again.";
/** The token file is unreadable or damaged. */
export const TOKEN_DAMAGED =
  "The Astrolabe access token on this computer is damaged. Restart the Astrolabe app and reconnect Claude from it.";
/** Anything else the app answered with. */
export const APP_ERROR = "The Astrolabe app answered with an error. Check the app, then try again.";

/** JSON-RPC server error code for "app not reachable" (implementation-defined range). */
export const APP_UNREACHABLE_CODE = -32001;

export interface BridgeLogger {
  error(message: string, context?: Record<string, unknown>): void;
}

/**
 * Forwards MCP messages unchanged between Claude Desktop (local, stdio) and
 * the Astrolabe app (remote, HTTP on 127.0.0.1). No tool logic, no data of
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
      logger.error("forwarding to the Astrolabe app failed", { error: describe(error) });
      if ("id" in message && "method" in message) {
        local
          .send({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: APP_UNREACHABLE_CODE, message: messageFor(error) },
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

/**
 * Tells the user what to do, by failure kind: no connection or no token file
 * means the app is not running; 401/403 means a stale token; anything else
 * is a generic app error. Never paths or stack traces.
 */
export function messageFor(error: unknown): string {
  if (error instanceof TokenMissingError) return APP_NOT_RUNNING;
  if (error instanceof TokenInvalidError) return TOKEN_DAMAGED;
  if (error instanceof StreamableHTTPError) {
    return error.code === 401 || error.code === 403 ? TOKEN_REJECTED : APP_ERROR;
  }
  // fetch() rejects with a TypeError when nothing listens on the port.
  if (error instanceof TypeError) return APP_NOT_RUNNING;
  return APP_ERROR;
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause === undefined ? "" : ` (cause: ${describe(error.cause)})`;
  return `${error.name}: ${error.message}${cause}`;
}
