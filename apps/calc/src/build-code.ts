import { MAX_BUILD_PAYLOAD_CHARS } from "@astrolabe/contracts";
import { deflateSync, inflateSync } from "node:zlib";
import { CalcServiceError } from "./errors.ts";

/*
 * PoB build codes are zlib-compressed XML in URL-safe base64. PoB's headless
 * mode has only stubs for Inflate/Deflate, so the supervisor converts codes
 * and the worker only ever sees XML.
 */

const CODE_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/;

/** PoB build code -> build XML. Throws `build_load_failed` on anything else. */
export function decodeBuildCode(code: string): string {
  const clean = code.replace(/\s+/g, "");
  if (!CODE_PATTERN.test(clean)) {
    throw new CalcServiceError(
      "build_load_failed",
      "Not a valid Path of Building code",
      "unexpected characters",
    );
  }
  const raw = Buffer.from(clean.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  let xml: string;
  try {
    // UTF-8 needs at most 4 bytes per character; a larger result cannot pass the limit below.
    xml = inflateSync(raw, { maxOutputLength: MAX_BUILD_PAYLOAD_CHARS * 4 }).toString("utf8");
  } catch (cause) {
    throw new CalcServiceError(
      "build_load_failed",
      "Not a valid Path of Building code",
      cause instanceof Error ? cause.message : String(cause),
      { cause },
    );
  }
  if (xml.length > MAX_BUILD_PAYLOAD_CHARS) {
    throw new CalcServiceError(
      "build_load_failed",
      "Build is too large",
      `${String(xml.length)} characters, limit ${String(MAX_BUILD_PAYLOAD_CHARS)}`,
    );
  }
  return xml;
}

/** Build XML -> PoB build code, in the same format PoB's export produces. */
export function encodeBuildCode(xml: string): string {
  return deflateSync(Buffer.from(xml, "utf8"), { level: 9 })
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
