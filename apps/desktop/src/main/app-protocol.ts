import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { CONTENT_SECURITY_POLICY } from "./security.js";

/** Largest request body the proxy forwards; matches the server's own limit. */
const MAX_BODY_BYTES = 1_000_000;
const API_PREFIX = "/api/";
const ALLOWED_METHODS = new Set(["GET", "POST"]);
/** Request headers forwarded to the server; everything else is dropped. */
const FORWARDED_REQUEST_HEADERS = ["content-type", "accept", "last-event-id"] as const;
/** Response headers passed back to the renderer. */
const FORWARDED_RESPONSE_HEADERS = ["content-type", "cache-control"] as const;

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

export interface AppProtocolDeps {
  /** Folder with the built frontend (apps/web/dist). */
  webRoot: string;
  /** Base URL of the local server, or undefined while it is not running. */
  serverUrl: () => string | undefined;
  /** Access token of the local server; added here so the renderer never sees it. */
  token: () => string | undefined;
  fetch: typeof fetch;
}

/**
 * Handler for `exileforge://app/...`. Serves the frontend files and forwards
 * `/api/*` to the local server with the access token attached. The window is
 * therefore same-origin with its backend: no CORS, no token in page code, and
 * a foreign web page can neither reach the server through the app nor read
 * the token.
 */
export function createAppProtocolHandler(deps: AppProtocolDeps) {
  const root = resolve(deps.webRoot);
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!ALLOWED_METHODS.has(request.method)) return error(405, "method_not_allowed");
    if (url.pathname.startsWith(API_PREFIX)) return forwardToServer(request, url, deps);
    if (request.method !== "GET") return error(405, "method_not_allowed");
    return serveFile(root, url.pathname);
  };
}

async function serveFile(root: string, pathname: string): Promise<Response> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return error(400, "bad_path");
  }
  if (/[\0\\:]/.test(decoded)) return error(400, "bad_path");
  const target = resolve(join(root, decoded === "/" ? "index.html" : decoded));
  const rel = relative(root, target);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return error(404, "not_found");
  }
  try {
    const body = await readFile(target);
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": MIME[extname(target).toLowerCase()] ?? "application/octet-stream",
        "content-security-policy": CONTENT_SECURITY_POLICY,
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
      },
    });
  } catch (cause) {
    if (
      (cause as NodeJS.ErrnoException).code === "ENOENT" ||
      (cause as NodeJS.ErrnoException).code === "EISDIR"
    ) {
      return error(404, "not_found");
    }
    return error(500, "file_unreadable");
  }
}

async function forwardToServer(
  request: Request,
  url: URL,
  deps: AppProtocolDeps,
): Promise<Response> {
  const base = deps.serverUrl();
  const token = deps.token();
  if (base === undefined || token === undefined) return error(503, "server_not_ready");
  const headers = new Headers({ authorization: `Bearer ${token}` });
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  let body: ArrayBuffer | undefined;
  if (request.method === "POST") {
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) return error(413, "body_too_large");
  }
  let upstream: Response;
  try {
    upstream = await deps.fetch(`${base}${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      ...(body === undefined ? {} : { body }),
      signal: request.signal,
    });
  } catch (cause) {
    if (request.signal.aborted) return error(499, "client_closed");
    console.error("api proxy: server unreachable", cause);
    return error(502, "server_unreachable");
  }
  const out = new Headers({ "x-content-type-options": "nosniff" });
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) out.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

function error(status: number, code: string, detail?: string): Response {
  return new Response(
    JSON.stringify({ error: { code, message: detail ?? code.replaceAll("_", " ") } }),
    { status, headers: { "content-type": "application/json; charset=utf-8" } },
  );
}
