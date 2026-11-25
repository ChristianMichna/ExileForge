/** Custom scheme the window is loaded from; the renderer never talks to the server directly. */
export const APP_SCHEME = "astrolabe";
export const APP_HOST = "app";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_URL = `${APP_ORIGIN}/index.html`;

/**
 * CSP for every page and file the app serves. Scripts and styles only from the
 * app itself; `connect-src 'self'` means the only reachable backend is the
 * /api proxy of the app protocol, never a foreign host or the MCP endpoint.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

/** True when `url` belongs to the app window's own origin. */
export function isAppUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === `${APP_SCHEME}:` && parsed.host === APP_HOST;
  } catch {
    return false;
  }
}

/** IPC calls are accepted only from a frame that was loaded from the app origin. */
export function isTrustedSender(frameUrl: string | undefined): boolean {
  return frameUrl !== undefined && isAppUrl(frameUrl);
}

/** Only these schemes may leave the app through `shell.openExternal`. */
export function isAllowedExternalUrl(url: string, allowedSchemes: readonly string[]): boolean {
  try {
    return allowedSchemes.includes(new URL(url).protocol);
  } catch {
    return false;
  }
}
