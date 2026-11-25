import net from "node:net";
import type { GameDataConfig } from "./config.ts";

export interface PatchInfo {
  /** base url of the patch's files, as announced by the update server */
  url: string;
  /** version part of the url, e.g. the directory name the files live under */
  version: string;
}

const URL_START = Buffer.from("https://", "utf16le");
const FIRST_URL_CHAR = 0x21;
const LAST_URL_CHAR = 0x7e;
const PATCH_URL = /^https:\/\/[^/\s]+\/(\d+(?:\.\d+)+)\/?$/;

function isUrlChar(byte: number): boolean {
  return byte >= FIRST_URL_CHAR && byte <= LAST_URL_CHAR;
}

/**
 * The patch server answers with the patch's base url as UTF-16LE text at a
 * fixed offset inside a binary reply. Searching for the text instead of
 * assuming the offset keeps this independent of the header layout.
 */
export function parsePatchReply(reply: Buffer): PatchInfo {
  const start = reply.indexOf(URL_START);
  if (start < 0) throw new Error(`patch server reply holds no url (${String(reply.length)} bytes)`);
  let end = start;
  // url characters are printable ASCII; whatever follows (length bytes, the
  // repeated url) is not part of this url
  while (end + 1 < reply.length && reply[end + 1] === 0 && isUrlChar(reply[end] ?? 0)) end += 2;
  const url = reply.subarray(start, end).toString("utf16le");
  const match = PATCH_URL.exec(url);
  if (!match?.[1]) throw new Error(`patch server announced an unexpected url: ${url}`);
  return { url, version: match[1] };
}

const QUERY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;

/**
 * Asks the update server for the current patch. The server sometimes does not
 * answer, so a failed attempt is repeated; the last failure is thrown with the
 * attempt count. A bad reply is not retried.
 */
export async function queryPatchServer(
  server: GameDataConfig["patchServer"],
  retryDelayMs: number = RETRY_DELAY_MS,
): Promise<PatchInfo> {
  let last: unknown;
  for (let attempt = 1; attempt <= QUERY_ATTEMPTS; attempt++) {
    try {
      return await queryOnce(server);
    } catch (cause) {
      if (cause instanceof BadReplyError) throw cause;
      last = cause;
      if (attempt < QUERY_ATTEMPTS) await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
  throw new Error(`patch server unreachable after ${String(QUERY_ATTEMPTS)} attempts`, {
    cause: last,
  });
}

class BadReplyError extends Error {}

function queryOnce(server: GameDataConfig["patchServer"]): Promise<PatchInfo> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = net.connect({ host: server.host, port: server.port });
    socket.setTimeout(server.timeoutMs);
    socket.on("connect", () => socket.write(Buffer.from(server.handshake)));
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("timeout", () => {
      socket.destroy(new Error(`patch server ${server.host} did not answer in time`));
    });
    socket.on("error", (cause) => {
      reject(
        new Error(`cannot query patch server ${server.host}:${String(server.port)}`, { cause }),
      );
    });
    socket.on("close", (hadError) => {
      if (hadError) return; // the error handler has rejected
      try {
        resolve(parsePatchReply(Buffer.concat(chunks)));
      } catch (cause) {
        reject(new BadReplyError(`bad reply from patch server ${server.host}`, { cause }));
      }
    });
  });
}
